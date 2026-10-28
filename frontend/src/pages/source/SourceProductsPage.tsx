import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, CircleCheck, Filter, Package, RefreshCw } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { getProducts, type Product } from '../../services/api/saas';
import { getConnectors, queueConnectorSync } from '../../services/api/connectors';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { Badge, Btn, Card, Empty, FilterInput, PageHeader, TableWrap } from '../../layouts/DashboardLayout/dashboard-v2-ui';

type ProductPage = { items: Product[]; total: number; page: number; pageSize: number; availability: string };

/** Source Product Catalog composition, populated only from the authenticated workspace APIs. */
export function SourceProductsPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { workspace } = useWorkspaceRoute();
  const canManage = workspace.role === 'owner' || workspace.role === 'admin';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('All products');
  const [result, setResult] = useState<ProductPage | null>(null);
  const [connector, setConnector] = useState<Awaited<ReturnType<typeof getConnectors>>['items'][number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectorLoading, setConnectorLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    getProducts(slug, page, search, controller.signal)
      .then((page) => { if (!controller.signal.aborted) setResult(page); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Products could not be loaded. Check your connection and retry.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, page, search, retry]);

  useEffect(() => {
    const controller = new AbortController();
    setConnectorLoading(true);
    getConnectors(slug, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setConnector(response.items.find((item) => item.connectorId.toLowerCase().includes('shopify')) ?? null);
      })
      .catch(() => { if (!controller.signal.aborted) setConnector(null); })
      .finally(() => { if (!controller.signal.aborted) setConnectorLoading(false); });
    return () => controller.abort();
  }, [slug, retry]);

  async function syncProducts() {
    if (!connector || !canManage || syncing) return;
    setSyncing(true);
    setNotice('');
    try {
      const job = await queueConnectorSync(slug, connector.id, 'PRODUCTS', 'FULL');
      setNotice(`Product sync queued · ${job.state.toLowerCase()}.`);
      setRetry((value) => value + 1);
    } catch (cause) {
      setNotice(cause instanceof ApiError ? cause.message : 'Product sync could not be queued. Check your connection and retry.');
    } finally { setSyncing(false); }
  }

  const products = result?.items ?? [];
  const filtered = filter === 'All products' ? products : [];
  const shopifyConnected = connector?.state === 'CONNECTED';

  return <>
    <PageHeader eyebrow="Commerce / Products" title="Product catalog" desc="View synced products, variants, inventory and knowledge availability." action={<Btn disabled={!connector || !canManage || syncing} onClick={() => void syncProducts()}><RefreshCw size={16}/>{syncing ? 'Syncing…' : 'Sync products'}</Btn>}/>
    <Card className="connect-strip">
      <div><Badge tone={shopifyConnected ? 'green' : 'neutral'}>{shopifyConnected && <CircleCheck size={14}/>} {connectorLoading ? 'Checking Shopify connection…' : shopifyConnected ? `${connector?.displayName} connected` : 'Shopify connection unavailable'}</Badge><span>{connector?.lastSuccessfulSyncAt ? `Last successful sync: ${new Date(connector.lastSuccessfulSyncAt).toLocaleString()}` : 'No successful sync recorded'}</span></div>
      <div className="action-line"><Badge>{result ? `${result.total.toLocaleString()} products` : loading ? 'Loading products…' : 'Product count unavailable'}</Badge><Btn secondary onClick={() => navigate(`/workspace/${encodeURIComponent(slug)}/${connector ? `integrations/shopify/${encodeURIComponent(connector.id)}` : 'integrations'}`)}>Manage sync</Btn></div>
    </Card>
    <div className="filter-line"><FilterInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search by product name or SKU..."/><span className="sr-only"><Filter size={15}/> Product filters</span><div className="filter-pills">{['All products','Indexed','Not indexed'].map((item) => <button key={item} type="button" className={'filter-pill '+(filter===item?'active':'')} disabled={item !== 'All products'} title={item === 'All products' ? undefined : 'AI indexing status is not exposed by the current product API.'} onClick={() => setFilter(item)}>{item}</button>)}</div></div>
    {notice && <p className="workspace-form-error" role="status">{notice}</p>}
    {loading && <div className="dashboard-page-loading" role="status" aria-live="polite"><span>Loading products…</span><i className="dashboard-page-loading-panel"/></div>}
    {!loading && error && <div className="dashboard-gate-card" role="alert"><strong>Products could not be loaded</strong><p>{error}</p><button type="button" className="btn btn-primary" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {!loading && !error && <Card className="table-card"><TableWrap><thead><tr><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th><th>AI index</th><th>Visibility</th><th/></tr></thead><tbody>{filtered.map((product) => <tr className="selectable" key={product.id} onClick={() => navigate(`/workspace/${encodeURIComponent(slug)}/products/${encodeURIComponent(product.externalId)}`)}>
      <td><div className="product-table-cell">{product.imageUrl ? <div className="product-art"><img src={product.imageUrl} alt="" loading="lazy"/></div> : <div className="product-art"><Package size={25}/></div>}<strong>{product.name}</strong></div></td>
      <td>{product.sku || product.variants?.[0]?.sku || '—'}</td><td className="semi">{formatMoney(product.price, product.currency)}</td><td>{product.inventory === null ? 'Not provided' : product.inventory.toLocaleString()}</td>
      <td><Badge tone="neutral">Unavailable</Badge></td><td><Badge tone="neutral">{product.availabilityStatus || product.rawStatus || 'Unavailable'}</Badge></td><td><ChevronRight size={16}/></td>
    </tr>)}</tbody></TableWrap>
      {filtered.length === 0 && <Empty title={result?.total && filter === 'All products' ? 'No matching products' : filter !== 'All products' ? 'AI index status unavailable' : result?.availability === 'NOT_CONNECTED' ? 'Connect a store to see products' : 'No products found'} desc={filter !== 'All products' ? 'The current product API does not expose AI indexing filters.' : 'Products appear here after an authorized store connection and catalog sync.'}/>}
      <div className="table-footer"><span>{filtered.length ? `Showing ${(page - 1) * (result?.pageSize ?? 25) + 1}–${Math.min(page * (result?.pageSize ?? 25), result?.total ?? 0)} of ${(result?.total ?? 0).toLocaleString()} live products` : 'No live products to show'}<small>AI indexing status is unavailable in the current product API.</small></span><div className="action-line"><button type="button" className="text-link" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page}</span><button type="button" className="text-link" disabled={page * (result?.pageSize ?? 25) >= (result?.total ?? 0)} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </Card>}
  </>;
}

function formatMoney(value: Product['price'], currency: Product['currency']) {
  if (value === null || !currency || !Number.isFinite(Number(value))) return '—';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${currency} ${Number(value).toLocaleString()}`; }
}
