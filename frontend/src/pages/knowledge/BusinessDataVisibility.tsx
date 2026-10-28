import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { createWebsiteSource, crawlWebsiteSource, getWebsitePage, getWebsiteSourceDetails, listWebsitePages, updateWebsiteSyncSettings, type WebsitePageDetail, type WebsitePagesResponse, type WebsiteSourceDetails } from '../../services/api/knowledge';
import { getConnectorPermissions, getConnectors, getConnectorSyncHistory, queueConnectorSync, refreshShopifyPermissions, retryConnectorSync, type ConnectorInstance, type ConnectorPermissions, type SyncJob } from '../../services/api/connectors';

const failureMessage = (error: unknown) => error instanceof ApiError && error.kind === 'http' && error.status !== undefined && error.status < 500 ? error.message : 'The stored business data could not be loaded. Please try again.';
const dateLabel = (date?: string | null) => date ? new Date(date).toLocaleString() : 'Not recorded';
const statusLabel = (value: string) => value.toLowerCase().replaceAll('_', ' ');

export function BusinessDataVisibility({ slug, manager, initialTab = 'website', compact = false }: { slug: string; manager: boolean; initialTab?: 'website' | 'shopify'; compact?: boolean }) {
  const [tab, setTab] = useState<'website' | 'shopify'>(initialTab);
  const [website, setWebsite] = useState<WebsitePagesResponse | null>(null);
  const [websitePage, setWebsitePage] = useState(1);
  const [websiteSearch, setWebsiteSearch] = useState('');
  const [selectedPage, setSelectedPage] = useState<WebsitePageDetail | null>(null);
  const [addWebsiteOpen, setAddWebsiteOpen] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteName, setWebsiteName] = useState('');
  const [websiteDetails, setWebsiteDetails] = useState<Record<string, WebsiteSourceDetails>>({});
  const [connectors, setConnectors] = useState<ConnectorInstance[]>([]);
  const [shopifyData, setShopifyData] = useState<Array<{ connector: ConnectorInstance; permissions: ConnectorPermissions; assistantOptions: Array<{ id: string; name: string; status: string }>; jobs: SyncJob[] }>>([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState('');
  const [websiteLoading, setWebsiteLoading] = useState(true);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => { setSelectedAssistantId(''); setSelectedPage(null); }, [slug]);

  useEffect(() => {
    if (compact) return;
    const controller = new AbortController(); setError(''); setWebsiteLoading(true);
    listWebsitePages(slug, { page: websitePage, pageSize: 20, search: websiteSearch }, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setWebsite(data); })
      .catch((cause) => { if (!controller.signal.aborted) setError(failureMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setWebsiteLoading(false); });
    return () => controller.abort();
  }, [slug, websitePage, websiteSearch, reload, compact]);

  useEffect(() => {
    if (tab !== 'shopify') return;
    const controller = new AbortController(); setShopifyLoading(true); setError('');
    getConnectors(slug, controller.signal).then(async ({ items }) => {
      const shopify = items.filter((item) => item.connectorId === 'shopify_v1'); setConnectors(shopify);
      const data = await Promise.all(shopify.map(async (connector) => {
        const [workspacePermissions, history] = await Promise.all([getConnectorPermissions(slug, connector.id), getConnectorSyncHistory(slug, connector.id, controller.signal)]);
        const assistantOptions = workspacePermissions.assistants ?? [];
        const assistantId = selectedAssistantId || assistantOptions[0]?.id || '';
        const permissions = assistantId ? await getConnectorPermissions(slug, connector.id, assistantId) : workspacePermissions;
        return { connector, permissions, assistantOptions, jobs: history.items };
      }));
      if (!controller.signal.aborted) { setShopifyData(data); if (!selectedAssistantId && data[0]?.assistantOptions[0]) setSelectedAssistantId(data[0].assistantOptions[0].id); }
    }).catch((cause) => { if (!controller.signal.aborted) setError(failureMessage(cause)); }).finally(() => { if (!controller.signal.aborted) setShopifyLoading(false); });
    return () => controller.abort();
  }, [slug, tab, reload, selectedAssistantId]);

  async function inspectPage(id: string) {
    setBusy(`page:${id}`); setError('');
    try { setSelectedPage(await getWebsitePage(slug, id)); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { setBusy(''); }
  }

  async function refreshWebsite(sourceId: string) {
    setBusy(sourceId); setError(''); setNotice('');
    try {
      await crawlWebsiteSource(slug, sourceId);
      const details = await getWebsiteSourceDetails(slug, sourceId);
      setWebsiteDetails((current) => ({ ...current, [sourceId]: details }));
      setReload((value) => value + 1);
      if (!details.workerEnabled) setNotice('The crawl is queued, but the Knowledge Processing worker is disabled. Enable it on a backend worker before pages can be crawled or indexed.');
    }
    catch (cause) { setError(failureMessage(cause)); }
    finally { setBusy(''); }
  }

  async function addWebsite() {
    setBusy('add-website'); setError(''); setNotice('');
    try {
      const source = await createWebsiteSource(slug, { sourceUrl: websiteUrl.trim(), ...(websiteName.trim() ? { name: websiteName.trim() } : {}) });
      setWebsiteUrl(''); setWebsiteName(''); setAddWebsiteOpen(false);
      setNotice(`Website saved. Its bounded initial crawl has been queued automatically; refreshes remain manual. Training status will update below.`);
      setReload((value) => value + 1);
      try {
        const details = await getWebsiteSourceDetails(slug, source.id);
        setWebsiteDetails((current) => ({ ...current, [source.id]: details }));
        if (!details.workerEnabled) setNotice('Website saved and the initial crawl was queued, but the Knowledge Processing worker is disabled. Enable it on a backend worker for pages to be crawled and indexed.');
      } catch { /* Source creation and the transactional initial job already succeeded. */ }
    } catch (cause) { setError(failureMessage(cause)); }
    finally { setBusy(''); }
  }

  async function inspectWebsiteStatus(sourceId: string) {
    setBusy(`status:${sourceId}`); setError('');
    try {
      const details = await getWebsiteSourceDetails(slug, sourceId);
      setWebsiteDetails((current) => ({ ...current, [sourceId]: details }));
      setReload((value) => value + 1);
    } catch (cause) { setError(failureMessage(cause)); }
    finally { setBusy(''); }
  }

  async function setManualWebsiteMode(sourceId: string) {
    setBusy(sourceId); setError('');
    try { await updateWebsiteSyncSettings(slug, sourceId, { syncPolicy: 'MANUAL' }); setReload((value) => value + 1); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { setBusy(''); }
  }

  async function startShopifySync(connectorId: string, resource: 'PRODUCTS' | 'CONTENT') {
    setBusy(`${connectorId}:${resource}`); setError('');
    try { await queueConnectorSync(slug, connectorId, resource, 'INCREMENTAL'); setReload((value) => value + 1); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { setBusy(''); }
  }

  async function retryShopifySync(connectorId: string, jobId: string) {
    setBusy(jobId); setError('');
    try { await retryConnectorSync(slug, connectorId, jobId); setReload((value) => value + 1); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { setBusy(''); }
  }

  async function refreshShopifyGrantSnapshot(connectorId: string) {
    setBusy(`${connectorId}:grants`); setError('');
    try { await refreshShopifyPermissions(slug, connectorId); setReload((value) => value + 1); }
    catch (cause) { setError(failureMessage(cause)); }
    finally { setBusy(''); }
  }

  if (compact) return <section className="workspace-panel business-data-panel">
    <div className="workspace-panel-heading"><div><h2>Products &amp; Collections</h2><p>Saved Shopify catalog snapshots. Prices and availability are not live API results.</p></div><button className="button button-secondary" onClick={() => setReload(value => value + 1)}><RefreshCw size={14}/> Refresh view</button></div>
    {error ? <p role="alert" className="workspace-form-error">{error}</p> : shopifyLoading ? <p role="status">Loading authorized catalog status…</p> : !connectors.length ? <p>No Shopify connector is configured. Use Manage integrations to connect a store.</p> : shopifyData.map(({ connector, permissions, assistantOptions, jobs }) => {
      const snapshot = permissions.shopifyScopeSnapshot;
      const counts = permissions.storedRecordCounts;
      const latest = permissions.latestSyncJob ?? jobs[0] ?? connector.latestSyncJob;
      return <article className="business-data-shopify" key={connector.id}>
        <h3>{connector.displayName}</h3><p>Connection: {connector.state} · Verified scope snapshot: {snapshot?.freshness ?? 'UNAVAILABLE'}</p>
        {!!assistantOptions.length && <label className="workspace-field">Assistant permissions<select aria-label="Shopify readiness assistant" value={selectedAssistantId} onChange={event => setSelectedAssistantId(event.target.value)}>{assistantOptions.map(assistant => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}</select></label>}
        <div className="business-data-counts">{[['Products', counts?.products], ['Collections', counts?.collections], ['Variants', counts?.variants], ['Products with prices', counts?.productsWithPrices], ['Products with inventory', counts?.productsWithInventory]].map(([label, value]) => <div key={String(label)}><strong>{typeof value === 'number' ? value.toLocaleString() : 'Unavailable'}</strong><small>{label}</small></div>)}</div>
        <p>Last successful sync: {dateLabel(snapshot?.lastSuccessfulSyncAt)} · Latest job: {latest ? `${latest.resourceType} ${statusLabel(latest.state)}${latest.lastErrorCode ? ` · ${latest.lastErrorCode}` : ''}` : 'Not recorded'}</p>
        <details><summary>Catalog permission status</summary><div className="business-data-operations">{snapshot?.operations.filter(operation => operation.category === 'PRODUCTS').map(operation => <div key={`${operation.category}:${operation.operation}`}><strong>{operation.operation}</strong><span>{operation.eligible ? 'Eligible' : operation.blockedReason ?? operation.dataStatus}</span></div>)}</div>{!snapshot && <p>Verified permission snapshot unavailable.</p>}</details>
      </article>;
    })}
  </section>;

  return <section className="workspace-panel business-data-panel">
    <div className="workspace-panel-heading"><div><h2>{compact ? 'Products & Collections' : 'Stored business data'}</h2><p>{compact ? 'Authorized Shopify catalog records, permission status and synchronization freshness.' : 'These records are read from the workspace database. Readiness reflects saved data and current permissions.'}</p></div><button className="button button-secondary" onClick={() => setReload((value) => value + 1)}><RefreshCw size={14}/> Refresh view</button></div>
    {!compact && <div className="kb-dashboard-tabs" role="tablist" aria-label="Stored business data views"><button role="tab" aria-selected={tab === 'website'} className={tab === 'website' ? 'active' : ''} onClick={() => setTab('website')}>Website pages</button><button role="tab" aria-selected={tab === 'shopify'} className={tab === 'shopify' ? 'active' : ''} onClick={() => setTab('shopify')}>Shopify data</button></div>}
    {error && <p role="alert" className="workspace-form-error">{error}</p>}
    {notice && <p role="status" className="website-training-notice">{notice}</p>}
    {tab === 'website' && <>
      <div className="business-data-toolbar"><label className="kb-search"><Search size={15}/><input aria-label="Search saved website pages" placeholder="Search saved pages" value={websiteSearch} onChange={(event) => { setWebsiteSearch(event.target.value); setWebsitePage(1); }}/></label><span>{website?.total ?? '…'} saved pages</span>{manager && <button className="button button-primary" onClick={() => { setAddWebsiteOpen((open) => !open); setError(''); }}><ExternalLink size={14}/>{addWebsiteOpen ? 'Close' : 'Add Website'}</button>}</div>
      {addWebsiteOpen && <form className="workspace-panel website-training-form" onSubmit={(event) => { event.preventDefault(); void addWebsite(); }}><div><h3>Add a website to train your AI</h3><p>Enter a public website URL. Carteio validates and saves it, then queues one bounded initial crawl automatically. No Shopify connection is required.</p></div><label className="workspace-field">Website URL<input type="url" required minLength={8} maxLength={2048} placeholder="https://your-business.example" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} autoComplete="url"/></label><label className="workspace-field">Display name <span>(optional)</span><input type="text" maxLength={200} placeholder="Your store name" value={websiteName} onChange={(event) => setWebsiteName(event.target.value)}/></label><p className="website-training-policy">Initial training starts once after registration. Later refreshes use <strong>MANUAL</strong> mode. Public crawling does not require DNS verification; customer widget use still requires a verified assistant domain matching this website.</p><div className="business-data-actions"><button type="submit" className="button button-primary" disabled={Boolean(busy)}>{busy === 'add-website' ? 'Saving and queueing…' : 'Add Website & Start Training'}</button></div></form>}
      {websiteLoading ? <div className="kb-skeleton-list" role="status" aria-label="Loading saved website pages"><i/><i/></div> : website?.sources.length ? <div className="business-data-sources">{website.sources.map((source) => { const details = websiteDetails[source.id]; const linked = source.linkedAssistants ?? source.assignedAssistants; const domainEligible = source.domainEligibleAssistants ?? source.assignedAssistants; const active = ['QUEUED', 'PROCESSING', 'RETRY_WAIT'].includes(details?.crawlJobStatus ?? '') || ['QUEUED', 'PROCESSING'].includes(source.processingStatus); return <article key={source.id} className="business-data-source"><div><strong>{source.name}</strong><span>{source.domain ?? source.url ?? 'URL unavailable'} · Public crawl · {source.syncPolicy} refresh · {source.pageCount} saved pages · {source.freshness}</span><small>Public crawl does not require source DNS verification. Customer widget use still requires a verified assistant domain matching this website. Last successful crawl: {dateLabel(source.lastSuccessfulSyncAt)} · Last attempt: {dateLabel(source.lastAttemptAt)}{source.errorCode ? ` · ${source.errorCode}` : ''}</small>{source.latestRun && <small>Latest crawl {statusLabel(source.latestRun.status)} · discovered {source.latestRun.discoveredPages} · crawled {source.latestRun.changedPages + source.latestRun.unchangedPages} · saved {source.pageCount} · failed {source.latestRun.failedPages} · skipped {source.latestRun.skippedPages}</small>}{linked.length > 0 ? <small>Linked assistants: {linked.map((assistant) => assistant.name).join(', ')} · Domain matched: {domainEligible.map((assistant) => assistant.name).join(', ') || 'None'}{!domainEligible.length ? ' · Check assistant activation and verified domain matching.' : ''}</small> : <small>This source is not assigned to an assistant yet. Add it to an active Knowledge Base linked to your assistant before customer chat can use it.</small>}{details && <small role="status">Training status: {statusLabel(details.crawlJobStatus ?? details.processingStatus)}{details.crawlStage ? ` · ${statusLabel(details.crawlStage)}` : ''}{details.processingErrorCode || details.lastSyncErrorCode ? ` · ${details.processingErrorCode ?? details.lastSyncErrorCode}` : ''}{!details.workerEnabled ? ' · Background worker is disabled; jobs will wait until it is enabled.' : ''}</small>}</div><div className="business-data-actions">{manager && <button className="button button-primary" disabled={Boolean(busy) || active || source.syncPaused} onClick={() => void refreshWebsite(source.id)}>{busy === source.id ? 'Queueing…' : active ? 'Training…' : source.syncPaused ? 'Paused' : 'Refresh website'}</button>}{manager && source.syncPolicy !== 'MANUAL' && <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void setManualWebsiteMode(source.id)}>{busy === source.id ? 'Updating…' : 'Use manual refresh'}</button>}{manager && <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void inspectWebsiteStatus(source.id)}>{busy === `status:${source.id}` ? 'Checking…' : 'Check training status'}</button>}</div></article>; })}</div> : <div className="knowledge-empty"><h3>No website sources stored</h3><p>Add a public website to automatically queue its first bounded crawl. Later refreshes remain manual. Shopify is not required.</p>{manager && <button className="button button-primary" onClick={() => setAddWebsiteOpen(true)}><ExternalLink size={14}/> Add Website</button>}</div>}
      {website?.pages.length ? <div className="business-data-pages">{website.pages.map((page) => { const linked = page.linkedAssistants ?? page.assignedAssistants; const domainEligible = page.domainEligibleAssistants ?? page.assignedAssistants; return <article key={page.id} className="business-data-page"><div className="business-data-page-heading"><div><strong>{page.title}</strong><a href={page.canonicalUrl} target="_blank" rel="noreferrer">{page.canonicalUrl}<ExternalLink size={12}/></a></div><span className={`business-data-state ${page.searchReady ? 'is-ready' : ''}`}>{page.searchReady ? 'AI READY' : statusLabel(page.availability)}</span></div><p>{page.preview || 'No extracted page text.'}</p><div className="business-data-metadata"><span>{page.category ?? 'Unclassified'}</span><span>Crawl: {statusLabel(page.crawlStatus)}</span><span>{page.indexedChunkCount} indexed chunks</span><span>Freshness: {page.freshness}</span><span>Crawled {dateLabel(page.crawledAt)}</span><span>Indexed {dateLabel(page.indexedAt)}</span><span>v{page.sourceVersion} · generation {page.generation}</span><span>Hash {page.contentHash.slice(0, 12)}</span></div>{page.errorCode && <small className="business-data-error">{page.errorCode}</small>}<div className="business-data-page-footer"><small>Linked assistants: {linked.map((assistant) => assistant.name).join(', ') || 'None'}. Domain matched: {domainEligible.map((assistant) => assistant.name).join(', ') || 'None'}{linked.length > 0 && !domainEligible.length ? ' · Check that an assistant is active and its verified domain matches this website.' : ''}</small><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void inspectPage(page.id)}>{busy === `page:${page.id}` ? 'Opening…' : 'Inspect stored page'}</button></div></article>; })}</div> : website && <div className="knowledge-empty"><h3>No verified saved pages match</h3><p>Pages are displayed after their website source is verified. Search by page title or URL.</p></div>}
      {website && website.pageCount > 1 && <div className="kb-pagination"><span>Page {website.page} of {website.pageCount} · {website.total} stored pages</span><div><button className="button button-secondary" disabled={websitePage <= 1} onClick={() => setWebsitePage((n) => n - 1)}><ChevronLeft size={14}/> Previous</button><button className="button button-secondary" disabled={websitePage >= website.pageCount} onClick={() => setWebsitePage((n) => n + 1)}>Next <ChevronRight size={14}/></button></div></div>}
    </>}
    {tab === 'shopify' && <>{shopifyLoading ? <div className="kb-skeleton-list" role="status" aria-label="Loading Shopify data"><i/><i/></div> : connectors.length === 0 ? <div className="knowledge-empty"><h3>No Shopify connector</h3><p>Connect Shopify to inspect persisted records, verified grants and sync history.</p></div> : shopifyData.map(({ connector, permissions, assistantOptions, jobs }) => { const snapshot = permissions.shopifyScopeSnapshot; const counts = permissions.storedRecordCounts; const latest = permissions.latestSyncJob ?? jobs[0] ?? connector.latestSyncJob; const activeAndFresh = connector.state === 'CONNECTED' && snapshot?.freshness === 'FRESH'; const productAllowed = activeAndFresh && permissions.categories.some((category) => category.category === 'PRODUCTS' && category.syncEnabled && category.providerGranted); const contentAllowed = activeAndFresh && permissions.categories.some((category) => category.syncEnabled && category.providerGranted && ['WEBSITE_PAGES', 'FAQ_POLICIES', 'SHOPIFY_SHIPPING', 'SHOPIFY_LEGAL_POLICIES', 'SHOPIFY_ONLINE_STORE_PAGES', 'SHOPIFY_LOCATIONS', 'SHOPIFY_MARKETS', 'SHOPIFY_DISCOUNTS'].includes(category.category)); return <article className="business-data-shopify" key={connector.id}><div className="workspace-panel-heading"><div><h3>{connector.displayName}</h3><p>{snapshot?.shopDomain ?? 'Shop domain unavailable'} · Connection {connector.state} · Scope snapshot {snapshot?.freshness ?? 'UNAVAILABLE'}</p>{assistantOptions.length > 0 && <label className="workspace-field business-data-assistant">Assistant<select aria-label="Shopify readiness assistant" value={selectedAssistantId} onChange={(event) => setSelectedAssistantId(event.target.value)}>{assistantOptions.map((assistant) => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}</select></label>}</div>{manager && <div className="business-data-actions"><button className="button button-secondary" disabled={connector.state !== 'CONNECTED' || Boolean(busy)} onClick={() => void refreshShopifyGrantSnapshot(connector.id)}>{busy === `${connector.id}:grants` ? 'Checking…' : 'Refresh verified grants'}</button><button className="button button-secondary" disabled={!productAllowed || Boolean(busy)} onClick={() => void startShopifySync(connector.id, 'PRODUCTS')}>{busy === `${connector.id}:PRODUCTS` ? 'Queueing…' : 'Refresh products'}</button><button className="button button-secondary" disabled={!contentAllowed || Boolean(busy)} onClick={() => void startShopifySync(connector.id, 'CONTENT')}>{busy === `${connector.id}:CONTENT` ? 'Queueing…' : 'Refresh authorized content'}</button></div>}</div><div className="business-data-counts">{[['Products', counts?.products], ['Variants', counts?.variants], ['Products with prices', counts?.productsWithPrices], ['Products with inventory', counts?.productsWithInventory], ['Collections', counts?.collections], ['Orders', counts?.orders]].map(([label, value]) => <div key={String(label)}><strong>{typeof value === 'number' ? value.toLocaleString() : '—'}</strong><small>{label}</small></div>)}</div><h4>Implemented operation readiness</h4><div className="business-data-operations">{snapshot?.operations.map((operation) => <div key={`${operation.category}:${operation.operation}`}><span><strong>{operation.operation}</strong><small>{operation.category} · requires {operation.requiredScopes.join(', ')}</small></span><span>{operation.dataRecordCount === null ? 'Count unavailable' : `${operation.dataRecordCount.toLocaleString()} stored`} · {operation.eligible ? 'AI ready' : operation.blockedReason ?? operation.dataStatus}</span></div>)}</div><p className="business-data-freshness">Last successful sync: {dateLabel(snapshot?.lastSuccessfulSyncAt)} · Last attempt: {dateLabel(connector.lastSyncAt)} · Latest job: {latest ? `${latest.resourceType} ${statusLabel(latest.state)}${latest.lastErrorCode ? ` · ${latest.lastErrorCode}` : ''}` : 'No sync job recorded'}</p><div className="business-data-grants"><strong>Verified Shopify grants</strong><span>{snapshot?.scopes.filter((scope) => scope.granted).map((scope) => scope.handle).join(', ') || 'No fresh verified grants available'}</span></div><div className="business-data-jobs"><strong>Recent sync jobs</strong>{jobs.length ? jobs.map((job) => <div key={job.id}><span>{job.resourceType} {job.mode} · {statusLabel(job.state)} · {job.itemCount} records · {dateLabel(job.createdAt)}{job.lastErrorCode ? ` · ${job.lastErrorCode}` : ''}</span>{manager && job.state === 'FAILED' && <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void retryShopifySync(connector.id, job.id)}>{busy === job.id ? 'Retrying…' : 'Retry'}</button>}</div>) : <small>No sync jobs recorded.</small>}</div></article>; })}</>}
    {selectedPage && <div className="kb-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPage(null); }}><section className="workspace-panel kb-modal business-page-detail" role="dialog" aria-modal="true" aria-labelledby="stored-page-title"><div className="knowledge-form-heading"><div><h2 id="stored-page-title">{selectedPage.title}</h2><p>{selectedPage.canonicalUrl}</p></div><button className="button button-secondary" onClick={() => setSelectedPage(null)}>Close</button></div><div className="business-data-metadata"><span>{selectedPage.category ?? 'Unclassified'}</span><span>{selectedPage.indexedChunkCount} indexed chunks</span><span>Hash {selectedPage.contentHash}</span></div><pre>{selectedPage.content}</pre></section></div>}
  </section>;
}
