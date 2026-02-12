import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Topbar from './components/Topbar';
import { useAuth } from './context/AuthContext';

function DashboardSkeleton() {
  const loc = useLocation();
  const isFacebook = loc.pathname === '/facebook' || loc.pathname.startsWith('/facebook/');
  const isAds = loc.pathname === '/ads' || loc.pathname.startsWith('/ads/');

  const wrapperClass = isFacebook
    ? 'facebook-dashboard facebook-dashboard--clean'
    : 'instagram-dashboard instagram-dashboard--clean';

  const brandLabel = isFacebook ? 'Facebook' : isAds ? 'Anúncios' : 'Instagram';
  const tabCount = isFacebook ? 4 : isAds ? 3 : 3;
  const cardCount = isFacebook ? 4 : isAds ? 3 : 4;

  return (
    <div className={wrapperClass} aria-hidden="true">
      <div className="ig-clean-container">
        <div className="ig-hero-gradient" />
        <div className="ig-clean-header">
          <div className="ig-clean-header__brand">
            <div className="ig-clean-header__logo">
              <span className="ig-skeleton" style={{ width: 32, height: 32, borderRadius: 12 }} />
            </div>
            <span className="ig-skeleton" style={{ width: brandLabel.length * 12, height: 22 }} />
          </div>
          <div className="ig-clean-tabs">
            {Array.from({ length: tabCount }).map((_, index) => (
              <span
                key={`tab-skeleton-${index}`}
                className="ig-skeleton"
                style={{ width: 88, height: 26, borderRadius: 999 }}
              />
            ))}
          </div>
        </div>
        <div style={{ marginTop: '24px', marginBottom: '16px', maxWidth: '240px' }}>
          <span className="ig-skeleton" style={{ height: 24 }} />
        </div>
        <div className="ig-analytics-grid ig-analytics-grid--pair">
          {Array.from({ length: cardCount }).map((_, index) => (
            <div key={`metric-skeleton-${index}`} className="ig-card-white ig-analytics-card">
              <span className="ig-skeleton" style={{ height: 18, marginBottom: '12px', maxWidth: '160px' }} />
              <span className="ig-skeleton ig-skeleton--stat" />
            </div>
          ))}
        </div>
        <div style={{ marginTop: '24px' }} className="ig-chart-skeleton ig-chart-skeleton--tall" />
        <div style={{ marginTop: '20px' }} className="ig-chart-skeleton ig-chart-skeleton--compact" />
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  const pageTitle = useMemo(() => {
    const path = location.pathname || '/';
    const map = {
      '/': 'Visao Geral',
      '/facebook': 'Facebook',
      '/instagram': 'Instagram',
      '/ads': 'Anúncios',
      '/relatorios': 'Relatórios',
      '/configuracoes': 'Configurações',
      '/admin': 'Admin',
    };
    return map[path] ?? 'Dashboard';
  }, [location.pathname]);

  const showFilters = useMemo(() => {
    const filterRoutes = new Set(['/facebook', '/instagram', '/ads']);
    return filterRoutes.has(location.pathname);
  }, [location.pathname]);

  const defaultTopbarConfig = useMemo(
    () => ({
      title: pageTitle,
      showFilters,
    }),
    [pageTitle, showFilters],
  );

  const [topbarOverrides, setTopbarOverrides] = useState({});

  useEffect(() => {
    if (loading || !user) return;
    setTopbarOverrides({});
  }, [loading, location.pathname, user]);

  const setTopbarConfig = useCallback((config) => {
    setTopbarOverrides(config || {});
  }, []);

  const resetTopbarConfig = useCallback(() => {
    setTopbarOverrides({});
  }, []);

  const topbarProps = useMemo(() => {
    const merged = {
      ...defaultTopbarConfig,
      ...topbarOverrides,
      sticky: true,
    };
    return merged;
  }, [defaultTopbarConfig, topbarOverrides]);

  if (!user && !loading) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <div className="app-layout app-layout--no-sidebar">
      <main className="app-main app-main--full-width">
        <div className="app-main__content">
          {(() => {
            const { hidden, ...rest } = topbarProps;
            return hidden ? null : <Topbar {...rest} />;
          })()}
          <div className="app-main__body">
            {loading && !user ? (
              <DashboardSkeleton />
            ) : (
              <Suspense fallback={<DashboardSkeleton />}>
                <Outlet context={{ setTopbarConfig, resetTopbarConfig }} />
              </Suspense>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
