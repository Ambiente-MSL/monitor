import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetchWithTimeout, isTimeoutError } from "../lib/fetchWithTimeout";
import DataState from "./DataState";

const WORD_COLORS = [
  "#4d7c0f",
  "#65a30d",
  "#15803d",
  "#a16207",
  "#b45309",
  "#ea580c",
  "#f59e0b",
  "#b91c1c",
  "#7c2d12",
];
const CLOUD_FONT_FAMILY = "'Lato', 'Segoe UI', sans-serif";
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

const scaleFont = (count, min, max, minSize, maxSize) => {
  if (!Number.isFinite(count)) return minSize;
  if (max <= min) return Math.round((minSize + maxSize) / 2);
  const normalized = (count - min) / (max - min);
  const weighted = Math.pow(normalized, 0.75);
  return Math.round(minSize + weighted * (maxSize - minSize));
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

const buildCloudEntries = (words) => {
  if (!Array.isArray(words) || words.length === 0) return [];
  const limited = words
    .filter((item) => item && item.word)
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 30);

  const counts = limited.map((item) => item.count || 0);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const minFont = 14;
  const maxFont = Math.max(minFont + 18, 72);

  return limited.map((item, index) => {
    const seed = hashString(item.word || `${index}`);
    const rng = createSeededRandom(seed);
    const baseFont = scaleFont(item.count || 0, minCount, maxCount, minFont, maxFont);
    const fontSize = index === 0 ? Math.min(baseFont + 8, 84) : baseFont;
    const color = index === 0 ? "#4d7c0f" : WORD_COLORS[Math.floor(rng() * WORD_COLORS.length)];
    const opacity = 0.85 + ((item.count || 0) / (maxCount || 1)) * 0.15;
    const rotateRoll = rng();
    const rotate = rotateRoll < 0.14 ? (rng() < 0.5 ? -90 : 90) : 0;
    const fontWeight = index === 0 ? 900 : item.count === maxCount ? 800 : item.count >= (minCount + maxCount) / 2 ? 700 : 600;
    return {
      key: `${item.word}-${index}`,
      word: item.word,
      count: item.count,
      rotate,
      style: {
        fontSize,
        color,
        opacity: Math.min(1, opacity),
        fontWeight,
        fontFamily: CLOUD_FONT_FAMILY,
      },
    };
  });
};

const measureWord = (ctx, word, fontSize, fontWeight) => {
  ctx.font = `${fontWeight || 600} ${fontSize}px ${CLOUD_FONT_FAMILY}`;
  const metrics = ctx.measureText(word);
  return {
    width: Math.ceil(metrics.width),
    height: Math.ceil(fontSize * 1.05),
  };
};

const hasCollision = (rect, placed, padding = 6) => placed.some((item) => (
  rect.x < item.x + item.width + padding
    && rect.x + rect.width + padding > item.x
    && rect.y < item.y + item.height + padding
    && rect.y + rect.height + padding > item.y
));

const buildCloudLayout = (entries, bounds) => {
  if (!entries.length || !bounds?.width || !bounds?.height) return [];
  if (typeof document === "undefined") return [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const margin = 16;
  const width = Math.max(bounds.width - margin * 2, 200);
  const height = Math.max(bounds.height - margin * 2, 160);
  const centerX = width / 2 + margin;
  const centerY = height / 2 + margin;
  // Usar proporção horizontal maior para expandir mais na largura
  const aspectRatio = width / height;
  const maxRadiusX = width / 2 - margin;
  const maxRadiusY = height / 2 - margin;
  const maxAttempts = 1200;

  const placed = [];
  entries.forEach((entry, index) => {
    const { width: textWidth, height: textHeight } = measureWord(
      ctx,
      entry.word,
      entry.style.fontSize,
      entry.style.fontWeight,
    );
    const rotated = Math.abs(entry.rotate) === 90;
    const wordWidth = rotated ? textHeight : textWidth;
    const wordHeight = rotated ? textWidth : textHeight;

    let x = centerX;
    let y = centerY;
    let placedOk = index === 0;

    if (!placedOk) {
      // Espiral de Arquimedes com expansão horizontal
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const angle = attempt * 0.5; // Ângulo maior para espiral mais aberta
        const baseRadius = 4 + attempt * 2.5; // Raio crescente mais rápido
        // Expandir mais horizontalmente que verticalmente
        const radiusX = Math.min(maxRadiusX, baseRadius * Math.max(1, aspectRatio * 0.7));
        const radiusY = Math.min(maxRadiusY, baseRadius * 0.8);
        x = centerX + radiusX * Math.cos(angle);
        y = centerY + radiusY * Math.sin(angle);
        const rect = {
          x: x - wordWidth / 2,
          y: y - wordHeight / 2,
          width: wordWidth,
          height: wordHeight,
        };
        if (
          rect.x < margin
          || rect.y < margin
          || rect.x + rect.width > width + margin
          || rect.y + rect.height > height + margin
        ) {
          continue;
        }
        if (!hasCollision(rect, placed, 8)) {
          placedOk = true;
          break;
        }
      }
    }

    if (!placedOk) {
      // Fallback: distribuir em grid elíptico
      const fallbackAngle = index * 0.7 + Math.PI / 4;
      const fallbackRadiusX = Math.min(maxRadiusX * 0.8, 20 + index * 8);
      const fallbackRadiusY = Math.min(maxRadiusY * 0.8, 15 + index * 5);
      x = centerX + fallbackRadiusX * Math.cos(fallbackAngle);
      y = centerY + fallbackRadiusY * Math.sin(fallbackAngle);
    }

    placed.push({
      ...entry,
      x,
      y,
      width: wordWidth,
      height: wordHeight,
      zIndex: Math.round(entry.style.fontSize || 0),
    });
  });

  return placed;
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

  const entries = useMemo(() => buildCloudEntries(data?.words || []), [data]);
  const packedLayout = useMemo(() => buildCloudLayout(entries, cloudSize), [entries, cloudSize]);
  const usePackedLayout = packedLayout.length > 0 && packedLayout.length === entries.length;
  const cloudEntries = usePackedLayout ? packedLayout : entries;
  const cloudClassName = `ig-word-cloud ig-word-cloud--large${usePackedLayout ? " ig-word-cloud--packed" : ""}`;

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
        {cloudEntries.map((item) => {
          const handleWordClick = () => {
            if (externalPanelMode && onWordClick) {
              onWordClick(item.word, item.count);
            } else {
              setSelectedWord(item.word);
            }
          };
          const wordStyle = usePackedLayout ? {
            ...item.style,
            left: item.x,
            top: item.y,
            zIndex: item.zIndex,
            "--wc-rotate": `${item.rotate || 0}deg`,
          } : item.style;
          return (
            <button
              key={item.key}
              className="ig-word-cloud__word"
              style={wordStyle}
              title={`${item.word} (${item.count})`}
              type="button"
              onClick={handleWordClick}
              aria-label={`Ver comentarios com ${item.word}`}
            >
              {item.word}
            </button>
          );
        })}
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
