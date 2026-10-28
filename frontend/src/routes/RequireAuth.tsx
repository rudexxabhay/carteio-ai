import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthProvider';
import { WorkspaceProvider } from '../app/providers/WorkspaceProvider';
import { LoadingState, RouteError } from '../components/common/ErrorStates';
export function AuthLoading() { return <main className="auth-loading"><LoadingState label="Checking your Carteio AI session…"/></main>; }
export function RequireAuth() { const { user, loading, error, refresh } = useAuth(); const location = useLocation(); if (loading) return <AuthLoading/>; if (error) return <main className="auth-loading"><RouteError title="Session could not be checked" message={error} action={{ label: 'Try again', onClick: () => void refresh() }}/></main>; if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}`, sessionExpired: true }}/>; return <WorkspaceProvider><Outlet/></WorkspaceProvider>; }
