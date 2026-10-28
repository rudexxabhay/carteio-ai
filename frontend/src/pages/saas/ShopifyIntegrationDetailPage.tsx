import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, LoaderCircle, ShoppingBag } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { ApiError } from '../../services/api/client';
import { getConnectors, getConnectorPermissions, getConnectorSyncHistory, queueConnectorSync, type ConnectorInstance, type ConnectorPermissions, type SyncJob } from '../../services/api/connectors';
import { Badge, Btn, Card, Empty, Notice, PageHeader, SectionHeader, Stat } from '../../layouts/DashboardLayout/dashboard-v2-ui';

export function ShopifyIntegrationDetailPage() {
  const { slug = '', role } = useWorkspaceRoute().workspace;
  const { connectorId = '' } = useParams();
  const [connector, setConnector] = useState<ConnectorInstance | null>(null);
  const [permissions, setPermissions] = useState<ConnectorPermissions | null>(null);
  const [history, setHistory] = useState<SyncJob[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const canManage = role === 'owner' || role === 'admin';
  const refresh = useCallback(() => setRetryKey((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setHistoryError(''); setHistory([]); setHistoryCursor(null); setHistoryHasMore(false);
    getConnectors(slug, controller.signal).then(async (result) => {
      const current = result.items.find((item) => item.id === connectorId && item.connectorId === 'shopify_v1');
      if (!current) throw new Error('Shopify connector is not available in this workspace.');
      const [access, jobs] = await Promise.allSettled([
        getConnectorPermissions(slug, current.id),
        getConnectorSyncHistory(slug, current.id, controller.signal),
      ]);
      if (!controller.signal.aborted) {
        setConnector(current);
        setPermissions(access.status === 'fulfilled' ? access.value : null);
        if (jobs.status === 'fulfilled') { setHistory(jobs.value.items); setHistoryCursor(jobs.value.nextCursor); setHistoryHasMore(jobs.value.hasMore); setHistoryError(''); }
        else { setHistory([]); setHistoryCursor(null); setHistoryHasMore(false); setHistoryError(jobs.reason instanceof ApiError ? jobs.reason.message : 'Shopify sync history could not be loaded.'); }
      }
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : 'Shopify connection details could not be loaded.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, connectorId, retryKey]);

  async function queueSync(resourceType: 'PRODUCTS' | 'ORDERS' | 'CONTENT') {
    if (!connector || !canManage) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const job = await queueConnectorSync(slug, connector.id, resourceType, 'FULL');
      setNotice(`${resourceType.toLowerCase()} sync queued. Current state: ${job.state.toLowerCase()}.`);
      setHistory((current) => [job, ...current]);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The sync request could not be queued.'); }
    finally { setBusy(false); }
  }

  async function loadMoreHistory() {
    if (!connector || !historyHasMore || !historyCursor || busy) return;
    setBusy(true); setHistoryError('');
    try {
      const page = await getConnectorSyncHistory(slug, connector.id, undefined, historyCursor);
      setHistory((current) => [...current, ...page.items.filter((job) => !current.some((item) => item.id === job.id))]);
      setHistoryCursor(page.nextCursor); setHistoryHasMore(page.hasMore);
    } catch (cause) { setHistoryError(cause instanceof ApiError ? cause.message : 'More sync history could not be loaded.'); }
    finally { setBusy(false); }
  }

  const counts = permissions?.storedRecordCounts;
  const shopDomain = typeof connector?.configuration.shopDomain === 'string' ? connector.configuration.shopDomain : '';
  const storeUrl = shopDomain && /^[a-z0-9-]+\.myshopify\.com$/i.test(shopDomain) ? `https://${shopDomain}/admin` : '';
  const domain = shopDomain || connector?.displayName;
  return <main className="shopify-detail-page"><PageHeader eyebrow="Integrations / Shopify" title="Shopify Integration" desc="Store connection, product synchronization, policies and authorized commerce context." action={storeUrl ? <a className="btn btn-secondary" href={storeUrl} target="_blank" rel="noreferrer">Open Shopify <ExternalLink size={15}/></a> : <Link className="btn btn-secondary" to={`/workspace/${encodeURIComponent(slug)}/integrations`}>All integrations</Link>}/>
    {(loading || error) && <div className={`dashboard-gate-card ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{loading ? <><LoaderCircle size={18}/> Loading connector state…</> : <>{error}<button type="button" onClick={refresh}>Retry</button></>}</div>}
    {notice && <p role="status">{notice}</p>}
    {connector && <>
      <Card className="shopify-hero"><span className="integr-icon shop-icon">S</span><div><small>CONNECTED STORE</small><h2>{domain || connector.displayName}</h2><p>Connection state and permissions are read from the authorized integration API.</p></div><Badge tone={connector.state === 'CONNECTED' ? 'green' : 'amber'}>{connector.state.replaceAll('_', ' ').toLowerCase()}</Badge></Card>
      <div className="metrics-grid"><Stat label="Products synced" value={counts ? counts.products.toLocaleString() : 'Unavailable'} change="Authorized catalog count" positive={false}/><Stat label="Collections" value={counts ? counts.collections.toLocaleString() : 'Unavailable'} change="Synced records" positive={false}/><Stat label="Knowledge policies" value={counts?.contentByCategory ? Object.values(counts.contentByCategory).reduce((a, b) => a + b, 0).toLocaleString() : 'Unavailable'} change="Connector-reported records" positive={false}/><Stat label="Last successful sync" value={connector.lastSuccessfulSyncAt ? new Date(connector.lastSuccessfulSyncAt).toLocaleString() : 'Unavailable'} change={connector.lastErrorCode || 'No successful sync recorded'} positive={false}/></div>
      <div className="two-col major"><Card><SectionHeader title="Data sync & permissions" desc="Data access reflects provider scopes and workspace permissions"/>{['PRODUCTS','COLLECTIONS','STORE_POLICIES','ORDERS'].map((category) => { const row = permissions?.categories.find((permission) => permission.category === category); const supportText: Record<string, string> = { PRODUCTS: 'Authorized product titles, images, variants, prices and stock.', COLLECTIONS: 'Merchant-authorized product collection hierarchy.', STORE_POLICIES: 'Authorized shipping, refunds and support knowledge.', ORDERS: 'Order data is limited to verified Shopify scopes and workspace permissions.' }; return <div className="setting-line" key={category}><div><strong>{category === 'STORE_POLICIES' ? 'Store policies' : category.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</strong><p>{supportText[category]}</p></div><Badge tone={row?.effective ? 'green' : 'neutral'}>{row ? row.effective ? 'Enabled' : row.providerStatus === 'GRANTED' ? 'Restricted' : 'Unavailable' : 'Permission unavailable'}</Badge></div>; })}<Notice tone="amber">Order visibility and AI access depend on verified Shopify scopes plus workspace and assistant permissions.</Notice></Card>
        <Card><SectionHeader title="Sync health" desc="Current state and recent authorized connector jobs"/><Badge tone={connector.state === 'CONNECTED' ? 'green' : 'neutral'}>{connector.state.replaceAll('_', ' ')}</Badge><div className="action-line major"><Btn disabled={!canManage || busy} onClick={() => void queueSync('PRODUCTS')}><ShoppingBag size={15}/> Sync products</Btn><Btn secondary disabled={!canManage || busy} onClick={() => void queueSync('ORDERS')}>Sync orders</Btn><Btn secondary disabled={!canManage || busy} onClick={() => void queueSync('CONTENT')}>Sync policies</Btn></div><h3>Recent sync activity</h3>{historyError && <Notice tone="amber">{historyError}</Notice>}{history.length ? <div className="timeline">{history.map((job) => <div key={job.id}><span className="timeline-dot"/><strong>{job.resourceType.replaceAll('_', ' ')} sync {job.state.toLowerCase()}</strong><small>{new Date(job.createdAt).toLocaleString()} · {job.itemCount.toLocaleString()} records · {job.lastErrorCode || 'No error reported'}</small></div>)}</div> : !historyError && <Empty title="No sync jobs available" desc="This connector has not returned sync history."/>}{historyHasMore && <Btn secondary disabled={busy} onClick={() => void loadMoreHistory()}>{busy ? 'Loading…' : 'Load older sync history'}</Btn>}</Card></div>
    </>}
  </main>;
}

