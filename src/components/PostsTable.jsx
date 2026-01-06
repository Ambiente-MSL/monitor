import React, { useState, useCallback } from 'react';

const PostsTable = ({ posts, loading, error }) => {
  const [columnOrder, setColumnOrder] = useState([
    'date',
    'caption',
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

  const columns = {
    date: { label: 'Data', align: 'left', isMetric: false },
    caption: { label: 'Publicação', align: 'left', isMetric: false },
    likes: { label: 'Curtidas', align: 'right', isMetric: true },
    comments: { label: 'Comentários', align: 'right', isMetric: true },
    saves: { label: 'Salvos', align: 'right', isMetric: true },
    shares: { label: 'Compart.', align: 'right', isMetric: true },
    plays: { label: 'Plays', align: 'right', isMetric: true },
    reach: { label: 'Alcance', align: 'right', isMetric: true },
    interactions: { label: 'Total interações', align: 'right', isMetric: true },
    engagement: { label: 'Engajamento', align: 'right', isMetric: true },
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

  const getCellValue = (post, columnId, index) => {
    switch (columnId) {
      case 'date': {
        const { date, time } = formatPostDateTime(
          post.timestamp || (post.timestamp_unix ? post.timestamp_unix * 1000 : null)
        );
        return (
          <div className="posts-table__date-cell">
            <div className="posts-table__date-main">{date}</div>
            {time && <div className="posts-table__date-time">{time}</div>}
          </div>
        );
      }

      case 'caption': {
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

        return (
          <div className="posts-table__caption-cell">
            {postUrl ? (
              <a
                href={postUrl}
                target="_blank"
                rel="noreferrer"
                className="posts-table__preview-link"
              >
                <div className="posts-table__preview">
                  {previewUrl ? (
                    <img src={previewUrl} alt={caption} />
                  ) : (
                    <div className="posts-table__placeholder">
                      <span>📷</span>
                    </div>
                  )}
                </div>
              </a>
            ) : (
              <div className="posts-table__preview">
                {previewUrl ? (
                  <img src={previewUrl} alt={caption} />
                ) : (
                  <div className="posts-table__placeholder">
                    <span>📷</span>
                  </div>
                )}
              </div>
            )}
            <div className="posts-table__caption-content">
              <div className="posts-table__caption-text">{truncate(caption, 100)}</div>
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
          <div className="posts-table-compact__spinner" />
          <p>Carregando publicações...</p>
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
        <div className="posts-table-compact__empty">Sem dados disponíveis.</div>
      </div>
    );
  }

  return (
    <div className="posts-table-compact">
      <div className="posts-table-compact__scroll">
        <table className="posts-table-compact__table">
          <thead className="posts-table-compact__head">
            <tr>
              {columnOrder.map((columnId) => {
                const column = columns[columnId];
                if (!column) return null;

                return (
                  <th
                    key={columnId}
                    className={`
                      posts-table-compact__th
                      ${column.isMetric ? 'posts-table-compact__th--metric' : ''}
                      ${draggedColumn === columnId ? 'posts-table-compact__th--dragging' : ''}
                      ${dragOverColumn === columnId ? 'posts-table-compact__th--drag-over' : ''}
                    `}
                    draggable
                    onDragStart={(e) => handleDragStart(e, columnId)}
                    onDragOver={(e) => handleDragOver(e, columnId)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, columnId)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="posts-table-compact__th-content">
                      <span className="posts-table-compact__th-grip">⋮⋮</span>
                      <span className="posts-table-compact__th-label">{column.label}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="posts-table-compact__body">
            {posts.map((post, index) => (
              <tr key={post.id || index} className="posts-table-compact__row">
                {columnOrder.map((columnId) => {
                  const column = columns[columnId];
                  if (!column) return null;

                  return (
                    <td
                      key={columnId}
                      className={`
                        posts-table-compact__td
                        ${column.isMetric ? 'posts-table-compact__td--metric' : ''}
                        posts-table-compact__td--${columnId}
                      `}
                    >
                      {getCellValue(post, columnId, index)}
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
