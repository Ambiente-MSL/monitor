import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Facebook,
  Instagram,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  Settings,
  Shield,
  TrendingUp,
} from 'lucide-react';
import logo from '../assets/logo-msl.svg';
import { useAuth } from '../context/AuthContext';

const DASHBOARD_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Visão geral', end: true, iconClass: 'icon-overview' },
  { to: '/facebook', icon: Facebook, label: 'Facebook', iconClass: 'icon-facebook' },
  { to: '/instagram', icon: Instagram, label: 'Instagram', iconClass: 'icon-instagram' },
  { to: '/ads', icon: TrendingUp, label: 'Ads', iconClass: 'icon-ads' },
];

const ADMIN_ITEMS = [
  { to: '/relatorios', icon: BarChart3, label: 'Relatórios', iconClass: 'icon-reports' },
  { to: '/configuracoes', icon: Settings, label: 'Configurações', iconClass: 'icon-settings' },
  { to: '/admin', icon: Shield, label: 'Admin', iconClass: 'icon-admin' },
];

const NavItem = ({ to, icon: Icon, label, end, iconClass }) => {
  const { search } = useLocation();
  const destination = search ? { pathname: to, search } : to;

  return (
    <NavLink
      to={destination}
      end={end}
      title={label}
      aria-label={label}
      className={({ isActive }) =>
        `sidebar__nav-item${isActive ? ' sidebar__nav-item--active' : ''}`
      }
    >
      <Icon size={18} strokeWidth={1.6} className={iconClass} />
      <span>{label}</span>
    </NavLink>
  );
};

export default function Sidebar({ open, onToggleSidebar }) {
  const { signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Erro ao encerrar sessão', err);
    }
  };

  return (
    <aside className={`sidebar${open ? '' : ' sidebar--collapsed'}`}>
      <div className="sidebar__top">
        <div className="sidebar__brand">
          <img src={logo} alt="Logotipo MSL" className="sidebar__logo" />
          <div className="sidebar__brand-text">
            <span className="sidebar__brand-name">MSL Estratégia</span>
            <span className="sidebar__brand-tag">Monitor</span>
          </div>
        </div>
        {onToggleSidebar && (
          <button
            type="button"
            className="sidebar__collapse"
            onClick={onToggleSidebar}
            aria-label={open ? 'Recolher menu lateral' : 'Expandir menu lateral'}
          >
            <PanelLeft size={18} />
          </button>
        )}
      </div>

      <nav className="sidebar__nav">
        <span className="sidebar__section">Dashboard</span>
        {DASHBOARD_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <span className="sidebar__section">Administração</span>
        {ADMIN_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      <div className="sidebar__footer">
        <button type="button" className="sidebar__signout" onClick={handleSignOut}>
          <LogOut size={17} />
          <span>Sair</span>
        </button>
      </div>
    </aside>
  );
}
