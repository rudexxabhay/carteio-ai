import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { ConnectorCredentialVault } from './connector-credential-vault';
import type { ConnectorAdapter, ConnectorDefinition, ConnectorOperationContext, ConnectorSyncPage, ConnectorWebhookInput, ConnectorVerification, NormalizedCommerceRecord } from './connector.contracts';
import { SafeOutboundHttpService } from './safe-outbound-http.service';
import { connectorSyncDebug } from './connector-sync-debug';
import { ShopifyGrantedScopeDiscoveryService, SHOPIFY_CONTENT_SCOPE_REQUIREMENTS, type ShopifyContentCategory } from './shopify-granted-scope-discovery.service';

const text = (value: unknown, max = 500) => typeof value === 'string' ? value.slice(0, max) : null;
export function shopifyWebhookSyncTarget(topic: string): { resourceType: 'PRODUCTS' | 'ORDERS' | 'CONTENT'; mode: 'FULL' | 'INCREMENTAL' } | null {
  if (/^orders\/(?:cancelled|create|delete|edited|fulfilled|paid|partially_fulfilled|updated)$/.test(topic)) return { resourceType: 'ORDERS', mode: 'INCREMENTAL' };
  if (/^inventory_levels\/(?:connect|disconnect|update)$/.test(topic) || /^inventory_items\/(?:create|update|delete)$/.test(topic)) return { resourceType: 'PRODUCTS', mode: 'FULL' };
  if (/^products\/(?:create|delete|update)$/.test(topic)) return { resourceType: 'PRODUCTS', mode: 'INCREMENTAL' };
  if (/^collections\/(?:create|update|delete)$/.test(topic)) return { resourceType: 'PRODUCTS', mode: 'FULL' };
  if (/^(?:locations\/(?:activate|create|deactivate|delete|update)|profiles\/(?:create|delete|update)|delivery_promise_settings\/update|shop\/update|markets\/(?:create|delete|update)|markets_backup_region\/update|discounts\/(?:create|delete|update|redeemcode_added|redeemcode_removed)|metaobjects\/(?:create|delete|update)|metafield_definitions\/(?:create|delete|update))$/.test(topic)) return { resourceType: 'CONTENT', mode: 'INCREMENTAL' };
  return null;
}
const amount = (value: unknown) => typeof value === 'string' && /^\d{1,12}(\.\d{1,4})?$/.test(value) ? value : null;
/** Product-level display price is the lowest valid variant price, paired with that variant's compare-at price. */
export function lowestShopifyVariantPrice(variants: readonly unknown[]): { price: string | null; compareAtPrice: string | null } {
  let lowest: { price: string; compareAtPrice: string | null } | null = null;
  const isLower = (candidate: string, current: string) => {
    const [candidateWhole = '0', candidateFraction = ''] = candidate.split('.');
    const [currentWhole = '0', currentFraction = ''] = current.split('.');
    const normalizedCandidate = candidateWhole.replace(/^0+(?=\d)/, ''), normalizedCurrent = currentWhole.replace(/^0+(?=\d)/, '');
    if (normalizedCandidate.length !== normalizedCurrent.length) return normalizedCandidate.length < normalizedCurrent.length;
    if (normalizedCandidate !== normalizedCurrent) return normalizedCandidate < normalizedCurrent;
    return candidateFraction.padEnd(4, '0') < currentFraction.padEnd(4, '0');
  };
  for (const candidate of variants) {
    if (!candidate || typeof candidate !== 'object') continue;
    const variant = candidate as { price?: unknown; compareAtPrice?: unknown };
    const price = amount(variant.price);
    if (price === null) continue;
    if (!lowest || isLower(price, lowest.price)) lowest = { price, compareAtPrice: amount(variant.compareAtPrice) };
  }
  return lowest ?? { price: null, compareAtPrice: null };
}
const int = (value: unknown) => value !== null && value !== undefined && value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const graphqlJson = (value: Buffer) => { try { return JSON.parse(value.toString('utf8')) as any; } catch { throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID'); } };
const assertConnection = (value: any) => {
  if (!value || !Array.isArray(value.nodes) || !value.pageInfo || typeof value.pageInfo.hasNextPage !== 'boolean' || (value.pageInfo.hasNextPage && typeof value.pageInfo.endCursor !== 'string')) throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
  return value;
};
const assertEdgeConnection = (value: any) => {
  if (!value || !Array.isArray(value.edges) || !value.pageInfo || typeof value.pageInfo.hasNextPage !== 'boolean' || (value.pageInfo.hasNextPage && typeof value.pageInfo.endCursor !== 'string')) throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
  return value;
};
const safeCause = (error: unknown) => {
  const value = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown; constructor?: { name?: string } } : null;
  const rawCode = typeof value?.code === 'string' ? value.code : value?.message === 'CONNECTOR_REQUEST_TIMEOUT' ? value.message : undefined;
  const code = typeof rawCode === 'string' && /^[A-Z0-9_-]{1,40}$/i.test(rawCode) ? rawCode : undefined;
  const kind = code === 'ETIMEDOUT' || code === 'CONNECTOR_REQUEST_TIMEOUT' ? 'TIMEOUT' : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'DNS' : code?.startsWith('ECONN') ? 'NETWORK' : code ? 'PROVIDER_OR_TRANSPORT' : 'APPLICATION';
  return { causeKind: kind, ...(code ? { causeCode: code } : {}), causeType: typeof value?.constructor?.name === 'string' ? value.constructor.name.slice(0, 40) : 'UnknownError' };
};
const graphqlErrorCodes = (body: any): string[] => {
  if (!Array.isArray(body?.errors)) return [];
  const codes: string[] = body.errors
    .map((entry: any) => entry?.extensions?.code)
    .filter((code: unknown): code is string => typeof code === 'string' && /^[A-Z0-9_]{1,60}$/.test(code));
  return [...new Set<string>(codes)].slice(0, 8);
};
const SAFE_METAOBJECT_FIELD_TYPES = new Set(['single_line_text_field', 'multi_line_text_field', 'rich_text_field', 'boolean', 'number_integer', 'number_decimal', 'date', 'date_time', 'url', 'color']);
const SENSITIVE_METAOBJECT_FIELD = /(?:customer|client|buyer|email|phone|address|postal|zip|payment|token|secret|password|birth|government|tax.?id|ip.?address|order.?id)/i;
const safeMetaobjectType = (value: unknown) => typeof value === 'string' && value.length <= 120 && /^(?:[a-zA-Z0-9_-]{1,100}|\$app:[a-zA-Z0-9_-]{1,100})$/.test(value);
export function isPublicSafeMetaobjectDefinition(definition: any): boolean {
  if (!definition || !safeMetaobjectType(definition.type) || definition.access?.storefront !== 'PUBLIC_READ' || !Array.isArray(definition.fieldDefinitions) || definition.fieldDefinitions.length < 1 || definition.fieldDefinitions.length > 30) return false;
  return definition.fieldDefinitions.every((field: any) => typeof field?.key === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(field.key) && !SENSITIVE_METAOBJECT_FIELD.test(field.key) && SAFE_METAOBJECT_FIELD_TYPES.has(field.type?.name));
}

@Injectable()
export class ShopifyConnectorAdapter implements ConnectorAdapter {
  readonly definition: ConnectorDefinition = {
    id: 'shopify_v1', type: 'SHOPIFY', version: '1.0.0', name: 'Shopify', description: 'Shopify Admin GraphQL catalog and authorized order synchronization.', authStrategy: 'OAUTH2',
    configurationSchema: { type: 'object', additionalProperties: false, required: ['shopDomain'], properties: { shopDomain: { type: 'string', minLength: 15, maxLength: 253, pattern: '^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.myshopify\\.com$' } } },
    credentialSchema: { type: 'object', additionalProperties: false, required: ['accessToken'], properties: { accessToken: { type: 'string', minLength: 16, maxLength: 4096 }, refreshToken: { type: 'string', minLength: 16, maxLength: 4096 }, accessTokenExpiresAt: { type: 'string', maxLength: 40 }, refreshTokenExpiresAt: { type: 'string', maxLength: 40 } } },
    capabilities: ['CONNECTOR_HEALTH_CHECK', 'PRODUCT_CATALOG', 'PRODUCT_PRICES', 'INVENTORY', 'ORDERS', 'FULFILLMENT', 'SHOPIFY_LOCATIONS', 'SHOPIFY_SHIPPING', 'SHOPIFY_LEGAL_POLICIES', 'SHOPIFY_ONLINE_STORE_PAGES', 'SHOPIFY_MARKETS', 'SHOPIFY_DISCOUNTS', 'SHOPIFY_METAOBJECT_DEFINITIONS'], syncResources: ['PRODUCTS', 'ORDERS', 'CONTENT'], webhooks: { supported: true, signatureScheme: 'SHOPIFY_HMAC_SHA256', replayWindowSeconds: null },
  };
  private readonly db: any;
  private readonly logger = new Logger(ShopifyConnectorAdapter.name);
  constructor(private readonly http: SafeOutboundHttpService, prisma: PrismaService, private readonly vault: ConnectorCredentialVault, private readonly scopeDiscovery: ShopifyGrantedScopeDiscoveryService) { this.db = prisma; }
  async connect(_c: ConnectorOperationContext, _config: Record<string, unknown>, credentials: Record<string, unknown>) { if (typeof credentials.accessToken !== 'string') throw new Error('CONNECTOR_CREDENTIALS_REQUIRED'); }
  async verify(context: ConnectorOperationContext, config: Record<string, unknown>, credentials: Record<string, unknown>): Promise<ConnectorVerification> {
    // Scope discovery and capability probes share the adapter's normal token
    // refresh lifecycle before making Admin API requests.
    const shopDomain = String(config.shopDomain);
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.myshopify\.com$/.test(shopDomain)) throw new Error('CONNECTOR_CONFIG_INVALID');
    const requestId = context.requestId ?? `shopify-verify-${randomUUID()}`;
    const credentialStartedAt = Date.now();
    let activeCredentials: Record<string, unknown>;
    try {
      activeCredentials = await this.validCredentials(context, shopDomain, credentials, requestId);
      this.logVerification({ requestId, operation: 'shopify.credential_validation', stage: 'credential_validation', targetHost: shopDomain, elapsedMs: Date.now() - credentialStartedAt, outcome: 'success' });
    } catch (error) {
      this.logVerification({ requestId, operation: 'shopify.credential_validation', stage: 'credential_validation', targetHost: shopDomain, elapsedMs: Date.now() - credentialStartedAt, outcome: 'failure', safeErrorCode: error instanceof Error && /^CONNECTOR_[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : undefined, ...safeCause(error) });
      throw error;
    }
    const scopeMetadata = await this.scopeDiscovery.discover({ ...context, requestId, shopDomain, accessToken: String(activeCredentials.accessToken ?? '') });
    const scopes = scopeMetadata.scopes.map((scope) => scope.handle);
    if (!scopes.includes('read_products')) {
      this.logVerification({ requestId, operation: 'shopify.required_scope_check', stage: 'required_scope_check', targetHost: shopDomain, elapsedMs: 0, outcome: 'failure', causeKind: 'REQUIRED_SCOPE_MISSING', requiredScope: 'read_products' });
      throw new Error('CONNECTOR_SHOPIFY_SCOPE_MISSING');
    }
    const productProbe = await this.query(context, config, activeCredentials, '{ products(first:1){nodes{id}} }', undefined, false, { requestId, stage: 'product_capability_probe' });
    if (!Array.isArray(productProbe.products?.nodes)) throw new Error('CONNECTOR_SHOPIFY_PRODUCTS_UNAVAILABLE');
    const caps: ConnectorVerification['capabilities'] = ['CONNECTOR_HEALTH_CHECK', 'PRODUCT_CATALOG', 'PRODUCT_PRICES'];
    if (scopes.includes('read_inventory')) {
      try { const inventoryProbe = await this.query(context, config, activeCredentials, '{ products(first:1){nodes{variants(first:1){nodes{inventoryQuantity inventoryItem{tracked}}}}} }', undefined, false, { requestId, stage: 'inventory_capability_probe' }); if (Array.isArray(inventoryProbe.products?.nodes)) caps.push('INVENTORY'); } catch { /* Optional permission stays unadvertised if the provider denies the real inventory query. */ }
    }
    if (scopes.includes('read_orders')) {
      try { const orderProbe = await this.query(context, config, activeCredentials, '{ orders(first:1){nodes{id}} }', undefined, false, { requestId, stage: 'orders_capability_probe' }); if (Array.isArray(orderProbe.orders?.nodes)) caps.push('ORDERS', 'FULFILLMENT'); } catch { /* Protected order access is advertised only after a successful real query. */ }
    }
    const optionalProbes: Array<{ scope: string; capability: ConnectorVerification['capabilities'][number]; query: string }> = [
      { scope: 'read_locations', capability: 'SHOPIFY_LOCATIONS', query: '{ locations(first:1){nodes{id}} }' },
      { scope: 'read_shipping', capability: 'SHOPIFY_SHIPPING', query: '{ deliveryProfiles(first:1){nodes{id}} }' },
      { scope: 'read_legal_policies', capability: 'SHOPIFY_LEGAL_POLICIES', query: '{ shop{shopPolicies{id}} }' },
      { scope: 'read_online_store_pages', capability: 'SHOPIFY_ONLINE_STORE_PAGES', query: '{ pages(first:1){nodes{id}} }' },
      { scope: 'read_content', capability: 'SHOPIFY_ONLINE_STORE_PAGES', query: '{ pages(first:1){nodes{id}} }' },
      { scope: 'read_markets', capability: 'SHOPIFY_MARKETS', query: '{ markets(first:1){nodes{id}} }' },
      { scope: 'read_discounts', capability: 'SHOPIFY_DISCOUNTS', query: '{ discountNodes(first:1){nodes{id}} }' },
      { scope: 'read_metaobject_definitions', capability: 'SHOPIFY_METAOBJECT_DEFINITIONS', query: '{ metaobjectDefinitions(first:1){nodes{id}} }' },
    ];
    for (const probe of optionalProbes) {
      if (!scopes.includes(probe.scope)) continue;
      try {
        const data = await this.query(context, config, activeCredentials, probe.query, undefined, false, { requestId, stage: `shopify_${probe.capability.toLowerCase()}_capability_probe` });
        const root = Object.values(data)[0] as any;
        if (root && (Array.isArray(root.nodes) || Array.isArray(root) || Array.isArray(root.shopPolicies))) {
          if (!caps.includes(probe.capability)) caps.push(probe.capability);
          if (!caps.includes('WEBSITE_CONTENT')) caps.push('WEBSITE_CONTENT');
        }
      } catch { /* A declared/granted scope alone does not establish a working capability. */ }
    }
    if (scopes.includes('read_metaobject_definitions') && scopes.includes('read_metaobjects')) {
      try {
        const definitions = await this.discoverPublicSafeMetaobjectDefinitions(context, config, activeCredentials);
        for (const definition of definitions.slice(0, 5)) {
          try {
            const data = await this.query(context, config, activeCredentials, 'query($type:String!){metaobjects(type:$type,first:1){nodes{id} pageInfo{hasNextPage endCursor}}}', { type: definition.type }, false, { requestId, stage: 'metaobject_entry_capability_probe' });
            if (Array.isArray(data.metaobjects?.nodes)) { caps.push('SHOPIFY_METAOBJECTS'); break; }
          } catch { /* inaccessible definitions do not establish a usable operation */ }
        }
      } catch { /* Definition access alone does not prove entry access. */ }
    }
    return { verified: true, externalAccountId: scopeMetadata.shopId, storefrontUrl: scopeMetadata.storefrontUrl, grantedScopes: scopes, grantedScopeMetadata: scopeMetadata.scopes.map(({ handle, description }) => ({ handle, description })), capabilities: [...new Set(caps)] };
  }
  async disconnect() {}
  async sync(_context: ConnectorOperationContext, input: { resourceType: string; mode: 'FULL'|'INCREMENTAL'; cursor?: string|null; checkpoint?: unknown; includePrices?: boolean; includeInventory?: boolean; enabledCategories?: string[]; grantedScopes?: string[] }, config: Record<string, unknown>, credentials: Record<string, unknown>): Promise<ConnectorSyncPage> {
    const after = input.cursor || null;
    if (input.resourceType === 'PRODUCTS') {
      const processingStartedAt = Date.now();
      const selectedPrice = input.includePrices === false ? '' : 'price';
      const selectedInventory = input.includeInventory === true ? 'inventoryQuantity inventoryItem{tracked}' : '';
      const data = await this.query(_context, config, credentials, `query($after:String,$filter:String){ shop{currencyCode} products(first:10,after:$after,query:$filter,sortKey:UPDATED_AT){ pageInfo{hasNextPage endCursor} nodes{id title descriptionHtml handle productType vendor status createdAt updatedAt category{id name} featuredImage{url altText width height} images(first:100){nodes{id url altText width height} pageInfo{hasNextPage endCursor}} onlineStoreUrl collections(first:50){nodes{id title handle ruleSet{rules{column}}} pageInfo{hasNextPage endCursor}} variants(first:100){nodes{id title sku ${selectedPrice} ${input.includePrices === false ? '' : 'compareAtPrice'} ${selectedInventory} selectedOptions{name value}} pageInfo{hasNextPage endCursor}}}}}`, { after, filter: input.mode === 'INCREMENTAL' ? `updated_at:>='${String((input.checkpoint as any)?.updatedAt ?? (input.checkpoint as any)?.highWatermark ?? (input.checkpoint as any)?.since ?? new Date(Date.now()-86400000).toISOString())}'` : null }, true);
      const connection = assertConnection(data.products);
      await this.expandProductImagePages(_context, config, credentials, connection?.nodes ?? []);
      await this.expandNestedPages(_context, config, credentials, connection?.nodes ?? [], 'variants', 9, true, input.includePrices !== false, input.includeInventory === true);
      await this.expandCollectionPages(_context, config, credentials, connection?.nodes ?? []);
      const records: NormalizedCommerceRecord[] = (connection?.nodes ?? []).map((p: any) => {
        const variants = p.variants?.nodes ?? [];
        const productPrice = input.includePrices === false ? { price: null, compareAtPrice: null } : lowestShopifyVariantPrice(variants);
        return { kind:'PRODUCT', externalId:String(p.id), name:text(p.title,500) ?? 'Untitled', description:text(p.descriptionHtml,20000), category:text(p.category?.name,500), taxonomyCategoryId:text(p.category?.id,255), taxonomyCategory:text(p.category?.name,500), productType:text(p.productType,200), vendor:text(p.vendor,200), handle:text(p.handle,255), collections:(p.collections?.nodes ?? []).filter((c:any)=>typeof c.id==='string'&&typeof c.title==='string').map((c:any)=>({externalId:c.id,title:text(c.title,200)!,handle:text(c.handle,255),membershipType:c.ruleSet?'AUTOMATED':'MANUAL'})), currency:text(data.shop?.currencyCode,3), price:productPrice.price, compareAtPrice:productPrice.compareAtPrice, inventory:variants.some((v:any)=>v.inventoryItem?.tracked)&&variants.filter((v:any)=>v.inventoryItem?.tracked).every((v:any)=>int(v.inventoryQuantity)!==null)?variants.filter((v:any)=>v.inventoryItem?.tracked).reduce((n:number,v:any)=>n+int(v.inventoryQuantity)!,0):null, availability:variants.some((v:any)=>int(v.inventoryQuantity)!==null&&int(v.inventoryQuantity)!==0)?'IN_STOCK':variants.length&&variants.every((v:any)=>int(v.inventoryQuantity)===0)?'OUT_OF_STOCK':null, status:text(p.status,80), productUrl:text(p.onlineStoreUrl,2048), imageUrl:text(p.featuredImage?.url,2048), imageAltText:text(p.featuredImage?.altText,500), imageWidth:int(p.featuredImage?.width), imageHeight:int(p.featuredImage?.height), imageEvidence:(p.images?.nodes ?? []).map((image:any)=>({externalId:String(image.id),url:text(image.url,2048),altText:text(image.altText,500),width:int(image.width),height:int(image.height)})).filter((image:any)=>image.url), imagesComplete:p.images?.pageInfo?.hasNextPage === false, createdAt:text(p.createdAt,40), updatedAt:text(p.updatedAt,40), variants:variants.map((v:any)=>({externalId:String(v.id),title:text(v.title,500)??'Variant',sku:text(v.sku,160),selectedOptions:Array.isArray(v.selectedOptions)?v.selectedOptions.map((o:any)=>({name:text(o.name,100)??'',value:text(o.value,200)??''})):[],currency:text(data.shop?.currencyCode,3),price:amount(v.price),compareAtPrice:amount(v.compareAtPrice),inventory:int(v.inventoryQuantity),availability:int(v.inventoryQuantity)===null?null:int(v.inventoryQuantity)!>0?'IN_STOCK':'OUT_OF_STOCK',status:text(p.status,80)})), variantsComplete:p.variants?.pageInfo?.hasNextPage === false };
      });
      connectorSyncDebug(this.logger, '16_product_variant_inventory_processing', `worker:${_context.connectorInstanceId}`, processingStartedAt, { operation: 'connector.shopify_normalize_products', organizationId: _context.organizationId, connectorInstanceId: _context.connectorInstanceId, productCount: records.length, variantCount: records.reduce((count, record) => count + (record.kind === 'PRODUCT' ? record.variants.length : 0), 0), complete: !connection?.pageInfo?.hasNextPage });
      return { itemCount: records.length, records, cursor: connection?.pageInfo?.endCursor ?? null, checkpoint: { since: (input.checkpoint as any)?.since ?? (input.mode === 'INCREMENTAL' ? (input.checkpoint as any)?.updatedAt ?? new Date(Date.now()-86400000).toISOString() : null), highWatermark: records.map(r => r.kind === 'PRODUCT' ? r.updatedAt : null).filter(Boolean).sort().at(-1) ?? (input.checkpoint as any)?.highWatermark ?? null, updatedAt: !connection?.pageInfo?.hasNextPage ? (records.map(r => r.kind === 'PRODUCT' ? r.updatedAt : null).filter(Boolean).sort().at(-1) ?? (input.checkpoint as any)?.highWatermark ?? (input.checkpoint as any)?.updatedAt ?? new Date().toISOString()) : (input.checkpoint as any)?.updatedAt ?? null }, complete: !connection?.pageInfo?.hasNextPage };
    }
    if (input.resourceType === 'ORDERS') {
      const data = await this.query(_context, config, credentials, `query($after:String,$filter:String){ orders(first:10,after:$after,query:$filter,sortKey:UPDATED_AT){pageInfo{hasNextPage endCursor} nodes{id name displayFinancialStatus displayFulfillmentStatus currencyCode subtotalPriceSet{shopMoney{amount currencyCode}} totalDiscountsSet{shopMoney{amount}} totalShippingPriceSet{shopMoney{amount}} totalTaxSet{shopMoney{amount}} totalPriceSet{shopMoney{amount}} cancelledAt createdAt updatedAt lineItems(first:50){nodes{id name sku quantity originalUnitPriceSet{shopMoney{amount}} discountedTotalSet{shopMoney{amount}} variant{id}} pageInfo{hasNextPage endCursor}}}}}`, { after, filter: input.mode === 'INCREMENTAL' ? `updated_at:>='${String((input.checkpoint as any)?.updatedAt ?? (input.checkpoint as any)?.highWatermark ?? (input.checkpoint as any)?.since ?? new Date(Date.now()-86400000).toISOString())}'` : null });
      const connection = assertConnection(data.orders); await this.expandNestedPages(_context, config, credentials, connection?.nodes ?? [], 'lineItems', 19); const records: NormalizedCommerceRecord[] = (connection?.nodes ?? []).map((o:any) => ({ kind:'ORDER', externalId:String(o.id), displayReference:text(o.name,160), financialStatus:text(o.displayFinancialStatus,80), fulfillmentStatus:text(o.displayFulfillmentStatus,80), currency:text(o.currencyCode,3), subtotal:amount(o.subtotalPriceSet?.shopMoney?.amount), discountTotal:amount(o.totalDiscountsSet?.shopMoney?.amount), shippingTotal:amount(o.totalShippingPriceSet?.shopMoney?.amount), taxTotal:amount(o.totalTaxSet?.shopMoney?.amount), total:amount(o.totalPriceSet?.shopMoney?.amount), orderedAt:text(o.createdAt,40), updatedAt:text(o.updatedAt,40), linesComplete:!o.lineItems?.pageInfo?.hasNextPage, status:o.cancelledAt?'CANCELLED':'ACTIVE', lines:(o.lineItems?.nodes ?? []).map((l:any)=>({externalId:String(l.id),productExternalId:text(l.variant?.id,255),name:text(l.name,500)??'Item',sku:text(l.sku,160),quantity:int(l.quantity)??0,currency:text(o.currencyCode,3),unitPrice:amount(l.originalUnitPriceSet?.shopMoney?.amount),total:amount(l.discountedTotalSet?.shopMoney?.amount)})) }));
      return { itemCount:records.length,records,cursor:connection?.pageInfo?.endCursor??null,checkpoint:{since:(input.checkpoint as any)?.since??(input.mode==='INCREMENTAL'?(input.checkpoint as any)?.updatedAt??new Date(Date.now()-86400000).toISOString():null),highWatermark:connection?.nodes?.map((o:any)=>o.updatedAt).filter(Boolean).sort().at(-1)??(input.checkpoint as any)?.highWatermark??null,updatedAt:!connection?.pageInfo?.hasNextPage?(connection?.nodes?.map((o:any)=>o.updatedAt).filter(Boolean).sort().at(-1)??(input.checkpoint as any)?.highWatermark??(input.checkpoint as any)?.updatedAt??new Date().toISOString()):(input.checkpoint as any)?.updatedAt??null},complete:!connection?.pageInfo?.hasNextPage };
    }
    if (input.resourceType === 'CONTENT') {
      const isContentCategory = (category: string | undefined): category is ShopifyContentCategory => category !== undefined && Object.prototype.hasOwnProperty.call(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS, category);
      const contentCategories = [...new Set((input.enabledCategories ?? []).filter((category): category is ShopifyContentCategory => isContentCategory(category)))];
      if (!contentCategories.length) throw new Error('CONNECTOR_DATA_PERMISSION_DISABLED');
      let currentCategory = contentCategories[0], after: string | null = null;
      if (input.cursor) {
        const match = /^content:([A-Z_]+):(.*)$/.exec(input.cursor);
        const cursorCategory = match?.[1];
        if (!isContentCategory(cursorCategory) || !contentCategories.includes(cursorCategory)) throw new Error('CONNECTOR_CURSOR_INVALID');
        currentCategory = cursorCategory;
        after = match?.[2] || null;
      }
      const selectedCategory = currentCategory;
      if (!selectedCategory) throw new Error('CONNECTOR_DATA_PERMISSION_DISABLED');
      const requirement = SHOPIFY_CONTENT_SCOPE_REQUIREMENTS[selectedCategory];
      if (requirement.anyScopes ? !requirement.requiredScopes.some((scope) => input.grantedScopes?.includes(scope)) : !requirement.requiredScopes.every((scope) => input.grantedScopes?.includes(scope))) throw new Error('CONNECTOR_SCOPE_NOT_GRANTED');
      if (selectedCategory === 'SHOPIFY_METAOBJECTS') return this.syncMetaobjectEntries(_context, config, credentials, contentCategories, contentCategories.indexOf(selectedCategory), after ?? '', input.checkpoint);
      let nodes: unknown[] = [], hasNextPage = false, endCursor: string | null = null;
      const readConnection = (value: unknown) => {
        const connection = assertConnection(value);
        const pageInfo = connection.pageInfo as Record<string, unknown>;
        return {
          nodes: connection.nodes,
          hasNextPage: pageInfo.hasNextPage === true,
          endCursor: typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null,
        };
      };
      if (selectedCategory === 'SHOPIFY_LOCATIONS') {
        const data = await this.query(_context, config, credentials, 'query($after:String){locations(first:50,after:$after){nodes{id name isActive fulfillsOnlineOrders address{formatted}} pageInfo{hasNextPage endCursor}}}', { after });
        ({ nodes, hasNextPage, endCursor } = readConnection(data.locations));
      } else if (selectedCategory === 'SHOPIFY_SHIPPING') {
        const data = await this.query(_context, config, credentials, 'query($after:String){deliveryProfiles(first:50,after:$after){nodes{id profileLocationGroups{locationGroup{id locations(first:250){nodes{id name isActive fulfillsOnlineOrders address{formatted}} pageInfo{hasNextPage endCursor}}} locationGroupZones(first:250){edges{node{zone{name countries{code{countryCode restOfWorld}}} methodDefinitions(first:250){edges{node{id description active methodConditions{field operator conditionCriteria{__typename ... on MoneyV2{amount currencyCode} ... on Weight{unit value}}}}} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}} pageInfo{hasNextPage endCursor}}}', { after });
        ({ nodes, hasNextPage, endCursor } = readConnection(data.deliveryProfiles));
        for (const profile of nodes as any[]) for (const group of profile.profileLocationGroups ?? []) {
          assertConnection(group.locationGroup?.locations);
          assertEdgeConnection(group.locationGroupZones);
          for (const edge of group.locationGroupZones.edges) assertEdgeConnection(edge?.node?.methodDefinitions);
        }
        const nestedIncomplete = (nodes as any[]).some((profile) => (profile.profileLocationGroups ?? []).some((group: any) => group.locationGroup?.locations?.pageInfo?.hasNextPage === true || group.locationGroupZones?.pageInfo?.hasNextPage === true || (group.locationGroupZones?.edges ?? []).some((edge: any) => edge.node?.methodDefinitions?.pageInfo?.hasNextPage === true)));
        if (nestedIncomplete) throw new Error('CONNECTOR_NESTED_PAGINATION_INCOMPLETE');
      } else if (selectedCategory === 'SHOPIFY_LEGAL_POLICIES') {
        const data = await this.query(_context, config, credentials, '{shop{shopPolicies{id title body type url updatedAt}}}', undefined, false, undefined, 4 * 1024 * 1024);
        nodes = Array.isArray(data.shop?.shopPolicies) ? data.shop.shopPolicies : [];
      } else if (selectedCategory === 'SHOPIFY_ONLINE_STORE_PAGES') {
        const data = await this.query(_context, config, credentials, 'query($after:String){pages(first:5,after:$after){nodes{id title handle bodySummary body isPublished updatedAt} pageInfo{hasNextPage endCursor}}}', { after }, false, undefined, 4 * 1024 * 1024);
        ({ nodes, hasNextPage, endCursor } = readConnection(data.pages));
      } else if (selectedCategory === 'SHOPIFY_MARKETS') {
        const data = await this.query(_context, config, credentials, 'query($after:String){markets(first:50,after:$after){nodes{id name handle status currencySettings{baseCurrency{currencyCode} localCurrencies roundingEnabled}} pageInfo{hasNextPage endCursor}}}', { after });
        ({ nodes, hasNextPage, endCursor } = readConnection(data.markets));
      } else if (selectedCategory === 'SHOPIFY_DISCOUNTS') {
        const data = await this.query(_context, config, credentials, 'query($after:String){discountNodes(first:50,after:$after){nodes{id discount{__typename ... on DiscountCodeBasic{title summary status} ... on DiscountAutomaticBasic{title summary status} ... on DiscountCodeBxgy{title summary status} ... on DiscountAutomaticBxgy{title summary status} ... on DiscountCodeFreeShipping{title summary status} ... on DiscountAutomaticApp{title status}}} pageInfo{hasNextPage endCursor}}}', { after });
        ({ nodes, hasNextPage, endCursor } = readConnection(data.discountNodes));
      } else if (selectedCategory === 'SHOPIFY_METAOBJECT_DEFINITIONS') {
        const data = await this.query(_context, config, credentials, 'query($after:String){metaobjectDefinitions(first:50,after:$after){nodes{id name type description fieldDefinitions{key name type{name}}} pageInfo{hasNextPage endCursor}}}', { after });
        ({ nodes, hasNextPage, endCursor } = readConnection(data.metaobjectDefinitions));
      }
      const titles: Record<ShopifyContentCategory, string> = { SHOPIFY_LOCATIONS: 'Shopify location', SHOPIFY_SHIPPING: 'Shopify shipping profile', SHOPIFY_LEGAL_POLICIES: 'Shopify legal policy', SHOPIFY_ONLINE_STORE_PAGES: 'Shopify online store page', SHOPIFY_MARKETS: 'Shopify market', SHOPIFY_DISCOUNTS: 'Shopify discount', SHOPIFY_METAOBJECT_DEFINITIONS: 'Shopify metaobject definition', SHOPIFY_METAOBJECTS: 'Public Shopify content' };
      const toContent = (value: unknown) => typeof value === 'string' ? value.replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48000) : (JSON.stringify(value ?? {}) ?? '{}').slice(0, 48000);
      const records: NormalizedCommerceRecord[] = nodes.flatMap((value): NormalizedCommerceRecord[] => {
        const node = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
        if (typeof node.id !== 'string') return [];
        const title = text(node.title ?? node.name ?? node.handle ?? node.type, 200) ?? titles[selectedCategory];
        const contentValue = selectedCategory === 'SHOPIFY_ONLINE_STORE_PAGES' ? node.body ?? node.bodySummary : selectedCategory === 'SHOPIFY_LEGAL_POLICIES' ? node.body : node;
        const content = toContent(contentValue);
        return [{ kind: 'KNOWLEDGE', externalId: node.id, title: `${titles[selectedCategory]}: ${title}`, content, category: selectedCategory, permissionCategory: selectedCategory, sourceUrl: typeof node.url === 'string' ? node.url : null, updatedAt: typeof node.updatedAt === 'string' ? node.updatedAt : null }];
      });
      const currentIndex = contentCategories.indexOf(selectedCategory);
      const nextCategory = !hasNextPage && currentIndex >= 0 ? contentCategories[currentIndex + 1] : undefined;
      const cursor = hasNextPage && endCursor ? `content:${selectedCategory}:${endCursor}` : nextCategory ? `content:${nextCategory}:` : null;
      return { itemCount: records.length, records, cursor, complete: cursor === null, checkpoint: { category: selectedCategory, updatedAt: new Date().toISOString() } };
    }
    throw new Error('CONNECTOR_RESOURCE_UNSUPPORTED');
  }
  async verifyWebhook(_c: ConnectorOperationContext, input: ConnectorWebhookInput, headers: Record<string,string|undefined>, configuration: Record<string,unknown>) {
    if (headers['x-shopify-shop-domain'] !== configuration.shopDomain) return false;
    const secret = process.env.SHOPIFY_CLIENT_SECRET ?? '', supplied = headers['x-shopify-hmac-sha256'] ?? '';
    if (!secret || !supplied) return false;
    const expected = createHmac('sha256', secret).update(input.rawBody).digest(); let actual: Buffer;
    try { actual=Buffer.from(supplied,'base64'); } catch { return false; }
    return actual.length===expected.length && timingSafeEqual(actual,expected);
  }
  async handleWebhook(context: ConnectorOperationContext, input: ConnectorWebhookInput, _configuration: Record<string,unknown>) {
    if (input.eventType === 'app/uninstalled') {
      await this.db.$transaction(async(tx:any)=>{ await tx.connectorCredential.deleteMany({where:{organizationId:context.organizationId,connectorInstanceId:context.connectorInstanceId}}); await tx.connectorSyncJob.updateMany({where:{organizationId:context.organizationId,connectorInstanceId:context.connectorInstanceId,state:{in:['PENDING','RETRY_WAIT','RUNNING']}},data:{state:'CANCELLED',finishedAt:new Date(),leaseToken:null,leaseUntil:null}}); await tx.connectorInstance.updateMany({where:{id:context.connectorInstanceId,organizationId:context.organizationId},data:{state:'DISCONNECTED',verifiedCapabilities:[],lastErrorCode:'SHOPIFY_APP_UNINSTALLED'}}); const c=await tx.connectorInstance.findFirst({where:{id:context.connectorInstanceId,organizationId:context.organizationId},select:{integrationConnectionId:true}}); if(c?.integrationConnectionId)await tx.integrationConnection.updateMany({where:{id:c.integrationConnectionId,organizationId:context.organizationId},data:{state:'REVOKED',grantedScopes:[],grantedScopeMetadata:[],grantedScopesVerifiedAt:null,lastErrorCode:'SHOPIFY_APP_UNINSTALLED'}}); }); return;
    }
    if (input.eventType === 'app/scopes_update') {
      const payload = input.payload as { current?: unknown; shop_id?: unknown };
      if (!Array.isArray(payload?.current) || payload.current.some((scope) => typeof scope !== 'string')) return;
      const scopes = [...new Set((payload.current as string[]).filter((scope) => /^[a-z][a-z0-9_]{0,127}$/.test(scope)))];
      const link = await this.db.connectorInstance.findFirst({ where: { id: context.connectorInstanceId, organizationId: context.organizationId }, select: { integrationConnectionId: true, commerceConnection: { select: { externalAccountId: true, grantedScopeMetadata: true } } } });
      const expectedShopId = String(link?.commerceConnection?.externalAccountId ?? '').match(/\d+$/)?.[0];
      const actualShopId = String(payload.shop_id ?? '').match(/\d+$/)?.[0];
      if (!link?.integrationConnectionId || !expectedShopId || expectedShopId !== actualShopId) return;
      await this.db.$transaction(async (tx: any) => {
        const oldMetadata: Array<{handle:string;description:string|null}> = Array.isArray(link.commerceConnection?.grantedScopeMetadata) ? link.commerceConnection.grantedScopeMetadata : [];
        const descriptions = new Map(oldMetadata.filter((item:any)=>item&&typeof item.handle==='string').map((item:any)=>[item.handle,typeof item.description==='string'?item.description:null]));
        const scopeMetadata = scopes.map((handle)=>({handle,description:descriptions.get(handle)??null}));
        await tx.integrationConnection.updateMany({ where: { id: link.integrationConnectionId, organizationId: context.organizationId }, data: { grantedScopes: scopes, grantedScopeMetadata: scopeMetadata, grantedScopesVerifiedAt: new Date(), lastErrorCode: null } });
        await tx.connectorInstance.updateMany({where:{id:context.connectorInstanceId,organizationId:context.organizationId},data:{lastVerifiedAt:new Date()}});
        const hasProducts = scopes.includes('read_products');
        const current = await tx.connectorInstance.findFirst({ where: { id: context.connectorInstanceId, organizationId: context.organizationId }, select: { verifiedCapabilities: true } });
        const caps: string[] = Array.isArray(current?.verifiedCapabilities) ? current.verifiedCapabilities : [];
        const nextCapabilities = hasProducts ? caps.filter((cap) => cap !== 'INVENTORY' && cap !== 'ORDERS' && cap !== 'FULFILLMENT') : [];
        if (hasProducts && scopes.includes('read_inventory') && caps.includes('INVENTORY')) nextCapabilities.push('INVENTORY');
        if (hasProducts && scopes.includes('read_orders') && caps.includes('ORDERS')) nextCapabilities.push('ORDERS', ...(caps.includes('FULFILLMENT') ? ['FULFILLMENT'] : []));
        for (const requirement of Object.values(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS)) {
          const stillGranted = requirement.anyScopes ? requirement.requiredScopes.some((scope) => scopes.includes(scope)) : requirement.requiredScopes.every((scope) => scopes.includes(scope));
          if (!stillGranted) {
            const index = nextCapabilities.indexOf(requirement.capability);
            if (index >= 0) nextCapabilities.splice(index, 1);
          }
        }
        if (nextCapabilities.some((capability) => Object.values(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS).some((requirement) => requirement.capability === capability))) nextCapabilities.push('WEBSITE_CONTENT');
        else if (!caps.includes('WEBSITE_CONTENT') || Object.values(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS).some((requirement) => caps.includes(requirement.capability))) {
          const index = nextCapabilities.indexOf('WEBSITE_CONTENT');
          if (index >= 0) nextCapabilities.splice(index, 1);
        }
        await tx.connectorInstance.updateMany({ where: { id: context.connectorInstanceId, organizationId: context.organizationId }, data: { verifiedCapabilities: [...new Set(nextCapabilities)], ...(hasProducts ? {} : { state: 'DEGRADED', lastErrorCode: 'SHOPIFY_REQUIRED_SCOPE_REVOKED' }) } });
        await tx.auditEvent.create({ data: { organizationId: context.organizationId, actorUserId: null, action: 'connector.provider_scopes_updated', entityType: 'connector_instance', entityId: context.connectorInstanceId, metadata: { grantedScopeCount: scopes.length, productsGranted: hasProducts, inventoryGranted: scopes.includes('read_inventory'), ordersGranted: scopes.includes('read_orders') } } });
        if (!hasProducts) {
          await tx.connectorSyncJob.updateMany({ where: { organizationId: context.organizationId, connectorInstanceId: context.connectorInstanceId, state: { in: ['PENDING', 'RETRY_WAIT', 'RUNNING'] } }, data: { state: 'CANCELLED', finishedAt: new Date(), leaseToken: null, leaseUntil: null, lastErrorCode: 'SHOPIFY_REQUIRED_SCOPE_REVOKED' } });
          await tx.commerceProduct.deleteMany({ where: { organizationId: context.organizationId, connectionId: link.integrationConnectionId } });
          await tx.commerceOrder.deleteMany({ where: { organizationId: context.organizationId, connectionId: link.integrationConnectionId } });
          await tx.integrationConnection.updateMany({ where: { id: link.integrationConnectionId, organizationId: context.organizationId }, data: { state: 'CONNECTED_WITH_WARNINGS', lastErrorCode: 'SHOPIFY_REQUIRED_SCOPE_REVOKED' } });
        } else {
          if (!scopes.includes('read_inventory')) {
            await tx.commerceProduct.updateMany({ where: { organizationId: context.organizationId, connectionId: link.integrationConnectionId }, data: { inventory: null, availabilityStatus: null } });
            const products = await tx.commerceProduct.findMany({ where: { organizationId: context.organizationId, connectionId: link.integrationConnectionId }, select: { id: true } });
            if (products.length) await tx.commerceProductVariant.updateMany({ where: { productId: { in: products.map((product: any) => product.id) } }, data: { inventory: null, availabilityStatus: null } });
          }
          if (!scopes.includes('read_orders')) await tx.commerceOrder.deleteMany({ where: { organizationId: context.organizationId, connectionId: link.integrationConnectionId } });
        }
      });
      return;
    }
    const target = shopifyWebhookSyncTarget(input.eventType);
    if (!target) return;
    const { resourceType, mode } = target;
    if (input.eventType === 'products/delete' && (input.payload as any)?.id) { const link=await this.db.connectorInstance.findFirst({where:{id:context.connectorInstanceId,organizationId:context.organizationId},select:{integrationConnectionId:true}}); const eventAt = new Date(String((input.payload as any).updated_at ?? '')); if(link?.integrationConnectionId && Number.isFinite(eventAt.getTime())) await this.db.commerceProduct.updateMany({where:{organizationId:context.organizationId,connectionId:link.integrationConnectionId,externalId:`gid://shopify/Product/${(input.payload as any).id}`,OR:[{externalUpdatedAt:null},{externalUpdatedAt:{lte:eventAt}}]},data:{rawStatus:'DELETED',externalUpdatedAt:eventAt,syncedAt:new Date()}}); }
    const key=`webhook:${input.eventId}:${resourceType}:${mode}`.slice(0,160);
    await this.db.connectorSyncJob.upsert({where:{organizationId_connectorInstanceId_idempotencyKey:{organizationId:context.organizationId,connectorInstanceId:context.connectorInstanceId,idempotencyKey:key}},create:{organizationId:context.organizationId,connectorInstanceId:context.connectorInstanceId,resourceType,mode,idempotencyKey:key,state:'PENDING'},update:{}});
  }
  async discoverCapabilities(context: ConnectorOperationContext, config: Record<string,unknown>, credentials: Record<string,unknown>) { return (await this.verify(context,config,credentials)).capabilities; }
  private async discoverPublicSafeMetaobjectDefinitions(context: ConnectorOperationContext, config: Record<string, unknown>, credentials: Record<string, unknown>) {
    const definitions = new Map<string, any>();
    let after: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 2; page++) {
      const data = await this.query(context, config, credentials, 'query($after:String){metaobjectDefinitions(first:50,after:$after){nodes{id name type access{storefront} fieldDefinitions{key name type{name}}} pageInfo{hasNextPage endCursor}}}', { after });
      const connection = data.metaobjectDefinitions;
      assertConnection(connection);
      for (const definition of connection.nodes) if (isPublicSafeMetaobjectDefinition(definition)) definitions.set(definition.type, definition);
      if (connection.pageInfo.hasNextPage !== true) return [...definitions.values()];
      const next = connection.pageInfo.endCursor;
      if (typeof next !== 'string' || !next || seen.has(next)) throw new Error('CONNECTOR_CURSOR_INVALID');
      seen.add(next);
      after = next;
    }
    throw new Error('CONNECTOR_METAOBJECT_DEFINITION_LIMIT');
  }
  private async syncMetaobjectEntries(context: ConnectorOperationContext, config: Record<string, unknown>, credentials: Record<string, unknown>, contentCategories: ShopifyContentCategory[], categoryIndex: number, cursorPayload: string, checkpoint: unknown): Promise<ConnectorSyncPage> {
    const checkpointValue = checkpoint && typeof checkpoint === 'object' ? checkpoint as Record<string, any> : {};
    let definitions: string[] = Array.isArray(checkpointValue.metaobjectTypes) ? checkpointValue.metaobjectTypes.filter(safeMetaobjectType) : [];
    if (!definitions.length) definitions = (await this.discoverPublicSafeMetaobjectDefinitions(context, config, credentials)).map((definition) => definition.type);
    if (definitions.length > 100) throw new Error('CONNECTOR_METAOBJECT_DEFINITION_LIMIT');
    let typeIndex = Number.isInteger(checkpointValue.metaobjectTypeIndex) ? checkpointValue.metaobjectTypeIndex : 0;
    let after: string | null = null;
    if (cursorPayload) {
      const match = /^metaobject:(\d+):(.+)$/.exec(cursorPayload);
      const rawTypeIndex = match?.[1];
      const rawCursor = match?.[2];
      if (rawTypeIndex === undefined || rawCursor === undefined) throw new Error('CONNECTOR_CURSOR_INVALID');
      typeIndex = Number(rawTypeIndex);
      try {
        const decodedCursor = rawCursor === 'start' ? null : decodeURIComponent(rawCursor);
        if (rawCursor !== 'start' && !decodedCursor) throw new Error('CONNECTOR_CURSOR_INVALID');
        after = decodedCursor;
      } catch {
        throw new Error('CONNECTOR_CURSOR_INVALID');
      }
    }
    if (typeIndex < 0 || typeIndex > definitions.length) throw new Error('CONNECTOR_CURSOR_INVALID');
    if (typeIndex === definitions.length) {
      const nextCategory = contentCategories[categoryIndex + 1];
      const nextCursor = nextCategory ? `content:${nextCategory}:` : null;
      return { itemCount: 0, records: [], cursor: nextCursor, complete: nextCursor === null, checkpoint: { category: 'SHOPIFY_METAOBJECTS', metaobjectTypes: definitions, metaobjectTypeIndex: typeIndex, updatedAt: new Date().toISOString() } };
    }
    const type = definitions[typeIndex];
    const currentDefinition = (await this.discoverPublicSafeMetaobjectDefinitions(context, config, credentials)).find((definition) => definition.type === type);
    if (!currentDefinition) throw new Error('CONNECTOR_METAOBJECT_DEFINITION_NOT_PUBLIC');
    const allowedFieldKeys = new Set<string>(currentDefinition.fieldDefinitions.map((field: any) => field.key));
    const data = await this.query(context, config, credentials, 'query($type:String!,$after:String){metaobjects(type:$type,first:50,after:$after){nodes{id handle type updatedAt fields{key value}} pageInfo{hasNextPage endCursor}}}', { type, after });
    const connection = assertConnection(data.metaobjects);
    const records: NormalizedCommerceRecord[] = connection.nodes.flatMap((entry: any): NormalizedCommerceRecord[] => {
      if (typeof entry?.id !== 'string' || typeof entry?.handle !== 'string' || entry.type !== type || !Array.isArray(entry.fields)) throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
      const fields: Record<string, string> = {};
      for (const field of entry.fields) {
        if (typeof field?.key !== 'string' || field.value == null || !allowedFieldKeys.has(field.key) || SENSITIVE_METAOBJECT_FIELD.test(field.key)) continue;
        if (typeof field.value !== 'string' || field.value.length > 4000) throw new Error('CONNECTOR_METAOBJECT_FIELD_LIMIT');
        fields[field.key] = field.value.replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, ' ').replace(/<[^>]+>/g, ' ');
      }
      const content = JSON.stringify(fields);
      if (content.length > 20000) throw new Error('CONNECTOR_METAOBJECT_FIELD_LIMIT');
      return [{ kind: 'KNOWLEDGE', externalId: entry.id, title: `Public Shopify content (${type}): ${entry.handle}`, content, category: 'SHOPIFY_METAOBJECTS', permissionCategory: 'SHOPIFY_METAOBJECTS', visibility: 'PUBLIC_REFERENCE', sourceUrl: null, updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null }];
    });
    let nextCursor: string | null = null;
    let nextTypeIndex = typeIndex;
    if (connection.pageInfo.hasNextPage === true) {
      const endCursor = connection.pageInfo.endCursor;
      if (typeof endCursor !== 'string' || !endCursor || endCursor === after) throw new Error('CONNECTOR_CURSOR_INVALID');
      nextCursor = `content:SHOPIFY_METAOBJECTS:metaobject:${typeIndex}:${encodeURIComponent(endCursor)}`;
    } else {
      nextTypeIndex++;
      if (nextTypeIndex < definitions.length) nextCursor = `content:SHOPIFY_METAOBJECTS:metaobject:${nextTypeIndex}:start`;
      else if (contentCategories[categoryIndex + 1]) nextCursor = `content:${contentCategories[categoryIndex + 1]}:`;
    }
    return { itemCount: records.length, records, cursor: nextCursor, complete: nextCursor === null, checkpoint: { category: 'SHOPIFY_METAOBJECTS', metaobjectTypes: definitions, metaobjectTypeIndex: nextTypeIndex, updatedAt: new Date().toISOString() } };
  }
  private async expandProductImagePages(context: ConnectorOperationContext, config: Record<string, unknown>, credentials: Record<string, unknown>, products: any[]) {
    const pageSize = 100, maxPages = 9, maxImages = 1000;
    for (const product of products) {
      const connection = product.images;
      assertConnection(connection);
      let after: string | null = connection.pageInfo.endCursor ?? null;
      let hasNext = connection.pageInfo.hasNextPage === true;
      const seenCursors = new Set<string>();
      const byId = new Map<string, any>();
      for (const image of connection.nodes) {
        if (typeof image?.id !== 'string' || typeof image?.url !== 'string') throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
        if (!byId.has(image.id)) byId.set(image.id, image);
      }
      let page = 0;
      while (hasNext) {
        if (!after || seenCursors.has(after) || page >= maxPages || byId.size >= maxImages) throw new Error('CONNECTOR_NESTED_PAGINATION_LIMIT');
        seenCursors.add(after);
        const result = await this.query(context, config, credentials, `query($id:ID!,$after:String){node(id:$id){... on Product{images(first:${pageSize},after:$after){nodes{id url altText width height} pageInfo{hasNextPage endCursor}}}}}`, { id: product.id, after }, true);
        const chunk = assertConnection(result.node?.images);
        for (const image of chunk.nodes) {
          if (typeof image?.id !== 'string' || typeof image?.url !== 'string') throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
          if (!byId.has(image.id)) byId.set(image.id, image);
        }
        if (byId.size > maxImages) throw new Error('CONNECTOR_NESTED_PAGINATION_LIMIT');
        hasNext = chunk.pageInfo.hasNextPage === true;
        after = typeof chunk.pageInfo.endCursor === 'string' ? chunk.pageInfo.endCursor : null;
        page++;
      }
      connection.nodes = [...byId.values()];
      connection.pageInfo = { ...connection.pageInfo, hasNextPage: false };
    }
  }
  private async expandNestedPages(context: ConnectorOperationContext, config: Record<string,unknown>, credentials: Record<string,unknown>, nodes: any[], connectionName: 'variants'|'lineItems', maxPages: number, syncDebug = false, includePrices = true, includeInventory = true) {
    const shape = connectionName === 'variants' ? `... on Product { variants(first:100,after:$after){nodes{id title sku ${includePrices ? 'price compareAtPrice' : ''} ${includeInventory ? 'inventoryQuantity inventoryItem{tracked}' : ''} selectedOptions{name value}} pageInfo{hasNextPage endCursor}} }` : '... on Order { lineItems(first:50,after:$after){nodes{id name sku quantity originalUnitPriceSet{shopMoney{amount}} discountedTotalSet{shopMoney{amount}} variant{id}} pageInfo{hasNextPage endCursor}} }';
    for (const node of nodes) {
      let next = node[connectionName]?.pageInfo?.hasNextPage, after = node[connectionName]?.pageInfo?.endCursor, page = 0;
      while (next && after && page < maxPages) {
        const result = await this.query(context, config, credentials, `query($id:ID!,$after:String){node(id:$id){${shape}}}`, { id: node.id, after }, syncDebug);
        const chunk = assertConnection(result.node?.[connectionName]);
        node[connectionName].nodes.push(...chunk.nodes);
        next = chunk.pageInfo?.hasNextPage === true;
        after = chunk.pageInfo?.endCursor ?? null;
        page++;
      }
      if (next) throw new Error('CONNECTOR_NESTED_PAGINATION_LIMIT');
      node[connectionName].pageInfo = { ...node[connectionName].pageInfo, hasNextPage: false };
    }
  }
  private async expandCollectionPages(context: ConnectorOperationContext, config: Record<string,unknown>, credentials: Record<string,unknown>, nodes: any[]) {
    for (const node of nodes) {
      let next = node.collections?.pageInfo?.hasNextPage, after = node.collections?.pageInfo?.endCursor, page = 0;
      while (next && after && page < 9) {
        const result = await this.query(context, config, credentials, 'query($id:ID!,$after:String){node(id:$id){... on Product{collections(first:50,after:$after){nodes{id title handle ruleSet{rules{column}}} pageInfo{hasNextPage endCursor}}}}}', { id: node.id, after }, true);
        const chunk = assertConnection(result.node?.collections);
        node.collections.nodes.push(...chunk.nodes); next = chunk.pageInfo?.hasNextPage === true; after = chunk.pageInfo?.endCursor ?? null; page++;
      }
      if (next) throw new Error('CONNECTOR_NESTED_PAGINATION_LIMIT');
    }
  }
  private async validCredentials(context: ConnectorOperationContext, shop: string, input: Record<string,unknown>, requestId?: string) {
    const expiry=typeof input.accessTokenExpiresAt==='string'?Date.parse(input.accessTokenExpiresAt):NaN;
    if(!Number.isFinite(expiry)||expiry>Date.now()+5*60_000)return input;
    if(typeof input.refreshToken!=='string'||!input.refreshToken||!process.env.SHOPIFY_CLIENT_ID||!process.env.SHOPIFY_CLIENT_SECRET)throw new Error('CONNECTOR_SHOPIFY_REAUTH_REQUIRED');
    const refreshExpires=typeof input.refreshTokenExpiresAt==='string'?Date.parse(input.refreshTokenExpiresAt):NaN;if(Number.isFinite(refreshExpires)&&refreshExpires<=Date.now())throw new Error('CONNECTOR_SHOPIFY_REAUTH_REQUIRED');
    const startedAt = Date.now();
    let response: Awaited<ReturnType<SafeOutboundHttpService['post']>>;
    try {
      response=await this.http.post(`https://${shop}/admin/oauth/access_token`,{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},new URLSearchParams({client_id:process.env.SHOPIFY_CLIENT_ID,client_secret:process.env.SHOPIFY_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:input.refreshToken}).toString(),32768);
      this.logVerification({ requestId, operation: 'shopify.oauth_token_refresh', stage: 'credential_refresh', targetHost: shop, httpStatus: response.status, elapsedMs: Date.now() - startedAt, outcome: response.status >= 200 && response.status < 300 ? 'success' : 'failure', ...(response.status >= 200 && response.status < 300 ? {} : { causeKind: 'PROVIDER_HTTP' }) });
    } catch (error) {
      this.logVerification({ requestId, operation: 'shopify.oauth_token_refresh', stage: 'credential_refresh', targetHost: shop, elapsedMs: Date.now() - startedAt, outcome: 'failure', ...safeCause(error) });
      throw error;
    }
    if(response.status<200||response.status>=300)throw new Error('CONNECTOR_SHOPIFY_REAUTH_REQUIRED');
    let token:any;try{token=JSON.parse(response.body.toString('utf8'));}catch{throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');}
    if(typeof token.access_token!=='string'||typeof token.refresh_token!=='string'||!Number.isFinite(token.expires_in))throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
    const updated={...input,accessToken:token.access_token,refreshToken:token.refresh_token,accessTokenExpiresAt:new Date(Date.now()+Number(token.expires_in)*1000).toISOString(),...(Number.isFinite(token.refresh_token_expires_in)?{refreshTokenExpiresAt:new Date(Date.now()+Number(token.refresh_token_expires_in)*1000).toISOString()}:{})};
    const encrypted=this.vault.encrypt(updated,`carteio:connector:${context.organizationId}:${context.connectorInstanceId}:shopify_v1`);
    await this.db.connectorCredential.updateMany({where:{organizationId:context.organizationId,connectorInstanceId:context.connectorInstanceId},data:encrypted});
    return updated;
  }
  private async query(context: ConnectorOperationContext, config: Record<string,unknown>, credentials: Record<string,unknown>, query: string, variables?: Record<string,unknown>, syncDebug = false, diagnostic?: { requestId: string; stage: string }, maxResponseBytes = 1048576) {
    const startedAt = Date.now();
    const requestId = `worker:${context.connectorInstanceId}`;
    const fields = { operation: 'connector.shopify_admin_graphql', organizationId: context.organizationId, connectorInstanceId: context.connectorInstanceId };
    try {
    const version = process.env.SHOPIFY_API_VERSION ?? '2026-10';
    if (!/^20\d{2}-(01|04|07|10)$/.test(version)) throw new Error('CONNECTOR_SHOPIFY_API_VERSION_INVALID');
    const shop=String(config.shopDomain); if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.myshopify\.com$/.test(shop)) throw new Error('CONNECTOR_CONFIG_INVALID');
    const active = await this.validCredentials(context, shop, credentials);
    const response = await this.http.post(`https://${shop}/admin/api/${version}/graphql.json`, { 'Content-Type':'application/json','Accept':'application/json','X-Shopify-Access-Token':String(active.accessToken) }, JSON.stringify({query,variables}), maxResponseBytes);
    if (diagnostic) this.logVerification({ requestId: diagnostic.requestId, operation: 'shopify.admin_graphql', stage: diagnostic.stage, targetHost: shop, httpStatus: response.status, elapsedMs: Date.now() - startedAt, outcome: response.status >= 200 && response.status < 300 ? 'response_received' : 'failure', ...(response.status >= 200 && response.status < 300 ? {} : { causeKind: 'PROVIDER_HTTP' }) });
    if (response.status === 429) throw new Error('CONNECTOR_RATE_LIMITED');
    if (response.status < 200 || response.status >= 300) throw new Error(`CONNECTOR_HTTP_${response.status}`);
    const body=graphqlJson(response.body); if (diagnostic && body.errors?.length) this.logVerification({ requestId: diagnostic.requestId, operation: 'shopify.admin_graphql', stage: diagnostic.stage, targetHost: shop, httpStatus: response.status, elapsedMs: Date.now() - startedAt, outcome: 'graphql_error', graphqlErrorCount: body.errors.length, graphqlErrorCodes: graphqlErrorCodes(body) }); if (body.errors?.some((entry: any) => entry?.extensions?.code === 'THROTTLED')) throw new Error('CONNECTOR_RATE_LIMITED'); if (body.errors?.length || !body.data) throw new Error('CONNECTOR_SHOPIFY_GRAPHQL_FAILED');
    if (syncDebug) connectorSyncDebug(this.logger, '15_shopify_product_api_request', requestId, startedAt, { ...fields, httpStatus: response.status });
    return body.data;
    } catch (error) {
      if (syncDebug) connectorSyncDebug(this.logger, '15_shopify_product_api_request', requestId, startedAt, fields, error);
      if (diagnostic) {
        const failure = error instanceof Error ? error.message : '';
        const status = /^CONNECTOR_HTTP_(\d{3})$/.exec(failure)?.[1];
        const host = typeof config.shopDomain === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.myshopify\.com$/.test(config.shopDomain) ? config.shopDomain : undefined;
        this.logVerification({ requestId: diagnostic.requestId, operation: 'shopify.admin_graphql', stage: diagnostic.stage, ...(host ? { targetHost: host } : {}), elapsedMs: Date.now() - startedAt, outcome: 'failure', ...(status ? { httpStatus: Number(status), causeKind: 'PROVIDER_HTTP' } : safeCause(error)) });
      }
      throw error;
    }
  }
  private logVerification(fields: Record<string, unknown>) { this.logger.log(JSON.stringify({ event: 'shopify_verification_diagnostic', ...fields })); }
}

@Injectable()
export class WooCommerceConnectorAdapter implements ConnectorAdapter {
  readonly definition: ConnectorDefinition = {
    id:'woocommerce_v1',type:'WOOCOMMERCE',version:'1.0.0',name:'WooCommerce',description:'WooCommerce REST API product, inventory and authorized order synchronization.',authStrategy:'API_KEY',
    configurationSchema:{type:'object',additionalProperties:false,required:['storeUrl'],properties:{storeUrl:{type:'string',minLength:12,maxLength:2048,format:'uri'}}},
    credentialSchema:{type:'object',additionalProperties:false,required:['consumerKey','consumerSecret'],properties:{consumerKey:{type:'string',minLength:8,maxLength:512},consumerSecret:{type:'string',minLength:8,maxLength:512},webhookSecret:{type:'string',minLength:16,maxLength:512}}},
    capabilities:['CONNECTOR_HEALTH_CHECK','PRODUCT_CATALOG','PRODUCT_PRICES','INVENTORY','ORDERS','FULFILLMENT'],syncResources:['PRODUCTS','ORDERS'],webhooks:{supported:true,signatureScheme:'WOOCOMMERCE_HMAC_SHA256',replayWindowSeconds:null},
  };
  private readonly db: any;
  constructor(private readonly http:SafeOutboundHttpService, prisma:PrismaService){this.db=prisma;}
  async connect(_c:ConnectorOperationContext,config:Record<string,unknown>,credentials:Record<string,unknown>){ this.base(config); if(typeof credentials.consumerKey!=='string'||typeof credentials.consumerSecret!=='string') throw new Error('CONNECTOR_CREDENTIALS_REQUIRED'); }
  async verify(_c:ConnectorOperationContext,config:Record<string,unknown>,credentials:Record<string,unknown>):Promise<ConnectorVerification>{
    const url=this.endpoint(config,'products?per_page=1'); const r=await this.call(url,credentials); if(r.status<200||r.status>=300)throw new Error(`CONNECTOR_HTTP_${r.status}`); const parsed=this.parse(r.body); if(!Array.isArray(parsed))throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
    const capabilities: ConnectorVerification['capabilities']=['CONNECTOR_HEALTH_CHECK','PRODUCT_CATALOG','PRODUCT_PRICES'];
    const sample=(parsed as any[])[0]; if(sample&&('stock_quantity' in sample||'stock_status' in sample||'manage_stock' in sample))capabilities.push('INVENTORY');
    const orders=await this.call(this.endpoint(config,'orders?per_page=1'),credentials);if(orders.status>=200&&orders.status<300){const orderPayload=this.parse(orders.body);if(Array.isArray(orderPayload))capabilities.push('ORDERS','FULFILLMENT');}
    return {verified:true,externalAccountId:new URL(this.base(config)).host,grantedScopes:['read_products',...(capabilities.includes('ORDERS')?['read_orders']:[])],capabilities};
  }
  async disconnect(){}
  async sync(_c:ConnectorOperationContext,input:{resourceType:string;mode:'FULL'|'INCREMENTAL';cursor?:string|null;checkpoint?:unknown},config:Record<string,unknown>,credentials:Record<string,unknown>):Promise<ConnectorSyncPage>{
    const page=Math.max(1,Number(input.cursor??1)); const params=new URLSearchParams({per_page:'10',page:String(page)}); if(input.mode==='INCREMENTAL')params.set('modified_after',String((input.checkpoint as any)?.updatedAt??(input.checkpoint as any)?.highWatermark??(input.checkpoint as any)?.since??new Date(Date.now()-86400000).toISOString()));
    const storeCurrency = await this.currency(config, credentials);
    if(input.resourceType==='PRODUCTS'){
      const response=await this.call(this.endpoint(config,`products?${params}`),credentials); if(response.status===429)throw new Error('CONNECTOR_RATE_LIMITED'); if(response.status<200||response.status>=300)throw new Error(`CONNECTOR_HTTP_${response.status}`);
      const products=this.parse(response.body); if(!Array.isArray(products))throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID'); const records:NormalizedCommerceRecord[]=[];
      for(const p of products.slice(0,10)){ const variations:any[]=[]; let variantsComplete=true; if(Array.isArray(p.variations)){ for(let vp=1;vp<=10;vp++){ const vr=await this.call(this.endpoint(config,`products/${encodeURIComponent(String(p.id))}/variations?per_page=100&page=${vp}`),credentials); if(vr.status===429)throw new Error('CONNECTOR_RATE_LIMITED'); if(vr.status<200||vr.status>=300)throw new Error(`CONNECTOR_HTTP_${vr.status}`); const pageRows=this.parse(vr.body); if(!Array.isArray(pageRows))throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID'); variations.push(...pageRows.slice(0,100)); const rawTotal=vr.headers['x-wp-totalpages'], total=Number(rawTotal); if(rawTotal?vp>=total:pageRows.length<100)break; if(vp===10)variantsComplete=false; } } records.push({kind:'PRODUCT',externalId:String(p.id),name:text(p.name,500)??'Untitled',description:text(p.description,20000),sku:text(p.sku,160),currency:storeCurrency,price:amount(p.price),inventory:int(p.stock_quantity),availability:text(p.stock_status,40)?.toUpperCase()??null,status:text(p.status,80),productUrl:text(p.permalink,2048),imageUrl:text(p.images?.[0]?.src,2048),updatedAt:text(p.date_modified_gmt,40),variants:variations.slice(0,1000).map((v:any)=>({externalId:String(v.id),title:text(v.attributes?.map((a:any)=>a.option).filter(Boolean).join(' / '),500)??'Variant',sku:text(v.sku,160),currency:storeCurrency,price:amount(v.price),inventory:int(v.stock_quantity),availability:text(v.stock_status,40)?.toUpperCase()??null,status:text(p.status,80)})),variantsComplete}); }
      const rawPages=response.headers['x-wp-totalpages'], pages=Number(rawPages), complete=rawPages?page>=pages:products.length<10; return {itemCount:records.length,records,cursor:String(page+1),checkpoint:{since:(input.checkpoint as any)?.since??(input.mode==='INCREMENTAL'?(input.checkpoint as any)?.updatedAt??new Date(Date.now()-86400000).toISOString():null),highWatermark:records.map(r=>r.kind==='PRODUCT'?r.updatedAt:null).filter(Boolean).sort().at(-1)??(input.checkpoint as any)?.highWatermark??null,updatedAt:complete?(records.map(r=>r.kind==='PRODUCT'?r.updatedAt:null).filter(Boolean).sort().at(-1)??(input.checkpoint as any)?.highWatermark??(input.checkpoint as any)?.updatedAt??new Date().toISOString()):(input.checkpoint as any)?.updatedAt??null},complete};
    }
    if(input.resourceType==='ORDERS'){
      const response=await this.call(this.endpoint(config,`orders?${params}`),credentials);if(response.status===429)throw new Error('CONNECTOR_RATE_LIMITED');if(response.status<200||response.status>=300)throw new Error(`CONNECTOR_HTTP_${response.status}`);
      const orders=this.parse(response.body);if(!Array.isArray(orders))throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');const records:NormalizedCommerceRecord[]=orders.slice(0,10).map((o:any)=>({kind:'ORDER',externalId:String(o.id),displayReference:text(o.number,160),financialStatus:o.date_paid?'PAID':null,fulfillmentStatus:o.date_completed?'FULFILLED':null,currency:text(o.currency,3)??storeCurrency,subtotal:null,discountTotal:amount(o.discount_total),shippingTotal:amount(o.shipping_total),taxTotal:amount(o.total_tax),total:amount(o.total),orderedAt:text(o.date_created_gmt,40),updatedAt:text(o.date_modified_gmt,40),linesComplete:Array.isArray(o.line_items)?o.line_items.length<=1000:true,status:text(o.status,100),lines:(Array.isArray(o.line_items)?o.line_items:[]).slice(0,1000).map((l:any)=>({externalId:String(l.id),productExternalId:text(l.product_id,255),name:text(l.name,500)??'Item',sku:text(l.sku,160),quantity:int(l.quantity)??0,currency:text(o.currency,3)??storeCurrency,unitPrice:amount(l.price),total:amount(l.total)}))}));const rawPages=response.headers['x-wp-totalpages'],pages=Number(rawPages),complete=rawPages?page>=pages:orders.length<10;return{itemCount:records.length,records,cursor:String(page+1),checkpoint:{since:(input.checkpoint as any)?.since??(input.mode==='INCREMENTAL'?(input.checkpoint as any)?.updatedAt??new Date(Date.now()-86400000).toISOString():null),highWatermark:records.map(r=>r.kind==='ORDER'?r.updatedAt:null).filter(Boolean).sort().at(-1)??(input.checkpoint as any)?.highWatermark??null,updatedAt:complete?(records.map(r=>r.kind==='ORDER'?r.updatedAt:null).filter(Boolean).sort().at(-1)??(input.checkpoint as any)?.highWatermark??(input.checkpoint as any)?.updatedAt??new Date().toISOString()):(input.checkpoint as any)?.updatedAt??null},complete};
    }
    throw new Error('CONNECTOR_RESOURCE_UNSUPPORTED');
  }
  async verifyWebhook(_c:ConnectorOperationContext,input:ConnectorWebhookInput,headers:Record<string,string|undefined>,config:Record<string,unknown>,credentials:Record<string,unknown>){const secret=credentials.webhookSecret,supplied=headers['x-wc-webhook-signature']??'',source=headers['x-wc-webhook-source']??'';if(typeof secret!=='string'||!supplied)return false;try{if(new URL(source).host!==new URL(this.base(config)).host)return false;}catch{return false;}const expected=createHmac('sha256',secret).update(input.rawBody).digest(),actual=Buffer.from(supplied,'base64');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
  async handleWebhook(context:ConnectorOperationContext,input:ConnectorWebhookInput,_config:Record<string,unknown>){
    const p=input.payload as any, type=input.eventType.toLowerCase(), isOrder=type.includes('order');
    if(type.includes('deleted')&&!isOrder&&p?.id){const link=await this.db.connectorInstance.findFirst({where:{id:context.connectorInstanceId,organizationId:context.organizationId},select:{integrationConnectionId:true}});if(link?.integrationConnectionId)await this.db.commerceProduct.updateMany({where:{organizationId:context.organizationId,connectionId:link.integrationConnectionId,externalId:String(p.id)},data:{rawStatus:'DELETED',syncedAt:new Date()}});}
    const resourceType=isOrder?'ORDERS':'PRODUCTS',key=`webhook:${input.eventId}:${resourceType}`.slice(0,160);
    await this.db.connectorSyncJob.upsert({where:{organizationId_connectorInstanceId_idempotencyKey:{organizationId:context.organizationId,connectorInstanceId:context.connectorInstanceId,idempotencyKey:key}},create:{organizationId:context.organizationId,connectorInstanceId:context.connectorInstanceId,resourceType,mode:'INCREMENTAL',idempotencyKey:key,state:'PENDING'},update:{}});
  }
  async discoverCapabilities(context:ConnectorOperationContext,config:Record<string,unknown>,credentials:Record<string,unknown>){return(await this.verify(context,config,credentials)).capabilities;}
  private base(config:Record<string,unknown>){let u:URL;try{u=new URL(String(config.storeUrl));}catch{throw new Error('CONNECTOR_CONFIG_INVALID');}if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)throw new Error('CONNECTOR_CONFIG_INVALID');return u.toString().replace(/\/$/,'');}
  private endpoint(config:Record<string,unknown>,path:string){return`${this.base(config)}/wp-json/wc/v3/${path}`;}
  private async currency(config:Record<string,unknown>,credentials:Record<string,unknown>):Promise<string|null>{const response=await this.call(this.endpoint(config,'settings/general'),credentials);if(response.status===429)throw new Error('CONNECTOR_RATE_LIMITED');if(response.status<200||response.status>=300)return null;const settings=this.parse(response.body);if(!Array.isArray(settings))return null;const value=settings.find((item:any)=>item?.id==='woocommerce_currency')?.value;return typeof value==='string'&&/^[A-Z]{3}$/.test(value)?value:null;}
  private async call(url:string,credentials:Record<string,unknown>){const auth=Buffer.from(`${String(credentials.consumerKey)}:${String(credentials.consumerSecret)}`).toString('base64');return this.http.request('GET',url,{Accept:'application/json',Authorization:`Basic ${auth}`},undefined,2097152);}
  private parse(body:Buffer){try{return JSON.parse(body.toString('utf8'));}catch{throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');}}
}
