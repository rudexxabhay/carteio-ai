import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/providers/AuthProvider';
import { useWorkspaces } from '../../app/providers/WorkspaceProvider';
import { ApiError } from '../../services/api/client';
import { getWorkspace, type Workspace } from '../../services/api/workspaces';
import { AccessDenied, NetworkError, RouteError } from '../../components/common/ErrorStates';
import { useTheme } from '../../app/providers/ThemeProvider';
import './source-dashboard-layout.css';

export type WorkspaceRouteContext = { workspace: Workspace; updateWorkspace: (workspace: Workspace) => void };
const WorkspaceContext = createContext<WorkspaceRouteContext | null>(null);
export function useWorkspaceRoute(): WorkspaceRouteContext {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('Workspace content requires an authorized dashboard context.');
  return context;
}
type WorkspaceFailure = { kind: 'network' | 'timeout' | 'not-found' | 'access' | 'invalid-response' | 'unknown'; message: string };
function importSourceDashboard() { return import('../../dashboard-source/SourceDashboard'); }
let sourceDashboardImport: ReturnType<typeof importSourceDashboard> | undefined;
function preloadSourceDashboard() { sourceDashboardImport ??= importSourceDashboard(); return sourceDashboardImport; }
const SourceDashboard = lazy(preloadSourceDashboard);

export function WorkspaceLoading() {
  const { mode } = useTheme();
  return <main className="workspace-bootstrap" data-mode={mode} role="status" aria-label="Preparing your workspace" aria-busy="true">
    <aside className="workspace-bootstrap-sidebar" aria-hidden="true"><i className="bootstrap-brand"/><i className="bootstrap-switcher"/><i className="bootstrap-nav active"/><i className="bootstrap-nav"/><i className="bootstrap-nav"/><i className="bootstrap-nav"/><i className="bootstrap-nav"/><i className="bootstrap-profile"/></aside>
    <section className="workspace-bootstrap-main" aria-hidden="true"><header><i/><i/><i/></header><div className="workspace-bootstrap-content"><span className="bootstrap-eyebrow">CARTEIO AI</span><i className="bootstrap-title"/><i className="bootstrap-description"/><div className="bootstrap-metrics"><i/><i/><i/><i/></div><div className="bootstrap-panels"><i/><i/></div><p>Preparing your workspace…</p></div></section>
  </main>;
}

export function DashboardLayout() {
  const { slug = '' } = useParams();
  const { user, logout, googleAuthState, setGoogleAuthState } = useAuth();
  const { workspaces, remember } = useWorkspaces();
  const navigate = useNavigate();
  const [result, setResult] = useState<{ slug: string; workspace: Workspace | null; error: WorkspaceFailure | null }>({ slug: '', workspace: null, error: null });
  const [retry, setRetry] = useState(0);

  useEffect(() => { void preloadSourceDashboard().catch(() => undefined); }, []);

  useEffect(() => {
    const controller = new AbortController();
    getWorkspace(slug, controller.signal).then(workspace => {
      if (!controller.signal.aborted) { setResult({ slug, workspace, error: null }); remember(slug); }
    }).catch(cause => {
      if (controller.signal.aborted) return;
      const error: WorkspaceFailure = cause instanceof ApiError
        ? cause.status === 404 ? { kind: 'not-found', message: 'This workspace does not exist, or your membership has ended.' }
          : cause.status === 401 || cause.status === 403 ? { kind: 'access', message: 'Your session or workspace access could not be confirmed.' }
            : cause.kind === 'network' ? { kind: 'network', message: 'Carteio could not reach the server. Check your connection and try again.' }
              : cause.kind === 'timeout' ? { kind: 'timeout', message: 'The workspace request took too long. Retry the request.' }
                : cause.kind === 'invalid-response' ? { kind: 'invalid-response', message: 'The server response could not be read. Please retry.' }
                  : { kind: 'unknown', message: 'The workspace could not be loaded. Retry or choose another workspace.' }
        : { kind: 'unknown', message: 'The workspace could not be loaded. Retry or choose another workspace.' };
      setResult({ slug, workspace: null, error });
    });
    return () => controller.abort();
  }, [slug, remember, retry]);

  const workspace = result.slug === slug ? result.workspace : null;
  const error = result.slug === slug ? result.error : null;
  useEffect(() => { if (workspace && googleAuthState === 'DASHBOARD_NAVIGATING') setGoogleAuthState('READY'); }, [workspace, googleAuthState, setGoogleAuthState]);

  if (!workspace && !error) return <WorkspaceLoading/>;
  if (!workspace) { const State = error?.kind === 'access' ? AccessDenied : error?.kind === 'network' || error?.kind === 'timeout' ? NetworkError : RouteError; return <main className="source-workspace-error"><State title={error?.kind === 'not-found' ? 'Workspace unavailable' : error?.kind === 'access' ? 'Access could not be verified' : 'Workspace could not load'} message={error?.message ?? 'Retry or choose another workspace.'} action={{ label: 'Try again', onClick: () => { setResult({ slug, workspace: null, error: null }); setRetry(value => value + 1); } }} secondary={<Link className="carteio-error-secondary" to="/workspaces">Choose workspace</Link>}/><small>Workspace content stays protected until access is confirmed.</small></main>; }

  const updateWorkspace = (updated: Workspace) => {
    if (updated.id !== workspace.id || updated.slug !== slug) return;
    setResult(current => current.slug === slug ? { ...current, workspace: updated, error: null } : current);
  };
  return <WorkspaceContext.Provider value={{ workspace, updateWorkspace }}><Suspense fallback={<WorkspaceLoading/>}><SourceDashboard
      workspace={workspace}
      workspaces={workspaces}
      userName={user?.name || ''}
      userEmail={user?.email}
      onLogout={async () => { await logout(); navigate('/login', { replace: true }); }}
      onSwitchWorkspace={nextSlug => { remember(nextSlug); navigate(`/workspace/${encodeURIComponent(nextSlug)}`); }}
      onWorkspaceSaved={updateWorkspace}
    /></Suspense></WorkspaceContext.Provider>;
}
