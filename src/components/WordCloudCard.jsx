import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { fetchWithTimeout, isTimeoutError } from "../lib/fetchWithTimeout";
import DataState from "./DataState";

const WORD_COLORS = ["#a855f7", "#6366f1", "#f97316", "#14b8a6", "#facc15", "#22d3ee", "#34d399", "#f472b6", "#60a5fa"];
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
  const weighted = Math.pow(normalized, 0.9);
  return Math.round(minSize + weighted * (maxSize - minSize));
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
  const minFont = 16;
  const maxFont = Math.max(minFont + 10, 60);

  return limited.map((item, index) => {
    const fontSize = scaleFont(item.count || 0, minCount, maxCount, minFont, maxFont);
    const color = WORD_COLORS[index % WORD_COLORS.length];
    const opacity = 0.8 + ((item.count || 0) / (maxCount || 1)) * 0.2;
    const fontWeight = item.count === maxCount ? 800 : item.count >= (minCount + maxCount) / 2 ? 700 : 500;
    return {
      key: `${item.word}-${index}`,
      word: item.word,
      count: item.count,
      style: {
        fontSize,
        color,
        opacity: Math.min(1, opacity),
        fontWeight,
      },
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
  igUserId,
  since,
  until,
  top = 30,
  showCommentsCount = true,
  onCommentsCountRender = null,
  onWordClick = null,
  externalPanelMode = false,
}) {
  const sanitizedBaseUrl = useMemo(() => (apiBaseUrl || "").replace(/\/$/, ""), [apiBaseUrl]);
  const [loadingSlow, setLoadingSlow] = useState(false);
  const [selectedWord, setSelectedWord] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsLoadingMore, setDetailsLoadingMore] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const requestKey = useMemo(() => {
    if (!igUserId) return null;
    const params = new URLSearchParams({ igUserId });
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    const limitedTop = Math.min(Math.max(top || 30, 1), 30);
    params.set("top", String(limitedTop));
    const path = `/api/instagram/comments/wordcloud?${params.toString()}`;
    return sanitizedBaseUrl ? `${sanitizedBaseUrl}${path}` : path;
  }, [igUserId, since, until, top, sanitizedBaseUrl]);

  useEffect(() => {
    setLoadingSlow(false);
  }, [requestKey]);

  const buildDetailsUrl = (word, offset = 0) => {
    if (!igUserId || !word) return null;
    const params = new URLSearchParams({
      igUserId,
      word,
      limit: String(DETAILS_PAGE_SIZE),
      offset: String(offset),
    });
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    const path = `/api/instagram/comments/search?${params.toString()}`;
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
  }, [selectedWord, igUserId, since, until, sanitizedBaseUrl]);

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

  if (!igUserId) {
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

  const entries = buildCloudEntries(data?.words || []);

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

      <div className="ig-word-cloud ig-word-cloud--large">
        {entries.map((item, index) => {
          const handleWordClick = () => {
            if (externalPanelMode && onWordClick) {
              onWordClick(item.word, item.count);
            } else {
              setSelectedWord(item.word);
            }
          };
          if (index === 0) {
            return (
              <button
                key={item.key}
                className="ig-word-cloud__word"
                style={{
                  ...item.style,
                  color: "#ef4444",
                  fontSize: Math.max(item.style.fontSize, 64),
                  fontWeight: 900,
                  width: "100%",
                  textAlign: "center",
                }}
                title={`${item.word} (${item.count})`}
                type="button"
                onClick={handleWordClick}
                aria-label={`Ver comentarios com ${item.word}`}
              >
                {item.word}
              </button>
            );
          }
          return (
            <button
              key={item.key}
              className="ig-word-cloud__word"
              style={item.style}
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
                        className="ig-word-detail-pagination__btn"
                        onClick={handlePrevPage}
                        disabled={!canGoPrev || detailsLoadingMore}
                        aria-label="Página anterior"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="15 18 9 12 15 6" />
                        </svg>
                      </button>
                      <span className="ig-word-detail-pagination__info">
                        {detailsLoadingMore ? (
                          "Carregando..."
                        ) : (
                          <>Página {currentPage} de {totalServerPages}</>
                        )}
                      </span>
                      <button
                        type="button"
                        className="ig-word-detail-pagination__btn"
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
