import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, ImageOff, Package } from 'lucide-react';
import { ApiError } from '../../services/api/client';
import { getProducts, type Product } from '../../services/api/saas';
import { useWorkspaceRoute } from '../../layouts/DashboardLayout/DashboardLayout';
import { Badge, Btn, Card, PageHeader, SectionHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';

/** Source Product Details composition, using the authorized product record for this route. */
export function SourceProductDetailPage() {
  const { slug = '' } = useWorkspaceRoute().workspace;
  const { externalId = '' } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [variantId, setVariantId] = useState('');
  const root = `/workspace/${encodeURIComponent(slug)}`;
  const load = useCallback((signal: AbortSignal) => getProducts(slug, 1, externalId, signal).then((page) => page.items.find((item) => item.externalId === externalId) ?? null), [slug, externalId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setProduct(null);
    load(controller.signal).then((item) => { if (!controller.signal.aborted) { setProduct(item); setVariantId(item?.variants?.[0]?.externalId ?? ''); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : 'Product details could not be loaded. Check your connection and retry.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, retry]);

  const selected = product?.variants?.find((item) => item.externalId === variantId);
  const shownPrice = selected?.price ?? product?.price;
  const shownCurrency = selected?.currency ?? product?.currency;
  return <>
    <PageHeader eyebrow="Commerce / Products / Detail" title={product?.name ?? 'Product details'} desc="Shopify product metadata, knowledge indexing and AI question testing." action={<Btn secondary onClick={() => navigate(`${root}/products`)}><ArrowLeft size={15}/> Back to products</Btn>}/>
    {loading && <div className="dashboard-page-loading" role="status" aria-live="polite"><span>Loading authorized product data…</span><i className="dashboard-page-loading-panel"/></div>}
    {!loading && error && <div className="dashboard-gate-card" role="alert"><strong>Product details could not be loaded</strong><p>{error}</p><button type="button" className="btn btn-primary" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {!loading && !error && !product && <Card className="empty"><Package size={22}/><strong>Product details are unavailable</strong><p>This product may not be synchronized or its identifier is no longer available in this workspace.</p><Link to={`${root}/products`}>Back to products</Link></Card>}
    {product && <>
      <div className="two-col product-detail-grid">
        <Card className="product-gallery"><div className="product-art featured-product">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} decoding="async"/> : <span><ImageOff size={28}/><small>Product image unavailable</small></span>}</div><div className="gallery-thumbs">{product.imageUrl ? <div className="product-art"><img src={product.imageUrl} alt={`${product.name} thumbnail`} loading="lazy"/></div> : <div className="product-art"><ImageOff size={18}/></div>}</div></Card>
        <Card className="product-describe"><Badge tone={product.connection.state === 'CONNECTED' ? 'green' : 'neutral'}>{product.connection.state.replaceAll('_', ' ')}</Badge><h2>{product.name}</h2><h2 className="price">{money(shownPrice, shownCurrency)}</h2><p>{product.description || 'Product description is not available from the authorized product record.'}</p><hr/>{[['Shopify product ID', product.externalId], ['SKU', selected?.sku || product.sku || 'Unavailable'], ['Collection', product.category || 'Unavailable'], ['Stock', selected?.inventory === null || product.inventory === null ? 'Not provided by authorized scope' : String(selected?.inventory ?? product.inventory)], ['Variants', product.variants?.length ? String(product.variants.length) : 'Unavailable']].map(([label, value]) => <div className="detail-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}
          {product.variants?.length ? <div className="field"><span>Preview selected variant</span><div className="filter-pills">{product.variants.map((item) => <button type="button" key={item.externalId} className={'filter-pill '+(item.externalId===variantId?'active':'')} onClick={() => setVariantId(item.externalId)}>{item.title}</button>)}</div></div> : <p>Variant records are not available for this product.</p>}
          {product.productUrl && <a href={product.productUrl} target="_blank" rel="noreferrer" className="text-link">Open product in Shopify <ExternalLink size={14}/></a>}
        </Card>
      </div>
      <div className="two-col major"><Card><SectionHeader title="What your AI knows" desc="Grounded product information from authorized data" action={<Badge tone="neutral">AI index status unavailable</Badge>}/><div className="detail-row bordered"><strong>Grounded description</strong><span>{product.description ? 'Product title, description and variant details' : 'No product description is available.'}</span></div><div className="detail-row bordered"><strong>Available fields</strong><span>Only merchant-authorized price, inventory and category fields are shown.</span></div><div className="detail-row bordered"><strong>Merchant policies</strong><span>Assistant policy sources are managed in Knowledge Base.</span></div></Card><Card><SectionHeader title="Ask about this product" desc="Test a grounded question using the real Playground API"/><p>No sample answer is shown here. Start a real Playground session to test the assistant.</p><Link className="btn btn-secondary" to={`${root}/training?tab=playground`}>Test in Playground <span aria-hidden="true">→</span></Link></Card></div>
    </>}
  </>;
}

function money(value: string | number | null | undefined, currency: string | null | undefined) {
  if (value === null || value === undefined || !currency || !Number.isFinite(Number(value))) return 'Unavailable';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)); }
  catch { return `${currency} ${Number(value).toLocaleString()}`; }
}
