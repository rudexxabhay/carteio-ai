import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Check, CircleAlert, Globe2, LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { ApiError } from '../../services/api/client';
import { createWebsiteSource, crawlWebsiteSource, getWebsiteSourceDetails, listWebsitePages, updateWebsiteSyncSettings, type WebsitePagesResponse, type WebsiteSourceDetails } from '../../services/api/knowledge';
import './crawler-pages.css';
import { PageHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';

function useCrawlerData(slug: string, query: { page?: number; pageSize?: number; search?: string; sourceId?: string }) {
  const [data, setData] = useState<WebsitePagesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const refresh = useCallback(() => setRetryKey((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    listWebsitePages(slug, query, controller.signal).then((value) => { if (!controller.signal.aborted) setData(value); }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Website crawl data could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, query.page, query.pageSize, query.search, query.sourceId, retryKey]);
  return { data, loading, error, refresh };
}

function CrawlerFrame({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return <main className="crawler-page"><PageHeader eyebrow="Train AI / Crawl" title={title} desc={description} action={action}/>{children}</main>;
}

function State({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  if (loading) return <p className="crawler-state" role="status"><LoaderCircle size={18}/>Loading authorized website data…</p>;
  if (error) return <p className="crawler-state is-error" role="alert">{error}<button type="button" onClick={retry}>Retry</button></p>;
  return null;
}

export function WebsiteCrawlerPage() {
  const { slug = '' } = useWorkspaceRoute().workspace;
  const [search, setSearch] = useState('');
  const [url, setUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const query = { page: 1, pageSize: 50, search };
  const { data, loading, error, refresh } = useCrawlerData(slug, query);
  const sources = data?.sources ?? [];
  const discovered = data?.total ?? 0;
  const indexed = data?.pages.filter((page) => page.searchReady).length ?? 0;
  const pending = data?.pages.filter((page) => !page.searchReady).length ?? 0;
  async function addWebsite(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice(''); setActionError('');
    try { const source = await createWebsiteSource(slug, { sourceUrl: url }); setNotice(`Website source added: ${source.name}. Verify the domain before crawling.`); setUrl(''); refresh(); }
    catch (cause) { setActionError(cause instanceof ApiError ? cause.message : 'Website source could not be added.'); }
    finally { setBusy(false); }
  }
  async function crawl(sourceId: string) {
    setBusy(true); setActionError(''); setNotice('');
    try { await crawlWebsiteSource(slug, sourceId); setNotice('Crawl request queued. Progress will update from the crawler service.'); refresh(); }
    catch (cause) { setActionError(cause instanceof ApiError ? cause.message : 'Crawl request could not be queued.'); }
    finally { setBusy(false); }
  }
  return <CrawlerFrame title="Website Crawler" description="Discover, index, exclude and re-sync content from authorized business domains." action={<span className="crawler-data-label">LIVE WORKSPACE DATA</span>}>
    <section className="crawler-card crawler-add-card"><h2>Crawl authorized website</h2><p>Respect robots.txt, page exclusions and workspace permissions.</p><form onSubmit={(event) => void addWebsite(event)}><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://store.example.com" aria-label="Website URL" required/><button type="submit" disabled={busy}><Plus size={16}/> Add website</button></form></section>
    {(notice || actionError) && <p className={`crawler-notice ${actionError ? 'is-error' : ''}`} role={actionError ? 'alert' : 'status'}>{actionError || notice}</p>}
    <State loading={loading} error={error} retry={refresh}/>
    {!loading && !error && data && <>
      <div className="crawler-metrics"><Metric label="Domains" value={sources.length} detail="Authorized sources"/><Metric label="Discovered URLs" value={discovered} detail="From available crawl data"/><Metric label="Indexed pages" value={indexed} detail="Current page of results"/><Metric label="Pending" value={pending} detail="Not search ready"/></div>
      <section className="crawler-card crawler-jobs"><div className="crawler-card-title"><div><h2>Crawl jobs</h2><p>Inspect progress, failures and excluded pages</p></div><button type="button" onClick={refresh}><RefreshCw size={15}/> Refresh</button></div>
        {!sources.length ? <div className="crawler-empty"><Globe2 size={22}/><strong>No authorized website sources</strong><p>Add a website source above. Domain verification and workspace permission checks remain required before crawling.</p></div> : sources.map((source) => {
          const ratio = source.pageCount ? Math.min(100, Math.round((source.latestRun?.changedPages ?? 0) / source.pageCount * 100)) : 0;
          return <article className="crawler-domain-row" key={source.id}><div className="crawler-domain-copy"><strong>{source.domain || source.name}</strong><small>{source.pageCount.toLocaleString()} pages · {source.syncPaused ? 'Paused' : source.syncPolicy.toLowerCase()} sync</small></div><div className="crawler-progress"><i style={{ width: `${source.latestRun?.status === 'COMPLETED' ? 100 : ratio}%` }}/></div><span className={`crawler-status ${source.freshness === 'FRESH' ? 'good' : source.latestRun?.status === 'FAILED' ? 'warn' : 'muted'}`}>{source.latestRun?.status?.toLowerCase().replaceAll('_', ' ') || source.processingStatus.toLowerCase()}</span><div className="crawler-row-actions"><button type="button" disabled={busy || source.verificationStatus !== 'VERIFIED'} onClick={() => void crawl(source.id)}>Start crawl <ArrowRight size={14}/></button><Link to={`/workspace/${encodeURIComponent(slug)}/crawler/${encodeURIComponent(source.id)}`}>Details</Link></div></article>;
        })}
      </section>
      <section className="crawler-card crawler-url-card"><div className="crawler-card-title"><div><h2>Discovered URLs</h2><p>{data.total.toLocaleString()} available page records</p></div><label className="crawler-search"><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter URLs"/></label></div>{data.pages.map((page) => <div className="crawler-url-row" key={page.id}><span>{page.canonicalUrl}</span><small className={page.searchReady ? 'good' : 'muted'}>{page.searchReady ? 'Indexed' : page.crawlStatus}</small></div>)}</section>
    </>}
  </CrawlerFrame>;
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) { return <article className="crawler-metric"><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{detail}</small></article>; }

export function WebsiteCrawlDetailPage() {
  const { slug = '' } = useWorkspaceRoute().workspace;
  const { sourceId = '' } = useParams();
  const [pageSearch, setPageSearch] = useState('');
  const query = { page: 1, pageSize: 100, sourceId, search: pageSearch };
  const { data, loading, error, refresh } = useCrawlerData(slug, query);
  const source = data?.sources.find((item) => item.id === sourceId);
  const [details, setDetails] = useState<WebsiteSourceDetails | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [policy, setPolicy] = useState<'MANUAL' | 'DAILY' | 'WEEKLY'>('MANUAL');
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setSettingsLoading(true); setSettingsError('');
    getWebsiteSourceDetails(slug, sourceId, controller.signal).then((value) => { if (!controller.signal.aborted) { setDetails(value); setPolicy(value.syncPolicy as typeof policy); setPaused(value.paused); } }).catch((cause) => { if (!controller.signal.aborted) setSettingsError(cause instanceof ApiError ? cause.message : 'Crawl configuration could not be loaded.'); }).finally(() => { if (!controller.signal.aborted) setSettingsLoading(false); });
    return () => controller.abort();
  }, [slug, sourceId]);
  async function saveSyncSettings() {
    setBusy(true); setActionError(''); setNotice('');
    try { await updateWebsiteSyncSettings(slug, sourceId, { syncPolicy: policy, paused }); setNotice('Sync settings saved. Path allow/deny rules are not exposed by the current API.'); refresh(); }
    catch (cause) { setActionError(cause instanceof ApiError ? cause.message : 'Sync settings could not be saved.'); }
    finally { setBusy(false); }
  }
  async function recrawl() {
    setBusy(true); setActionError(''); setNotice('');
    try { await crawlWebsiteSource(slug, sourceId); setNotice('Crawl queued. Job progress will update from the crawler service.'); refresh(); }
    catch (cause) { setActionError(cause instanceof ApiError ? cause.message : 'Crawl could not be queued.'); }
    finally { setBusy(false); }
  }
  const host = source?.domain || source?.url || source?.name || 'Website crawl';
  return <CrawlerFrame title={host} description="Configure authorized sync timing, review indexed URLs and inspect crawler state." action={<button className="crawler-primary" type="button" disabled={busy || source?.verificationStatus !== 'VERIFIED'} onClick={() => void recrawl()}>Re-crawl now</button>}>
    <State loading={loading || settingsLoading} error={error || settingsError} retry={refresh}/>
    {(notice || actionError) && <p className={`crawler-notice ${actionError ? 'is-error' : ''}`} role={actionError ? 'alert' : 'status'}>{actionError || notice}</p>}
    {!loading && !error && source && <>
      <div className="crawler-detail-badges"><span className={`crawler-status ${source.verificationStatus === 'VERIFIED' ? 'good' : 'warn'}`}>{source.verificationStatus === 'VERIFIED' ? 'Domain verified' : `Domain ${source.verificationStatus.toLowerCase()}`}</span><span className="crawler-status blue"><Check size={14}/> Robots rules respected</span></div>
      <section className="crawler-detail-grid"><article className="crawler-card crawler-config"><h2>Crawl configuration</h2><label>Starting URL<input readOnly value={source.url || ''}/></label><label>Allowed paths<input disabled value="Path rules unavailable in current crawler API"/></label><label>Excluded paths<input disabled value="Path rules unavailable in current crawler API"/></label><label>Crawl schedule<select value={policy} onChange={(event) => setPolicy(event.target.value as typeof policy)}><option value="MANUAL">Manual</option><option value="DAILY">Every 24 hours</option><option value="WEEKLY">Weekly</option></select></label><label className="crawler-toggle"><input type="checkbox" checked={paused} onChange={(event) => setPaused(event.target.checked)}/> Pause scheduled sync</label><span className="crawler-status blue"><Check size={14}/> Respect robots.txt</span><button className="crawler-primary" disabled={busy || !details || (policy === details.syncPolicy && paused === details.paused)} type="button" onClick={() => void saveSyncSettings()}>Save sync settings</button><p className="crawler-capability-note">Custom path allow/deny rules and crawl-depth settings are not supported by the current API; those controls stay unavailable.</p></article>
        <article className="crawler-card crawler-page-list"><div className="crawler-card-title"><div><h2>Discovered &amp; indexed pages</h2><p>{data?.total.toLocaleString() ?? 0} page records</p></div><label className="crawler-search"><Search size={15}/><input aria-label="Filter URLs" value={pageSearch} placeholder="Filter URLs" onChange={(event) => setPageSearch(event.target.value)}/></label></div>{data?.pages.map((page) => <div className="crawler-url-row" key={page.id}><span>{page.canonicalUrl}</span><small className={page.searchReady ? 'good' : 'muted'}>{page.searchReady ? 'Indexed' : page.crawlStatus}</small><time>{new Date(page.crawledAt).toLocaleDateString()}</time></div>)}</article></section>
    </>}
    {!loading && !error && !source && <div className="crawler-empty"><CircleAlert size={22}/><strong>Website source is unavailable</strong><p>It may have been removed, or you may no longer have workspace access.</p><Link to={`/workspace/${encodeURIComponent(slug)}/crawler`}>Back to Website Crawler</Link></div>}
  </CrawlerFrame>;
}
