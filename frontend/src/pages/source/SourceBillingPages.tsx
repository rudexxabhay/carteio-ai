import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CreditCard, FileText, WalletCards } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { getBillingUsage, type BillingUsage } from '../../services/api/saas';
import { Badge, Card, Empty, PageHeader, SectionHeader, Stat } from '../../layouts/DashboardLayout/dashboard-v2-ui';

function useBillingUsage() {
  const { slug = '' } = useParams();
  const [value, setValue] = useState<BillingUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    getBillingUsage(slug, controller.signal).then((result) => { if (!controller.signal.aborted) setValue(result); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Billing information could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [slug, retry]);
  return { slug, value, loading, error, retry: () => setRetry((current) => current + 1) };
}

export function SourceBillingPage() {
  const { slug, value, loading, error, retry } = useBillingUsage();
  const plan = value?.subscription.plan;
  return <>
    <PageHeader eyebrow="Insights / Billing" title="Billing & Plans" desc="Review the current subscription status and provider-reported workspace usage." action={<Link className="btn btn-secondary" to={`/workspace/${encodeURIComponent(slug)}/invoices`}>Billing history <span aria-hidden="true">→</span></Link>}/>
    {loading && <div className="dashboard-page-loading" role="status" aria-live="polite"><span>Loading subscription and usage…</span><div className="dashboard-page-loading-metrics">{[0,1,2,3].map((item) => <i key={item}/>)}</div></div>}
    {!loading && error && <div className="dashboard-gate-card" role="alert"><strong>Billing information could not be loaded</strong><p>{error}</p><button type="button" className="btn btn-primary" onClick={retry}>Retry</button></div>}
    {!loading && !error && value && <>
      <div className="two-col major billing-columns">
        <Card className="current-plan"><Badge tone={value.subscription.state === 'ACTIVE' ? 'green' : 'neutral'}>Current subscription · {value.subscription.state.replaceAll('_',' ').toLowerCase()}</Badge><h2>{plan?.displayName || 'Plan unavailable'}</h2><p>{value.billingProvider === 'NOT_CONFIGURED' ? 'No payment gateway is configured for this workspace.' : 'Subscription status is supplied by the configured billing provider.'}</p><div className="price-display">{plan?.priceMinor != null && plan.currency ? formatPrice(plan.priceMinor, plan.currency) : 'Price unavailable'} <small>{plan?.interval ? `/ ${plan.interval.toLowerCase()}` : ''}</small></div><div className="check-line"><CreditCard size={16}/> Billing provider: {value.billingProvider}</div><div className="check-line"><FileText size={16}/> Current period ends {value.subscription.currentPeriodEnd ? new Date(value.subscription.currentPeriodEnd).toLocaleDateString() : 'unavailable'}</div><Badge tone="neutral">Plan changes unavailable from current API</Badge></Card>
        <Card><SectionHeader title="Subscription usage" desc="Usage values returned by this workspace service"/><div className="detail-row"><span>Assistant messages</span><strong>{value.usage.assistantMessages.toLocaleString()}</strong></div><div className="detail-row"><span>Playground conversations</span><strong>{value.usage.playgroundConversations.toLocaleString()}</strong></div><div className="detail-row"><span>Token-reported responses</span><strong>{value.usage.tokenReportedResponses.toLocaleString()}</strong></div><div className="detail-row"><span>Input tokens</span><strong>{value.usage.inputTokens === null ? 'Unavailable' : value.usage.inputTokens.toLocaleString()}</strong></div><div className="detail-row"><span>Output tokens</span><strong>{value.usage.outputTokens === null ? 'Unavailable' : value.usage.outputTokens.toLocaleString()}</strong></div><p>{value.note}</p></Card>
      </div>
      <SectionHeader title="Plans" desc="Plan catalog and mutation operations are not exposed by the current billing API."/>
      <div className="plan-grid"><Card className="plan-card"><Badge tone="neutral">Unavailable</Badge><h3>Plan options</h3><Empty title="Plan catalog unavailable" desc="No other plan names or prices are shown because the current service returns only the active subscription."/></Card><Card className="plan-card"><Badge tone="neutral">Unavailable</Badge><h3>Manage subscription</h3><Empty title="Plan changes unavailable" desc="Subscription mutation is not available through the current frontend API."/></Card></div>
      <p className="page-footer">Usage period starts {new Date(value.periodStart).toLocaleDateString()}.</p>
    </>}
  </>;
}

export function SourceInvoicesPage() {
  const { slug, value, loading, error, retry } = useBillingUsage();
  return <>
    <PageHeader eyebrow="Billing / History" title="Billing History" desc="Review invoice and payment history provided by the billing service." action={<Link className="btn btn-secondary" to={`/workspace/${encodeURIComponent(slug)}/billing`}>Back to billing</Link>}/>
    {loading && <div className="dashboard-page-loading" role="status" aria-live="polite"><span>Checking billing history…</span><i className="dashboard-page-loading-panel"/></div>}
    {!loading && error && <div className="dashboard-gate-card" role="alert"><strong>Billing history could not be loaded</strong><p>{error}</p><button className="btn btn-primary" type="button" onClick={retry}>Retry</button></div>}
    {!loading && !error && value && <>
      <div className="metrics-grid"><Stat label="Current plan" value={value.subscription.plan?.displayName || 'Unavailable'} change={value.subscription.state.replaceAll('_',' ').toLowerCase()} positive={false} icon={CreditCard}/><Stat label="Payment history" value="Unavailable" change="No payment history endpoint is exposed" positive={false} icon={WalletCards}/><Stat label="Invoices" value="Unavailable" change="No invoice endpoint is exposed" positive={false} icon={FileText}/><Stat label="Next billing" value={value.subscription.currentPeriodEnd ? new Date(value.subscription.currentPeriodEnd).toLocaleDateString() : 'Unavailable'} change="Provider-reported period end" positive={false} icon={CreditCard}/></div>
      <Card className="major"><SectionHeader title="Invoice history" desc="Invoice and payment records are not returned by the current billing API."/><Empty title="Invoice history unavailable" desc="No invoice rows or payment history are fabricated."/></Card>
    </>}
  </>;
}

export function SourceAnalyticsPage() {
  const { slug = '' } = useParams();
  return <>
    <PageHeader eyebrow="Insights / Analytics" title="Analytics" desc="Understand assistant engagement, support performance and commerce trends." action={<Link className="btn btn-secondary" to={`/workspace/${encodeURIComponent(slug)}/sales`}>View sales data <span aria-hidden="true">→</span></Link>}/>
    <div className="metrics-grid"><Stat label="Total conversations" value="Unavailable" change="Historical analytics are not exposed" positive={false}/><Stat label="AI resolution rate" value="Unavailable" change="No verified resolution metric" positive={false}/><Stat label="Average response" value="Unavailable" change="No response-time aggregate" positive={false}/><Stat label="Human handoffs" value="Unavailable" change="No analytics aggregate available" positive={false}/></div>
    <div className="two-col major"><Card className="chart-panel"><SectionHeader title="Conversation volume" desc="No historical time-series endpoint is available."/><Empty title="Trend unavailable" desc="The dashboard does not generate or estimate historical values."/></Card><Card><SectionHeader title="Resolution breakdown" desc="AI resolution and human escalation rates are not reported by the available services."/><Empty title="Resolution metrics unavailable" desc="No split between AI resolved, handoff or unresolved sessions is available."/></Card></div>
    <Card className="major"><SectionHeader title="Top questions" desc="Topic frequency analytics are not available."/><Empty title="Question analytics unavailable" desc="No ranked topic or percentage breakdown is returned by the current API."/></Card>
  </>;
}

function formatPrice(priceMinor: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(priceMinor / 100); }
  catch { return `${currency} ${(priceMinor / 100).toFixed(2)}`; }
}
