import { lazy } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import App from './App';

// Lazy load páginas para reduzir bundle inicial
const FacebookDashboard = lazy(() => import('./pages/FacebookDashboard'));
const InstagramDashboard = lazy(() => import('./pages/InstagramDashboard'));
const AdsDashboard = lazy(() => import('./pages/AdsDashboard'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Admin = lazy(() => import('./pages/Admin'));

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    element: <App />,
    children: [
      { path: '/', element: <Navigate to='/instagram' replace /> },
      { path: '/facebook', element: <FacebookDashboard /> },
      { path: '/instagram', element: <InstagramDashboard /> },
      { path: '/ads', element: <AdsDashboard /> },
      { path: '/relatorios', element: <Reports /> },
      { path: '/configuracoes', element: <Settings /> },
      { path: '/admin', element: <Admin /> },
      { path: '*', element: <Navigate to='/instagram' replace /> },
    ],
  },
]);

export default function RootRouter() {
  return <RouterProvider router={router} />;
}
