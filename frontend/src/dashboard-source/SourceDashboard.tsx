import { useEffect, useState } from 'react';
import { Search, Bell, Menu, X, ChevronDown, CircleHelp, LogOut, ChevronRight, ArrowUpRight, LayoutDashboard, Bot, Database, MoreHorizontal, CircleAlert, Sun, Moon } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Pages from './pages';
import { AppErrorBoundary } from '../components/common/AppErrorBoundary';
import { useTheme } from '../app/providers/ThemeProvider';
import { nav, extra, pageTitles, type PageId } from './data';
import type { Workspace } from '../services/api/workspaces';
import './source-dashboard.css';

type Props = { workspace: Workspace; workspaces: Workspace[]; userName: string; userEmail?: string; onLogout: () => void | Promise<void>; onSwitchWorkspace: (slug: string) => void; onWorkspaceSaved?: (workspace: Workspace) => void };
const pagePaths: Record<PageId, string> = {
  overview: '', products: 'products', 'product-detail': 'products/source-preview', sales: 'sales', 'order-detail': 'orders/source-preview',
  assistants: 'assistants', train: 'training', behavior: 'training/behavior', playground: 'training/playground', knowledge: 'knowledge',
  'source-detail': 'knowledge/source-preview', crawler: 'crawler', 'crawl-detail': 'crawler/source-preview', builder: 'builder', integrations: 'integrations',
  shopify: 'integrations/shopify', install: 'widget', appearance: 'widget/appearance', conversations: 'conversations', handoff: 'tickets',
  'case-detail': 'tickets/source-preview', 'handoff-rules': 'escalation-rules', analytics: 'analytics', billing: 'billing', invoices: 'invoices',
  settings: 'settings', team: 'team', sync: 'integrations/shopify/sync',
};
function pageFromPath(path: string, slug: string, search = ''): PageId {
  const parts = path.split('/').filter(Boolean).slice(2);
  if (!parts.length) return 'overview';
  if (parts[0] === 'products') return parts.length > 1 ? 'product-detail' : 'products';
  if (parts[0] === 'orders') return 'order-detail';
  if (parts[0] === 'training') return parts[1] === 'behavior' ? 'behavior' : parts[1] === 'playground' || new URLSearchParams(search).get('tab') === 'playground' ? 'playground' : 'train';
  if (parts[0] === 'knowledge') return parts.length > 1 ? 'source-detail' : 'knowledge';
  if (parts[0] === 'crawler') return parts.length > 1 ? 'crawl-detail' : 'crawler';
  if (parts[0] === 'integrations') return parts[1] === 'shopify' ? parts[2] === 'sync' ? 'sync' : 'shopify' : 'integrations';
  if (parts[0] === 'widget') return parts[1] === 'appearance' ? 'appearance' : 'install';
  if (parts[0] === 'tickets') return parts.length > 1 ? 'case-detail' : 'handoff';
  if (parts[0] === 'settings' && parts[1] === 'team') return 'team';
  const routes: Record<string, PageId> = { sales: 'sales', assistants: 'assistants', builder: 'builder', conversations: 'conversations', 'escalation-rules': 'handoff-rules', analytics: 'analytics', billing: 'billing', invoices: 'invoices', settings: 'settings', team: 'team' };
  return routes[parts[0] ?? ''] ?? (slug ? 'overview' : 'overview');
}

export default function SourceDashboard({ workspace, workspaces, userName, userEmail, onLogout, onSwitchWorkspace, onWorkspaceSaved }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { slug = '', '*': wildcard = '' } = useParams();
  const routeSegments = wildcard.split('/').filter(Boolean);
  const productRouteQuery = new URLSearchParams(location.search);
  const recordId = routeSegments[0] === 'products' && routeSegments[1] === 'item' ? productRouteQuery.get('externalId') ?? '' : routeSegments.length ? routeSegments[routeSegments.length - 1] : '';
  const recordConnectionId = productRouteQuery.get('integrationId') ?? (routeSegments.length > 2 && routeSegments[0] === 'products' ? routeSegments[routeSegments.length - 2] : '');
  const [page, setPage] = useState<PageId>(() => pageFromPath(location.pathname, slug, location.search));
  const [drawer, setDrawer] = useState(false);
  const [cmd, setCmd] = useState(false);
  const [find, setFind] = useState('');
  const [toast, setToast] = useState('');
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const { mode, setMode } = useTheme();
  useEffect(() => { setPage(pageFromPath(location.pathname, slug, location.search)); setDrawer(false); }, [location.pathname, location.search, slug]);
  useEffect(() => { const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd(x => !x); } else if (e.key === 'Escape') { setCmd(false); setDrawer(false); setWorkspaceMenu(false); setProfileMenu(false); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 3600); return () => clearTimeout(id); }, [toast]);
  function go(id: PageId) { navigate(`/workspace/${encodeURIComponent(slug)}/${pagePaths[id]}`.replace(/\/$/, '')); setPage(id); setDrawer(false); setCmd(false); setProfileMenu(false); window.scrollTo({ top: 0, behavior: 'instant' } as ScrollToOptions); }
  function signOut() { setProfileMenu(false); void Promise.resolve().then(() => onLogout()).catch(() => setToast('We could not safely end your session. Please try again.')); }
  const parent = extra.find(x => x.id === page)?.parent ?? page;
  const groups = [...new Set(nav.map(n => n.group))];
  const displayName = userName?.trim() || userEmail?.trim() || 'Account';
  const userInitials = getInitials(userName?.trim() || userEmail?.trim() || '');
  const workspaceInitials = getInitials(workspace.name);
  return <div className={`source-dashboard${page === 'builder' ? ' builder-active' : ''}`} data-mode={mode}><div className={'app-layout'}>
    {drawer && <button className="mobile-overlay" onClick={() => setDrawer(false)} aria-label="Close navigation"/>}
    <aside className={'sidebar ' + (drawer ? 'show' : '')}><div className="sidebar-brand"><button className="brand" onClick={() => go('overview')} aria-label="Carteio AI dashboard"><span>Carteio</span><b>AI</b></button><button className="close-nav" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={19}/></button></div>
      <button className="workspace-switcher" onClick={() => setWorkspaceMenu(x => !x)} aria-expanded={workspaceMenu}><span className="workspace-logo">{workspaceInitials}</span><span className="workspace-names"><strong>{workspace.name}</strong><small>{workspace.businessType || `${workspace.currentUserRole || workspace.role} workspace`}</small></span><ChevronDown size={14}/></button>
      {workspaceMenu && workspaces.length > 1 && <div className="workspace-options">{workspaces.map(item => <button key={item.id} aria-current={item.slug === slug ? 'true' : undefined} disabled={item.slug === slug} onClick={() => { setWorkspaceMenu(false); if (item.slug !== slug) onSwitchWorkspace(item.slug); }}>{item.name}{item.slug === slug ? ' · Current' : ''}</button>)}</div>}
      <nav className="sidebar-nav" aria-label="Dashboard navigation">{groups.map(g => <div className="nav-group" key={g}><div className="nav-group-label">{g}</div>{nav.filter(n => n.group === g).map(n => { const Icon = n.icon; return <button className={'nav-link ' + (parent === n.id ? 'active' : '')} title={n.label} key={n.id} onClick={() => go(n.id)}><Icon size={18}/><span>{n.label}</span>{parent === n.id && <i/>}</button>; })}</div>)}</nav>
      <div className="sidebar-bottom"><button className="profile" aria-haspopup="menu" aria-expanded={profileMenu} onClick={() => setProfileMenu(value => !value)}><span className="user-avatar">{userInitials}</span><span><strong>{displayName}</strong><small>{userEmail || 'Manage account'}</small></span><ChevronRight size={17}/></button>{profileMenu && <div className="source-profile-menu" role="menu"><button role="menuitem" onClick={() => go('settings')}>Account settings</button><button role="menuitem" className="source-signout" onClick={signOut}><LogOut size={15}/> Sign out</button></div>}</div>
    </aside>
      <div className={`app-right${page === 'builder' ? ' builder-route' : ''}`}><header className="topbar"><div className="top-left"><button onClick={() => setDrawer(true)} aria-label="Open sidebar" className="hamburger"><Menu size={21}/></button><button className="top-crumb" onClick={() => go(parent)}><span>{workspace.name}</span><ChevronRight size={13}/><strong>{pageTitles[page]}</strong></button></div><div className="top-right"><button className="top-search" onClick={() => setCmd(true)}><Search size={18}/><span>Search dashboard pages...</span><kbd>⌘ K</kbd></button><button className="theme-toggle" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>{mode === 'dark' ? <Sun size={18}/> : <Moon size={18}/>}</button><button className="help-button" onClick={() => navigate('/help')} title="Help center"><CircleHelp size={18}/><span>Help</span></button><button className="bell-button" onClick={() => setToast('Notifications are unavailable because no notification API is exposed to the frontend.')} title="Notifications"><Bell size={18}/></button><button className="top-user" onClick={() => go('settings')}><span className="user-avatar">{userInitials}</span><span><strong>{displayName}</strong><small>{workspace.currentUserRole || workspace.role}</small></span></button></div></header>
      <main className={`main-content${page === 'builder' ? ' builder-route-content' : ''}${page === 'playground' ? ' playground-route-content' : ''}`} id="content"><AppErrorBoundary key={`${slug}:${page}`} mode="section"><Pages page={page} go={go} notify={setToast} workspaceSlug={slug} workspaceRole={workspace.currentUserRole || workspace.role} workspaceData={workspace} onWorkspaceSaved={onWorkspaceSaved} preferredAssistantId={productRouteQuery.get('assistantId') ?? ''} recordId={recordId} recordConnectionId={recordConnectionId} openProduct={(externalId, integrationId) => { const query = new URLSearchParams({ externalId, ...(integrationId ? { integrationId } : {}) }); navigate(`/workspace/${encodeURIComponent(slug)}/products/item?${query}`); window.scrollTo({ top: 0, behavior: 'instant' } as ScrollToOptions); }} openOrder={externalId => { navigate(`/workspace/${encodeURIComponent(slug)}/orders/${encodeURIComponent(externalId)}`); window.scrollTo({ top: 0, behavior: 'instant' } as ScrollToOptions); }} openAssistant={id => navigate(`/workspace/${encodeURIComponent(slug)}/training/behavior?assistantId=${encodeURIComponent(id)}`)} createAssistant={() => navigate(`/workspace/${encodeURIComponent(slug)}/assistants/new`)} openKnowledge={id => navigate(`/workspace/${encodeURIComponent(slug)}/knowledge/${encodeURIComponent(id)}`)} openTicket={id => navigate(`/workspace/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(id)}`)} openCrawl={id => navigate(`/workspace/${encodeURIComponent(slug)}/crawler/${encodeURIComponent(id)}`)} openShopify={id => { navigate(`/workspace/${encodeURIComponent(slug)}/integrations/shopify/${encodeURIComponent(id)}`); window.scrollTo({ top: 0, behavior: 'instant' } as ScrollToOptions); }}/></AppErrorBoundary>{page !== 'playground' && <footer className="page-footer">Carteio AI · {workspace.name}</footer>}</main></div>
    <nav className="mobile-bottom" aria-label="Quick mobile navigation">{[{id:'overview' as PageId,icon:LayoutDashboard,title:'Home'},{id:'assistants' as PageId,icon:Bot,title:'Assistants'},{id:'knowledge' as PageId,icon:Database,title:'Sources'}].map(({id,icon:Icon,title})=><button onClick={() => go(id)} className={parent === id ? 'active' : ''} key={id}><Icon size={19}/><span>{title}</span></button>)}<button onClick={() => setDrawer(true)}><MoreHorizontal size={20}/><span>More</span></button></nav>
    {cmd && <div className="command-backdrop" role="dialog" aria-modal="true" aria-label="Navigate dashboard"><button className="command-overlay" onClick={() => setCmd(false)}/><div className="command-palette"><div className="command-search"><Search size={19}/><input autoFocus placeholder="Go to a dashboard screen..." value={find} onChange={e => setFind(e.target.value)}/><button onClick={() => setCmd(false)} aria-label="Close search"><X size={18}/></button></div><div className="command-results">{[...nav, ...extra].filter(n => ('label' in n ? n.label : n.title).toLowerCase().includes(find.toLowerCase())).map(n => { const Icon = n.icon; return <button key={n.id} onClick={() => go(n.id)}><Icon size={18}/><span>{'label' in n ? n.label : n.title}</span><ArrowUpRight size={15}/></button>; })}</div></div></div>}
    {toast && <div className="toast" role="status"><CircleAlert size={18}/>{toast}<button onClick={() => setToast('')} aria-label="Dismiss"><X size={15}/></button></div>}
  </div></div>;
}

function getInitials(value: string): string {
  const initials = value.trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  return initials || '—';
}
