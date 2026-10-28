import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChartColumnIncreasing, ShoppingCart, WalletCards } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { getOrders, getSales, type Order, type SalesSummary } from '../../services/api/saas';
import { Badge, Card, Empty, PageHeader, SectionHeader, Stat, TableWrap } from '../../layouts/DashboardLayout/dashboard-v2-ui';

/** Source Sales & Orders composition; only API supplied aggregates and orders are displayed. */
export function SourceSalesPage() {
  const { slug = '' } = useParams();
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersError, setOrdersError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    Promise.allSettled([getSales(slug, controller.signal), getOrders(slug, 1, '', controller.signal)])
      .then(([summaryResult, ordersResult]) => {
        if (controller.signal.aborted) return;
        if (summaryResult.status === 'fulfilled') setSales(summaryResult.value);
        else setError(summaryResult.reason instanceof ApiError ? summaryResult.reason.message : 'Sales data could not be loaded. Check your connection and retry.');
        if (ordersResult.status === 'fulfilled') { setOrders(ordersResult.value.items); setOrdersError(''); }
        else setOrdersError(ordersResult.reason instanceof ApiError ? ordersResult.reason.message : 'Recent orders could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, retry]);

  const primary = sales?.currencyTotals[0];
  const average = useMemo(() => primary && primary.orderCount > 0 && primary.netSales !== null ? Number(primary.netSales) / primary.orderCount : null, [primary]);
  const currency = primary?.currency ?? null;
  const root = `/workspace/${encodeURIComponent(slug)}`;
  const unavailable = !loading && !error && (!sales || sales.availability !== 'AVAILABLE');
  return <>
    <PageHeader eyebrow="Commerce / Sales" title="Sales & orders" desc="Monitor Shopify sales, fulfillment activity and authorized order data." action={<Link className="btn btn-secondary" to={`${root}/orders`}>View all orders <span aria-hidden="true">→</span></Link>}/>
    {sales?.availability === 'PERMISSION_REQUIRED' && <div className="top-chip"><Badge tone="amber">Order permission required to show sales totals.</Badge></div>}
    {loading && <div className="dashboard-page-loading" role="status" aria-live="polite"><span>Loading authorized sales…</span><div className="dashboard-page-loading-metrics">{[0,1,2,3].map((i) => <i key={i}/>)}</div><i className="dashboard-page-loading-panel"/></div>}
    {!loading && error && <div className="dashboard-gate-card" role="alert"><strong>Sales data could not be loaded</strong><p>{error}</p><button type="button" className="btn btn-primary" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {!loading && !error && <>
      <div className="metrics-grid">
        <Stat label={primary ? `Net sales · ${primary.currency || 'currency unavailable'}` : 'Net sales'} value={primary ? money(primary.netSales, currency) : 'Unavailable'} change={primary ? 'Authorized paid-order aggregate' : 'No sales aggregate returned'} icon={WalletCards}/>
        <Stat label={primary ? `Orders · ${primary.currency || 'currency unavailable'}` : 'Orders'} value={primary ? String(primary.orderCount) : 'Unavailable'} change="Paid order count from current API" icon={ShoppingCart}/>
        <Stat label={primary ? `Average order · ${primary.currency || 'currency unavailable'}` : 'Average order'} value={average === null ? 'Unavailable' : money(average, currency)} change="Calculated from that currency’s net sales and paid orders" icon={ChartColumnIncreasing}/>
        <Stat label="Conversion" value="Unavailable" change="Conversion attribution is not provided by the current API" positive={false} icon={ChartColumnIncreasing}/>
      </div>
      {unavailable && <div className="top-chip"><Badge tone="neutral">{sales?.availability === 'NOT_CONNECTED' ? 'No store connected' : sales?.availability === 'NO_DATA' ? 'No synchronized paid orders' : 'Sales summary unavailable'}</Badge>{(sales?.currencyTotals.length ?? 0) > 1 && <Badge tone="neutral">Currencies are reported separately</Badge>}</div>}
      <div className="two-col major">
        <Card className="chart-panel"><SectionHeader title="Revenue trend" desc="Historical time-series data is not available from the current sales API."/><Empty title="Trend unavailable" desc="Only verified aggregate sales totals and authorized order records are shown."/></Card>
        <Card><SectionHeader title="Order breakdown" desc="Verified aggregate totals are listed separately by currency."/>{sales?.currencyTotals.length ? <div className="order-breakdown">{sales.currencyTotals.map((row, index) => <div key={`${row.currency ?? 'unknown'}-${index}`}><span>{row.currency || 'Currency unavailable'}</span><Badge tone="neutral">{row.orderCount} paid orders</Badge><strong>{money(row.netSales, row.currency)}</strong></div>)}</div> : <Empty title="Breakdown unavailable" desc="Order-status counts are not returned by the current API."/>}</Card>
      </div>
      <Card className="major"><SectionHeader title="Recent Shopify orders" desc="Order-level data when merchant permissions allow" action={<Link className="text-link" to={`${root}/orders`}>View all orders →</Link>}/>
        {ordersError ? <div role="alert">{ordersError} <button type="button" className="text-link" onClick={() => setRetry((value) => value + 1)}>Retry</button></div> : orders.length ? <TableWrap><thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Fulfillment</th><th>Status</th><th/></tr></thead><tbody>{orders.slice(0, 5).map((order) => <tr key={order.id}><td className="link-cell"><Link to={`${root}/orders/${encodeURIComponent(order.externalId)}`}>{order.displayReference || 'Order reference unavailable'}</Link></td><td>{order.orderedAt ? new Date(order.orderedAt).toLocaleDateString() : 'Unavailable'}</td><td>{order._count.lines}</td><td className="semi">{money(order.total, order.currency)}</td><td>{order.fulfillmentStatus || 'Unavailable'}</td><td>{order.financialStatus || 'Unavailable'}</td><td>→</td></tr>)}</tbody></TableWrap> : <Empty title="No authorized orders" desc="Recent order records appear after the connected store synchronizes permitted data."/>}
      </Card>
    </>}
  </>;
}

function money(value: string | number | null, currency: string | null) {
  if (value === null || !currency || !Number.isFinite(Number(value))) return 'Unavailable';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${currency} ${Number(value).toLocaleString()}`; }
}
