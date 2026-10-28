import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { getPlatformOverview } from '../../services/api/saas';
import './saas-pages.css';

function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, dependencies: readonly unknown[]) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    load(controller.signal).then((next) => { if (!controller.signal.aborted) setValue(next); }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'We could not load this information. Try again.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  // `dependencies` is a deliberate caller-controlled dependency list for a small page fetch hook.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, reload]);
  return { value, error, loading, refresh: () => setReload((current) => current + 1) };
}

function PageFrame({ title, description, children, actions, kicker = 'BUSINESS', className = '' }: { title: string; description: string; icon: ReactNode; children: ReactNode; actions?: ReactNode; kicker?: string; className?: string }) {
  return <section className={`saas-product-page ${className}`.trim()}><header className="saas-product-header"><div className="saas-product-title"><div><p className="saas-product-eyebrow">{kicker}</p><h1>{title}</h1><p>{description}</p></div></div>{actions}</header>{children}</section>;
}

function PageState({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  if (loading) return <div className="saas-product-state" role="status" aria-live="polite" aria-label="Loading live workspace data">Loading live workspace data…</div>;
  if (error) return <div className="saas-product-state saas-product-error" role="alert"><AlertCircle size={19}/><span>{error}</span><button type="button" className="saas-small-button" onClick={onRetry}>Retry</button></div>;
  return null;
}

export function PlatformAdminPage() {
  const { value, error, loading, refresh } = useLoad((signal) => getPlatformOverview(signal), []);
  return <PageFrame title="Platform operations" description="Restricted platform-level aggregate diagnostics. Workspace conversation and Knowledge content are not exposed here." icon={<AlertCircle size={20}/> }>
    <PageState loading={loading} error={error} onRetry={refresh}/>{!loading && !error && value && <><div className="saas-sales-grid saas-platform-grid">{Object.entries({ Users: value.counts.users, Workspaces: value.counts.workspaces, Assistants: value.counts.assistants, 'Integration records': value.counts.integrationConnections, Products: value.counts.products, Orders: value.counts.orders, 'Active subscriptions': value.counts.activeSubscriptions, 'Failed sync jobs': value.counts.failedSyncJobs }).map(([label, count]) => <article className="saas-product-card saas-usage-card" key={label}><span>{label}</span><strong>{count.toLocaleString()}</strong></article>)}</div><p className="saas-product-footnote">{value.privacy} Snapshot observed {new Date(value.generatedAt).toLocaleString()}.</p></>}</PageFrame>;
}

// Keep the established module exports available to existing frontend consumers.
// Production routes lazy-load these source-composition pages directly.
export { SourceConversationsPage as ConversationsPage } from '../source/SourceConversationsPage';
export { SourceTicketsPage as TicketsPage } from '../source/SourceTicketsPage';

