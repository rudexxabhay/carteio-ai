import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useWorkspaces } from '../../app/providers/WorkspaceProvider';

export function WorkspaceEntry({ children, allowEmpty = false, allowSelector = false }: { children?: ReactNode; allowEmpty?: boolean; allowSelector?: boolean }) {
  const { workspaces, loading, error, reload, lastSlug } = useWorkspaces();
  const location = useLocation();
  if (loading) return <main className="workspace-loading" role="status" aria-live="polite"><span className="workspace-spinner"/>Loading your workspace…</main>;
  if (error) return <main className="workspace-message"><h1>We couldn’t load your workspace</h1><p>{error}</p><button className="button button-primary" onClick={() => void reload()}>Try again</button></main>;
  if (workspaces.length === 0) return allowEmpty ? children : <Navigate to="/onboarding" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (workspaces.length === 1) return <Navigate to={`/workspace/${encodeURIComponent(workspaces[0]!.slug)}`} replace />;
  const lastWorkspace = workspaces.find((workspace) => workspace.slug === lastSlug);
  if (lastWorkspace) return <Navigate to={`/workspace/${encodeURIComponent(lastWorkspace.slug)}`} replace />;
  if (allowSelector) return children;
  return <Navigate to="/workspaces" replace state={{ from: `${location.pathname}${location.search}` }} />;
}
