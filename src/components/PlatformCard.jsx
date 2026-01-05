import { ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export default function PlatformCard({
  platform,
  to,
  icon: Icon,
  color,
  gradient,
  metrics,
  loading = false
}) {
  const { search } = useLocation();
  const destination = search ? { pathname: to, search } : to;

  const formatNumber = (num) => {
    if (num == null) return '—';
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toLocaleString('pt-BR');
  };

  const formatPercent = (value) => {
    if (value == null) return null;
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  };

  return (
    <Link to={destination} className="platform-card" style={{ '--platform-color': color }}>
      <div className="platform-card__gradient" style={{ background: gradient }} />

      <div className="platform-card__header">
        <div className="platform-card__icon">
          <Icon size={24} strokeWidth={1.5} />
        </div>
        <div className="platform-card__title">
          <h3>{platform}</h3>
          <span>Ver mais</span>
        </div>
        <div className="platform-card__arrow">
          <ArrowRight size={20} />
        </div>
      </div>

      {loading ? (
        <div className="platform-card__loading">
          <div className="platform-card__skeleton" />
          <div className="platform-card__skeleton" />
          <div className="platform-card__skeleton" />
        </div>
      ) : (
        <div className="platform-card__metrics">
          {metrics?.reach != null && (
            <div className="platform-card__metric">
              <span className="platform-card__metric-label">Alcance</span>
              <div className="platform-card__metric-value">
                {formatNumber(metrics.reach)}
                {metrics.reachGrowth != null && (
                  <span className={`platform-card__growth ${metrics.reachGrowth >= 0 ? 'platform-card__growth--positive' : 'platform-card__growth--negative'}`}>
                    {metrics.reachGrowth >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {formatPercent(metrics.reachGrowth)}
                  </span>
                )}
              </div>
            </div>
          )}

          {metrics?.engagement != null && (
            <div className="platform-card__metric">
              <span className="platform-card__metric-label">Engajamento</span>
              <div className="platform-card__metric-value">
                {formatNumber(metrics.engagement)}
                {metrics.engagementGrowth != null && (
                  <span className={`platform-card__growth ${metrics.engagementGrowth >= 0 ? 'platform-card__growth--positive' : 'platform-card__growth--negative'}`}>
                    {metrics.engagementGrowth >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {formatPercent(metrics.engagementGrowth)}
                  </span>
                )}
              </div>
            </div>
          )}

          {metrics?.followers != null && (
            <div className="platform-card__metric">
              <span className="platform-card__metric-label">Seguidores</span>
              <div className="platform-card__metric-value">
                {formatNumber(metrics.followers)}
                {metrics.followersGrowth != null && (
                  <span className={`platform-card__growth ${metrics.followersGrowth >= 0 ? 'platform-card__growth--positive' : 'platform-card__growth--negative'}`}>
                    {metrics.followersGrowth >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {formatPercent(metrics.followersGrowth)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="platform-card__footer">
        <span>Clique para ver análise completa</span>
      </div>
    </Link>
  );
}
