import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useWorkspaces } from '../../app/providers/WorkspaceProvider';
import { WorkspaceLoading } from '../../layouts/DashboardLayout/DashboardLayout';
import { AccessDenied } from '../../components/common/ErrorStates';

export function WorkspaceEntry({ children, allowEmpty = false, allowSelector = false }: { children?: ReactNode; allowEmpty?: boolean; allowSelector?: boolean }) {
  const { workspaces, loading, error, reload, lastSlug } = useWorkspaces();
  const location = useLocation();
  if (loading) return <WorkspaceLoading/>;
  if (error) return <div className="carteio-dashboard-v2 dashboard-gate"><main className="dashboard-gate-card"><AccessDenied title="We couldn’t load your workspaces" message={error} action={{ label: 'Try again', onClick: () => void reload() }}/><small>Workspace data stays protected until access is confirmed.</small></main></div>;
  if (workspaces.length === 0) return allowEmpty ? children : <Navigate to="/onboarding" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (workspaces.length === 1) return <Navigate to={`/workspace/${encodeURIComponent(workspaces[0]!.slug)}`} replace />;
  const lastWorkspace = workspaces.find((workspace) => workspace.slug === lastSlug);
  if (lastWorkspace) return <Navigate to={`/workspace/${encodeURIComponent(lastWorkspace.slug)}`} replace />;
  if (allowSelector) return children;
  return <Navigate to="/workspaces" replace state={{ from: `${location.pathname}${location.search}` }} />;
}
