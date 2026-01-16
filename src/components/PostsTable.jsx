import React, { useState, useCallback, useMemo } from 'react';
import DataState from './DataState';

const PostsTable = ({ posts, loading, error }) => {
  const [columnOrder, setColumnOrder] = useState([
    'post',
    'likes',
    'comments',
    'saves',
    'shares',
    'plays',
    'reach',
    'interactions',
    'engagement',
  ]);
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'desc' });
  const [filters, setFilters] = useState({
    type: 'all',
    minEngagement: '',
    search: '',
  });

  const handleDragStart = useCallback((e, columnId) => {
    setDraggedColumn(columnId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e, columnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedColumn !== columnId) {
      setDragOverColumn(columnId);
    }
  }, [draggedColumn]);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback((e, targetColumnId) => {
    e.preventDefault();

    if (!draggedColumn || draggedColumn === targetColumnId) {
      setDraggedColumn(null);
      setDragOverColumn(null);
      return;
    }

    const newOrder = [...columnOrder];
    const draggedIndex = newOrder.indexOf(draggedColumn);
    const targetIndex = newOrder.indexOf(targetColumnId);

    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedColumn);

    setColumnOrder(newOrder);
    setDraggedColumn(null);
    setDragOverColumn(null);
  }, [draggedColumn, columnOrder]);

  const handleDragEnd = useCallback(() => {
    setDraggedColumn(null);
    setDragOverColumn(null);
  }, []);

  const handleSort = useCallback((columnId) => {
    if (columnId === 'post') return;
    setSortConfig((prev) => ({
      key: columnId,
      direction: prev.key === columnId && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  }, []);

  const columns = {
    post: { label: 'Publicacao', align: 'left', isMetric: false, sortable: false },
    likes: { label: 'Curtidas', align: 'right', isMetric: true, sortable: true },
    comments: { label: 'Comentarios', align: 'right', isMetric: true, sortable: true },
    saves: { label: 'Salvos', align: 'right', isMetric: true, sortable: true },
    shares: { label: 'Compart.', align: 'right', isMetric: true, sortable: true },
    plays: { label: 'Plays', align: 'right', isMetric: true, sortable: true },
    reach: { label: 'Alcance', align: 'right', isMetric: true, sortable: true },
    interactions: { label: 'Interacoes', align: 'right', isMetric: true, sortable: true },
    engagement: { label: 'Engajamento', align: 'right', isMetric: true, sortable: true },
  };

  const formatNumber = (value) => {
    if (value == null || value === '--') return '--';
    const num = Number(value);
    if (!Number.isFinite(num)) return '--';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString('pt-BR');
  };

  const truncate = (str, maxLength) => {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  };

  const formatPostDateTime = (timestamp) => {
    if (!timestamp) return { date: '--', time: null };
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return { date: '--', time: null };

      const dateStr = date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      const timeStr = date.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });

      return { date: dateStr, time: timeStr };
    } catch {
      return { date: '--', time: null };
    }
  };

  const resolvePostMetric = (post, metricKey, fallback = 0) => {
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
  };

  const extractNumber = (value, fallback) => {
    if (value == null) return fallback;
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };

  const getPostType = (post) => {
    const mediaType = post?.media_type?.toLowerCase() || post?.mediaType?.toLowerCase() || '';
    if (mediaType.includes('video') || mediaType.includes('reel')) return 'video';
    if (mediaType.includes('carousel') || mediaType.includes('album')) return 'carousel';
    return 'image';
  };

  const getNumericValue = useCallback((post, columnId) => {
    switch (columnId) {
      case 'likes':
        return resolvePostMetric(post, 'likes', 0);
      case 'comments':
        return resolvePostMetric(post, 'comments', 0);
      case 'saves':
        return resolvePostMetric(post, 'saves', 0);
      case 'shares':
        return resolvePostMetric(post, 'shares', 0);
      case 'plays':
        return extractNumber(post.views ?? post.video_views ?? post.plays ?? null, 0);
      case 'reach':
        return resolvePostMetric(post, 'reach', 0);
      case 'interactions': {
        const likes = resolvePostMetric(post, 'likes', 0);
        const comments = resolvePostMetric(post, 'comments', 0);
        const shares = resolvePostMetric(post, 'shares', 0);
        const saves = resolvePostMetric(post, 'saves', 0);
        return extractNumber(post.interactions, null) ?? likes + comments + shares + saves;
      }
      case 'engagement': {
        const likes = resolvePostMetric(post, 'likes', 0);
        const comments = resolvePostMetric(post, 'comments', 0);
        const shares = resolvePostMetric(post, 'shares', 0);
        const saves = resolvePostMetric(post, 'saves', 0);
        const reach = resolvePostMetric(post, 'reach', 0);
        const interactions = extractNumber(post.interactions, null) ?? likes + comments + shares + saves;
        return Number.isFinite(post.engagement_rate)
          ? post.engagement_rate
          : reach > 0
            ? (interactions / reach) * 100
            : 0;
      }
      default:
        return 0;
    }
  }, []);

  const filteredAndSortedPosts = useMemo(() => {
    if (!posts || posts.length === 0) return [];

    let result = [...posts];

    // Apply type filter
    if (filters.type !== 'all') {
      result = result.filter((post) => getPostType(post) === filters.type);
    }

    // Apply engagement filter
    if (filters.minEngagement && !isNaN(Number(filters.minEngagement))) {
      const minEng = Number(filters.minEngagement);
      result = result.filter((post) => {
        const engagement = getNumericValue(post, 'engagement');
        return engagement >= minEng;
      });
    }

    // Apply search filter
    if (filters.search.trim()) {
      const searchLower = filters.search.toLowerCase().trim();
      result = result.filter((post) => {
        const caption = (post.caption || post.text || '').toLowerCase();
        return caption.includes(searchLower);
      });
    }

    // Apply sorting
    if (sortConfig.key) {
      result.sort((a, b) => {
        const aVal = getNumericValue(a, sortConfig.key);
        const bVal = getNumericValue(b, sortConfig.key);
        const diff = bVal - aVal;
        return sortConfig.direction === 'desc' ? diff : -diff;
      });
    }

    return result;
  }, [posts, filters, sortConfig, getNumericValue]);

  const getCellValue = (post, columnId) => {
    switch (columnId) {
      case 'post': {
        const { date, time } = formatPostDateTime(
          post.timestamp || (post.timestamp_unix ? post.timestamp_unix * 1000 : null)
        );
        const postUrl = post.permalink || (post.id ? `https://www.instagram.com/p/${post.id}` : null);
        const previewUrl = [
          post.preview_url,
          post.previewUrl,
          post.thumbnail_url,
          post.thumbnailUrl,
          post.media_url,
          post.mediaUrl,
        ].find((url) => url && !/\.(mp4|mov)$/i.test(url));
        const caption = post.caption || post.text || 'Sem legenda';
        const postType = getPostType(post);

        return (
          <div className="posts-table__post-cell">
            {postUrl ? (
              <a
                href={postUrl}
                target="_blank"
                rel="noreferrer"
                className="posts-table__preview-link"
              >
                <div className="posts-table__preview-compact">
                  {previewUrl ? (
                    <img src={previewUrl} alt={caption} />
                  ) : (
                    <div className="posts-table__placeholder-compact">
                      <span>📷</span>
                    </div>
                  )}
                  <div className="posts-table__type-badge" data-type={postType}>
                    {postType === 'video' && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5,3 19,12 5,21" />
                      </svg>
                    )}
                    {postType === 'carousel' && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="2" width="16" height="16" rx="2" />
                        <rect x="6" y="6" width="16" height="16" rx="2" />
                      </svg>
                    )}
                    {postType === 'image' && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    )}
                  </div>
                </div>
              </a>
            ) : (
              <div className="posts-table__preview-compact">
                {previewUrl ? (
                  <img src={previewUrl} alt={caption} />
                ) : (
                  <div className="posts-table__placeholder-compact">
                    <span>📷</span>
                  </div>
                )}
              </div>
            )}
            <div className="posts-table__post-info">
              <div className="posts-table__caption-compact" title={caption}>
                {truncate(caption, 80)}
              </div>
              <div className="posts-table__post-meta">
                <span className="posts-table__post-date">{date}</span>
                {time && <span className="posts-table__post-time">{time}</span>}
              </div>
            </div>
          </div>
        );
      }

      case 'likes':
        return formatNumber(resolvePostMetric(post, 'likes', 0));

      case 'comments':
        return formatNumber(resolvePostMetric(post, 'comments', 0));

      case 'saves':
        return formatNumber(resolvePostMetric(post, 'saves', 0));

      case 'shares':
        return formatNumber(resolvePostMetric(post, 'shares', 0));

      case 'plays':
        return formatNumber(extractNumber(post.views ?? post.video_views ?? post.plays ?? null, null));

      case 'reach':
        return formatNumber(resolvePostMetric(post, 'reach', 0));

      case 'interactions': {
        const likes = resolvePostMetric(post, 'likes', 0);
        const comments = resolvePostMetric(post, 'comments', 0);
        const shares = resolvePostMetric(post, 'shares', 0);
        const saves = resolvePostMetric(post, 'saves', 0);
        const interactions = extractNumber(post.interactions, null) ?? likes + comments + shares + saves;
        return formatNumber(interactions);
      }

      case 'engagement': {
        const likes = resolvePostMetric(post, 'likes', 0);
        const comments = resolvePostMetric(post, 'comments', 0);
        const shares = resolvePostMetric(post, 'shares', 0);
        const saves = resolvePostMetric(post, 'saves', 0);
        const reach = resolvePostMetric(post, 'reach', 0);
        const interactions = extractNumber(post.interactions, null) ?? likes + comments + shares + saves;
        const engagementRate = Number.isFinite(post.engagement_rate)
          ? post.engagement_rate
          : reach > 0
            ? (interactions / reach) * 100
            : null;
        return engagementRate != null && Number.isFinite(engagementRate)
          ? `${engagementRate.toFixed(2)}%`
          : '--';
      }

      default:
        return '--';
    }
  };

  if (loading) {
    return (
      <div className="posts-table-compact">
        <div className="posts-table-compact__loading">
          <DataState state="loading" label="Carregando publicacoes..." size="sm" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="posts-table-compact">
        <div className="posts-table-compact__error">{error}</div>
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <div className="posts-table-compact">
        <div className="posts-table-compact__empty">Sem dados disponiveis.</div>
      </div>
    );
  }

  return (
    <div className="posts-table-compact posts-table-compact--slim">
      {/* Filter Bar */}
      <div className="posts-table__filters">
        <div className="posts-table__filter-group">
          <label className="posts-table__filter-label">Tipo</label>
          <select
            className="posts-table__filter-select"
            value={filters.type}
            onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
          >
            <option value="all">Todos</option>
            <option value="image">Imagens</option>
            <option value="video">Videos</option>
            <option value="carousel">Carrossel</option>
          </select>
        </div>
        <div className="posts-table__filter-group">
          <label className="posts-table__filter-label">Engaj. min.</label>
          <input
            type="number"
            className="posts-table__filter-input"
            placeholder="0%"
            value={filters.minEngagement}
            onChange={(e) => setFilters((prev) => ({ ...prev, minEngagement: e.target.value }))}
            min="0"
            max="100"
            step="0.1"
          />
        </div>
        <div className="posts-table__filter-group posts-table__filter-group--search">
          <label className="posts-table__filter-label">Buscar</label>
          <input
            type="text"
            className="posts-table__filter-input posts-table__filter-input--search"
            placeholder="Buscar na legenda..."
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          />
        </div>
        {(filters.type !== 'all' || filters.minEngagement || filters.search) && (
          <button
            className="posts-table__filter-clear"
            onClick={() => setFilters({ type: 'all', minEngagement: '', search: '' })}
          >
            Limpar filtros
          </button>
        )}
        <div className="posts-table__filter-count">
          {filteredAndSortedPosts.length} de {posts.length} posts
        </div>
      </div>

      <div className="posts-table-compact__scroll">
        <table className="posts-table-compact__table posts-table-compact__table--slim">
          <thead className="posts-table-compact__head">
            <tr>
              {columnOrder.map((columnId) => {
                const column = columns[columnId];
                if (!column) return null;
                const isSorted = sortConfig.key === columnId;
                const isSortable = column.sortable;

                return (
                  <th
                    key={columnId}
                    className={`
                      posts-table-compact__th
                      posts-table-compact__th--slim
                      ${column.isMetric ? 'posts-table-compact__th--metric' : ''}
                      ${draggedColumn === columnId ? 'posts-table-compact__th--dragging' : ''}
                      ${dragOverColumn === columnId ? 'posts-table-compact__th--drag-over' : ''}
                      ${isSorted ? 'posts-table-compact__th--sorted' : ''}
                      ${isSortable ? 'posts-table-compact__th--sortable' : ''}
                    `}
                    title={column.label}
                    draggable
                    onDragStart={(e) => handleDragStart(e, columnId)}
                    onDragOver={(e) => handleDragOver(e, columnId)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, columnId)}
                    onDragEnd={handleDragEnd}
                    onClick={() => isSortable && handleSort(columnId)}
                  >
                    <div className="posts-table-compact__th-content">
                      <span className="posts-table-compact__th-grip">⋮⋮</span>
                      <span className="posts-table-compact__th-label truncate" title={column.label}>
                        {column.label}
                      </span>
                      {isSortable && (
                        <span className={`posts-table-compact__sort-icon ${isSorted ? 'posts-table-compact__sort-icon--active' : ''}`}>
                          {isSorted ? (
                            sortConfig.direction === 'desc' ? '▼' : '▲'
                          ) : (
                            <span style={{ opacity: 0.4 }}>▼</span>
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="posts-table-compact__body">
            {filteredAndSortedPosts.map((post, index) => (
              <tr key={post.id || index} className="posts-table-compact__row posts-table-compact__row--slim">
                {columnOrder.map((columnId) => {
                  const column = columns[columnId];
                  if (!column) return null;

                  return (
                    <td
                      key={columnId}
                      className={`
                        posts-table-compact__td
                        posts-table-compact__td--slim
                        ${column.isMetric ? 'posts-table-compact__td--metric' : ''}
                        posts-table-compact__td--${columnId}
                      `}
                    >
                      {getCellValue(post, columnId)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PostsTable;
