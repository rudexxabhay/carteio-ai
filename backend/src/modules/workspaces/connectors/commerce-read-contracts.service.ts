import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { WorkspaceService } from '../workspace.service';
import { isShopifyScopeSnapshotFresh, shopifyScopeAllows, SHOPIFY_REGISTERED_OPERATIONS } from './shopify-granted-scope-discovery.service';

const PRODUCT_STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'available', 'below', 'buy', 'can', 'catalog', 'catalogue', 'color', 'colour', 'do', 'for', 'how', 'i', 'in', 'is', 'item', 'items', 'less', 'me', 'of', 'on', 'our', 'out', 'please', 'price', 'product', 'products', 'show', 'stock', 'inventory', 'than', 'the', 'this', 'to', 'under', 'what', 'which', 'within', 'with', 'you', 'your', 'inr', 'rs']);
const ACTIVE_CONNECTION_STATES = ['CONNECTED', 'CONNECTED_WITH_WARNINGS'];
const SOURCE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const asText = (value: unknown): string | null => value == null ? null : String(value);
const asIso = (value: Date | null | undefined): string | null => value ? value.toISOString() : null;
const safeHttpsUrl = (value: unknown): string | null => { if (typeof value !== 'string') return null; try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.toString().slice(0, 2048) : null; } catch { return null; } };

/** Recognize explicit structured constraints so broad discovery does not erase them. */
export function hasProductCatalogFilterSignal(query: string): boolean {
  const normalized = query.normalize('NFKC').toLocaleLowerCase();
  const filters = parseProductSearchFilters(normalized);
  return filters.maxPrice !== undefined || filters.color !== undefined
    || /\bsize\s*[-:#]?\s*(?:\d{1,3}|xs|s|m|l|xl|xxl)\b/iu.test(normalized);
}

export type ProductSearchFilters = Readonly<{ maxPrice?: number; currency?: string; color?: string }>;

/** Parse explicit INR upper-bound requests without treating arbitrary numbers as prices. */
export function parseProductSearchFilters(query: string): ProductSearchFilters {
  const normalized = query.normalize('NFKC');
  const amount = /(?:₹|\bINR\b|\bRs\.?\s*)\s*([\d,]+(?:\.\d{1,2})?)/iu.exec(normalized);
  const parsedPrice = amount?.[1] && /(?:\bunder\b|\bbelow\b|\bless\s+than\b|\bwithin\b|ke\s+andar|से\s*कम|के\s*अंदर)/iu.test(normalized) ? Number(amount[1].replaceAll(',', '')) : null;
  const maxPrice = parsedPrice !== null && Number.isFinite(parsedPrice) && parsedPrice >= 0 && parsedPrice <= 1_000_000_000 ? parsedPrice : undefined;
  const color = /\b(blue|red|black|white|green|yellow|pink|purple|brown|grey|gray|navy|beige)\b|(नीला|नीली|लाल|काला|काली|सफेद)/iu.exec(normalized)?.[0]?.toLocaleLowerCase();
  return { ...(maxPrice !== undefined ? { maxPrice, currency: 'INR' } : {}), ...(color ? { color } : {}) };
}

export type CommerceProductEvidence = Readonly<{
  id: string;
  connectionId: string;
  externalId: string;
  name: string;
  description: string | null;
  category: string | null;
  productType: string | null;
  taxonomyCategoryId: string | null;
  taxonomyCategory: string | null;
  collections: readonly Readonly<{ externalId: string; title: string; handle: string | null; membershipType: 'MANUAL' | 'AUTOMATED' | 'UNKNOWN' }>[];
  vendor: string | null;
  handle: string | null;
  compareAtPrice: string | null;
  imageUrl: string | null;
  imageAltText: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageEvidence: readonly Readonly<{ url: string; altText: string | null; width: number | null; height: number | null }>[];
  sku: string | null;
  currency: string | null;
  price: string | null;
  inventory: number | null;
  availabilityStatus: string | null;
  rawStatus: string | null;
  productUrl: string | null;
  syncedAt: string;
  externalUpdatedAt: string | null;
  stale: boolean;
  retrievalScore: number;
  retrievalReason: 'catalog_browse' | 'keyword_match';
  dataCompleteness: 'UNKNOWN';
  variants: readonly Readonly<{ title: string; sku: string | null; selectedOptions: readonly Readonly<{ name: string; value: string }>[]; compareAtPrice: string | null; currency: string | null; price: string | null; inventory: number | null; availabilityStatus: string | null; rawStatus: string | null }>[];
  contentHash: string;
}>;

/** Provider-neutral, read-only contracts over the existing normalized commerce tables. */
@Injectable()
export class CommerceReadContracts {
  private readonly logger = new Logger(CommerceReadContracts.name);
  private readonly db: any;
  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService) { this.db = prisma; }

  /** Current request-time eligibility check for the assistant's read-only product catalog. */
  async canSearchProducts(organizationId: string, assistantId: string): Promise<boolean> {
    return (await this.productSearchReadiness(organizationId, assistantId)).eligible;
  }

  /** Current server-side readiness with a safe, specific blocker for the Playground Inspector. */
  async productSearchReadiness(organizationId: string, assistantId: string, filters: ProductSearchFilters = {}): Promise<{ eligible: boolean; reason: string | null; recordCount: number; connectionStatus?: 'CONNECTED' | 'NOT_CONNECTED'; scopeSnapshotStatus?: 'FRESH' | 'STALE' | 'UNAVAILABLE'; relevantGrantedScopes?: string[]; assistantEnabledOperations?: string[]; dataSource?: 'NORMALIZED_SNAPSHOT' }> {
    const supported = SHOPIFY_REGISTERED_OPERATIONS.some((operation) => operation.category === 'PRODUCTS' && operation.accessType === 'READ' && operation.executable && operation.assistantEligible);
    if (!supported) return { eligible: false, reason: 'PRODUCT_OPERATION_UNSUPPORTED', recordCount: 0 };
    await this.assertAssistant(organizationId, assistantId);
    const connectors = await this.db.connectorInstance.findMany({ where: { organizationId, connectorId: 'shopify_v1', state: 'CONNECTED', integrationConnectionId: { not: null }, commerceConnection: { is: { organizationId, state: { in: ACTIVE_CONNECTION_STATES } } } }, select: { id: true, verifiedCapabilities: true, lastVerifiedAt: true, commerceConnection: { select: { id: true, grantedScopes: true, grantedScopesVerifiedAt: true } } } });
    if (!connectors.length) return { eligible: false, reason: 'NO_CONNECTED_SHOPIFY_CONNECTION', recordCount: 0, connectionStatus: 'NOT_CONNECTED' as const, scopeSnapshotStatus: 'UNAVAILABLE' as const, relevantGrantedScopes: [] as string[], assistantEnabledOperations: [] as string[], dataSource: 'NORMALIZED_SNAPSHOT' as const };
    const connectorIds = connectors.map((row: any) => row.id);
    const [workspaceRows, assistantRows] = await Promise.all([
      this.db.connectorDataPermission.findMany({ where: { organizationId, connectorInstanceId: { in: connectorIds }, category: { in: ['PRODUCTS', 'PRICES', 'INVENTORY', 'CATEGORIES'] }, enabled: true }, select: { connectorInstanceId: true, category: true } }),
      this.db.assistantConnectorDataPermission.findMany({ where: { organizationId, assistantId, connectorInstanceId: { in: connectorIds }, category: { in: ['PRODUCTS', 'PRICES', 'INVENTORY', 'CATEGORIES'] }, enabled: true }, select: { connectorInstanceId: true, category: true } }),
    ]);
    const workspaceEnabled = new Set(workspaceRows.map((row: any) => `${row.connectorInstanceId}:${row.category}`));
    const assistantEnabled = new Set(assistantRows.map((row: any) => `${row.connectorInstanceId}:${row.category}`));
    const relevantGrantedScopes = [...new Set<string>(connectors.flatMap((row: any) => row.commerceConnection?.grantedScopes ?? []).filter((scope: unknown): scope is string => typeof scope === 'string' && ['read_products', 'read_inventory'].includes(scope)))].sort();
    const assistantEnabledOperations = [...new Set<string>(assistantRows.map((row: any) => row.category).filter((category: unknown): category is string => typeof category === 'string' && ['PRODUCTS', 'PRICES', 'INVENTORY', 'CATEGORIES'].includes(category)))].sort();
    const scopeSnapshotStatus = connectors.some((row: any) => isShopifyScopeSnapshotFresh(row.commerceConnection?.grantedScopesVerifiedAt ?? row.lastVerifiedAt)) ? 'FRESH' as const : 'STALE' as const;
    const readinessMetadata = { connectionStatus: 'CONNECTED' as const, scopeSnapshotStatus, relevantGrantedScopes, assistantEnabledOperations, dataSource: 'NORMALIZED_SNAPSHOT' as const };
    const connectionIds: string[] = [];
    const blockers = new Set<string>();
    for (const row of connectors) {
      if (!workspaceEnabled.has(`${row.id}:PRODUCTS`)) { blockers.add('WORKSPACE_PERMISSION_DISABLED'); continue; }
      if (!isShopifyScopeSnapshotFresh(row.commerceConnection?.grantedScopesVerifiedAt ?? row.lastVerifiedAt)) { blockers.add('SHOPIFY_SCOPE_SNAPSHOT_STALE'); continue; }
      if (!shopifyScopeAllows(row.commerceConnection?.grantedScopes ?? [], 'PRODUCTS')) { blockers.add('SHOPIFY_READ_PRODUCTS_NOT_GRANTED'); continue; }
      if (!Array.isArray(row.verifiedCapabilities) || !row.verifiedCapabilities.includes('PRODUCT_CATALOG')) { blockers.add('PRODUCT_CATALOG_CAPABILITY_UNVERIFIED'); continue; }
      if (!assistantEnabled.has(`${row.id}:PRODUCTS`)) { blockers.add('ASSISTANT_PERMISSION_DISABLED'); continue; }
      if (filters.maxPrice !== undefined && filters.currency === 'INR') {
        if (!workspaceEnabled.has(`${row.id}:PRICES`)) { blockers.add('PRICE_WORKSPACE_PERMISSION_DISABLED'); continue; }
        if (!assistantEnabled.has(`${row.id}:PRICES`)) { blockers.add('PRICE_ASSISTANT_PERMISSION_DISABLED'); continue; }
        if (!row.verifiedCapabilities.includes('PRODUCT_PRICES')) { blockers.add('PRICE_CAPABILITY_UNVERIFIED'); continue; }
      }
      connectionIds.push(row.commerceConnection.id);
    }
    if (!connectionIds.length) {
      const order = ['SHOPIFY_SCOPE_SNAPSHOT_STALE', 'SHOPIFY_READ_PRODUCTS_NOT_GRANTED', 'PRODUCT_CATALOG_CAPABILITY_UNVERIFIED', 'WORKSPACE_PERMISSION_DISABLED', 'ASSISTANT_PERMISSION_DISABLED', 'PRICE_WORKSPACE_PERMISSION_DISABLED', 'PRICE_ASSISTANT_PERMISSION_DISABLED', 'PRICE_CAPABILITY_UNVERIFIED'];
      return { eligible: false, reason: order.find((reason) => blockers.has(reason)) ?? 'PRODUCT_PERMISSION_UNAVAILABLE', recordCount: 0, ...readinessMetadata };
    }
    const recordCount = typeof this.db.commerceProduct.count === 'function' ? await this.db.commerceProduct.count({ where: { organizationId, connectionId: { in: connectionIds }, OR: [{ rawStatus: null }, { rawStatus: { not: 'DELETED' } }], connection: { is: { organizationId, state: { in: ACTIVE_CONNECTION_STATES } } } } }) : 0;
    return recordCount > 0 ? { eligible: true, reason: null, recordCount, ...readinessMetadata } : { eligible: false, reason: 'NO_QUERY_READY_PRODUCTS', recordCount: 0, ...readinessMetadata };
  }

  async searchProducts(organizationId: string, assistantId: string, query: string, limit = 10) {
    const rows = await this.searchCatalog(organizationId, assistantId, [query], limit, false, parseProductSearchFilters(query));
    return rows.map(({ id: _id, connectionId: _connectionId, stale: _stale, variants, ...product }) => ({ ...product, variants }));
  }

  /** Bounded candidate search; token matching covers names, categories, descriptions, SKUs and variants. */
  async searchCatalog(organizationId: string, assistantId: string, queries: readonly string[], limit = 3, browseAll = false, filters: ProductSearchFilters = {}): Promise<CommerceProductEvidence[]> {
    await this.assertAssistant(organizationId, assistantId);
    const access = await this.effectiveCommerceAccess(organizationId, assistantId);
    if (!access.size) return [];
    if (filters.maxPrice !== undefined && filters.currency !== 'INR') return [];
    // Browsing is an explicit bounded operation selected by the model or the
    // server's validated semantic plan. Query wording itself never changes a
    // filtered product search into a full catalog browse.
    browseAll = browseAll && filters.maxPrice === undefined && filters.color === undefined && !queries.some(hasProductCatalogFilterSignal);
    const priceFilter = filters.maxPrice !== undefined;
    const searchableQueries = priceFilter ? queries.map((query) => query.normalize('NFKC')
      .replace(/(?:₹|\bINR\b|\bRs\.?\s*)\s*[\d,]+(?:\.\d{1,2})?/giu, ' ')
      .replace(/[\d,]+(?:\.\d{1,2})?/gu, (amount) => Number(amount.replaceAll(',', '')) === filters.maxPrice ? ' ' : amount)) : queries;
    const terms = browseAll ? [] : [...new Set(searchableQueries.slice(0, 8).flatMap((query) => query.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []))]
      .filter((term) => term.length > 1 && !PRODUCT_STOP_WORDS.has(term) && !(filters.maxPrice !== undefined && Number(term.replaceAll(',', '')) === filters.maxPrice)).slice(0, 24);
    if (!terms.length && !browseAll && !priceFilter && !filters.color) return [];
    const categoryConnectionIds = [...access.entries()].filter(([, permission]) => permission.categories).map(([id]) => id);
    if (priceFilter && ![...access.values()].some((permission) => permission.prices)) return [];
    const color = filters.color;
    const matchingColorVariant = (term: string) => ({ variants: { some: { OR: [
      { title: { contains: term, mode: 'insensitive' } },
      { selectedOptions: { array_contains: [{ value: term }] } },
      { selectedOptions: { array_contains: [{ value: `${term[0]?.toLocaleUpperCase() ?? ''}${term.slice(1)}` }] } },
    ] } } });
    const matchingPriceVariant = { currency: filters.currency, price: { lte: filters.maxPrice } };
    const variantConstraints = [
      ...(priceFilter ? [matchingPriceVariant] : []),
      ...(color ? [{ OR: [{ title: { contains: color, mode: 'insensitive' } }, { selectedOptions: { array_contains: [{ value: color }] } }, { selectedOptions: { array_contains: [{ value: `${color[0]?.toLocaleUpperCase() ?? ''}${color.slice(1)}` }] } }] }] : []),
    ];
    const structuredConstraints = color && priceFilter
      ? [{ variants: { some: { AND: variantConstraints } } }]
      : color
        ? [{ OR: [{ name: { contains: color, mode: 'insensitive' } }, { description: { contains: color, mode: 'insensitive' } }, matchingColorVariant(color)] }]
        : priceFilter
          ? [{ OR: [{ currency: filters.currency, price: { lte: filters.maxPrice } }, { variants: { some: matchingPriceVariant } }] }]
          : [];
    const candidates = await this.db.commerceProduct.findMany({
      where: {
        organizationId,
        connectionId: { in: [...access.keys()] },
        connection: { is: { organizationId, state: { in: ACTIVE_CONNECTION_STATES } } },
        AND: [{ OR: [{ rawStatus: null }, { rawStatus: { not: 'DELETED' } }] }, ...structuredConstraints, ...(terms.length ? [{ OR: terms.flatMap((term) => [
          { name: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } },
          { sku: { contains: term, mode: 'insensitive' } },
          ...(categoryConnectionIds.length ? [{ connectionId: { in: categoryConnectionIds }, OR: [{ category: { contains: term, mode: 'insensitive' } }, { productType: { contains: term, mode: 'insensitive' } }, { taxonomyCategory: { contains: term, mode: 'insensitive' } }, { collectionSearchTerms: { has: term } }] }] : []),
          { variants: { some: { OR: [{ title: { contains: term, mode: 'insensitive' } }, { sku: { contains: term, mode: 'insensitive' } }, { selectedOptions: { array_contains: [{ value: term }] } }, { selectedOptions: { array_contains: [{ value: `${term[0]?.toLocaleUpperCase() ?? ''}${term.slice(1)}` }] } }] } } },
        ]) }] : [])],
      },
      orderBy: [{ syncedAt: 'desc' }, { name: 'asc' }, { id: 'asc' }], take: 60,
      select: { id: true, connectionId: true, externalId: true, name: true, description: true, category: true, productType: true, taxonomyCategoryId: true, taxonomyCategory: true, collections: true, collectionSearchTerms: true, vendor: true, handle: true, compareAtPrice: true, imageUrl: true, imageAltText: true, imageWidth: true, imageHeight: true, imageEvidence: true, sku: true, currency: true, price: true, inventory: true, availabilityStatus: true, rawStatus: true, productUrl: true, externalUpdatedAt: true, syncedAt: true, variants: { orderBy: [{ title: 'asc' }, { id: 'asc' }], take: priceFilter ? 1000 : 20, select: { title: true, sku: true, currency: true, price: true, compareAtPrice: true, selectedOptions: true, inventory: true, availabilityStatus: true, rawStatus: true } } },
    });
    const products = this.rankAndFormat(candidates, terms, limit, access, priceFilter || filters.color ? filters : undefined);
    this.logger.debug(JSON.stringify({ event: 'commerce_product_retrieval', organizationId, assistantId, eligibleConnectionCount: access.size, catalogBrowseMode: browseAll, searchTermCount: terms.length, candidateProductCount: candidates.length, productEvidenceCount: products.length, staleEvidenceCount: products.filter((product) => product.stale).length, filteringOutcome: products.length ? 'PRODUCT_EVIDENCE_SELECTED' : candidates.length ? 'NO_QUERY_MATCH' : 'NO_QUERY_READY_PRODUCT_ROWS' }));
    return products;
  }

  async getProductDetails(organizationId: string, assistantId: string, externalId: string) {
    await this.assertAssistant(organizationId, assistantId);
    const access = await this.effectiveCommerceAccess(organizationId, assistantId);
    if (!access.size) return null;
    const row = await this.db.commerceProduct.findFirst({
      where: { organizationId, externalId, connectionId: { in: [...access.keys()] }, OR: [{ rawStatus: null }, { rawStatus: { not: 'DELETED' } }], connection: { is: { organizationId, state: { in: ACTIVE_CONNECTION_STATES } } } },
      select: { id: true, connectionId: true, externalId: true, name: true, description: true, category: true, productType: true, taxonomyCategoryId: true, taxonomyCategory: true, collections: true, collectionSearchTerms: true, vendor: true, handle: true, compareAtPrice: true, imageUrl: true, imageAltText: true, imageWidth: true, imageHeight: true, imageEvidence: true, sku: true, currency: true, price: true, inventory: true, availabilityStatus: true, rawStatus: true, productUrl: true, externalUpdatedAt: true, syncedAt: true, variants: { orderBy: [{ title: 'asc' }, { id: 'asc' }], take: 20, select: { title: true, sku: true, currency: true, price: true, compareAtPrice: true, selectedOptions: true, inventory: true, availabilityStatus: true, rawStatus: true } } },
    });
    return row ? this.rankAndFormat([row], [], 1, access)[0] ?? null : null;
  }

  /** Rechecks tenant, assistant, connection state and current catalog hash before a commerce citation is persisted or replayed. */
  async revalidateProducts(organizationId: string, assistantId: string, identities: readonly { id: string; connectionId: string; contentHash: string; sourceVersion: number }[]): Promise<CommerceProductEvidence[]> {
    if (!identities.length) return [];
    await this.assertAssistant(organizationId, assistantId);
    const access = await this.effectiveCommerceAccess(organizationId, assistantId);
    if (!access.size) return [];
    const rows = await this.db.commerceProduct.findMany({
      where: { organizationId, id: { in: identities.map((item) => item.id) }, connectionId: { in: [...access.keys()] }, OR: [{ rawStatus: null }, { rawStatus: { not: 'DELETED' } }], connection: { is: { organizationId, state: { in: ACTIVE_CONNECTION_STATES } } } },
      select: { id: true, connectionId: true, externalId: true, name: true, description: true, category: true, productType: true, taxonomyCategoryId: true, taxonomyCategory: true, collections: true, collectionSearchTerms: true, vendor: true, handle: true, compareAtPrice: true, imageUrl: true, imageAltText: true, imageWidth: true, imageHeight: true, imageEvidence: true, sku: true, currency: true, price: true, inventory: true, availabilityStatus: true, rawStatus: true, productUrl: true, externalUpdatedAt: true, syncedAt: true, variants: { orderBy: [{ title: 'asc' }, { id: 'asc' }], take: 20, select: { title: true, sku: true, currency: true, price: true, compareAtPrice: true, selectedOptions: true, inventory: true, availabilityStatus: true, rawStatus: true } } },
    });
    const byId = new Map(rows.map((row: any) => [row.id, row]));
    const current = this.rankAndFormat(rows, [], rows.length, access);
    const formatted = new Map(current.map((product) => [product.id, product]));
    return identities.flatMap((identity) => {
      const row = byId.get(identity.id) as any;
      const product = formatted.get(identity.id);
      return row && product && row.connectionId === identity.connectionId && product.contentHash === identity.contentHash
        && row.syncedAt.getTime() === identity.sourceVersion ? [product] : [];
    });
  }

  /** Customer order access intentionally has no public-customer principal until verified ownership exists. */
  async getAuthorizedOrder(input: { organizationId: string; assistantId: string; orderReference: string; principal: { type: 'WORKSPACE_OPERATOR'; userId: string; workspaceSlug: string } | { type: 'CUSTOMER'; verifiedCustomerReference: string } }) {
    await this.assertAssistant(input.organizationId, input.assistantId);
    if (input.principal.type !== 'WORKSPACE_OPERATOR') throw new NotFoundException('Order not found');
    const access = await this.workspaces.requireAccess(input.principal.userId, input.principal.workspaceSlug, ['OWNER', 'ADMIN']);
    if (access.organizationId !== input.organizationId) throw new NotFoundException('Order not found');
    const allowed = await this.effectiveConnections(input.organizationId, input.assistantId, 'ORDERS');
    if (!allowed.length) return null;
    return this.db.commerceOrder.findFirst({
      where: { organizationId: input.organizationId, connectionId: { in: allowed }, OR: [{ externalId: input.orderReference }, { displayReference: input.orderReference }], connection: { is: { organizationId: input.organizationId, state: { in: ACTIVE_CONNECTION_STATES } } } },
      select: { externalId: true, displayReference: true, financialStatus: true, fulfillmentStatus: true, currency: true, subtotal: true, discountTotal: true, shippingTotal: true, taxTotal: true, total: true, refundedTotal: true, orderedAt: true, externalUpdatedAt: true, rawStatus: true, syncedAt: true, lines: { orderBy: [{ id: 'asc' }], take: 1000, select: { externalId: true, productExternalId: true, name: true, sku: true, quantity: true, currency: true, unitPrice: true, total: true } } },
    });
  }

  private rankAndFormat(rows: any[], terms: string[], limit: number, access: Map<string, { prices: boolean; inventory: boolean; categories: boolean }>, filters?: ProductSearchFilters): CommerceProductEvidence[] {
    const now = Date.now();
    const ranked = rows.map((row) => {
      const permissions = access.get(row.connectionId) ?? { prices: false, inventory: false, categories: false };
      const text = `${row.name} ${row.description ?? ''} ${(permissions.categories ? `${row.category ?? ''} ${row.productType ?? ''} ${row.taxonomyCategory ?? ''} ${(row.collections ?? []).map((item:any) => item.title).join(' ')}` : '')} ${row.sku ?? ''} ${(row.variants ?? []).map((variant: any) => `${variant.title} ${variant.sku ?? ''} ${(variant.selectedOptions ?? []).map((option: any) => `${option.name} ${option.value}`).join(' ')}`).join(' ')}`.normalize('NFKC').toLocaleLowerCase();
      const score = terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
      const productText = `${row.name} ${row.description ?? ''}`.normalize('NFKC').toLocaleLowerCase();
      const productColorMatch = Boolean(filters?.color && productText.includes(filters.color));
      const hasColorOption = (row.variants ?? []).some((variant: any) => (variant.selectedOptions ?? []).some((option: any) => /colou?r/iu.test(String(option.name ?? ''))));
      const matchingVariants = (row.variants ?? []).filter((variant: any) => {
        const variantText = `${variant.title} ${(variant.selectedOptions ?? []).map((option: any) => `${option.name} ${option.value}`).join(' ')}`.normalize('NFKC').toLocaleLowerCase();
        const colorMatches = !filters?.color || variantText.includes(filters.color) || (productColorMatch && !hasColorOption);
        const priceMatches = filters?.maxPrice === undefined || (permissions.prices && variant.currency === filters.currency && variant.price != null && Number(variant.price) <= filters.maxPrice);
        return colorMatches && priceMatches;
      });
      const variants = matchingVariants.map((variant: any) => ({ title: variant.title, sku: variant.sku, selectedOptions: variant.selectedOptions ?? [], currency: permissions.prices ? variant.currency : null, price: permissions.prices ? asText(variant.price) : null, compareAtPrice: permissions.prices ? asText(variant.compareAtPrice) : null, inventory: permissions.inventory ? variant.inventory : null, availabilityStatus: permissions.inventory ? variant.availabilityStatus : null, rawStatus: variant.rawStatus })).slice(0, 5);
      const productPriceMatch = filters?.maxPrice !== undefined && permissions.prices && row.currency === filters.currency && row.price != null && Number(row.price) <= filters.maxPrice;
      if (filters?.color && (hasColorOption ? !matchingVariants.length : !productColorMatch && !matchingVariants.length)) return { score: 0, product: null };
      if (filters?.maxPrice !== undefined && !variants.length && !productPriceMatch) return { score: 0, product: null };
      const syncedAt = asIso(row.syncedAt) ?? new Date(0).toISOString();
      const filteredPrice = filters?.maxPrice !== undefined ? matchingVariants.reduce((lowest: any, variant: any) => lowest === null || Number(variant.price) < Number(lowest) ? variant.price : lowest, productPriceMatch ? row.price : null) : row.price;
      const data = { id: row.id, connectionId: row.connectionId, externalId: row.externalId, name: row.name, description: row.description, category: permissions.categories ? row.category : null, productType: permissions.categories ? row.productType : null, taxonomyCategoryId: permissions.categories ? row.taxonomyCategoryId : null, taxonomyCategory: permissions.categories ? row.taxonomyCategory : null, collections: permissions.categories ? (row.collections ?? []).slice(0,50) : [], vendor: permissions.categories ? row.vendor : null, handle: row.handle, imageUrl: safeHttpsUrl(row.imageUrl), imageAltText: row.imageAltText, imageWidth: row.imageWidth, imageHeight: row.imageHeight, imageEvidence: (row.imageEvidence ?? []).slice(0,20).flatMap((image:any) => { const url = safeHttpsUrl(image?.url); return url ? [{ url, altText: typeof image.altText === 'string' ? image.altText.slice(0,500) : null, width: Number.isInteger(image.width) ? image.width : null, height: Number.isInteger(image.height) ? image.height : null }] : []; }), sku: row.sku, currency: permissions.prices ? (filters?.currency ?? row.currency) : null, price: permissions.prices ? asText(filteredPrice) : null, compareAtPrice: permissions.prices && filters?.maxPrice === undefined ? asText(row.compareAtPrice) : null, inventory: permissions.inventory ? row.inventory : null, availabilityStatus: permissions.inventory ? row.availabilityStatus : null, rawStatus: row.rawStatus, productUrl: safeHttpsUrl(row.productUrl), syncedAt, externalUpdatedAt: asIso(row.externalUpdatedAt), stale: now - new Date(syncedAt).getTime() > SOURCE_STALE_AFTER_MS, variants };
      return { score, product: { ...data, retrievalScore: score, retrievalReason: terms.length ? 'keyword_match' as const : 'catalog_browse' as const, dataCompleteness: 'UNKNOWN' as const, contentHash: hash(data) } };
    }).flatMap((row) => row.product !== null && (terms.length === 0 || row.score > 0) ? [row] : []).sort((a, b) => b.score - a.score || a.product.syncedAt.localeCompare(b.product.syncedAt) * -1 || a.product.name.localeCompare(b.product.name));
    return ranked.slice(0, Math.min(Math.max(limit, 1), 5)).map((row) => row.product);
  }

  private async effectiveCommerceAccess(organizationId: string, assistantId: string) {
    const connectorRows = await this.db.connectorInstance.findMany({ where: { organizationId, connectorId: 'shopify_v1', state: 'CONNECTED', integrationConnectionId: { not: null }, commerceConnection: { is: { organizationId, state: { in: ACTIVE_CONNECTION_STATES } } } }, select: { id: true, connectorId: true, verifiedCapabilities: true, lastVerifiedAt: true, commerceConnection: { select: { id: true, grantedScopes: true, grantedScopesVerifiedAt: true } } } });
    const ids = connectorRows.map((row: any) => row.id);
    if (!ids.length) {
      this.logger.debug(JSON.stringify({ event: 'commerce_product_access_evaluated', organizationId, assistantId, connectedConnectionCount: 0, eligibleConnectionCount: 0, permissionDeniedCount: 0, staleGrantCount: 0, missingGrantCount: 0, missingCapabilityCount: 0 }));
      return new Map<string, { prices: boolean; inventory: boolean; categories: boolean }>();
    }
    const [business, assistant] = await Promise.all([
      this.db.connectorDataPermission.findMany({ where: { organizationId, connectorInstanceId: { in: ids }, enabled: true }, select: { connectorInstanceId: true, category: true } }),
      this.db.assistantConnectorDataPermission.findMany({ where: { organizationId, assistantId, connectorInstanceId: { in: ids }, enabled: true }, select: { connectorInstanceId: true, category: true } }),
    ]);
    const businessSet = new Set(business.map((row: any) => `${row.connectorInstanceId}:${row.category}`));
    const assistantSet = new Set(assistant.map((row: any) => `${row.connectorInstanceId}:${row.category}`));
    const result = new Map<string, { prices: boolean; inventory: boolean; categories: boolean }>();
    let permissionDeniedCount = 0, staleGrantCount = 0, missingGrantCount = 0, missingCapabilityCount = 0;
    for (const row of connectorRows) {
      const caps: string[] = Array.isArray(row.verifiedCapabilities) ? row.verifiedCapabilities : [];
      const scopes: string[] = row.commerceConnection?.grantedScopes ?? [];
      const enabled = (category: string) => businessSet.has(`${row.id}:${category}`) && assistantSet.has(`${row.id}:${category}`);
      const scopesFresh = row.connectorId !== 'shopify_v1' || isShopifyScopeSnapshotFresh(row.commerceConnection?.grantedScopesVerifiedAt ?? row.lastVerifiedAt);
      const provider = (category: string) => row.connectorId === 'shopify_v1'
        ? scopesFresh && (category === 'ORDERS' ? shopifyScopeAllows(scopes, 'ORDERS') && caps.includes('ORDERS') : category === 'INVENTORY' ? shopifyScopeAllows(scopes, 'INVENTORY') && caps.includes('INVENTORY') : shopifyScopeAllows(scopes, 'PRODUCTS') && caps.includes(category === 'PRICES' ? 'PRODUCT_PRICES' : 'PRODUCT_CATALOG'))
        : category === 'ORDERS' ? caps.includes('ORDERS') : category === 'INVENTORY' ? caps.includes('INVENTORY') : caps.includes(category === 'PRICES' ? 'PRODUCT_PRICES' : 'PRODUCT_CATALOG');
      if (!enabled('PRODUCTS')) { permissionDeniedCount += 1; continue; }
      if (row.connectorId === 'shopify_v1' && !scopesFresh) { staleGrantCount += 1; continue; }
      if (row.connectorId === 'shopify_v1' && !shopifyScopeAllows(scopes, 'PRODUCTS')) { missingGrantCount += 1; continue; }
      if (!provider('PRODUCTS')) { missingCapabilityCount += 1; continue; }
      result.set(row.commerceConnection.id, { prices: enabled('PRICES') && provider('PRICES'), inventory: enabled('INVENTORY') && provider('INVENTORY'), categories: enabled('CATEGORIES') && provider('CATEGORIES') });
    }
    this.logger.debug(JSON.stringify({ event: 'commerce_product_access_evaluated', organizationId, assistantId, connectedConnectionCount: connectorRows.length, eligibleConnectionCount: result.size, permissionDeniedCount, staleGrantCount, missingGrantCount, missingCapabilityCount }));
    return result;
  }

  private async effectiveConnections(organizationId: string, assistantId: string, category: string) {
    const rows = await this.effectiveCommerceAccess(organizationId, assistantId);
    if (category === 'ORDERS') {
      const connectors = await this.db.connectorInstance.findMany({ where: { organizationId, state: 'CONNECTED', integrationConnectionId: { not: null }, commerceConnection: { is: { organizationId, state: { in: ACTIVE_CONNECTION_STATES } } } }, select: { id: true, lastVerifiedAt: true, commerceConnection: { select: { id: true, grantedScopesVerifiedAt: true } } } });
      const allowed = await Promise.all(connectors.map(async (connector: any) => {
        const [business, assistant] = await Promise.all([
          this.db.connectorDataPermission.findFirst({ where: { organizationId, connectorInstanceId: connector.id, category, enabled: true }, select: { id: true } }),
          this.db.assistantConnectorDataPermission.findFirst({ where: { organizationId, connectorInstanceId: connector.id, assistantId, category, enabled: true }, select: { id: true } }),
        ]);
        const full = await this.db.connectorInstance.findFirst({ where: { id: connector.id, organizationId }, select: { connectorId: true, verifiedCapabilities: true, lastVerifiedAt: true, commerceConnection: { select: { grantedScopes: true, grantedScopesVerifiedAt: true } } } });
        const caps: string[] = Array.isArray(full?.verifiedCapabilities) ? full.verifiedCapabilities : [], scopes: string[] = full?.commerceConnection?.grantedScopes ?? [];
        const provider = full?.connectorId === 'shopify_v1' ? isShopifyScopeSnapshotFresh(full.commerceConnection?.grantedScopesVerifiedAt ?? full.lastVerifiedAt) && shopifyScopeAllows(scopes, 'ORDERS') && caps.includes('ORDERS') : caps.includes('ORDERS');
        return business && assistant && provider ? connector.commerceConnection.id : null;
      }));
      return allowed.filter(Boolean);
    }
    return [...rows.keys()];
  }

  private async assertAssistant(organizationId: string, assistantId: string) {
    const row = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId, status: 'ACTIVE', archivedAt: null }, select: { id: true } });
    if (!row) throw new NotFoundException('Assistant not found');
  }
}
