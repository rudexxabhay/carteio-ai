import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { getOrders, type Order } from '../../services/api/saas';
import { Badge, Card, Empty, FilterInput, PageHeader, TableWrap } from '../../layouts/DashboardLayout/dashboard-v2-ui';

export function SourceOrdersPage() {
  const { slug = '' } = useParams();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [availability, setAvailability] = useState('NOT_CONNECTED');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    getOrders(slug, page, search, controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      setOrders(response.items); setTotal(response.total); setAvailability(response.availability);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Orders could not be loaded. Check your connection and retry.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, page, search, retry]);
  const root = `/workspace/${encodeURIComponent(slug)}`;
  return <>
    <PageHeader eyebrow="Commerce / Orders" title="Sales & orders" desc="Browse authorized Shopify orders and fulfillment activity." action={<Link className="btn btn-secondary" to={`${root}/sales`}>Sales overview <span aria-hidden="true">→</span></Link>}/>
    <Card className="connect-strip"><div><Badge tone={availability === 'AVAILABLE' ? 'green' : 'neutral'}>{availability.replaceAll('_', ' ').toLowerCase()}</Badge><span>Order and customer fields follow connected-store permissions.</span></div><Badge>{loading ? 'Loading orders…' : `${total.toLocaleString()} orders`}</Badge></Card>
    <div className="filter-line"><FilterInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search by order reference..."/></div>
    {loading && <div className="dashboard-page-loading" role="status" aria-live="polite"><span>Loading authorized orders…</span><i className="dashboard-page-loading-panel"/></div>}
    {!loading && error && <div className="dashboard-gate-card" role="alert"><strong>Orders could not be loaded</strong><p>{error}</p><button type="button" className="btn btn-primary" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {!loading && !error && <Card className="table-card"><TableWrap><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Fulfillment</th><th>Status</th><th/></tr></thead><tbody>{orders.map((order) => <tr className="selectable" key={order.id}>
      <td className="link-cell"><Link to={`${root}/orders/${encodeURIComponent(order.externalId)}`}>{order.displayReference || 'Order reference unavailable'}</Link><small className="source-order-date">{order.orderedAt ? new Date(order.orderedAt).toLocaleDateString() : 'Date unavailable'}</small></td>
      <td>Unavailable in authorized response</td><td>{order._count.lines}</td><td className="semi">{money(order.total, order.currency)}</td><td>{order.fulfillmentStatus || 'Unavailable'}</td><td>{order.financialStatus || 'Unavailable'}</td><td><ChevronRight size={16}/></td>
    </tr>)}</tbody></TableWrap>
      {!orders.length && <Empty title={availability === 'NOT_CONNECTED' ? 'Connect a store to see orders' : 'No orders found'} desc="Only order details returned by the authorized commerce service are displayed."/>}
      <div className="table-footer"><span>Showing {orders.length} of {total.toLocaleString()} authorized orders</span><div className="action-line"><button type="button" className="text-link" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page}</span><button type="button" className="text-link" disabled={page * 25 >= total} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </Card>}
  </>;
}

function money(value: string | number | null, currency: string | null) {
  if (value === null || !currency || !Number.isFinite(Number(value))) return 'Unavailable';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${currency} ${Number(value).toLocaleString()}`; }
}
