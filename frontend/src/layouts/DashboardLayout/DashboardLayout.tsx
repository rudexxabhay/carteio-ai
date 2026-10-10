import { useEffect, useState } from 'react';
import { Activity, BookOpen, Bot, Building2, ChevronDown, LayoutDashboard, LogOut, Settings, Users, Database } from 'lucide-react';
import { Link, NavLink, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { BrandLogo } from '../../components/common/BrandLogo';
import { ThemeSwitcher } from '../../components/common/ThemeSwitcher';
import { useAuth } from '../../app/providers/AuthProvider';
import { useWorkspaces } from '../../app/providers/WorkspaceProvider';
import { ApiError } from '../../services/api/client';
import { getWorkspace, type Workspace } from '../../services/api/workspaces';

export type WorkspaceRouteContext = { workspace: Workspace; updateWorkspace: (workspace: Workspace) => void };

function WorkspaceLoading() {
  return <main className="workspace-loading" role="status" aria-live="polite"><span className="workspace-spinner"/>Loading workspace…</main>;
}

export function DashboardLayout() {
  const { slug = '' } = useParams();
  const { user, logout, googleAuthState, setGoogleAuthState } = useAuth();
  const { workspaces, remember } = useWorkspaces();
  const navigate = useNavigate();
  const [result, setResult] = useState<{ slug: string; workspace: Workspace | null; error: string | null }>({ slug: '', workspace: null, error: null });
  const [logoutError, setLogoutError] = useState('');
  const updateWorkspace = (next: Workspace) => setResult({ slug, workspace: next, error: null });

  useEffect(() => {
    const controller = new AbortController();
    getWorkspace(slug, controller.signal).then((workspace) => {
      if (!controller.signal.aborted) { setResult({ slug, workspace, error: null }); remember(slug); }
    }).catch((cause) => {
      if (!controller.signal.aborted) setResult({ slug, workspace: null, error: cause instanceof ApiError && cause.status === 404 ? 'This workspace is unavailable or you are no longer a member.' : 'We could not open this workspace. Please try again.' });
    });
    return () => controller.abort();
  }, [slug, remember]);

  const workspace = result.slug === slug ? result.workspace : null;
  const error = result.slug === slug ? result.error : null;

  useEffect(() => {
    if (workspace && googleAuthState === 'DASHBOARD_NAVIGATING') setGoogleAuthState('READY');
  }, [workspace, googleAuthState, setGoogleAuthState]);

  async function signOut() {
    setLogoutError('');
    try { await logout(); navigate('/login', { replace: true }); }
    catch { setLogoutError('We could not safely end your session. Please try again.'); }
  }

  if (!workspace && !error) return <WorkspaceLoading/>;
  if (!workspace) return <main className="workspace-message"><span className="workspace-message-icon"><Building2 size={22}/></span><h1>Workspace unavailable</h1><p>{error || 'You may no longer have access to this workspace.'}</p><Link className="button button-primary" to="/workspaces">Choose a workspace</Link></main>;

  return <div className="saas-shell">
    <aside className="saas-sidebar">
      <Link className="brand" to="/" aria-label="Carteio AI home"><BrandLogo/></Link>
      <div className="sidebar-workspace-identity"><span className="workspace-avatar">{workspace.name.slice(0, 1).toUpperCase()}</span><span><strong>{workspace.name}</strong><small>{workspace.role} workspace</small></span></div>
      <span className="saas-nav-label">WORKSPACE</span>
      <nav className="saas-nav" aria-label="Workspace navigation">
        <NavLink to={`/workspace/${encodeURIComponent(slug)}`} end><LayoutDashboard size={17}/> Overview</NavLink>
        <NavLink to={`/workspace/${encodeURIComponent(slug)}/assistants`}><Bot size={17}/> AI Assistants</NavLink>
        <NavLink to={`/workspace/${encodeURIComponent(slug)}/knowledge`}><Database size={17}/> Knowledge Base</NavLink>
        <NavLink to={`/workspace/${encodeURIComponent(slug)}/team`}><Users size={17}/> Team</NavLink>
        <NavLink to={`/workspace/${encodeURIComponent(slug)}/settings`}><Settings size={17}/> Settings</NavLink>
      </nav>
      <div className="saas-sidebar-bottom"><div className="sidebar-note"><Activity size={16}/><span><strong>{user?.name || user?.email}</strong><small>{user?.emailVerified ? 'Verified account' : 'Account'}</small></span></div><Link to="/docs" className="saas-help-link"><BookOpen size={15}/> Help & documentation</Link></div>
    </aside>
    <div className="saas-main">
      <header className="saas-header">
        <div className="saas-mobile-brand"><Link className="brand" to="/" aria-label="Carteio AI home"><BrandLogo/></Link></div>
        <label className="workspace-switcher-label" htmlFor="workspace-switcher">Workspace</label>
        <div className="workspace-switcher-wrap"><Building2 size={16}/><select id="workspace-switcher" aria-label="Switch workspace" value={slug} onChange={(event) => { const next = workspaces.find((item) => item.slug === event.target.value); if (next) { remember(next.slug); navigate(`/workspace/${encodeURIComponent(next.slug)}`); } }}>
          {workspaces.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
        </select><ChevronDown size={14}/></div>
        <div className="saas-header-spacer"/>
        <ThemeSwitcher/>
        <details className="account-menu"><summary aria-label="Open account menu"><span className="account-avatar">{(user?.name || user?.email || 'U').slice(0, 1).toUpperCase()}</span><span className="account-menu-name">{user?.name || user?.email}</span><ChevronDown size={14}/></summary><div className="account-menu-panel"><strong>{user?.name || 'Your account'}</strong><small>{user?.email}</small><button type="button" onClick={() => void signOut()}><LogOut size={15}/> Sign out</button></div></details>
      </header>
      <nav className="saas-mobile-nav" aria-label="Workspace navigation">
        <NavLink to={`/workspace/${encodeURIComponent(slug)}`} end><LayoutDashboard size={16}/><span>Overview</span></NavLink>
        <NavLink to={`/workspace/${encodeURIComponent(slug)}/assistants`}><Bot size={16}/><span>Assistants</span></NavLink>
        <NavLink to={`/workspace/${encodeURIComponent(slug)}/knowledge`}><Database size={16}/><span>Knowledge</span></NavLink>
        <NavLink to={`/workspace/${encodeURIComponent(slug)}/team`}><Users size={16}/><span>Team</span></NavLink>
        <NavLink to={`/workspace/${encodeURIComponent(slug)}/settings`}><Settings size={16}/><span>Settings</span></NavLink>
      </nav>
      <main className="saas-content">{logoutError && <div className="workspace-form-error" role="alert">{logoutError}</div>}<Outlet context={{ workspace, updateWorkspace } satisfies WorkspaceRouteContext}/></main>
    </div>
  </div>;
}

export function useWorkspaceRoute() { return useOutletContext<WorkspaceRouteContext>(); }
