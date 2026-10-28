import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { SafeOutboundHttpService } from './safe-outbound-http.service';

export type ShopifyScopeMetadata = Readonly<{ handle: string; description: string | null }>;
export type ShopifyScopeAccessType = 'READ' | 'WRITE' | 'OTHER';
export type ShopifyDataClassification = 'STANDARD' | 'SENSITIVE' | 'PROTECTED' | 'UNKNOWN';
export type ShopifyScopeDiscoveryResult = Readonly<{ shopId: string; shopDomain: string; storefrontUrl: string | null; scopes: readonly ShopifyScopeMetadata[] }>;
export const SHOPIFY_SCOPE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SHOPIFY_CAPABILITY_SCOPE_MAP = Object.freeze({
  PRODUCTS: { scope: 'read_products', operation: 'Shopify Admin GraphQL Product query' },
  PRICES: { scope: 'read_products', operation: 'Shopify Admin GraphQL ProductVariant price fields' },
  CATEGORIES: { scope: 'read_products', operation: 'Shopify Product taxonomy and collection fields' },
  INVENTORY: { scope: 'read_inventory', operation: 'Shopify ProductVariant inventory fields' },
  ORDERS: { scope: 'read_orders', operation: 'Shopify Admin GraphQL Order query' },
  FULFILLMENT: { scope: 'read_orders', operation: 'Shopify Order fulfillment status fields' },
} as const);
export const SHOPIFY_SCOPE_OPERATION_REGISTRY = Object.freeze({
  read_products: [
    { category: 'PRODUCTS', operation: 'Product search and details', resource: 'Products and variants', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_products'], sensitivity: 'BUSINESS', assistantEligible: true },
    { category: 'PRICES', operation: 'Product and variant prices', resource: 'Product variants', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_products'], sensitivity: 'BUSINESS', assistantEligible: true },
    { category: 'CATEGORIES', operation: 'Product types, taxonomy and collections', resource: 'Product taxonomy and collections', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_products'], sensitivity: 'BUSINESS', assistantEligible: true },
  ],
  read_inventory: [{ category: 'INVENTORY', operation: 'Inventory and availability', resource: 'Inventory levels', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_inventory'], sensitivity: 'BUSINESS', assistantEligible: true }],
  read_orders: [{ category: 'ORDERS', operation: 'Order and fulfillment records', resource: 'Orders and fulfillments', accessType: 'READ', dataClassification: 'PROTECTED', customerIdentityRequired: true, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_orders'], sensitivity: 'RESTRICTED', assistantEligible: false }],
  read_locations: [{ category: 'SHOPIFY_LOCATIONS', operation: 'Store locations', resource: 'Location name and fulfillment address', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_locations'], sensitivity: 'BUSINESS', assistantEligible: true }],
  read_shipping: [{ category: 'SHOPIFY_SHIPPING', operation: 'Shipping and delivery profiles', resource: 'Delivery profiles and shipping zones', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_shipping'], sensitivity: 'BUSINESS', assistantEligible: true }],
  read_legal_policies: [{ category: 'SHOPIFY_LEGAL_POLICIES', operation: 'Store legal policies', resource: 'Shop policies', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_legal_policies'], sensitivity: 'BUSINESS', assistantEligible: true }],
  read_online_store_pages: [{ category: 'SHOPIFY_ONLINE_STORE_PAGES', operation: 'Online store pages', resource: 'Published pages', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_online_store_pages'], requiredAnyScopes: ['read_online_store_pages', 'read_content'], sensitivity: 'BUSINESS', assistantEligible: true }],
  read_content: [{ category: 'SHOPIFY_ONLINE_STORE_PAGES', operation: 'Online store pages', resource: 'Published pages', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_content'], requiredAnyScopes: ['read_online_store_pages', 'read_content'], sensitivity: 'BUSINESS', assistantEligible: true }],
  read_markets: [{ category: 'SHOPIFY_MARKETS', operation: 'Markets and currencies', resource: 'Markets and currency settings', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_markets'], sensitivity: 'BUSINESS', assistantEligible: true }],
  read_discounts: [{ category: 'SHOPIFY_DISCOUNTS', operation: 'Discounts', resource: 'Discount rules and status', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_discounts'], sensitivity: 'BUSINESS', assistantEligible: true }],
  read_metaobject_definitions: [{ category: 'SHOPIFY_METAOBJECT_DEFINITIONS', operation: 'Metaobject definitions', resource: 'Custom content schemas', accessType: 'READ', dataClassification: 'SENSITIVE', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_metaobject_definitions'], sensitivity: 'RESTRICTED', assistantEligible: false }],
  read_metaobjects: [{ category: 'SHOPIFY_METAOBJECTS', operation: 'Public metaobject entries', resource: 'Storefront-public custom content', accessType: 'READ', dataClassification: 'STANDARD', customerIdentityRequired: false, explicitConfirmationRequired: false, executable: true, requiredScopes: ['read_metaobjects', 'read_metaobject_definitions'], sensitivity: 'BUSINESS', assistantEligible: true }],
} as const);
export const SHOPIFY_REGISTERED_OPERATIONS = Object.freeze([...new Map(Object.values(SHOPIFY_SCOPE_OPERATION_REGISTRY).flat().map((operation: any) => [`${operation.category}:${operation.operation}`, operation])).values()]);
export const SHOPIFY_CONTENT_SCOPE_REQUIREMENTS = Object.freeze({
  SHOPIFY_LOCATIONS: { requiredScopes: ['read_locations'], anyScopes: false, capability: 'SHOPIFY_LOCATIONS', assistantEligible: true },
  SHOPIFY_SHIPPING: { requiredScopes: ['read_shipping'], anyScopes: false, capability: 'SHOPIFY_SHIPPING', assistantEligible: true },
  SHOPIFY_LEGAL_POLICIES: { requiredScopes: ['read_legal_policies'], anyScopes: false, capability: 'SHOPIFY_LEGAL_POLICIES', assistantEligible: true },
  SHOPIFY_ONLINE_STORE_PAGES: { requiredScopes: ['read_online_store_pages', 'read_content'], anyScopes: true, capability: 'SHOPIFY_ONLINE_STORE_PAGES', assistantEligible: true },
  SHOPIFY_MARKETS: { requiredScopes: ['read_markets'], anyScopes: false, capability: 'SHOPIFY_MARKETS', assistantEligible: true },
  SHOPIFY_DISCOUNTS: { requiredScopes: ['read_discounts'], anyScopes: false, capability: 'SHOPIFY_DISCOUNTS', assistantEligible: true },
  SHOPIFY_METAOBJECT_DEFINITIONS: { requiredScopes: ['read_metaobject_definitions'], anyScopes: false, capability: 'SHOPIFY_METAOBJECT_DEFINITIONS', assistantEligible: false },
  SHOPIFY_METAOBJECTS: { requiredScopes: ['read_metaobjects', 'read_metaobject_definitions'], anyScopes: false, capability: 'SHOPIFY_METAOBJECTS', assistantEligible: true },
} as const);
export type ShopifyContentCategory = keyof typeof SHOPIFY_CONTENT_SCOPE_REQUIREMENTS;
export const shopifyContentCategoryAllowed = (category: string, scopes: readonly string[], capabilities: readonly string[]) => {
  const requirement = SHOPIFY_CONTENT_SCOPE_REQUIREMENTS[category as ShopifyContentCategory];
  return Boolean(requirement && (requirement.anyScopes ? requirement.requiredScopes.some((scope) => scopes.includes(scope)) : requirement.requiredScopes.every((scope) => scopes.includes(scope))) && capabilities.includes(requirement.capability));
};
export const SHOPIFY_KNOWN_SCOPE_CLASSIFICATIONS: Readonly<Record<string, ShopifyDataClassification>> = Object.freeze({
  read_products: 'STANDARD', read_inventory: 'STANDARD', read_orders: 'PROTECTED', read_locations: 'STANDARD', read_shipping: 'STANDARD',
  read_legal_policies: 'STANDARD', read_online_store_pages: 'STANDARD', read_content: 'STANDARD', read_markets: 'STANDARD', read_discounts: 'STANDARD',
  read_metaobject_definitions: 'STANDARD', read_metaobjects: 'SENSITIVE',
});
export const shopifyScopeAccessType = (handle: string): ShopifyScopeAccessType => handle.startsWith('read_') ? 'READ' : handle.startsWith('write_') ? 'WRITE' : 'OTHER';
export const shopifyScopeClassification = (handle: string): ShopifyDataClassification => SHOPIFY_KNOWN_SCOPE_CLASSIFICATIONS[handle] ?? 'UNKNOWN';
export const shopifyScopeAllows = (scopes: readonly string[], capability: keyof typeof SHOPIFY_CAPABILITY_SCOPE_MAP) => scopes.includes(SHOPIFY_CAPABILITY_SCOPE_MAP[capability].scope);
export const isShopifyScopeSnapshotFresh = (verifiedAt: Date | string | null | undefined, now = Date.now()) => {
  if (!verifiedAt) return false;
  const timestamp = verifiedAt instanceof Date ? verifiedAt.getTime() : Date.parse(verifiedAt);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= SHOPIFY_SCOPE_MAX_AGE_MS;
};

const shopPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.myshopify\.com$/;
const scopePattern = /^[a-z][a-z0-9_]{0,127}$/;

/** Reads only the installed app's actual grants. Unknown handles are retained as metadata, never as capabilities. */
@Injectable()
export class ShopifyGrantedScopeDiscoveryService {
  private readonly db: any;
  private readonly logger = new Logger(ShopifyGrantedScopeDiscoveryService.name);
  constructor(private readonly http: SafeOutboundHttpService, prisma: PrismaService) { this.db = prisma; }

  async discover(input: { organizationId: string; connectorInstanceId: string; requestId?: string; shopDomain: string; accessToken: string }): Promise<ShopifyScopeDiscoveryResult> {
    if (!shopPattern.test(input.shopDomain) || typeof input.accessToken !== 'string' || input.accessToken.length < 16) throw new Error('CONNECTOR_SHOPIFY_SCOPE_CONTEXT_INVALID');
    const version = process.env.SHOPIFY_API_VERSION ?? '2026-10';
    if (!/^20\d{2}-(01|04|07|10)$/.test(version)) throw new Error('CONNECTOR_SHOPIFY_API_VERSION_INVALID');
    const requestId = input.requestId ?? `shopify-scope-${input.connectorInstanceId}`;
    const startedAt = Date.now();
    let response: Awaited<ReturnType<SafeOutboundHttpService['post']>>;
    try {
      response = await this.http.post(`https://${input.shopDomain}/admin/api/${version}/graphql.json`, {
        'Content-Type': 'application/json', Accept: 'application/json', 'X-Shopify-Access-Token': input.accessToken,
      }, JSON.stringify({ query: 'query CarteioGrantedScopes { shop { id myshopifyDomain primaryDomain { url } } currentAppInstallation { accessScopes { handle description } } }' }), 262144);
    } catch (error) {
      const safe = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown; constructor?: { name?: string } } : null;
      const rawCode = typeof safe?.code === 'string' ? safe.code : safe?.message === 'CONNECTOR_REQUEST_TIMEOUT' ? safe.message : undefined;
      const code = typeof rawCode === 'string' && /^[A-Z0-9_-]{1,40}$/i.test(rawCode) ? rawCode : undefined;
      const causeKind = code === 'ETIMEDOUT' || code === 'CONNECTOR_REQUEST_TIMEOUT' ? 'TIMEOUT' : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'DNS' : code?.startsWith('ECONN') ? 'NETWORK' : 'TRANSPORT_OR_VALIDATION';
      this.logger.error(JSON.stringify({ event: 'shopify_verification_diagnostic', requestId, operation: 'shopify.granted_scope_discovery', stage: 'scope_discovery', targetHost: input.shopDomain, elapsedMs: Date.now() - startedAt, outcome: 'failure', causeKind, ...(code ? { causeCode: code } : {}), causeType: typeof safe?.constructor?.name === 'string' ? safe.constructor.name.slice(0, 40) : 'UnknownError' }));
      throw error;
    }
    if (response.status < 200 || response.status >= 300) {
      this.logger.error(JSON.stringify({ event: 'shopify_verification_diagnostic', requestId, operation: 'shopify.granted_scope_discovery', stage: 'scope_discovery', targetHost: input.shopDomain, httpStatus: response.status, elapsedMs: Date.now() - startedAt, outcome: 'failure', causeKind: 'PROVIDER_HTTP' }));
      throw new Error('CONNECTOR_SHOPIFY_SCOPE_DISCOVERY_FAILED');
    }
    let body: any;
    try { body = JSON.parse(response.body.toString('utf8')); } catch {
      this.logger.error(JSON.stringify({ event: 'shopify_verification_diagnostic', requestId, operation: 'shopify.granted_scope_discovery', stage: 'scope_discovery', targetHost: input.shopDomain, httpStatus: response.status, elapsedMs: Date.now() - startedAt, outcome: 'invalid_json', causeKind: 'PROVIDER_RESPONSE_INVALID' }));
      throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
    }
    const shop = body?.data?.shop, scopeRows = body?.data?.currentAppInstallation?.accessScopes;
    if (body?.errors?.length) {
      const graphqlErrorCodes = [...new Set(body.errors.map((entry: any) => entry?.extensions?.code).filter((code: unknown): code is string => typeof code === 'string' && /^[A-Z0-9_]{1,60}$/.test(code)))].slice(0, 8);
      this.logger.error(JSON.stringify({ event: 'shopify_verification_diagnostic', requestId, operation: 'shopify.granted_scope_discovery', stage: 'scope_discovery', targetHost: input.shopDomain, httpStatus: response.status, elapsedMs: Date.now() - startedAt, outcome: 'graphql_error', graphqlErrorCount: body.errors.length, graphqlErrorCodes }));
      throw new Error('CONNECTOR_SHOPIFY_SCOPE_DISCOVERY_FAILED');
    }
    if (!shop?.id || shop.myshopifyDomain !== input.shopDomain || !Array.isArray(scopeRows)) {
      this.logger.error(JSON.stringify({ event: 'shopify_verification_diagnostic', requestId, operation: 'shopify.granted_scope_discovery', stage: 'scope_discovery', targetHost: input.shopDomain, httpStatus: response.status, elapsedMs: Date.now() - startedAt, outcome: 'invalid_response_fields', causeKind: !shop?.id ? 'SHOP_ID_MISSING' : shop.myshopifyDomain !== input.shopDomain ? 'SHOP_DOMAIN_MISMATCH' : 'SCOPE_LIST_MISSING' }));
      throw new Error('CONNECTOR_SHOPIFY_SCOPE_DISCOVERY_FAILED');
    }
    this.logger.log(JSON.stringify({ event: 'shopify_verification_diagnostic', requestId, operation: 'shopify.granted_scope_discovery', stage: 'scope_discovery', targetHost: input.shopDomain, httpStatus: response.status, elapsedMs: Date.now() - startedAt, outcome: 'success', grantedScopeCount: scopeRows.length }));
    const scopes = new Map<string, string | null>();
    for (const entry of scopeRows) {
      if (!entry || typeof entry.handle !== 'string' || !scopePattern.test(entry.handle)) {
        this.logger.error(JSON.stringify({ event: 'shopify_verification_diagnostic', requestId, operation: 'shopify.granted_scope_discovery', stage: 'scope_response_validation', targetHost: input.shopDomain, elapsedMs: Date.now() - startedAt, outcome: 'failure', causeKind: 'INVALID_SCOPE_HANDLE' }));
        throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
      }
      const description = entry.description == null ? null : typeof entry.description === 'string' ? entry.description.slice(0, 500) : null;
      if (entry.description != null && description === null) {
        this.logger.error(JSON.stringify({ event: 'shopify_verification_diagnostic', requestId, operation: 'shopify.granted_scope_discovery', stage: 'scope_response_validation', targetHost: input.shopDomain, elapsedMs: Date.now() - startedAt, outcome: 'failure', causeKind: 'INVALID_SCOPE_DESCRIPTION' }));
        throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
      }
      if (!scopes.has(entry.handle)) scopes.set(entry.handle, description);
    }
    let storefrontUrl: string | null = null;
    if (typeof shop.primaryDomain?.url === 'string') {
      try {
        const candidate = new URL(shop.primaryDomain.url);
        if (candidate.protocol === 'https:' && !candidate.username && !candidate.password && !candidate.port
          && candidate.pathname === '/' && !candidate.search && !candidate.hash
          && candidate.hostname.length <= 253 && candidate.hostname.includes('.')
          && /^[a-z0-9.-]+$/i.test(candidate.hostname) && !candidate.hostname.includes('..')) storefrontUrl = candidate.origin;
      } catch { /* A malformed provider storefront URL is never used as a crawl origin. */ }
    }
    return { shopId: shop.id, shopDomain: shop.myshopifyDomain, storefrontUrl, scopes: [...scopes].map(([handle, description]) => ({ handle, description })).sort((a, b) => a.handle.localeCompare(b.handle)) };
  }

  async persist(input: { organizationId: string; connectionId: string; scopes: readonly ShopifyScopeMetadata[]; verifiedAt?: Date }) {
    const verifiedAt = input.verifiedAt ?? new Date();
    await this.db.integrationConnection.updateMany({
      where: { id: input.connectionId, organizationId: input.organizationId, platform: 'SHOPIFY' },
      data: { grantedScopes: input.scopes.map((scope) => scope.handle), grantedScopeMetadata: input.scopes, grantedScopesVerifiedAt: verifiedAt },
    });
    return verifiedAt;
  }
}
