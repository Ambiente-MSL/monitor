import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Topbar from './components/Topbar';
import { useAuth } from './context/AuthContext';

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

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card--compact">
          <h2 className="auth-heading">Carregando dashboard...</h2>
          <p className="auth-subtext">Estamos preparando seus dados. Aguarde um instante.</p>
        </div>
      </div>
    );
  }

  if (!user) {
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
            <Suspense
              fallback={
                <div className="auth-screen">
                  <div className="auth-card auth-card--compact">
                    <h2 className="auth-heading">Carregando...</h2>
                    <p className="auth-subtext">Preparando conteúdo.</p>
                  </div>
                </div>
              }
            >
              <Outlet context={{ setTopbarConfig, resetTopbarConfig }} />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}
