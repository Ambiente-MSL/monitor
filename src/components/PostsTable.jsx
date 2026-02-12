import React, { useState, useCallback, useMemo } from 'react';
import DataState from './DataState';

const PostsTable = ({ posts, loading, error }) => {
  const [sortKey, setSortKey] = useState('timestamp');
  const [sortDir, setSortDir] = useState('desc');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'list'
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedPost, setExpandedPost] = useState(null);

  const formatNumber = (value) => {
    if (value == null || value === '--') return '--';
    const num = Number(value);
    if (!Number.isFinite(num)) return '--';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString('pt-BR');
  };

  const resolvePostMetric = useCallback((post, metricKey, fallback = 0) => {
    const candidates = [
      post?.[metricKey],
      post?.[`${metricKey}_count`],
      post?.[`${metricKey}Count`],
    ];

    if (metricKey === 'likes') {
      candidates.push(post?.likeCount, post?.like_count);
    } else if (metricKey === 'comments') {
      candidates.push(post?.commentsCount, post?.comments_count);
    } else if (metricKey === 'saves') {
      candidates.push(post?.saveCount, post?.saved, post?.saved_count);
    } else if (metricKey === 'shares') {
      candidates.push(post?.shareCount, post?.shares_count);
    } else if (metricKey === 'reach') {
      candidates.push(post?.reachCount, post?.reach_count);
    } else if (metricKey === 'plays') {
      candidates.push(post?.playCount, post?.plays_count, post?.videoViews, post?.video_views);
    } else if (metricKey === 'interactions') {
      candidates.push(post?.totalInteractions, post?.total_interactions);
    }

    for (const candidate of candidates) {
      if (candidate == null) continue;
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) return numeric;
    }
    return fallback;
  }, []);

  const getPostType = (post) => {
    const mediaType = post?.media_type?.toLowerCase() || post?.mediaType?.toLowerCase() || '';
    if (mediaType.includes('video') || mediaType.includes('reel')) return 'video';
    if (mediaType.includes('carousel') || mediaType.includes('album')) return 'carousel';
    return 'image';
  };

  const getPostTypeLabel = (type) => {
    if (type === 'video') return 'Vídeo';
    if (type === 'carousel') return 'Carrossel';
    return 'Imagem';
  };

  const getEngagement = useCallback((post) => {
    const likes = resolvePostMetric(post, 'likes', 0);
    const comments = resolvePostMetric(post, 'comments', 0);
    const shares = resolvePostMetric(post, 'shares', 0);
    const saves = resolvePostMetric(post, 'saves', 0);
    const reach = resolvePostMetric(post, 'reach', 0);
    const interactions = likes + comments + shares + saves;
    const rate = Number.isFinite(post?.engagement_rate)
      ? post.engagement_rate
      : reach > 0
        ? (interactions / reach) * 100
        : 0;
    return { likes, comments, shares, saves, reach, interactions, rate };
  }, [resolvePostMetric]);

  const formatPostDate = (timestamp) => {
    if (!timestamp) return { relative: '', full: '' };
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return { relative: '', full: '' };

      const now = new Date();
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      let relative;
      if (diffDays === 0) relative = 'Hoje';
      else if (diffDays === 1) relative = 'Ontem';
      else if (diffDays < 7) relative = `${diffDays}d atrás`;
      else if (diffDays < 30) relative = `${Math.floor(diffDays / 7)}sem atrás`;
      else if (diffDays < 365) relative = `${Math.floor(diffDays / 30)}m atrás`;
      else relative = `${Math.floor(diffDays / 365)}a atrás`;

      const full = date.toLocaleDateString('pt-BR', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      return { relative, full };
    } catch {
      return { relative: '', full: '' };
    }
  };

  const getPreviewUrl = (post) => {
    return [
      post.preview_url,
      post.previewUrl,
      post.thumbnail_url,
      post.thumbnailUrl,
      post.media_url,
      post.mediaUrl,
    ].find((url) => url && !/\.(mp4|mov)$/i.test(url));
  };

  const getPermalink = (post) => {
    return post.permalink || (post.id ? `https://www.instagram.com/p/${post.id}` : null);
  };

  const filteredAndSortedPosts = useMemo(() => {
    if (!posts || posts.length === 0) return [];
    let result = [...posts];

    if (typeFilter !== 'all') {
      result = result.filter((p) => getPostType(p) === typeFilter);
    }

    result.sort((a, b) => {
      let aVal, bVal;
      if (sortKey === 'timestamp') {
        aVal = new Date(a.timestamp || 0).getTime();
        bVal = new Date(b.timestamp || 0).getTime();
      } else if (sortKey === 'engagement') {
        aVal = getEngagement(a).interactions;
        bVal = getEngagement(b).interactions;
      } else if (sortKey === 'reach') {
        aVal = resolvePostMetric(a, 'reach', 0);
        bVal = resolvePostMetric(b, 'reach', 0);
      } else {
        aVal = resolvePostMetric(a, sortKey, 0);
        bVal = resolvePostMetric(b, sortKey, 0);
      }
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    });

    return result;
  }, [posts, typeFilter, sortKey, sortDir, getEngagement, resolvePostMetric]);

  const typeCounts = useMemo(() => {
    if (!posts) return {};
    const counts = { all: posts.length, image: 0, video: 0, carousel: 0 };
    posts.forEach((p) => { counts[getPostType(p)] = (counts[getPostType(p)] || 0) + 1; });
    return counts;
  }, [posts]);

  if (loading) {
    return (
      <div className="rp-container">
        <div className="rp-loading">
          <DataState state="loading" label="Carregando publicações..." size="sm" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rp-container">
        <div className="rp-empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <p style={{ color: '#ef4444' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <div className="rp-container">
        <div className="rp-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <p>Nenhuma publicação encontrada no período</p>
        </div>
      </div>
    );
  }

  const sortOptions = [
    { value: 'timestamp', label: 'Mais recentes' },
    { value: 'likes', label: 'Mais curtidos' },
    { value: 'engagement', label: 'Mais engajados' },
    { value: 'reach', label: 'Maior alcance' },
  ];

  const typeOptions = [
    { value: 'all', label: 'Todos', icon: null },
    { value: 'image', label: 'Fotos', icon: 'image' },
    { value: 'video', label: 'Vídeos', icon: 'video' },
    { value: 'carousel', label: 'Carrossel', icon: 'carousel' },
  ];

  return (
    <div className="rp-container">
      {/* Toolbar */}
      <div className="rp-toolbar">
        <div className="rp-toolbar__left">
          {/* Type pills */}
          <div className="rp-type-pills">
            {typeOptions.map((opt) => (
              <button
                key={opt.value}
                className={`rp-type-pill ${typeFilter === opt.value ? 'rp-type-pill--active' : ''}`}
                onClick={() => setTypeFilter(opt.value)}
              >
                {opt.icon === 'video' && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                )}
                {opt.icon === 'image' && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                )}
                {opt.icon === 'carousel' && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="2" width="16" height="16" rx="2" />
                    <rect x="6" y="6" width="16" height="16" rx="2" />
                  </svg>
                )}
                <span>{opt.label}</span>
                {typeCounts[opt.value] > 0 && (
                  <span className="rp-type-pill__count">{typeCounts[opt.value]}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="rp-toolbar__right">
          {/* Sort selector */}
          <select
            className="rp-sort-select"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {/* View toggle */}
          <div className="rp-view-toggle">
            <button
              className={`rp-view-btn ${viewMode === 'cards' ? 'rp-view-btn--active' : ''}`}
              onClick={() => setViewMode('cards')}
              title="Visualização em cards"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
            <button
              className={`rp-view-btn ${viewMode === 'list' ? 'rp-view-btn--active' : ''}`}
              onClick={() => setViewMode('list')}
              title="Visualização em lista"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Cards View */}
      {viewMode === 'cards' ? (
        <div className="rp-grid">
          {filteredAndSortedPosts.map((post, idx) => {
            const eng = getEngagement(post);
            const postType = getPostType(post);
            const { relative, full } = formatPostDate(post.timestamp || (post.timestamp_unix ? post.timestamp_unix * 1000 : null));
            const previewUrl = getPreviewUrl(post);
            const permalink = getPermalink(post);
            const caption = post.caption || post.text || '';
            const isExpanded = expandedPost === (post.id || idx);

            return (
              <div key={post.id || idx} className="rp-card" onClick={() => setExpandedPost(isExpanded ? null : (post.id || idx))}>
                {/* Thumbnail */}
                <div className="rp-card__thumb">
                  {previewUrl ? (
                    <img src={previewUrl} alt={caption || 'Post'} loading="lazy" />
                  ) : (
                    <div className="rp-card__thumb-placeholder">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    </div>
                  )}
                  {/* Overlay badges */}
                  <div className="rp-card__badges">
                    <span className={`rp-card__type-badge rp-card__type-badge--${postType}`}>
                      {postType === 'video' && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                      )}
                      {postType === 'carousel' && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <rect x="2" y="2" width="14" height="14" rx="2" />
                          <rect x="8" y="8" width="14" height="14" rx="2" />
                        </svg>
                      )}
                      {postType === 'image' && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                        </svg>
                      )}
                      <span>{getPostTypeLabel(postType)}</span>
                    </span>
                  </div>
                  {/* Engagement overlay */}
                  {eng.rate > 0 && (
                    <div className="rp-card__eng-badge">
                      {eng.rate.toFixed(1)}%
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="rp-card__body">
                  {/* Date */}
                  <div className="rp-card__date" title={full}>
                    {relative}
                  </div>

                  {/* Caption */}
                  {caption && (
                    <p className={`rp-card__caption ${isExpanded ? 'rp-card__caption--expanded' : ''}`}>
                      {caption}
                    </p>
                  )}

                  {/* Metrics row */}
                  <div className="rp-card__metrics">
                    <div className="rp-card__metric" title="Curtidas">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.7">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                      </svg>
                      <span>{formatNumber(eng.likes)}</span>
                    </div>
                    <div className="rp-card__metric" title="Comentários">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.7">
                        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                      </svg>
                      <span>{formatNumber(eng.comments)}</span>
                    </div>
                    <div className="rp-card__metric" title="Compartilhamentos">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.7">
                        <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                        <polyline points="16 6 12 2 8 6" />
                        <line x1="12" y1="2" x2="12" y2="15" />
                      </svg>
                      <span>{formatNumber(eng.shares)}</span>
                    </div>
                    <div className="rp-card__metric" title="Salvos">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.7">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                      </svg>
                      <span>{formatNumber(eng.saves)}</span>
                    </div>
                  </div>

                  {/* Reach bar */}
                  {eng.reach > 0 && (
                    <div className="rp-card__reach">
                      <span className="rp-card__reach-label">Alcance</span>
                      <span className="rp-card__reach-value">{formatNumber(eng.reach)}</span>
                    </div>
                  )}
                </div>

                {/* Footer with link */}
                {permalink && (
                  <a
                    href={permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="rp-card__link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Ver no Instagram
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M7 17L17 7" />
                      <path d="M7 7h10v10" />
                    </svg>
                  </a>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="rp-list">
          {filteredAndSortedPosts.map((post, idx) => {
            const eng = getEngagement(post);
            const postType = getPostType(post);
            const { relative, full } = formatPostDate(post.timestamp || (post.timestamp_unix ? post.timestamp_unix * 1000 : null));
            const previewUrl = getPreviewUrl(post);
            const permalink = getPermalink(post);
            const caption = post.caption || post.text || '';

            return (
              <div key={post.id || idx} className="rp-list-item">
                {/* Thumbnail */}
                <div className="rp-list-item__thumb">
                  {previewUrl ? (
                    <img src={previewUrl} alt={caption || 'Post'} loading="lazy" />
                  ) : (
                    <div className="rp-list-item__thumb-placeholder">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                      </svg>
                    </div>
                  )}
                  <span className={`rp-list-item__type rp-list-item__type--${postType}`}>
                    {getPostTypeLabel(postType)}
                  </span>
                </div>

                {/* Info */}
                <div className="rp-list-item__info">
                  <div className="rp-list-item__header">
                    <span className="rp-list-item__date" title={full}>{relative}</span>
                    {eng.rate > 0 && (
                      <span className="rp-list-item__eng">{eng.rate.toFixed(1)}% eng.</span>
                    )}
                  </div>
                  {caption && (
                    <p className="rp-list-item__caption">{caption}</p>
                  )}
                </div>

                {/* Metrics */}
                <div className="rp-list-item__metrics">
                  <div className="rp-list-item__metric">
                    <span className="rp-list-item__metric-val">{formatNumber(eng.likes)}</span>
                    <span className="rp-list-item__metric-lbl">curtidas</span>
                  </div>
                  <div className="rp-list-item__metric">
                    <span className="rp-list-item__metric-val">{formatNumber(eng.comments)}</span>
                    <span className="rp-list-item__metric-lbl">coment.</span>
                  </div>
                  <div className="rp-list-item__metric">
                    <span className="rp-list-item__metric-val">{formatNumber(eng.reach)}</span>
                    <span className="rp-list-item__metric-lbl">alcance</span>
                  </div>
                </div>

                {/* Link */}
                {permalink && (
                  <a href={permalink} target="_blank" rel="noreferrer" className="rp-list-item__link" title="Ver no Instagram">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Results count */}
      {filteredAndSortedPosts.length !== posts.length && (
        <div className="rp-results-info">
          Exibindo {filteredAndSortedPosts.length} de {posts.length} publicações
        </div>
      )}
    </div>
  );
};

export default PostsTable;
