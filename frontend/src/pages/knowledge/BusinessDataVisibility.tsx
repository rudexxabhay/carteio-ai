import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { getConnectorPermissions, getConnectors, getConnectorSyncHistory, queueConnectorSync, refreshShopifyPermissions, retryConnectorSync, type ConnectorInstance, type ConnectorPermissions, type SyncJob } from '../../services/api/connectors';

const failureMessage = (error: unknown) => error instanceof ApiError && error.kind === 'http' && error.status !== undefined && error.status < 500 ? error.message : 'The stored business data could not be loaded. Please try again.';
const dateLabel = (date?: string | null) => date ? new Date(date).toLocaleString() : 'Not recorded';
const statusLabel = (value: string) => value.toLowerCase().replaceAll('_', ' ');

export function BusinessDataVisibility({ slug, manager, compact = false }: { slug: string; manager: boolean; initialTab?: 'shopify'; compact?: boolean }) {
  const tab = 'shopify';
  const [connectors, setConnectors] = useState<ConnectorInstance[]>([]);
  const [shopifyData, setShopifyData] = useState<Array<{ connector: ConnectorInstance; permissions: ConnectorPermissions; assistantOptions: Array<{ id: string; name: string; status: string }>; jobs: SyncJob[] }>>([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState('');
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => { setSelectedAssistantId(''); }, [slug]);


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

    {error && <p role="alert" className="workspace-form-error">{error}</p>}
    {tab === 'shopify' && <>{shopifyLoading ? <div className="kb-skeleton-list" role="status" aria-label="Loading Shopify data"><i/><i/></div> : connectors.length === 0 ? <div className="knowledge-empty"><h3>No Shopify connector</h3><p>Connect Shopify to inspect persisted records, verified grants and sync history.</p></div> : shopifyData.map(({ connector, permissions, assistantOptions, jobs }) => { const snapshot = permissions.shopifyScopeSnapshot; const counts = permissions.storedRecordCounts; const latest = permissions.latestSyncJob ?? jobs[0] ?? connector.latestSyncJob; const activeAndFresh = connector.state === 'CONNECTED' && snapshot?.freshness === 'FRESH'; const productAllowed = activeAndFresh && permissions.categories.some((category) => category.category === 'PRODUCTS' && category.syncEnabled && category.providerGranted); const contentAllowed = activeAndFresh && permissions.categories.some((category) => category.syncEnabled && category.providerGranted && ['WEBSITE_PAGES', 'FAQ_POLICIES', 'SHOPIFY_SHIPPING', 'SHOPIFY_LEGAL_POLICIES', 'SHOPIFY_ONLINE_STORE_PAGES', 'SHOPIFY_LOCATIONS', 'SHOPIFY_MARKETS', 'SHOPIFY_DISCOUNTS'].includes(category.category)); return <article className="business-data-shopify" key={connector.id}><div className="workspace-panel-heading"><div><h3>{connector.displayName}</h3><p>{snapshot?.shopDomain ?? 'Shop domain unavailable'} · Connection {connector.state} · Scope snapshot {snapshot?.freshness ?? 'UNAVAILABLE'}</p>{assistantOptions.length > 0 && <label className="workspace-field business-data-assistant">Assistant<select aria-label="Shopify readiness assistant" value={selectedAssistantId} onChange={(event) => setSelectedAssistantId(event.target.value)}>{assistantOptions.map((assistant) => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}</select></label>}</div>{manager && <div className="business-data-actions"><button className="button button-secondary" disabled={connector.state !== 'CONNECTED' || Boolean(busy)} onClick={() => void refreshShopifyGrantSnapshot(connector.id)}>{busy === `${connector.id}:grants` ? 'Checking…' : 'Refresh verified grants'}</button><button className="button button-secondary" disabled={!productAllowed || Boolean(busy)} onClick={() => void startShopifySync(connector.id, 'PRODUCTS')}>{busy === `${connector.id}:PRODUCTS` ? 'Queueing…' : 'Refresh products'}</button><button className="button button-secondary" disabled={!contentAllowed || Boolean(busy)} onClick={() => void startShopifySync(connector.id, 'CONTENT')}>{busy === `${connector.id}:CONTENT` ? 'Queueing…' : 'Refresh authorized content'}</button></div>}</div><div className="business-data-counts">{[['Products', counts?.products], ['Variants', counts?.variants], ['Products with prices', counts?.productsWithPrices], ['Products with inventory', counts?.productsWithInventory], ['Collections', counts?.collections], ['Orders', counts?.orders]].map(([label, value]) => <div key={String(label)}><strong>{typeof value === 'number' ? value.toLocaleString() : '—'}</strong><small>{label}</small></div>)}</div><h4>Implemented operation readiness</h4><div className="business-data-operations">{snapshot?.operations.map((operation) => <div key={`${operation.category}:${operation.operation}`}><span><strong>{operation.operation}</strong><small>{operation.category} · requires {operation.requiredScopes.join(', ')}</small></span><span>{operation.dataRecordCount === null ? 'Count unavailable' : `${operation.dataRecordCount.toLocaleString()} stored`} · {operation.eligible ? 'AI ready' : operation.blockedReason ?? operation.dataStatus}</span></div>)}</div><p className="business-data-freshness">Last successful sync: {dateLabel(snapshot?.lastSuccessfulSyncAt)} · Last attempt: {dateLabel(connector.lastSyncAt)} · Latest job: {latest ? `${latest.resourceType} ${statusLabel(latest.state)}${latest.lastErrorCode ? ` · ${latest.lastErrorCode}` : ''}` : 'No sync job recorded'}</p><div className="business-data-grants"><strong>Verified Shopify grants</strong><span>{snapshot?.scopes.filter((scope) => scope.granted).map((scope) => scope.handle).join(', ') || 'No fresh verified grants available'}</span></div><div className="business-data-jobs"><strong>Recent sync jobs</strong>{jobs.length ? jobs.map((job) => <div key={job.id}><span>{job.resourceType} {job.mode} · {statusLabel(job.state)} · {job.itemCount} records · {dateLabel(job.createdAt)}{job.lastErrorCode ? ` · ${job.lastErrorCode}` : ''}</span>{manager && job.state === 'FAILED' && <button className="button button-secondary" disabled={Boolean(busy)} onClick={() => void retryShopifySync(connector.id, job.id)}>{busy === job.id ? 'Retrying…' : 'Retry'}</button>}</div>) : <small>No sync jobs recorded.</small>}</div></article>; })}</>}

  </section>;
}
