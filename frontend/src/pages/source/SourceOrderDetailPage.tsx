import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Package } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { getOrders, type Order } from '../../services/api/saas';
import { Badge, Card, Empty, PageHeader, SectionHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';

export function SourceOrderDetailPage() {
  const { slug = '' } = useWorkspaceRoute().workspace;
  const { externalId = '' } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const root = `/workspace/${encodeURIComponent(slug)}`;
  const load = useCallback((signal: AbortSignal) => getOrders(slug, 1, externalId, signal).then((page) => page.items.find((item) => item.externalId === externalId) ?? null), [slug, externalId]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setOrder(null);
    load(controller.signal).then((value) => { if (!controller.signal.aborted) setOrder(value); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Order details could not be loaded. Check your connection and retry.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, retry]);

  return <>
    <PageHeader eyebrow="Commerce / Orders / Details" title={order?.displayReference ? `Order ${order.displayReference}` : 'Order details'} desc="Authorized order context and fulfillment fields from the connected store." action={<Link className="btn btn-secondary" to={`${root}/orders`}><ArrowLeft size={15}/> Back to orders</Link>}/>
    {loading && <div className="dashboard-page-loading" role="status" aria-live="polite"><span>Loading authorized order data…</span><i className="dashboard-page-loading-panel"/></div>}
    {!loading && error && <div className="dashboard-gate-card" role="alert"><strong>Order details could not be loaded</strong><p>{error}</p><button className="btn btn-primary" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {!loading && !error && !order && <Card className="empty"><Package size={22}/><strong>Order details are unavailable</strong><p>The order may not be synchronized or the workspace may lack the required permission.</p><Link to={`${root}/orders`}>Back to orders</Link></Card>}
    {order && <>
      <div className="top-chip"><Badge tone="neutral">Payment: {order.financialStatus || 'Unavailable'}</Badge><Badge tone="neutral">Fulfillment: {order.fulfillmentStatus || 'Unavailable'}</Badge></div>
      <div className="two-col major">
        <Card><SectionHeader title="Order summary" desc="Fields returned by the authorized order service"/>{[['Order number', order.displayReference || 'Unavailable'], ['Placed on', order.orderedAt ? new Date(order.orderedAt).toLocaleString() : 'Unavailable'], ['Order total', money(order.total, order.currency)], ['Subtotal', money(order.subtotal, order.currency)], ['Discounts', money(order.discountTotal, order.currency)], ['Shipping', money(order.shippingTotal, order.currency)], ['Tax', money(order.taxTotal, order.currency)], ['Refunded', money(order.refundedTotal, order.currency)], ['Fulfillment', order.fulfillmentStatus || 'Unavailable']].map(([label, value]) => <div className="detail-row bordered" key={label}><span>{label}</span><strong>{value}</strong></div>)}</Card>
        <Card><SectionHeader title="Customer context" desc="Personal details follow merchant permission scopes"/><Empty title="Customer details unavailable" desc="The current authorized order response does not expose customer identity or payment credentials."/><Badge tone="neutral">AI assistant access remains permission scoped</Badge><p>Tracking is shown only if included in the authorized order record.</p></Card>
      </div>
      <Card className="major"><SectionHeader title="Line items" desc="Order items returned by the connected store"/>{order.lines?.length ? order.lines.map((line) => <div className="detail-row bordered" key={line.externalId}><span><Package size={17}/> {line.name}<small>{line.sku || 'SKU unavailable'} · Quantity {line.quantity}</small></span><strong>{money(line.total, line.currency || order.currency)}</strong></div>) : <Empty title="Line items unavailable" desc="The current order response did not include line-item records."/>}</Card>
    </>}
  </>;
}

function money(value: string | number | null | undefined, currency: string | null | undefined) {
  if (value === null || value === undefined || !currency || !Number.isFinite(Number(value))) return 'Unavailable';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${currency} ${Number(value).toLocaleString()}`; }
}
