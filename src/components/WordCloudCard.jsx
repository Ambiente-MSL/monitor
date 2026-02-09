import { useEffect, useMemo, useRef, useState } from "react";
import cloud from "d3-cloud";
import { scaleSqrt } from "d3";
import useSWR from "swr";
import { fetchWithTimeout, isTimeoutError } from "../lib/fetchWithTimeout";
import DataState from "./DataState";

// Cores como na imagem de referência - verdes, laranjas, vermelhos, pretos
const WORD_COLORS = [
  "#2d5016", // verde escuro
  "#4d7c0f", // verde
  "#65a30d", // verde claro
  "#15803d", // verde médio
  "#b45309", // laranja escuro
  "#ea580c", // laranja
  "#f59e0b", // amarelo/laranja
  "#dc2626", // vermelho
  "#b91c1c", // vermelho escuro
  "#1f2937", // preto/cinza escuro
  "#374151", // cinza
];
// Fonte clássica de wordcloud (próxima ao exemplo)
const CLOUD_FONT_FAMILY = "Impact, 'Arial Black', Arial, sans-serif";
const DEFAULT_MIN_FONT = 14;
const DEFAULT_MAX_FONT = 120;
const DEFAULT_CLOUD_PADDING = 0;
const RESIZE_DEBOUNCE_MS = 150;
const MAX_RETRY_PASSES = 2;
const FONT_BOOST_FACTOR = 1.10;
const DETAILS_PAGE_SIZE = 50;
const COMMENTS_PER_PAGE = 10;

const fetcher = async (url) => {
  let response;
  try {
    response = await fetchWithTimeout(url);
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error("Tempo esgotado ao carregar nuvem de palavras.");
    }
    throw err;
  }
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Falha ao carregar nuvem de palavras.");
  }
  return response.json();
};

const hashString = (value) => {
  let hash = 0;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return hash >>> 0;
};

const createSeededRandom = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const buildCloudEntries = (words, { minFont, maxFont, maxWords = 100 }) => {
  if (!Array.isArray(words) || words.length === 0) return [];

  const limited = words
    .map((item, index) => {
      if (!item) return null;
      const text = item.word ?? item.text;
      if (!text) return null;
      const rawValue = item.count ?? item.value ?? 0;
      const value = Number.isFinite(rawValue) ? Number(rawValue) : Number(rawValue) || 0;
      return { text: String(text), value, originalIndex: index };
    })
    .filter(Boolean)
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .slice(0, maxWords); // Mais palavras como na referência

  if (!limited.length) return [];

  const values = limited.map((item) => item.value || 0);
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);
  const fallbackSize = Math.round((minFont + maxFont) / 2);
  const scale = scaleSqrt().domain([minValue, maxValue]).range([minFont, maxFont]);

  return limited.map((item) => {
    const seed = hashString(item.text || `${item.originalIndex}`);
    const rng = createSeededRandom(seed);
    const fontSize = minValue === maxValue
      ? fallbackSize
      : Math.round(scale(item.value));
    const color = WORD_COLORS[Math.floor(rng() * WORD_COLORS.length)];
    // Sem variação de opacidade - todas sólidas como na referência
    const opacity = 1;
    // Fonte forte como na referência
    const fontWeight = 700;
    return {
      key: `${item.text}-${item.originalIndex}`,
      text: item.text.toLowerCase(), // Palavras em minúsculo
      value: item.value,
      style: {
        fontSize,
        color,
        opacity,
        fontWeight,
        fontFamily: CLOUD_FONT_FAMILY,
      },
      size: fontSize,
      color,
    };
  });
};

const formatDetailDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
};

export default function WordCloudCard({
  apiBaseUrl = "",
  platform = "instagram",
  igUserId,
  pageId,
  accountId,
  since,
  until,
  top = 30,
  minFont = DEFAULT_MIN_FONT,
  maxFont = DEFAULT_MAX_FONT,
  cloudPadding = DEFAULT_CLOUD_PADDING,
  allowRotate = false,
  showCommentsCount = true,
  onCommentsCountRender = null,
  onWordClick = null,
  externalPanelMode = false,
}) {
  const resolvedPlatform = platform === "facebook" ? "facebook" : "instagram";
  const resolvedAccountId = resolvedPlatform === "facebook"
    ? (pageId || accountId)
    : (igUserId || accountId);
  const sanitizedBaseUrl = useMemo(() => (apiBaseUrl || "").replace(/\/$/, ""), [apiBaseUrl]);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [selectedWord, setSelectedWord] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsLoadingMore, setDetailsLoadingMore] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const cloudRef = useRef(null);
  const [cloudSize, setCloudSize] = useState({ width: 0, height: 0 });
  const [layoutWords, setLayoutWords] = useState([]);
  const [isLayouting, setIsLayouting] = useState(false);
  const layoutRef = useRef(null);
  const layoutTimerRef = useRef(null);

  const requestKey = useMemo(() => {
    if (!resolvedAccountId) return null;
    const accountParam = resolvedPlatform === "facebook" ? "pageId" : "igUserId";
    const params = new URLSearchParams({ [accountParam]: resolvedAccountId });
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    const limitedTop = Math.min(Math.max(top || 30, 1), 30);
    params.set("top", String(limitedTop));
    const path = `/api/${resolvedPlatform}/comments/wordcloud?${params.toString()}`;
    return sanitizedBaseUrl ? `${sanitizedBaseUrl}${path}` : path;
  }, [resolvedAccountId, resolvedPlatform, since, until, top, sanitizedBaseUrl]);

  useEffect(() => {
    setLoadingSlow(false);
  }, [requestKey]);

  const buildDetailsUrl = (word, offset = 0) => {
    if (!resolvedAccountId || !word) return null;
    const accountParam = resolvedPlatform === "facebook" ? "pageId" : "igUserId";
    const params = new URLSearchParams({
      [accountParam]: resolvedAccountId,
      word,
      limit: String(DETAILS_PAGE_SIZE),
      offset: String(offset),
    });
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    const path = `/api/${resolvedPlatform}/comments/search?${params.toString()}`;
    return sanitizedBaseUrl ? `${sanitizedBaseUrl}${path}` : path;
  };

  const fetchWordDetails = async (word, offset = 0) => {
    const url = buildDetailsUrl(word, offset);
    if (!url) return null;
    let response;
    try {
      response = await fetchWithTimeout(url);
    } catch (err) {
      if (isTimeoutError(err)) {
        throw new Error("Tempo esgotado ao carregar comentarios.");
      }
      throw err;
    }
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Falha ao carregar comentarios.");
    }
    return response.json();
  };

  const closeDetails = () => {
    setSelectedWord(null);
    setDetails(null);
    setDetailsError("");
    setDetailsLoading(false);
    setDetailsLoadingMore(false);
    setCurrentPage(1);
  };

  useEffect(() => {
    if (!selectedWord) return undefined;
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError("");
    setDetails(null);
    setCurrentPage(1);
    fetchWordDetails(selectedWord, 0)
      .then((payload) => {
        if (cancelled) return;
        setDetails(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        setDetailsError(err?.message || "Falha ao carregar comentarios.");
      })
      .finally(() => {
        if (cancelled) return;
        setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWord, resolvedAccountId, resolvedPlatform, since, until, sanitizedBaseUrl]);

  useEffect(() => {
    if (!selectedWord) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeDetails();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
    return undefined;
  }, [selectedWord]);

  const { data, error, isLoading, isValidating } = useSWR(requestKey, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    keepPreviousData: true,
    loadingTimeout: 3000,
    onLoadingSlow: () => setLoadingSlow(true),
  });

  const entries = useMemo(
    () => buildCloudEntries(data?.words || [], { minFont, maxFont }),
    [data, minFont, maxFont],
  );
  const cloudClassName = "ig-word-cloud ig-word-cloud--large";

  // Build a deterministic seed from account + date range
  const layoutSeed = useMemo(() => {
    const seedStr = `${resolvedAccountId || ""}_${since || ""}_${until || ""}`;
    return hashString(seedStr);
  }, [resolvedAccountId, since, until]);

  useEffect(() => {
    if (!entries.length || !cloudSize.width || !cloudSize.height) {
      setLayoutWords([]);
      setIsLayouting(false);
      return undefined;
    }

    let cancelled = false;
    setIsLayouting(true);

    if (layoutTimerRef.current) {
      clearTimeout(layoutTimerRef.current);
    }

    layoutTimerRef.current = setTimeout(() => {
      if (cancelled) return;

      const w = cloudSize.width;
      const h = cloudSize.height;

      // Compute bounding-box fill ratio to decide if a retry is needed
      const computeFillRatio = (words) => {
        if (!words.length) return 0;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const wd of words) {
          const halfW = (wd.size * (wd.text?.length || 1) * 0.6) / 2;
          const halfH = wd.size / 2;
          const rotated = wd.rotate === 90 || wd.rotate === -90;
          const hw = rotated ? halfH : halfW;
          const hh = rotated ? halfW : halfH;
          if (wd.x - hw < minX) minX = wd.x - hw;
          if (wd.y - hh < minY) minY = wd.y - hh;
          if (wd.x + hw > maxX) maxX = wd.x + hw;
          if (wd.y + hh > maxY) maxY = wd.y + hh;
        }
        const bboxW = maxX - minX || 1;
        const bboxH = maxY - minY || 1;
        // After fit-to-box the cloud will fill the container,
        // but we want to know how "full" the internal canvas is
        return (bboxW * bboxH) / (w * h);
      };

      let passCount = 0;
      let fontBoost = 1;

      const runPass = () => {
        if (cancelled) return;
        passCount++;
        const seededRng = createSeededRandom(layoutSeed + passCount);

        // Larger internal canvas so d3-cloud can place more words
        const internalW = w * 1.6;
        const internalH = h * 1.6;

        const wordsForLayout = entries.map((entry) => ({
          ...entry,
          size: Math.round(entry.size * fontBoost),
        }));

        const layout = cloud()
          .size([internalW, internalH])
          .words(wordsForLayout)
          .padding(Math.max(0, Number(cloudPadding) || 0))
          .spiral("rectangular")
          .random(seededRng)
          .rotate(() => (seededRng() < 0.05 ? 90 : 0))
          .font(CLOUD_FONT_FAMILY)
          .fontWeight(700)
          .fontSize((d) => d.size)
          .timeInterval(4000)
          .on("end", (computed) => {
            if (cancelled) return;

            const fillRatio = computeFillRatio(computed);

            // If fill is low and we haven't retried too much, boost fonts and retry
            if (fillRatio < 0.75 && passCount < MAX_RETRY_PASSES) {
              fontBoost *= FONT_BOOST_FACTOR;
              runPass();
              return;
            }

            setLayoutWords(computed);
            setIsLayouting(false);
          });

        layoutRef.current = layout;
        layout.start();
      };

      runPass();
    }, RESIZE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (layoutTimerRef.current) {
        clearTimeout(layoutTimerRef.current);
      }
      if (layoutRef.current) {
        layoutRef.current.stop();
      }
    };
  }, [entries, cloudSize.width, cloudSize.height, cloudPadding, allowRotate, layoutSeed]);

  useEffect(() => {
    const node = cloudRef.current;
    if (!node) return undefined;

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setCloudSize((prev) => {
        const next = { width: rect.width, height: rect.height };
        if (Math.abs(prev.width - next.width) < 1 && Math.abs(prev.height - next.height) < 1) {
          return prev;
        }
        return next;
      });
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver((entries) => {
      if (!entries || !entries.length) return;
      const { width, height } = entries[0].contentRect || {};
      if (!width || !height) return;
      setCloudSize((prev) => {
        if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) {
          return prev;
        }
        return { width, height };
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [entries.length]);

  const hasMoreDetails = useMemo(() => {
    if (!details) return false;
    const total = Number(details.total_comments || 0);
    const current = Array.isArray(details.comments) ? details.comments.length : 0;
    return total > current;
  }, [details]);

  const paginatedComments = useMemo(() => {
    if (!details || !Array.isArray(details.comments)) return [];
    const startIndex = (currentPage - 1) * COMMENTS_PER_PAGE;
    const endIndex = startIndex + COMMENTS_PER_PAGE;
    return details.comments.slice(startIndex, endIndex);
  }, [details, currentPage]);

  const totalLoadedPages = useMemo(() => {
    if (!details || !Array.isArray(details.comments)) return 0;
    return Math.ceil(details.comments.length / COMMENTS_PER_PAGE);
  }, [details]);

  const totalServerPages = useMemo(() => {
    if (!details) return 0;
    return Math.ceil((details.total_comments || 0) / COMMENTS_PER_PAGE);
  }, [details]);

  const canGoNext = currentPage < totalLoadedPages || hasMoreDetails;
  const canGoPrev = currentPage > 1;
  const svgWidth = Math.max(1, cloudSize.width || 1);
  const svgHeight = Math.max(1, cloudSize.height || 1);
  const hasLayout = layoutWords.length > 0;

  // Compute bounding box and fit-to-box transform
  const cloudTransform = useMemo(() => {
    if (!hasLayout || !layoutWords.length) {
      return `translate(${svgWidth / 2}, ${svgHeight / 2})`;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of layoutWords) {
      // Approximate bounding box per word
      const halfW = (w.size * (w.text?.length || 1) * 0.6) / 2;
      const halfH = w.size / 2;
      const rotated = w.rotate === 90 || w.rotate === -90;
      const hw = rotated ? halfH : halfW;
      const hh = rotated ? halfW : halfH;
      const x1 = w.x - hw, x2 = w.x + hw;
      const y1 = w.y - hh, y2 = w.y + hh;
      if (x1 < minX) minX = x1;
      if (y1 < minY) minY = y1;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
    }

    const bboxW = maxX - minX || 1;
    const bboxH = maxY - minY || 1;
    const bboxCX = (minX + maxX) / 2;
    const bboxCY = (minY + maxY) / 2;

    const scaleX = (svgWidth * 0.98) / bboxW;
    const scaleY = (svgHeight * 0.94) / bboxH;
    const s = Math.min(scaleX, scaleY, 2.0); // cap scale to avoid over-zoom on few words

    const tx = svgWidth / 2 - bboxCX * s;
    const ty = svgHeight / 2 - bboxCY * s;

    return `translate(${tx}, ${ty}) scale(${s})`;
  }, [layoutWords, hasLayout, svgWidth, svgHeight]);

  const handleLoadMore = async () => {
    if (!selectedWord || !details || detailsLoadingMore) return;
    const currentCount = Array.isArray(details.comments) ? details.comments.length : 0;
    setDetailsLoadingMore(true);
    try {
      const payload = await fetchWordDetails(selectedWord, currentCount);
      const nextComments = Array.isArray(payload?.comments) ? payload.comments : [];
      setDetails((prev) => {
        if (!prev) return payload;
        const merged = Array.isArray(prev.comments) ? [...prev.comments, ...nextComments] : nextComments;
        return {
          ...prev,
          comments: merged,
          total_comments: payload?.total_comments ?? prev.total_comments,
          total_occurrences: payload?.total_occurrences ?? prev.total_occurrences,
        };
      });
    } catch (err) {
      setDetailsError(err?.message || "Falha ao carregar comentarios.");
    } finally {
      setDetailsLoadingMore(false);
    }
  };

  const handleNextPage = async () => {
    if (detailsLoadingMore) return;
    if (currentPage < totalLoadedPages) {
      setCurrentPage((prev) => prev + 1);
    } else if (hasMoreDetails) {
      await handleLoadMore();
      setCurrentPage((prev) => prev + 1);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  const handleGoToPage = async (page) => {
    if (detailsLoadingMore || page === currentPage) return;
    if (page <= totalLoadedPages) {
      setCurrentPage(page);
    } else if (page <= totalServerPages) {
      // Precisamos carregar mais dados antes de ir para essa página
      const neededComments = page * COMMENTS_PER_PAGE;
      const currentCount = Array.isArray(details?.comments) ? details.comments.length : 0;
      if (neededComments > currentCount && hasMoreDetails) {
        setDetailsLoadingMore(true);
        try {
          const payload = await fetchWordDetails(selectedWord, currentCount);
          const nextComments = Array.isArray(payload?.comments) ? payload.comments : [];
          setDetails((prev) => {
            if (!prev) return payload;
            const merged = Array.isArray(prev.comments) ? [...prev.comments, ...nextComments] : nextComments;
            return {
              ...prev,
              comments: merged,
              total_comments: payload?.total_comments ?? prev.total_comments,
              total_occurrences: payload?.total_occurrences ?? prev.total_occurrences,
            };
          });
          setCurrentPage(page);
        } catch (err) {
          setDetailsError(err?.message || "Falha ao carregar comentarios.");
        } finally {
          setDetailsLoadingMore(false);
        }
      }
    }
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;

    if (totalServerPages <= maxVisible) {
      for (let i = 1; i <= totalServerPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= Math.min(maxVisible, totalServerPages); i++) {
          pages.push(i);
        }
        if (totalServerPages > maxVisible) {
          pages.push('...');
          pages.push(totalServerPages);
        }
      } else if (currentPage >= totalServerPages - 2) {
        pages.push(1);
        pages.push('...');
        for (let i = totalServerPages - maxVisible + 1; i <= totalServerPages; i++) {
          if (i > 1) pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalServerPages);
      }
    }
    return pages;
  };

  if (!resolvedAccountId) {
    return (
      <DataState
        state="empty"
        label="Selecione um perfil para visualizar os comentarios."
        size="lg"
      />
    );
  }

  if (isLoading) {
    return (
      <DataState
        state="loading"
        label="Carregando palavras-chave..."
        hint={loadingSlow ? "Isso pode levar alguns segundos na primeira vez." : null}
        size="lg"
      />
    );
  }

  if (error) {
    return (
      <DataState
        state="error"
        label="Falha ao carregar a nuvem de palavras."
        hint={error.message}
        size="lg"
      />
    );
  }

  // Chama callback com o total de comentarios se fornecido
  if (onCommentsCountRender && typeof data?.total_comments === "number") {
    onCommentsCountRender(data.total_comments);
  }

  if (!entries.length) {
    return <DataState state="empty" label="Sem dados no periodo." size="lg" />;
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {isValidating && entries.length ? (
        <div className="flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-medium text-slate-600">
          <span className="inline-flex h-2 w-2 rounded-full bg-indigo-500" />
          <span>Atualizando palavras-chave...</span>
        </div>
      ) : null}
      {showCommentsCount && typeof data.total_comments === "number" ? (
        <div className="flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-medium text-slate-600">
          <span className="inline-flex h-2 w-2 rounded-full bg-rose-500" />
          <span>
            {data.total_comments} comentario{data.total_comments === 1 ? "" : "s"} analisado{data.total_comments === 1 ? "" : "s"} no periodo
          </span>
        </div>
      ) : null}

      <div className={cloudClassName} ref={cloudRef}>
        {isLayouting || !hasLayout ? (
          <DataState
            state="loading"
            label="Gerando nuvem de palavras..."
            size="lg"
          />
        ) : (
          <svg
            className="ig-word-cloud__svg"
            width={svgWidth}
            height={svgHeight}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            role="img"
            aria-label="Nuvem de palavras"
          >
            <g transform={cloudTransform}>
              {layoutWords.map((item) => {
                const handleWordClick = () => {
                  if (externalPanelMode && onWordClick) {
                    onWordClick(item.text, item.value);
                  } else {
                    setSelectedWord(item.text);
                  }
                };
                const handleWordKeyDown = (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleWordClick();
                  }
                };
                return (
                  <text
                    key={item.key || item.text}
                    className="ig-word-cloud__word"
                    textAnchor="middle"
                    transform={`translate(${item.x}, ${item.y}) rotate(${item.rotate || 0})`}
                    style={{
                      fontSize: item.size,
                      fontFamily: CLOUD_FONT_FAMILY,
                      fontWeight: 700,
                      fill: item.color,
                      opacity: 1,
                    }}
                    role="button"
                    tabIndex={0}
                    onClick={handleWordClick}
                    onKeyDown={handleWordKeyDown}
                    aria-label={`Ver comentarios com ${item.text}`}
                  >
                    <title>{`${item.text} (${item.value ?? 0})`}</title>
                    {item.text}
                  </text>
                );
              })}
            </g>
          </svg>
        )}
      </div>

      {selectedWord && !externalPanelMode && (
        <div className="ig-word-detail-modal" role="dialog" aria-modal="true" aria-label={`Comentarios com ${selectedWord}`}>
          <div className="ig-word-detail-modal__backdrop" onClick={closeDetails} aria-hidden="true" />
          <div className="ig-word-detail-modal__content">
            <div className="ig-word-detail-modal__header">
              <div>
                <h3>Comentarios com "{selectedWord}"</h3>
                {details && !detailsLoading && !detailsError ? (
                  <p>
                    {details.total_occurrences} ocorrencia{details.total_occurrences === 1 ? "" : "s"} em {details.total_comments} comentario{details.total_comments === 1 ? "" : "s"}.
                  </p>
                ) : (
                  <p>Buscando ocorrencias no periodo selecionado.</p>
                )}
              </div>
              <button type="button" className="ig-word-detail-modal__close" onClick={closeDetails} aria-label="Fechar">
                ✕
              </button>
            </div>
            <div className="ig-word-detail-modal__body">
              {detailsLoading ? (
                <DataState state="loading" label="Carregando comentarios..." size="sm" />
              ) : detailsError ? (
                <DataState state="error" label="Falha ao carregar comentarios." hint={detailsError} size="sm" />
              ) : details && Array.isArray(details.comments) && details.comments.length ? (
                <>
                  <ul className="ig-word-detail-list">
                    {paginatedComments.map((comment) => (
                      <li key={comment.id || `${comment.text}-${comment.timestamp}`} className="ig-word-detail-list__item">
                        <div className="ig-word-detail-list__row">
                          <div className="ig-word-detail-list__avatar">
                            {comment.username ? (
                              <img
                                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(comment.username)}&background=6366f1&color=fff&size=40&bold=true`}
                                alt={comment.username}
                                className="ig-word-detail-list__avatar-img"
                              />
                            ) : (
                              <div className="ig-word-detail-list__avatar-placeholder">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                  <circle cx="12" cy="7" r="4" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="ig-word-detail-list__content">
                            <div className="ig-word-detail-list__header">
                              <span className="ig-word-detail-list__user">
                                {comment.username ? `@${comment.username}` : "Usuário"}
                              </span>
                              {comment.timestamp && (
                                <span className="ig-word-detail-list__date">
                                  {formatDetailDate(comment.timestamp)}
                                </span>
                              )}
                            </div>
                            <p className="ig-word-detail-list__text">{comment.text}</p>
                            <div className="ig-word-detail-list__footer">
                              <span className="ig-word-detail-list__likes">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                </svg>
                                {comment.like_count || 0}
                              </span>
                              {comment.occurrences > 1 && (
                                <span className="ig-word-detail-list__badge">
                                  {comment.occurrences}x "{selectedWord}"
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {(totalServerPages > 1 || hasMoreDetails) && (
                    <div className="ig-word-detail-pagination">
                      <button
                        type="button"
                        className="ig-word-detail-pagination__btn ig-word-detail-pagination__arrow"
                        onClick={handlePrevPage}
                        disabled={!canGoPrev || detailsLoadingMore}
                        aria-label="Página anterior"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                      </button>
                      <div className="ig-word-detail-pagination__pages">
                        {detailsLoadingMore ? (
                          <span className="ig-word-detail-pagination__loading">Carregando...</span>
                        ) : (
                          getPageNumbers().map((page, index) => (
                            page === '...' ? (
                              <span key={`ellipsis-${index}`} className="ig-word-detail-pagination__ellipsis">...</span>
                            ) : (
                              <button
                                key={page}
                                type="button"
                                className={`ig-word-detail-pagination__page ${currentPage === page ? 'ig-word-detail-pagination__page--active' : ''}`}
                                onClick={() => handleGoToPage(page)}
                                disabled={detailsLoadingMore}
                              >
                                {page}
                              </button>
                            )
                          ))
                        )}
                      </div>
                      <button
                        type="button"
                        className="ig-word-detail-pagination__btn ig-word-detail-pagination__arrow"
                        onClick={handleNextPage}
                        disabled={!canGoNext || detailsLoadingMore}
                        aria-label="Próxima página"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <DataState state="empty" label="Nenhum comentario encontrado com essa palavra." size="sm" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
