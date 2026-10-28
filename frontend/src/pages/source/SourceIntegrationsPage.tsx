import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, RefreshCw, Store } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { getConnectorCatalog, getConnectors, type ConnectorDefinition, type ConnectorInstance } from '../../services/api/connectors';
import { Badge, Btn, Card, Empty, FilterInput, PageHeader, SectionHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';

export function SourceIntegrationsPage() {
  const { slug = '' } = useParams(); const navigate = useNavigate();
  const [catalog, setCatalog] = useState<ConnectorDefinition[]>([]); const [connected, setConnected] = useState<ConnectorInstance[]>([]);
  const [search, setSearch] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError('');
    Promise.all([getConnectorCatalog(slug, controller.signal), getConnectors(slug, controller.signal)]).then(([definitions, instances]) => { if (!controller.signal.aborted) { setCatalog(definitions.items); setConnected(instances.items); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Integration data could not be loaded.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort();
  }, [slug, retry]);
  const items = catalog.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()) || item.type.toLowerCase().includes(search.toLowerCase()));
  const shopify = connected.find((item) => item.connectorId.toLowerCase().includes('shopify'));
  return <>
    <PageHeader eyebrow="Channels / Integrations" title="Integrations" desc="Connect your products, data, AI providers and customer-facing channels." action={<Btn secondary onClick={() => setRetry((v) => v + 1)}><RefreshCw size={15}/> Refresh</Btn>}/>
    <div className="filter-line"><FilterInput value={search} onChange={setSearch} placeholder="Search integrations..."/><div className="filter-pills"><Badge>{connected.length} connected records</Badge><Badge tone="neutral">From connector catalog</Badge></div></div>
    {loading && <div className="dashboard-page-loading" role="status">Loading available integrations…</div>}{error && <div className="dashboard-gate-card" role="alert">{error}<button className="btn btn-primary" onClick={() => setRetry((v) => v + 1)}>Retry</button></div>}
    {!loading && !error && <>
      <Card className="featured-integration"><span className="integr-icon shop-icon"><Store size={30}/></span><div className="featured-body"><Badge>COMMERCE</Badge><h2>Shopify Commerce</h2><p>Sync authorized product details, collections, store policies and order workflows.</p><small>{shopify?.displayName || 'Shopify connection status is not connected'}</small></div><div className="featured-cta"><Badge tone={shopify?.state === 'CONNECTED' ? 'green' : 'neutral'}>{shopify?.state || 'Not connected'}</Badge>{shopify && <Btn onClick={() => navigate(`/workspace/${encodeURIComponent(slug)}/integrations/shopify/${encodeURIComponent(shopify.id)}`)}>Manage Shopify <ArrowRight size={15}/></Btn>}</div></Card>
      <SectionHeader title="Discover integrations" desc="Availability and capabilities reported by the authorized connector catalog"/><div className="integration-grid">{items.map((item) => { const instance = connected.find((value) => value.connectorId === item.id); return <Card className="integration-card" key={item.id}><div className="integration-top"><span className="integr-icon"><Store size={20}/></span><Badge tone={instance?.state === 'CONNECTED' ? 'green' : item.availability === 'AVAILABLE' ? 'blue' : 'neutral'}>{instance?.state || item.availability.replaceAll('_', ' ').toLowerCase()}</Badge></div><h3>{item.name}</h3><p>{item.description}</p><span className="integration-link">{item.capabilities.join(' · ') || 'No capabilities reported'}</span>{instance && <button className="text-link" onClick={() => navigate(`/workspace/${encodeURIComponent(slug)}/integrations/shopify/${encodeURIComponent(instance.id)}`)}>Manage connection <ArrowRight size={14}/></button>}</Card>; })}</div>{items.length === 0 && <Empty title="No matching integrations"/>}
    </>}
  </>;
}
