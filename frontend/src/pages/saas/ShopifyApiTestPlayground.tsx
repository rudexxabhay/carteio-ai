import { useState } from 'react';
import { ApiError } from '../../services/api/client';
import { runShopifyApiTest, type ConnectorInstance, type ConnectorPermissions, type ShopifyApiTestOperation, type ShopifyApiTestResult } from '../../services/api/connectors';
import { Badge, Btn, Card, SectionHeader } from '../../layouts/DashboardLayout/dashboard-v2-ui';

type Props = { slug: string; connector: ConnectorInstance; permissions: ConnectorPermissions | null; assistantId: string; canManage: boolean };
const operations: Array<{ value: ShopifyApiTestOperation; label: string }> = [
  { value: 'VERIFY_CONNECTION', label: 'Verify connection' }, { value: 'SEARCH_LIVE_PRODUCTS', label: 'Search live products' },
  { value: 'READ_PRODUCT_DETAILS', label: 'Read product details' }, { value: 'READ_VARIANTS', label: 'Read variants' },
  { value: 'READ_PRICES', label: 'Read prices' }, { value: 'READ_PRODUCT_IMAGES', label: 'Read product images' },
  { value: 'READ_INVENTORY', label: 'Read inventory (scope required)' },
  { value: 'LIST_COLLECTIONS', label: 'List / search collections' }, { value: 'READ_LOCATIONS', label: 'Read locations' },
  { value: 'READ_ONLINE_STORE_PAGES', label: 'Read online store pages' }, { value: 'READ_STORE_POLICIES', label: 'Read store policies' },
  { value: 'READ_MARKETS', label: 'Read markets' }, { value: 'READ_DISCOUNTS', label: 'Read discounts' },
  { value: 'READ_METAOBJECT_DEFINITIONS', label: 'Read metaobject definitions' },
  { value: 'SEARCH_SYNCED_CATALOG', label: 'Search synced catalog' }, { value: 'ASSISTANT_PRODUCT_READINESS', label: 'Test assistant product access' },
];
const needsQuery = (operation: ShopifyApiTestOperation) => ['SEARCH_LIVE_PRODUCTS', 'LIST_COLLECTIONS', 'SEARCH_SYNCED_CATALOG'].includes(operation);
const queryRequired = (operation: ShopifyApiTestOperation) => operation !== 'LIST_COLLECTIONS';
const needsProduct = (operation: ShopifyApiTestOperation) => ['READ_PRODUCT_DETAILS', 'READ_VARIANTS', 'READ_PRICES', 'READ_PRODUCT_IMAGES', 'READ_INVENTORY'].includes(operation);
const obj = (value: unknown): Record<string, any> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
function resultRows(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value.map(obj).filter((row): row is Record<string, any> => Boolean(row));
  const row = obj(value);
  return row ? [row] : [];
}

export function ShopifyApiTestPlayground({ slug, connector, permissions, assistantId, canManage }: Props) {
  const [operation, setOperation] = useState<ShopifyApiTestOperation>('VERIFY_CONNECTION');
  const [query, setQuery] = useState('');
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ShopifyApiTestResult | null>(null);
  const snapshot = permissions?.shopifyScopeSnapshot;
  const scopes = (snapshot?.scopes ?? []).filter(item => item.granted).map(item => item.handle);
  const domain = snapshot?.shopDomain ?? (typeof connector.configuration.shopDomain === 'string' ? connector.configuration.shopDomain : connector.displayName);
  async function run() {
    if (!canManage || busy || (needsQuery(operation) && queryRequired(operation) && !query.trim()) || (needsProduct(operation) && !productId.trim())) return;
    setBusy(true); setError(''); setResult(null);
    try { setResult(await runShopifyApiTest(slug, connector.id, { operation, ...(query.trim() ? { query: query.trim() } : {}), ...(productId.trim() ? { productId: productId.trim() } : {}), ...(assistantId ? { assistantId } : {}) })); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The Shopify test request failed.'); }
    finally { setBusy(false); }
  }
  const cards = resultRows(result?.data);
  return <Card className="shopify-api-playground">
    <SectionHeader title="API Test Playground" desc="Bounded read-only checks for the live Shopify API, synced catalog, and assistant access." action={<div className="shopify-api-header-actions"><span className="shopify-api-development-note" title="This temporary testing panel will be removed once the feature is stable.">Development only · temporary</span><Badge tone="neutral">Read only</Badge></div>}/>
    <div className="shopify-api-status-grid">
      <div><small>Store</small><strong>{domain || 'Unavailable'}</strong></div>
      <div><small>Connection</small><strong>{connector.state.replaceAll('_', ' ')}</strong></div>
      <div><small>Authorization</small><strong>{snapshot?.freshness ?? 'Not verified'}</strong></div>
      <div><small>Granted scopes</small><strong>{snapshot ? `${scopes.length} verified` : 'Unavailable'}</strong><small>{snapshot ? scopes.join(', ') || 'No granted scopes reported' : ''}</small></div>
      <div><small>Last successful sync</small><strong>{connector.lastSuccessfulSyncAt ? new Date(connector.lastSuccessfulSyncAt).toLocaleString() : 'Not recorded'}</strong></div>
      <div><small>API readiness</small><strong>{result?.source === 'LIVE_SHOPIFY_API' ? result.success ? 'Live read succeeded' : 'Live read failed' : 'Live API untested'}</strong></div>
    </div>
    <div className="shopify-api-test-controls">
      <label><span>Operation</span><select aria-label="Shopify test operation" value={operation} disabled={!canManage || busy} onChange={event => { setOperation(event.target.value as ShopifyApiTestOperation); setResult(null); setError(''); }}>
        {operations.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select></label>
      {needsQuery(operation) && <label><span>{operation === 'LIST_COLLECTIONS' ? 'Collection search (optional)' : 'Search query'}</span><input aria-label="Shopify test search query" value={query} maxLength={120} onChange={event => setQuery(event.target.value)} placeholder="Search products or collections"/></label>}
      {needsProduct(operation) && <label><span>Shopify product ID</span><input aria-label="Shopify product ID" value={productId} maxLength={80} onChange={event => setProductId(event.target.value)} placeholder="Product GID or numeric ID"/></label>}
      {(operation === 'ASSISTANT_PRODUCT_READINESS' || operation === 'SEARCH_SYNCED_CATALOG') && <span className="shopify-api-assistant">Assistant: {permissions?.assistants?.find(item => item.id === assistantId)?.name ?? 'Select an authorized assistant above'}</span>}
      <Btn disabled={!canManage || busy || (needsQuery(operation) && queryRequired(operation) && !query.trim()) || (needsProduct(operation) && !productId.trim()) || (['ASSISTANT_PRODUCT_READINESS', 'SEARCH_SYNCED_CATALOG'].includes(operation) && !assistantId)} onClick={() => void run()}>{busy ? 'Running test…' : 'Run test'}</Btn>
    </div>
    {error && <p className="shopify-api-test-error" role="alert">{error}</p>}
    {result && <div className="shopify-api-test-result" aria-live="polite">
      <div className="shopify-api-result-summary"><strong>{operations.find(item => item.value === result.operation)?.label}</strong><Badge tone={result.success === false || result.eligible === false ? 'amber' : 'green'}>{result.success === false || result.eligible === false ? 'Blocked / failed' : 'Completed'}</Badge></div>
      <p>{result.source.replaceAll('_', ' ')} · HTTP {result.httpStatus ?? 'not dispatched'} · GraphQL errors {result.graphqlErrorCount ?? 'not applicable'}{result.graphqlErrorCodes?.length ? ` (${result.graphqlErrorCodes.join(', ')})` : ''} · Permission {result.permissionStatus ?? (result.eligible === false ? 'DENIED' : 'checked')} · {result.durationMs} ms · {result.resultCount} result(s)</p>
      {(result.reason || result.error?.code) && <p className="shopify-api-test-error">Reason: <code>{result.reason ?? result.error?.code}</code></p>}
      {cards.length > 0 && <div className="shopify-api-result-cards">{cards.slice(0, 10).map((item, index) => {
        const image = obj(item.featuredImage)?.url;
        const price = obj(obj(item.priceRangeV2)?.minVariantPrice);
        const imageUrl = typeof image === 'string' && /^https:\/\/cdn\.shopify\.com\//i.test(image) ? image : '';
        const title = String(item.title ?? item.name ?? item.handle ?? item.id ?? `Result ${index + 1}`);
        return <article key={String(item.id ?? index)}>{imageUrl && <img src={imageUrl} alt={String(obj(item.featuredImage)?.altText ?? title)} loading="lazy" referrerPolicy="no-referrer"/>}<div><strong>{title}</strong>{item.handle && <small>{item.handle}</small>}{price && <small>{price.amount} {price.currencyCode}</small>}{Array.isArray(item.variants?.nodes) && <small>{item.variants.nodes.length} variants · {item.variants.nodes.filter((variant: any) => variant.availableForSale).length} available</small>}</div></article>;
      })}</div>}
      <details><summary>Sanitized response JSON</summary><pre>{JSON.stringify(result.data ?? result.readiness ?? result, null, 2)}</pre></details>
    </div>}
    {!canManage && <p className="shopify-api-test-error">Workspace owner or admin access is required to run Shopify API tests.</p>}
  </Card>;
}
