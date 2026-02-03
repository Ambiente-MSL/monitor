import { useEffect, useMemo, useRef, useState } from "react";
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
// Fonte similar à da referência - Impact ou similar
const CLOUD_FONT_FAMILY = "Impact, 'Arial Black', 'Helvetica Neue', sans-serif";
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
    .slice(0, 80); // Mais palavras como na referência

  const counts = limited.map((item) => item.count || 0);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  // Escala maior para ocupar melhor o card
  const minFont = 16;
  const maxFont = 68;

  return limited.map((item, index) => {
    const seed = hashString(item.word || `${index}`);
    const rng = createSeededRandom(seed);
    const baseFont = scaleFont(item.count || 0, minCount, maxCount, minFont, maxFont);
    // Top 1 = muito grande, top 2 = grande, resto proporcional
    let fontSize;
    if (index === 0) {
      fontSize = 96; // Palavra principal maior
    } else if (index === 1) {
      fontSize = 78; // Segunda palavra grande
    } else {
      fontSize = baseFont;
    }
    const color = WORD_COLORS[Math.floor(rng() * WORD_COLORS.length)];
    // Sem variação de opacidade - todas sólidas como na referência
    const opacity = 1;
    // Sem rotação por enquanto para evitar sobreposição
    const rotate = 0;
    // Fonte normal (Impact já é bold)
    const fontWeight = 300;
    return {
      key: `${item.word}-${index}`,
      word: item.word.toLowerCase(), // Palavras em minúsculo
      count: item.count,
      rotate,
      style: {
        fontSize,
        color,
        opacity,
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

// Verifica colisão entre retângulos usando coordenadas do canto superior esquerdo
const hasCollision = (newRect, placed, padding = 1) => {
  for (const item of placed) {
    // Converter centro para canto superior esquerdo para comparação
    const itemLeft = item.x - item.width / 2;
    const itemTop = item.y - item.height / 2;
    const itemRight = itemLeft + item.width;
    const itemBottom = itemTop + item.height;

    const newLeft = newRect.left;
    const newTop = newRect.top;
    const newRight = newLeft + newRect.width;
    const newBottom = newTop + newRect.height;

    // Verificar sobreposição - padding mínimo para palavras coladas
    const p = Math.max(0, padding);
    if (newLeft < itemRight + p &&
        newRight > itemLeft - p &&
        newTop < itemBottom + p &&
        newBottom > itemTop - p) {
      return true;
    }
  }
  return false;
};

const spreadLayoutToFill = (layout, bounds, margin = 10) => {
  if (!Array.isArray(layout) || !layout.length) return layout;
  if (!bounds?.width || !bounds?.height) return layout;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  layout.forEach((item) => {
    const left = item.x - item.width / 2;
    const right = item.x + item.width / 2;
    const top = item.y - item.height / 2;
    const bottom = item.y + item.height / 2;
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, right);
    minY = Math.min(minY, top);
    maxY = Math.max(maxY, bottom);
  });

  const boxWidth = Math.max(1, maxX - minX);
  const boxHeight = Math.max(1, maxY - minY);
  const targetWidth = Math.max(1, bounds.width - margin * 2);
  const targetHeight = Math.max(1, bounds.height - margin * 2);
  const scale = Math.min(targetWidth / boxWidth, targetHeight / boxHeight, 1.18);

  if (scale <= 1.01) return layout;

  const centerX = bounds.width / 2;
  const centerY = bounds.height / 2;
  return layout.map((item) => ({
    ...item,
    x: centerX + (item.x - centerX) * scale,
    y: centerY + (item.y - centerY) * scale,
  }));
};

const buildCloudLayout = (entries, bounds) => {
  if (!entries.length) return [];
  if (!bounds?.width || bounds.width < 200 || !bounds?.height || bounds.height < 150) return [];
  if (typeof document === "undefined") return [];

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const width = bounds.width;
  const height = bounds.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const margin = 5;

  const placed = [];

  // Medir todas as palavras primeiro
  const measured = entries.map((entry) => {
    const { width: textWidth, height: textHeight } = measureWord(
      ctx,
      entry.word,
      entry.style.fontSize,
      entry.style.fontWeight,
    );
    return {
      ...entry,
      textWidth,
      textHeight,
    };
  });

  measured.forEach((entry, index) => {
    const rotated = Math.abs(entry.rotate || 0) === 90;
    const wordWidth = rotated ? entry.textHeight : entry.textWidth;
    const wordHeight = rotated ? entry.textWidth : entry.textHeight;

    let bestX = centerX;
    let bestY = centerY;
    let placedOk = false;

    // Primeira palavra: centralizada horizontalmente, um pouco acima do centro
    if (index === 0) {
      bestY = centerY - wordHeight * 0.3;
      const left = centerX - wordWidth / 2;
      const top = bestY - wordHeight / 2;
      if (left >= margin && top >= margin &&
          left + wordWidth <= width - margin &&
          top + wordHeight <= height - margin) {
        placedOk = true;
      }
    }

    // Segunda palavra: abaixo e levemente à esquerda da primeira (como "greve" na referência)
    if (index === 1 && !placedOk && placed.length > 0) {
      const first = placed[0];
      bestX = first.x - wordWidth * 0.15;
      bestY = first.y + first.height * 0.5 + wordHeight * 0.3;
      const left = bestX - wordWidth / 2;
      const top = bestY - wordHeight / 2;
      const testRect = { left, top, width: wordWidth, height: wordHeight };
      if (left >= margin && top >= margin &&
          left + wordWidth <= width - margin &&
          top + wordHeight <= height - margin &&
          !hasCollision(testRect, placed, 0)) {
        placedOk = true;
      }
    }

    // Demais palavras: espiral muito compacta preenchendo os espaços
    if (!placedOk) {
      // Espiral com passos muito pequenos para encaixe preciso
      for (let step = 0; step < 10000 && !placedOk; step += 1) {
        const angle = step * 0.2;
        const baseRadius = step * 0.5;

        // Elipse horizontal (oval) para formato mais largo
        const testX = centerX + baseRadius * 1.8 * Math.cos(angle);
        const testY = centerY + baseRadius * 0.9 * Math.sin(angle);

        const left = testX - wordWidth / 2;
        const top = testY - wordHeight / 2;

        // Verificar limites
        if (left < margin || top < margin ||
            left + wordWidth > width - margin ||
            top + wordHeight > height - margin) {
          continue;
        }

        // Colisão com padding 0 para máxima proximidade
        const testRect = { left, top, width: wordWidth, height: wordHeight };
        if (!hasCollision(testRect, placed, 0)) {
          bestX = testX;
          bestY = testY;
          placedOk = true;
        }
      }
    }

    if (placedOk) {
      placed.push({
        ...entry,
        x: bestX,
        y: bestY,
        width: wordWidth,
        height: wordHeight,
        zIndex: entries.length - index,
      });
    }
  });

  return spreadLayoutToFill(placed, bounds, margin);
};

const hasLayoutOverlap = (layout, padding = 0) => {
  if (!Array.isArray(layout) || layout.length < 2) return false;
  const p = Math.max(0, padding);
  for (let i = 0; i < layout.length; i += 1) {
    const a = layout[i];
    const aLeft = a.x - a.width / 2;
    const aTop = a.y - a.height / 2;
    const aRight = aLeft + a.width;
    const aBottom = aTop + a.height;
    for (let j = i + 1; j < layout.length; j += 1) {
      const b = layout[j];
      const bLeft = b.x - b.width / 2;
      const bTop = b.y - b.height / 2;
      const bRight = bLeft + b.width;
      const bBottom = bTop + b.height;
      const overlaps = (
        aLeft < bRight + p &&
        aRight + p > bLeft &&
        aTop < bBottom + p &&
        aBottom + p > bTop
      );
      if (overlaps) return true;
    }
  }
  return false;
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
  const packedHasOverlap = useMemo(() => hasLayoutOverlap(packedLayout, 2), [packedLayout]);
  const usePackedLayout = packedLayout.length > 0 && packedLayout.length === entries.length && !packedHasOverlap;
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
