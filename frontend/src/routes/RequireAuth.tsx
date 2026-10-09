import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthProvider';
export function AuthLoading() { return <main className="auth-loading" role="status">Checking your Carteio AI session…</main>; }
export function RequireAuth() { const { user, loading, error, refresh } = useAuth(); const location = useLocation(); if (loading) return <AuthLoading/>; if (error) return <main className="auth-loading"><div role="alert">{error}<br/><button className="button button-secondary" onClick={()=>void refresh()}>Try again</button></div></main>; if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}`, sessionExpired: true }}/>; return <Outlet/>; }
