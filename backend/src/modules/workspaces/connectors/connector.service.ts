import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { WorkspaceService } from '../workspace.service';
import { ConnectorCredentialVault } from './connector-credential-vault';
import { isShopifyScopeSnapshotFresh, shopifyScopeAllows, shopifyScopeAccessType, shopifyScopeClassification, SHOPIFY_SCOPE_OPERATION_REGISTRY, SHOPIFY_REGISTERED_OPERATIONS, SHOPIFY_CONTENT_SCOPE_REQUIREMENTS, shopifyContentCategoryAllowed, ShopifyGrantedScopeDiscoveryService, type ShopifyScopeDiscoveryResult } from './shopify-granted-scope-discovery.service';
import { ConnectorRegistry } from './connector.registry';
import { connectorSyncDebug } from './connector-sync-debug';
import type { ConnectorSyncMode, ConnectorWebhookInput } from './connector.contracts';
import { getShopifyConfiguredOAuthScopes, normalizeShopifyScopeInventory } from '../../../config/shopify-scope-inventory.config';
import { getShopifyScopeUpgradeScopes } from '../../../config/shopify-scope-upgrade.config';

const safeErrorCode = (error: unknown) => {
  const candidate = error instanceof Error ? error.message : '';
  return /^CONNECTOR_[A-Z0-9_]{1,80}$/.test(candidate) ? candidate : 'CONNECTOR_OPERATION_FAILED';
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const CONNECTOR_DATA_CATEGORIES = ['PRODUCTS', 'PRICES', 'INVENTORY', 'CATEGORIES', 'SERVICES', 'WEBSITE_PAGES', 'FAQ_POLICIES', 'ORDERS', 'CUSTOMER_PII', 'SHOPIFY_LOCATIONS', 'SHOPIFY_SHIPPING', 'SHOPIFY_LEGAL_POLICIES', 'SHOPIFY_ONLINE_STORE_PAGES', 'SHOPIFY_MARKETS', 'SHOPIFY_DISCOUNTS', 'SHOPIFY_METAOBJECT_DEFINITIONS', 'SHOPIFY_METAOBJECTS'] as const;
type ConnectorDataCategory = typeof CONNECTOR_DATA_CATEGORIES[number];
type ShopifyContentCategory = keyof typeof SHOPIFY_CONTENT_SCOPE_REQUIREMENTS;
const isShopifyContentCategory = (category: string): category is ShopifyContentCategory => Object.prototype.hasOwnProperty.call(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS, category);
const CONNECTOR_VERIFICATION_STALE_AFTER_MS = 120_000;

@Injectable()
export class ConnectorService {
  private readonly db: any;
  private readonly logger = new Logger(ConnectorService.name);
  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService, private readonly registry: ConnectorRegistry, private readonly vault: ConnectorCredentialVault, private readonly scopeDiscovery: ShopifyGrantedScopeDiscoveryService) { this.db = prisma; }

  async catalog(userId: string, slug: string) { await this.workspaces.requireAccess(userId, slug); return { items: this.registry.catalog(), capabilities: await this.capabilities(userId, slug) }; }
  async list(userId: string, slug: string) {
    const { organizationId } = await this.workspaces.requireAccess(userId, slug);
    const items = await this.db.connectorInstance.findMany({ where: { organizationId }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 100, select: { id: true, connectorId: true, connectorType: true, connectorVersion: true, displayName: true, configuration: true, state: true, verifiedCapabilities: true, webhookPublicId: true, integrationConnectionId: true, lastVerifiedAt: true, lastErrorCode: true, createdAt: true, updatedAt: true, credential: { select: { id: true } }, commerceConnection: { select: { lastSyncAt: true, lastSuccessfulSyncAt: true } } } });
    const ids = items.map((item: any) => item.id);
    const [schedules, jobs] = await Promise.all([
      ids.length && typeof this.db.connectorSyncSchedule?.findMany === 'function' ? this.db.connectorSyncSchedule.findMany({ where: { organizationId, connectorInstanceId: { in: ids } }, select: { connectorInstanceId: true, resourceType: true, mode: true, enabled: true, paused: true, intervalMinutes: true, nextRunAt: true, lastRunAt: true } }) : [],
      ids.length && typeof this.db.connectorSyncJob?.findMany === 'function' ? this.db.connectorSyncJob.findMany({ where: { organizationId, connectorInstanceId: { in: ids } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: ids.length * 4, select: { connectorInstanceId: true, resourceType: true, state: true, itemCount: true, lastErrorCode: true, scheduledAt: true, startedAt: true, finishedAt: true, createdAt: true } }) : [],
    ]);
    const schedulesByConnector = new Map<string, any[]>();
    for (const schedule of schedules) schedulesByConnector.set(schedule.connectorInstanceId, [...(schedulesByConnector.get(schedule.connectorInstanceId) ?? []), schedule]);
    const latestJobByConnector = new Map<string, any>();
    for (const job of jobs) if (!latestJobByConnector.has(job.connectorInstanceId)) latestJobByConnector.set(job.connectorInstanceId, job);
    return { items: items.map(({ credential, commerceConnection, ...item }: any) => ({ ...item, lastSyncAt: commerceConnection?.lastSyncAt ?? null, lastSuccessfulSyncAt: commerceConnection?.lastSuccessfulSyncAt ?? null, syncSchedules: schedulesByConnector.get(item.id) ?? [], latestSyncJob: latestJobByConnector.get(item.id) ?? null, hasCredentials: Boolean(credential) })), pageSize: 100 };
  }
  async capabilities(userId: string, slug: string) {
    const { organizationId } = await this.workspaces.requireAccess(userId, slug);
    const instances = await this.db.connectorInstance.findMany({ where: { organizationId, state: 'CONNECTED' }, orderBy: [{ connectorId: 'asc' }, { id: 'asc' }], take: 100, select: { id: true, connectorId: true, displayName: true, state: true, verifiedCapabilities: true } });
    return this.registry.capabilitiesFor(instances);
  }

  async permissions(userId: string, slug: string, id: string, assistantId?: string) {
    const { organizationId } = await this.owner(userId, slug);
    if (assistantId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assistantId)) throw new BadRequestException('Assistant ID must be a UUID.');
    const connector = await this.db.connectorInstance.findFirst({ where: { id, organizationId }, include: { commerceConnection: { select: { id: true, state: true, grantedScopes: true, grantedScopeMetadata: true, grantedScopesVerifiedAt: true, lastSuccessfulSyncAt: true } }, shopifyOAuthStates: { orderBy: { createdAt: 'desc' }, take: 1, select: { requestedScopes: true, createdAt: true } }, dataPermissions: true, assistantDataPermissions: assistantId ? { where: { assistantId } } : true } });
    if (!connector) throw new NotFoundException({ code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found.' });
    if (assistantId) {
      const assistant = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId, archivedAt: null }, select: { id: true } });
      if (!assistant) throw new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Assistant not found in this workspace.' });
    }
    const grantedScopes: string[] = connector.commerceConnection?.grantedScopes ?? [];
    const caps: string[] = Array.isArray(connector.verifiedCapabilities) ? connector.verifiedCapabilities : [];
    const scopeSnapshotFresh = connector.connectorId !== 'shopify_v1' || isShopifyScopeSnapshotFresh(connector.commerceConnection?.grantedScopesVerifiedAt ?? connector.lastVerifiedAt);
    const businessRows = new Map<string, { ai: boolean; sync: boolean }>(connector.dataPermissions.map((row: any): [string, { ai: boolean; sync: boolean }] => [row.category, { ai: row.enabled, sync: row.syncEnabled }]));
    const assistantRows = new Map<string, boolean>(connector.assistantDataPermissions.map((row: any): [string, boolean] => [row.category, row.enabled]));
    const categories = CONNECTOR_DATA_CATEGORIES.map((category) => {
      const providerGranted = scopeSnapshotFresh && this.providerGranted(category, connector.connectorId, caps, grantedScopes);
      const businessEnabled = businessRows.get(category)?.ai === true;
      const syncEnabled = businessRows.get(category)?.sync === true;
      const assistantEnabled = assistantId ? assistantRows.get(category) === true : null;
      const contentRequirement = isShopifyContentCategory(category) ? SHOPIFY_CONTENT_SCOPE_REQUIREMENTS[category] : undefined;
      const assistantEligible = connector.connectorId !== 'shopify_v1' || !contentRequirement || contentRequirement.assistantEligible;
      const effective = connector.state === 'CONNECTED' && providerGranted && businessEnabled && assistantEligible && (assistantId ? assistantEnabled === true : true);
      const requiredScope = contentRequirement?.requiredScopes[0] ?? (category === 'INVENTORY' ? 'read_inventory' : ['PRODUCTS', 'PRICES', 'CATEGORIES'].includes(category) ? 'read_products' : category === 'ORDERS' ? 'read_orders' : null);
      // The backend's legacy authorization request is not authoritative metadata
      // about the live Dev Dashboard app version or merchant approval decision.
      // Only Shopify's verified grant snapshot can establish GRANTED.
      const requested = null;
      const providerStatus = connector.connectorId === 'shopify_v1' && !scopeSnapshotFresh && requiredScope ? 'STALE' : providerGranted ? 'GRANTED' : connector.connectorId === 'shopify_v1' && requiredScope ? 'UNKNOWN' : 'NOT_SUPPORTED';
      const reauthorizationRequired = connector.connectorId === 'shopify_v1' && requiredScope ? null : Boolean(requested && scopeSnapshotFresh && !providerGranted);
      return { category, providerStatus, providerDecision: providerStatus, businessStatus: businessEnabled ? 'ENABLED_IN_CARTEIO_AI' : 'DISABLED_IN_CARTEIO_AI', syncStatus: syncEnabled ? 'SYNC_ENABLED' : 'SYNC_DISABLED', assistantStatus: assistantId ? assistantEnabled && assistantEligible ? 'ENABLED_FOR_ASSISTANT' : 'DISABLED_FOR_ASSISTANT' : 'NOT_SELECTED', requested, providerGranted, businessEnabled, syncEnabled, assistantEnabled: assistantId ? assistantEligible && assistantEnabled === true : assistantEnabled, effective, reauthorizationRequired, scopeRefreshRequired: connector.connectorId === 'shopify_v1' && requiredScope !== null && !scopeSnapshotFresh };
    });
    const assistants = assistantId ? undefined : await this.db.chatbot.findMany({ where: { organizationId, archivedAt: null }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true, status: true } });
    const scopeMetadata: Array<{ handle: string; description: string | null }> = Array.isArray(connector.commerceConnection?.grantedScopeMetadata) ? connector.commerceConnection.grantedScopeMetadata : [];
    const descriptionByScope = new Map(scopeMetadata.filter((scope: any) => scope && typeof scope.handle === 'string').map((scope: any) => [scope.handle, typeof scope.description === 'string' ? scope.description : null]));
    const verifiedScopeHandles = [...new Set(grantedScopes.filter((scope) => typeof scope === 'string'))].sort();
    const verifiedScopeAt = connector.commerceConnection?.grantedScopesVerifiedAt ?? connector.lastVerifiedAt ?? null;
    const scopeInventory = normalizeShopifyScopeInventory();
    const configuredOAuthScopes = getShopifyConfiguredOAuthScopes(getShopifyScopeUpgradeScopes());
    const configuredOAuthScopeSet = new Set(configuredOAuthScopes.combined);
    const connectionId = connector.connectorId === 'shopify_v1' ? connector.integrationConnectionId : null;
    const countIfAvailable = async (model: any, where: Record<string, unknown>) => typeof model?.count === 'function' ? model.count({ where }) as Promise<number> : null;
    const contentCategories = Object.keys(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS).filter(isShopifyContentCategory);
    const contentCategoryIndexes = new Map<string, number>(contentCategories.map((category, index) => [category, index]));
    const dataCounts = connectionId ? await Promise.all([
      countIfAvailable(this.db.commerceProduct, { organizationId, connectionId, OR: [{ rawStatus: null }, { rawStatus: { not: 'DELETED' } }] }),
      countIfAvailable(this.db.commerceProduct, { organizationId, connectionId, price: { not: null }, OR: [{ rawStatus: null }, { rawStatus: { not: 'DELETED' } }] }),
      countIfAvailable(this.db.commerceProduct, { organizationId, connectionId, inventory: { not: null }, OR: [{ rawStatus: null }, { rawStatus: { not: 'DELETED' } }] }),
      countIfAvailable(this.db.commerceProduct, { organizationId, connectionId, OR: [{ category: { not: null } }, { productType: { not: null } }, { taxonomyCategory: { not: null } }], AND: [{ OR: [{ rawStatus: null }, { rawStatus: { not: 'DELETED' } }] }] }),
      countIfAvailable(this.db.commerceOrder, { organizationId, connectionId }),
      ...contentCategories.map((category) => countIfAvailable(this.db.knowledgeSource, { organizationId, connectorInstanceId: id, connectorDataCategory: category, deletedAt: null, status: 'REGISTERED', processingStatus: 'READY' })),
    ]) : [null, null, null, null, null];
    const [variantCount, latestSyncJob] = connectionId ? await Promise.all([
      this.db.commerceProductVariant.count({ where: { product: { organizationId, connectionId, OR: [{ rawStatus: null }, { rawStatus: { not: 'DELETED' } }] } } }),
      this.db.connectorSyncJob.findFirst({ where: { organizationId, connectorInstanceId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, resourceType: true, mode: true, state: true, itemCount: true, attemptCount: true, lastErrorCode: true, scheduledAt: true, startedAt: true, finishedAt: true, createdAt: true } }),
    ]) : [0, null];
    const productCatalogProvider = connector.connectorId === 'shopify_v1'
      ? scopeSnapshotFresh && shopifyScopeAllows(grantedScopes, 'PRODUCTS') && caps.includes('PRODUCT_CATALOG')
      : caps.includes('PRODUCT_CATALOG');
    const commerceConnectionActive = ['CONNECTED', 'CONNECTED_WITH_WARNINGS', 'SYNCING'].includes(connector.commerceConnection?.state ?? '');
    const catalogVisible = connector.state === 'CONNECTED' && commerceConnectionActive && businessRows.get('PRODUCTS')?.ai === true && productCatalogProvider;
    const visibleProductCount = dataCounts[0] === null ? null : catalogVisible ? dataCounts[0] : 0;
    const dataCountFor = (category: string) => {
      if (category === 'PRODUCTS') return dataCounts[0] ?? null;
      if (category === 'PRICES') return dataCounts[1] ?? null;
      if (category === 'INVENTORY') return dataCounts[2] ?? null;
      if (category === 'CATEGORIES') return dataCounts[3] ?? null;
      if (category === 'ORDERS') return dataCounts[4] ?? null;
      const contentIndex = contentCategoryIndexes.get(category);
      return contentIndex === undefined ? null : dataCounts[5 + contentIndex] ?? null;
    };
    const buildShopifyOperation = (definition: any) => {
      const permission = categories.find((item) => item.category === definition.category);
      const providerGranted = Array.isArray(definition.requiredAnyScopes) ? definition.requiredAnyScopes.some((requiredScope: string) => grantedScopes.includes(requiredScope)) : definition.requiredScopes.every((requiredScope: string) => grantedScopes.includes(requiredScope));
      const providerCapabilityVerified = Boolean(permission?.providerGranted);
      const dataRecordCount = dataCountFor(definition.category);
      const dataStatus = !scopeSnapshotFresh || !providerGranted || !providerCapabilityVerified || dataRecordCount === null ? 'UNAVAILABLE' : dataRecordCount > 0 ? 'QUERY_READY' : 'NOT_SYNCED';
      const executable = definition.executable === true && definition.accessType === 'READ';
      const eligible = executable && definition.assistantEligible && connector.state === 'CONNECTED' && scopeSnapshotFresh && providerGranted && providerCapabilityVerified && dataStatus === 'QUERY_READY' && permission?.businessEnabled === true && permission?.assistantEnabled === true;
      const reason = !executable ? 'This operation is not an enabled read-only Carteio implementation.' : !scopeSnapshotFresh ? 'Granted scope snapshot is stale or unavailable.' : !definition.assistantEligible ? 'Restricted order data requires verified customer ownership, which is not available.' : connector.state !== 'CONNECTED' ? 'Shopify connection is not connected.' : !providerGranted ? 'A required Shopify scope has not been granted.' : !providerCapabilityVerified ? 'The granted API capability has not passed connector verification.' : dataStatus !== 'QUERY_READY' ? 'No synchronized data is currently query-ready for this operation.' : !permission?.businessEnabled ? 'Workspace AI permission is disabled.' : !permission?.assistantEnabled ? 'Assistant AI permission is disabled.' : null;
      return { category: definition.category, operation: definition.operation, resource: definition.resource, accessType: definition.accessType, dataClassification: definition.dataClassification, customerIdentityRequired: definition.customerIdentityRequired, explicitConfirmationRequired: definition.explicitConfirmationRequired, requiredScopes: [...(definition.requiredAnyScopes ?? definition.requiredScopes)], requiredScopeMode: definition.requiredAnyScopes ? 'ANY' : 'ALL', sensitivity: definition.sensitivity, supported: executable, executable, providerGranted, providerCapabilityVerified, dataRecordCount, dataStatus, workspaceAllowed: permission?.businessEnabled === true, workspaceSyncEnabled: permission?.syncEnabled === true, assistantPermissionGranted: permission?.assistantEnabled === true, assistantAllowed: executable && definition.assistantEligible && permission?.assistantEnabled === true, eligible, blockedReason: reason };
    };
    const shopifyOperations = connector.connectorId === 'shopify_v1' ? SHOPIFY_REGISTERED_OPERATIONS.map(buildShopifyOperation) : [];
    const shopifyScopeSnapshot = connector.connectorId === 'shopify_v1' ? {
      shopDomain: typeof connector.configuration?.shopDomain === 'string' ? connector.configuration.shopDomain : null,
      connectionState: connector.state,
      declaredScopesStatus: 'UNAVAILABLE',
      configurationSourceStatus: 'CARTEIO_OAUTH_INPUTS_NOT_SHOPIFY_DECLARATION',
      configuredOAuthScopes: configuredOAuthScopes.combined,
      scopeInventoryCount: scopeInventory.entries.length,
      scopeInventoryDuplicateCount: scopeInventory.duplicates.length,
      scopeInventoryMalformedCount: scopeInventory.malformed.length,
      scopeInventory: scopeInventory.entries.map((entry) => ({
        ...entry,
        configuredForOAuth: configuredOAuthScopeSet.has(entry.handle),
        grantedToStore: verifiedScopeHandles.includes(entry.handle),
        implementedInCarteio: Object.prototype.hasOwnProperty.call(SHOPIFY_SCOPE_OPERATION_REGISTRY, entry.handle),
      })),
      requestedScopesStatus: connector.shopifyOAuthStates?.length ? 'AVAILABLE' : 'UNAVAILABLE',
      requestedScopes: connector.shopifyOAuthStates?.[0]?.requestedScopes ?? [],
      requestedAt: connector.shopifyOAuthStates?.[0]?.createdAt ?? null,
      grantedScopeCount: verifiedScopeHandles.length,
      supportedOperationCount: shopifyOperations.filter((operation) => operation.executable && operation.supported).length,
      assistantEnabledCount: shopifyOperations.filter((operation) => operation.eligible).length,
      verifiedAt: verifiedScopeAt,
      capabilityVerifiedAt: connector.lastVerifiedAt ?? null,
      lastSuccessfulSyncAt: connector.commerceConnection?.lastSuccessfulSyncAt ?? null,
      freshness: !verifiedScopeAt ? 'UNAVAILABLE' : scopeSnapshotFresh ? 'FRESH' : 'STALE',
      operations: shopifyOperations,
      scopes: verifiedScopeHandles.map((handle) => {
        const description = descriptionByScope.get(handle) ?? null;
        const definitions = SHOPIFY_SCOPE_OPERATION_REGISTRY[handle as keyof typeof SHOPIFY_SCOPE_OPERATION_REGISTRY] ?? [];
        const operations = definitions.map(buildShopifyOperation);
        const dataClassification = shopifyScopeClassification(handle);
        return { handle, description, granted: true, accessType: shopifyScopeAccessType(handle), dataClassification, sensitivity: dataClassification === 'STANDARD' ? 'BUSINESS' : dataClassification === 'UNKNOWN' ? 'UNKNOWN' : 'RESTRICTED', supported: operations.some((operation: any) => operation.executable === true && operation.accessType === 'READ'), operations };
      }),
    } : undefined;
    const collectionRows = connectionId ? await this.db.$queryRaw`SELECT COUNT(DISTINCT collection->>'externalId')::int AS count FROM "CommerceProduct" AS p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.collections) = 'array' THEN p.collections ELSE '[]'::jsonb END) AS entries(collection) WHERE p."organizationId" = ${organizationId}::uuid AND p."connectionId" = ${connectionId}::uuid AND p."rawStatus" IS DISTINCT FROM 'DELETED'` : [{ count: 0 }];
    const collectionCount = Number(collectionRows[0]?.count ?? 0);
    return { connectorInstanceId: id, assistantId: assistantId ?? null, ...(shopifyScopeSnapshot ? { shopifyScopeSnapshot } : {}), categories, assistants, ...(connectionId ? { storedRecordCounts: { products: dataCounts[0] ?? 0, variants: variantCount, productsWithPrices: dataCounts[1] ?? 0, productsWithInventory: dataCounts[2] ?? 0, categorizedProducts: dataCounts[3] ?? 0, collections: collectionCount, orders: dataCounts[4] ?? 0, contentByCategory: Object.fromEntries(contentCategories.map((category, index) => [category, dataCounts[5 + index] ?? 0])) }, visibleProductCount, latestSyncJob } : {}) };
  }

  async refreshShopifyPermissions(userId: string, slug: string, id: string) {
    const { organizationId } = await this.owner(userId, slug);
    await this.rate(`connector-scope-refresh:${organizationId}:${id}:${userId}`, 6);
    const row = await this.db.connectorInstance.findFirst({ where: { id, organizationId }, include: { credential: true, commerceConnection: { select: { id: true, grantedScopes: true } } } });
    if (!row) throw new NotFoundException({ code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found.' });
    if (row.connectorId !== 'shopify_v1' || row.state !== 'CONNECTED' || !row.credential || !row.integrationConnectionId) throw new ConflictException({ code: 'SHOPIFY_SCOPE_REFRESH_UNAVAILABLE', message: 'Verify a connected Shopify installation before refreshing its permissions.' });
    const configuration = object(row.configuration);
    const credentials = this.vault.decrypt(row.credential, this.aad(organizationId, id, row.connectorId));
    let snapshot: ShopifyScopeDiscoveryResult;
    try { snapshot = await this.scopeDiscovery.discover({ organizationId, connectorInstanceId: id, shopDomain: String(configuration.shopDomain ?? ''), accessToken: String(credentials.accessToken ?? '') }); }
    catch { throw new BadGatewayException({ code: 'SHOPIFY_SCOPE_REFRESH_FAILED', message: 'Shopify permissions could not be refreshed. The saved snapshot was left unchanged.' }); }
    const nextScopes = snapshot.scopes.map((scope) => scope.handle);
    const previousScopes: string[] = row.commerceConnection?.grantedScopes ?? [];
    const revoked = previousScopes.filter((scope) => !nextScopes.includes(scope));
    const capabilities: string[] = Array.isArray(row.verifiedCapabilities) ? row.verifiedCapabilities : [];
    const contentCapabilityStillGranted = (category: keyof typeof SHOPIFY_CONTENT_SCOPE_REQUIREMENTS) => {
      const requirement = SHOPIFY_CONTENT_SCOPE_REQUIREMENTS[category];
      return requirement.anyScopes ? requirement.requiredScopes.some((scope) => nextScopes.includes(scope)) : requirement.requiredScopes.every((scope) => nextScopes.includes(scope));
    };
    const nextCapabilities = capabilities.filter((capability) => !(revoked.includes('read_products') && ['PRODUCT_CATALOG', 'PRODUCT_PRICES'].includes(capability)) && !(revoked.includes('read_inventory') && capability === 'INVENTORY') && !(revoked.includes('read_orders') && ['ORDERS', 'FULFILLMENT'].includes(capability)) && !Object.entries(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS).some(([category, requirement]) => requirement.capability === capability && !contentCapabilityStillGranted(category as keyof typeof SHOPIFY_CONTENT_SCOPE_REQUIREMENTS)));
    const verifiedAt = new Date();
    await this.db.$transaction(async (tx: any) => {
      const saved = await tx.integrationConnection.updateMany({ where: { id: row.integrationConnectionId, organizationId, platform: 'SHOPIFY' }, data: { externalAccountId: snapshot.shopId, grantedScopes: nextScopes, grantedScopeMetadata: snapshot.scopes, grantedScopesVerifiedAt: verifiedAt } });
      if (saved.count !== 1) throw new ConflictException({ code: 'SHOPIFY_SCOPE_REFRESH_SUPERSEDED', message: 'The Shopify connection changed during permission refresh.' });
      if (revoked.length) await tx.connectorInstance.updateMany({ where: { id, organizationId, state: 'CONNECTED' }, data: { verifiedCapabilities: nextCapabilities } });
      if (revoked.includes('read_products')) await tx.commerceProduct.deleteMany({ where: { organizationId, connectionId: row.integrationConnectionId } });
      if (revoked.includes('read_inventory')) await this.purgeDisabledCategory(tx, organizationId, row.integrationConnectionId, id, 'INVENTORY');
      if (revoked.includes('read_orders')) await tx.commerceOrder.deleteMany({ where: { organizationId, connectionId: row.integrationConnectionId } });
      for (const [category, requirement] of Object.entries(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS)) {
        if (requirement.requiredScopes.some((scope) => revoked.includes(scope)) && !contentCapabilityStillGranted(category as keyof typeof SHOPIFY_CONTENT_SCOPE_REQUIREMENTS)) await this.purgeDisabledCategory(tx, organizationId, row.integrationConnectionId, id, category as ConnectorDataCategory);
      }
      await this.audit(tx, organizationId, userId, 'connector.shopify_scopes_refreshed', id, { grantedScopeCount: nextScopes.length, revokedScopeCount: revoked.length });
    });
    return this.permissions(userId, slug, id);
  }

  async updatePermission(userId: string, slug: string, id: string, input: { category: ConnectorDataCategory; enabled: boolean; scope?: 'SYNC' | 'AI'; assistantId?: string }) {
    const { organizationId } = await this.owner(userId, slug);
    if (!CONNECTOR_DATA_CATEGORIES.includes(input.category)) throw new BadRequestException('Unknown connector data category.');
    if (input.category === 'CUSTOMER_PII' && input.enabled) throw new ForbiddenException({ code: 'CUSTOMER_PII_AI_ACCESS_UNAVAILABLE', message: 'Customer personal information is not available for AI access.' });
    const connector = await this.db.connectorInstance.findFirst({ where: { id, organizationId }, select: { id: true, connectorId: true, integrationConnectionId: true, state: true, verifiedCapabilities: true, lastVerifiedAt: true, commerceConnection: { select: { grantedScopes: true, grantedScopesVerifiedAt: true } } } });
    if (!connector) throw new NotFoundException({ code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found.' });
    if (input.assistantId && input.scope === 'SYNC') throw new BadRequestException('Synchronization permissions are configured at connector level.');
    if (input.assistantId && !await this.db.chatbot.findFirst({ where: { id: input.assistantId, organizationId, archivedAt: null }, select: { id: true } })) throw new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Assistant not found in this workspace.' });
    const scope = input.scope ?? 'AI';
    if (input.enabled && scope === 'AI') {
      if (connector.connectorId === 'shopify_v1' && !SHOPIFY_REGISTERED_OPERATIONS.some((operation: any) => operation.category === input.category && operation.executable === true && operation.accessType === 'READ')) throw new ForbiddenException({ code: 'SHOPIFY_OPERATION_NOT_IMPLEMENTED', message: 'This Shopify operation is not implemented for AI access.' });
      const operationDefinition = connector.connectorId === 'shopify_v1' ? SHOPIFY_REGISTERED_OPERATIONS.find((operation: any) => operation.category === input.category) : null;
      if (connector.connectorId === 'shopify_v1' && input.assistantId && operationDefinition && operationDefinition.assistantEligible !== true) throw new ForbiddenException({ code: 'SHOPIFY_AI_SENSITIVE_ACCESS_UNAVAILABLE', message: 'This Shopify data category remains restricted for assistant access.' });
      // Avoid calling permissions() here: it builds the entire Shopify operation
      // snapshot and runs catalog, variant, order, content, collection and job
      // counts. The update needs only the current verified provider grant and
      // workspace permission; the full snapshot is built once after commit.
      const grantedScopes: string[] = connector.commerceConnection?.grantedScopes ?? [];
      const capabilities: string[] = Array.isArray(connector.verifiedCapabilities) ? connector.verifiedCapabilities : [];
      const scopeSnapshotFresh = connector.connectorId !== 'shopify_v1' || isShopifyScopeSnapshotFresh(connector.commerceConnection?.grantedScopesVerifiedAt ?? connector.lastVerifiedAt);
      const providerGranted = scopeSnapshotFresh && this.providerGranted(input.category, connector.connectorId, capabilities, grantedScopes);
      const workspacePermission = input.assistantId
        ? await this.db.connectorDataPermission.findFirst({ where: { organizationId, connectorInstanceId: id, category: input.category }, select: { enabled: true } })
        : null;
      if (!providerGranted || (input.assistantId && !workspacePermission?.enabled)) throw new ForbiddenException({ code: 'CONNECTOR_AI_PERMISSION_UNAVAILABLE', message: 'This capability is not available under the current provider and workspace permissions.' });
    }
    await this.db.$transaction(async (tx: any) => {
      if (input.assistantId) {
        if (input.enabled) {
          const workspacePermission = await tx.connectorDataPermission.findFirst({ where: { organizationId, connectorInstanceId: id, category: input.category, enabled: true }, select: { id: true } });
          if (!workspacePermission) throw new ForbiddenException({ code: 'CONNECTOR_WORKSPACE_AI_PERMISSION_DISABLED', message: 'Enable this capability for the workspace before enabling it for an assistant.' });
        }
        await tx.assistantConnectorDataPermission.upsert({ where: { organizationId_connectorInstanceId_assistantId_category: { organizationId, connectorInstanceId: id, assistantId: input.assistantId, category: input.category } }, create: { organizationId, connectorInstanceId: id, assistantId: input.assistantId, category: input.category, enabled: input.enabled, updatedById: userId }, update: { enabled: input.enabled, updatedById: userId } });
      } else {
        await tx.connectorDataPermission.upsert({ where: { organizationId_connectorInstanceId_category: { organizationId, connectorInstanceId: id, category: input.category } }, create: { organizationId, connectorInstanceId: id, category: input.category, enabled: scope === 'AI' && input.enabled, syncEnabled: scope === 'SYNC' && input.enabled, updatedById: userId }, update: { ...(scope === 'AI' ? { enabled: input.enabled } : { syncEnabled: input.enabled }), updatedById: userId } });
        if (!input.enabled && connector.integrationConnectionId) {
          const currentPermission = await tx.connectorDataPermission.findFirst({ where: { organizationId, connectorInstanceId: id, category: input.category }, select: { enabled: true, syncEnabled: true } });
          if (currentPermission && !currentPermission.enabled && !currentPermission.syncEnabled) await this.purgeDisabledCategory(tx, organizationId, connector.integrationConnectionId, id, input.category);
        }
        if (scope === 'SYNC' && !input.enabled) await tx.connectorSyncJob.updateMany({ where: { organizationId, connectorInstanceId: id, state: { in: ['PENDING', 'RETRY_WAIT'] }, ...(input.category === 'ORDERS' ? { resourceType: 'ORDERS' } : input.category === 'WEBSITE_PAGES' || input.category === 'FAQ_POLICIES' || input.category in SHOPIFY_CONTENT_SCOPE_REQUIREMENTS ? { resourceType: 'CONTENT' } : { resourceType: 'PRODUCTS' }) }, data: { state: 'CANCELLED', finishedAt: new Date(), lastErrorCode: 'CONNECTOR_SYNC_PERMISSION_DISABLED' } });
      }
      await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action: input.enabled ? 'connector.data_permission_enabled' : 'connector.data_permission_disabled', entityType: 'connector_instance', entityId: id, metadata: { category: input.category, assistantId: input.assistantId ?? null, scope: input.assistantId ? 'ASSISTANT_AI' : scope, enabled: input.enabled } } });
    });
    return this.permissions(userId, slug, id, input.assistantId);
  }

  private providerGranted(category: ConnectorDataCategory, connectorId: string, capabilities: string[], scopes: string[]) {
    if (category === 'CUSTOMER_PII') return false;
    if (connectorId === 'shopify_v1') {
      if (category in SHOPIFY_CONTENT_SCOPE_REQUIREMENTS) return shopifyContentCategoryAllowed(category, scopes, capabilities);
      const providerCapability = category === 'ORDERS' ? 'ORDERS' : category === 'INVENTORY' ? 'INVENTORY' : category === 'PRICES' ? 'PRODUCT_PRICES' : category === 'PRODUCTS' || category === 'CATEGORIES' ? 'PRODUCT_CATALOG' : null;
      const scopeKey = category === 'ORDERS' ? 'ORDERS' : category === 'INVENTORY' ? 'INVENTORY' : category === 'PRODUCTS' || category === 'PRICES' || category === 'CATEGORIES' ? 'PRODUCTS' : null;
      return Boolean(providerCapability && scopeKey && shopifyScopeAllows(scopes, scopeKey) && capabilities.includes(providerCapability as any));
    }
    const capability = category in SHOPIFY_CONTENT_SCOPE_REQUIREMENTS ? SHOPIFY_CONTENT_SCOPE_REQUIREMENTS[category as keyof typeof SHOPIFY_CONTENT_SCOPE_REQUIREMENTS].capability : category === 'ORDERS' ? 'ORDERS' : category === 'INVENTORY' ? 'INVENTORY' : category === 'PRICES' ? 'PRODUCT_PRICES' : ['PRODUCTS', 'CATEGORIES'].includes(category) ? 'PRODUCT_CATALOG' : category === 'SERVICES' ? 'SERVICES' : ['WEBSITE_PAGES', 'FAQ_POLICIES'].includes(category) ? 'WEBSITE_CONTENT' : null;
    return capability ? capabilities.includes(capability) : false;
  }

  private async purgeDisabledCategory(tx: any, organizationId: string, connectionId: string, connectorInstanceId: string, category: ConnectorDataCategory) {
    if (category === 'PRODUCTS') await tx.commerceProduct.deleteMany({ where: { organizationId, connectionId } });
    if (category === 'ORDERS') await tx.commerceOrder.deleteMany({ where: { organizationId, connectionId } });
    if (category === 'PRICES') {
      await tx.commerceProduct.updateMany({ where: { organizationId, connectionId }, data: { price: null, compareAtPrice: null, currency: null } });
      await tx.commerceProductVariant.updateMany({ where: { product: { is: { organizationId, connectionId } } }, data: { price: null, compareAtPrice: null, currency: null } });
    }
    if (category === 'CATEGORIES') await tx.commerceProduct.updateMany({ where: { organizationId, connectionId }, data: { category: null, productType: null, taxonomyCategoryId: null, taxonomyCategory: null, collections: [], collectionSearchTerms: [] } });
    if (category === 'INVENTORY') {
      await tx.commerceProduct.updateMany({ where: { organizationId, connectionId }, data: { inventory: null, availabilityStatus: null } });
      await tx.commerceProductVariant.updateMany({ where: { product: { is: { organizationId, connectionId } } }, data: { inventory: null, availabilityStatus: null } });
    }
    if (category === 'WEBSITE_PAGES' || category === 'FAQ_POLICIES') {
      const now = new Date();
      const sources = await tx.knowledgeSource.findMany({ where: { organizationId, connectorInstanceId, connectorDataCategory: category, deletedAt: null }, select: { id: true } });
      const sourceIds = sources.map((source: any) => source.id);
      if (sourceIds.length) {
        await tx.knowledgeChunk.deleteMany({ where: { organizationId, sourceId: { in: sourceIds } } });
        await tx.knowledgeProcessingJob.updateMany({ where: { organizationId, sourceId: { in: sourceIds }, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', errorCode: 'CONNECTOR_DATA_PERMISSION_DISABLED', leaseOwner: null, leasedAt: null, heartbeatAt: null } });
        await tx.knowledgeSource.updateMany({ where: { organizationId, id: { in: sourceIds } }, data: { deletedAt: now, status: 'DISABLED', processingStatus: 'NOT_PROCESSED', activeIndexGeneration: null, contentBody: null, sourceUrl: null } });
      }
    }
    if (category in SHOPIFY_CONTENT_SCOPE_REQUIREMENTS) {
      const now = new Date();
      const sources = await tx.knowledgeSource.findMany({ where: { organizationId, connectorInstanceId, connectorDataCategory: category, deletedAt: null }, select: { id: true } });
      const sourceIds = sources.map((source: any) => source.id);
      if (sourceIds.length) {
        await tx.knowledgeChunk.deleteMany({ where: { organizationId, sourceId: { in: sourceIds } } });
        await tx.knowledgeProcessingJob.updateMany({ where: { organizationId, sourceId: { in: sourceIds }, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', errorCode: 'CONNECTOR_DATA_PERMISSION_DISABLED', leaseOwner: null, leasedAt: null, heartbeatAt: null } });
        await tx.knowledgeSource.updateMany({ where: { organizationId, id: { in: sourceIds } }, data: { deletedAt: now, status: 'DISABLED', processingStatus: 'NOT_PROCESSED', activeIndexGeneration: null, contentBody: null } });
      }
    }
  }

  async businessCategorySyncEnabled(organizationId: string, connectorInstanceId: string, categories: readonly ConnectorDataCategory[]): Promise<ConnectorDataCategory[]> {
    const rows = await this.db.connectorDataPermission.findMany({ where: { organizationId, connectorInstanceId, category: { in: [...categories] }, syncEnabled: true }, select: { category: true } });
    return rows.map((row: { category: ConnectorDataCategory }) => row.category);
  }

  async create(userId: string, slug: string, input: { connectorId: string; displayName: string; configuration: unknown; credentials?: unknown }) {
    const { organizationId } = await this.owner(userId, slug);
    await this.rate(`connector-create:${organizationId}:${userId}`, 20);
    const existingCount = await this.db.connectorInstance.count({ where: { organizationId } });
    if (existingCount >= 100) throw new ConflictException({ code: 'CONNECTOR_INSTANCE_LIMIT', message: 'This workspace has reached its connector limit.' });
    const { definition, config, credentials } = this.registry.validateConfiguration(input.connectorId, input.configuration, input.credentials);
    const name = input.displayName.trim();
    if (name.length < 2 || name.length > 160) throw new BadRequestException('Connector name must be 2–160 characters');
    const id = randomUUID();
    const encrypted = credentials ? this.vault.encrypt(credentials, this.aad(organizationId, id, definition.id)) : null;
    return this.db.$transaction(async (tx: any) => {
      const isCommerce = definition.syncResources.includes('PRODUCTS');
      const platform = definition.type === 'SHOPIFY' ? 'SHOPIFY' : definition.type === 'WOOCOMMERCE' ? 'WOOCOMMERCE' : definition.type === 'WORDPRESS' ? 'WORDPRESS' : 'CUSTOM_API';
      const siteUrl = definition.id === 'shopify_v1' ? `https://${String(config.shopDomain)}` : typeof config.baseUrl === 'string' ? config.baseUrl : String(config.storeUrl ?? '');
      const commerce = isCommerce ? await tx.integrationConnection.create({ data: { organizationId, platform, displayName: name, siteUrl, state: 'DRAFT' }, select: { id: true } }) : null;
      const row = await tx.connectorInstance.create({ data: { id, organizationId, connectorId: definition.id, connectorType: definition.type, connectorVersion: definition.version, displayName: name, configuration: config, state: 'DRAFT', webhookPublicId: definition.webhooks.supported ? randomBytes(24).toString('base64url') : null, ...(commerce ? { integrationConnectionId: commerce.id } : {}) }, select: this.safeSelect() });
      if (encrypted) await tx.connectorCredential.create({ data: { organizationId, connectorInstanceId: id, ...encrypted } });
      await this.audit(tx, organizationId, userId, 'connector.created', id, { connectorId: definition.id, version: definition.version, credentialsProvided: Boolean(encrypted) });
      return { ...row, hasCredentials: Boolean(encrypted) };
    });
  }

  async update(userId: string, slug: string, id: string, input: { displayName?: string; configuration?: unknown }) {
    const { organizationId } = await this.owner(userId, slug);
    const current = await this.instance(organizationId, id);
    const adapter = this.registry.adapter(current.connectorId);
    const config = input.configuration === undefined ? object(current.configuration) : this.registry.validateConfiguration(current.connectorId, input.configuration).config;
    const displayName = input.displayName === undefined ? current.displayName : input.displayName.trim();
    if (displayName.length < 2 || displayName.length > 160) throw new BadRequestException('Connector name must be 2–160 characters');
    const changed = JSON.stringify(config) !== JSON.stringify(current.configuration) || displayName !== current.displayName;
    const next = await this.db.$transaction(async (tx: any) => {
      if (changed) await tx.connectorSyncJob.updateMany({ where: { organizationId, connectorInstanceId: id, state: { in: ['PENDING', 'RETRY_WAIT', 'RUNNING'] } }, data: { state: 'CANCELLED', finishedAt: new Date(), leaseToken: null, leaseUntil: null } });
      if (changed && current.connectorId !== 'generic_https_health_v1') { const linked = await tx.connectorInstance.findFirst({ where: { id, organizationId }, select: { integrationConnectionId: true } }); if (linked?.integrationConnectionId) await tx.integrationConnection.updateMany({ where: { id: linked.integrationConnectionId, organizationId }, data: { state: 'DRAFT', grantedScopes: [], grantedScopeMetadata: [], grantedScopesVerifiedAt: null, lastErrorCode: null, ...(current.connectorId === 'shopify_v1' ? { siteUrl: `https://${String(config.shopDomain)}` } : typeof config.baseUrl === 'string' ? { siteUrl: config.baseUrl } : current.connectorId === 'woocommerce_v1' ? { siteUrl: String(config.storeUrl) } : {}) } }); }
      const row = await tx.connectorInstance.update({ where: { id_organizationId: { id: current.id, organizationId } }, data: { displayName, configuration: config, ...(changed ? { state: 'DRAFT', verifiedCapabilities: [], lastErrorCode: null } : {}) }, select: this.safeSelect() });
      await this.audit(tx, organizationId, userId, 'connector.configuration_updated', id, { connectorId: adapter.definition.id, configurationChanged: JSON.stringify(config) !== JSON.stringify(current.configuration), displayNameChanged: displayName !== current.displayName });
      return row;
    });
    return { ...next, hasCredentials: Boolean(await this.db.connectorCredential.findFirst({ where: { organizationId, connectorInstanceId: id }, select: { id: true } })) };
  }

  async replaceCredentials(userId: string, slug: string, id: string, credentialInput: unknown) {
    const { organizationId } = await this.owner(userId, slug);
    await this.rate(`connector-credential:${organizationId}:${userId}`, 20);
    const current = await this.instance(organizationId, id);
    const supplied = object(credentialInput);
    const existing = await this.db.connectorCredential.findFirst({ where: { organizationId, connectorInstanceId: id } });
    const previous = existing ? this.vault.decrypt(existing, this.aad(organizationId, id, current.connectorId)) : {};
    const { definition, credentials } = this.registry.validateConfiguration(current.connectorId, current.configuration, { ...previous, ...supplied });
    if (!credentials || !Object.keys(credentials).length) throw new BadRequestException('Provide the credentials required by this adapter');
    // Encryption is intentionally before the transaction: missing keys fail closed before any write.
    const encrypted = this.vault.encrypt(credentials, this.aad(organizationId, id, definition.id));
    await this.db.$transaction(async (tx: any) => {
      await tx.connectorCredential.upsert({ where: { connectorInstanceId: id }, create: { organizationId, connectorInstanceId: id, ...encrypted }, update: encrypted });
      await tx.connectorSyncJob.updateMany({ where: { organizationId, connectorInstanceId: id, state: { in: ['PENDING', 'RETRY_WAIT', 'RUNNING'] } }, data: { state: 'CANCELLED', finishedAt: new Date(), leaseToken: null, leaseUntil: null } });
      await tx.connectorInstance.update({ where: { id_organizationId: { id, organizationId } }, data: { state: 'DRAFT', verifiedCapabilities: [], lastErrorCode: null } });
      const linked = await tx.connectorInstance.findFirst({ where: { id, organizationId }, select: { integrationConnectionId: true } }); if (linked?.integrationConnectionId) await tx.integrationConnection.updateMany({ where: { id: linked.integrationConnectionId, organizationId }, data: { state: 'DRAFT', grantedScopes: [], grantedScopeMetadata: [], grantedScopesVerifiedAt: null, lastErrorCode: null } });
      await this.audit(tx, organizationId, userId, 'connector.credentials_replaced', id, { connectorId: definition.id, credentialFields: Object.keys(credentials).sort() });
    });
    return { id, hasCredentials: true, state: 'DRAFT' };
  }

  async verify(userId: string, slug: string, id: string) {
    const { organizationId } = await this.owner(userId, slug);
    await this.rate(`connector-verify:${organizationId}:${id}:${userId}`, 12);
    const row = await this.db.connectorInstance.findFirst({ where: { id, organizationId }, include: { credential: true } });
    if (!row) throw new NotFoundException({ code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found.' });
    if (!row.credential) throw new ConflictException({ code: 'CONNECTOR_CREDENTIALS_REQUIRED', message: 'Add credentials before verifying this connection.' });
    if (row.state === 'CONNECTING' && Date.now() - row.updatedAt.getTime() < CONNECTOR_VERIFICATION_STALE_AFTER_MS) {
      throw new ConflictException({ code: 'CONNECTOR_VERIFICATION_IN_PROGRESS', message: 'Shopify verification is still in progress. Refresh its status before retrying.' });
    }
    const adapter = this.registry.adapter(row.connectorId), configuration = object(row.configuration);
    const credentials = this.vault.decrypt(row.credential, this.aad(organizationId, row.id, row.connectorId));
    const requestId = randomUUID();
    const verificationStartedAt = Date.now();
    const verificationClaim = await this.db.$transaction(async (tx: any) => {
      await tx.connectorSyncJob.updateMany({ where: { organizationId, connectorInstanceId: id, state: { in: ['PENDING', 'RETRY_WAIT', 'RUNNING'] } }, data: { state: 'CANCELLED', finishedAt: new Date(), leaseToken: null, leaseUntil: null } });
      const claim = await tx.connectorInstance.updateMany({ where: { id, organizationId, updatedAt: row.updatedAt }, data: { state: 'CONNECTING', lastErrorCode: null } });
      if (claim.count !== 1) throw new ConflictException({ code: 'CONNECTOR_CONFIGURATION_CHANGED', message: 'Connector configuration changed before verification started. Reload and verify again.' });
      const claimed = await tx.connectorInstance.findFirst({ where: { id, organizationId }, select: { updatedAt: true } });
      await this.audit(tx, organizationId, userId, 'connector.verification_started', id, { connectorId: row.connectorId });
      return claimed.updatedAt as Date;
    });
    let verificationStage = 'shopify_verification';
    let databasePersistenceStartedAt: number | undefined;
    const persistenceOperationTimings: Array<{ operation: string; elapsedMs: number }> = [];
    try {
      await adapter.connect({ organizationId, connectorInstanceId: id, requestId }, configuration, credentials);
      const result = await adapter.verify({ organizationId, connectorInstanceId: id, requestId }, configuration, credentials);
      if (result.verified !== true || result.capabilities.some((capability) => !adapter.definition.capabilities.includes(capability))) throw new Error('CONNECTOR_VERIFICATION_INVALID');
      const verifiedCapabilities = [...new Set(result.capabilities)];
      const scopeVerifiedAt = new Date();
      verificationStage = 'final_database_persistence';
      const defaultCategories = CONNECTOR_DATA_CATEGORIES.filter((category) => ['PRODUCTS', 'PRICES', 'CATEGORIES'].includes(category) && verifiedCapabilities.includes('PRODUCT_CATALOG'));
      verificationStage = 'permission_snapshot_read';
      const defaultAssistants = defaultCategories.length ? await this.db.chatbot.findMany({ where: { organizationId, status: 'ACTIVE', archivedAt: null }, select: { id: true } }) : [];
      verificationStage = 'final_database_persistence';
      databasePersistenceStartedAt = Date.now();
      const persistOperation = async <T,>(operation: string, run: () => Promise<T>): Promise<T> => {
        const started = Date.now();
        try { return await run(); }
        finally { persistenceOperationTimings.push({ operation, elapsedMs: Math.max(0, Date.now() - started) }); }
      };
      await this.db.$transaction(async (tx: Prisma.TransactionClient) => {
        const changed = await persistOperation('connector_state_update', () => tx.connectorInstance.updateMany({ where: { id, organizationId, state: 'CONNECTING', updatedAt: verificationClaim }, data: { state: 'CONNECTED', verifiedCapabilities, lastVerifiedAt: scopeVerifiedAt, lastErrorCode: null, webhookPublicId: row.webhookPublicId ?? (adapter.definition.webhooks.supported ? randomBytes(24).toString('base64url') : null) } }));
        if (changed.count !== 1) throw new ConflictException({ code: 'CONNECTOR_VERIFICATION_SUPERSEDED', message: 'Connector configuration changed while verification was running. Verify again.' });
        if (row.integrationConnectionId) {
          const saved = await persistOperation('integration_connection_update', () => tx.integrationConnection.updateMany({ where: { id: row.integrationConnectionId, organizationId }, data: { state: 'CONNECTED', externalAccountId: result.externalAccountId ?? null, siteUrl: adapter.definition.id === 'shopify_v1' ? result.storefrontUrl ?? `https://${String(configuration.shopDomain)}` : typeof configuration.baseUrl === 'string' ? configuration.baseUrl : String(configuration.storeUrl), grantedScopes: result.grantedScopes ?? [], ...(row.connectorId === 'shopify_v1' ? { grantedScopeMetadata: result.grantedScopeMetadata ?? [], grantedScopesVerifiedAt: scopeVerifiedAt } : {}), lastErrorCode: null } }));
          if (saved.count !== 1) throw new ConflictException({ code: 'CONNECTOR_VERIFICATION_SUPERSEDED', message: 'The connected commerce record changed while verification was running. Verify again.' });
        }
        await persistOperation('connector_permission_snapshot', () => tx.connectorDataPermission.createMany({ data: CONNECTOR_DATA_CATEGORIES.map((category) => {
          const enabled = defaultCategories.includes(category);
          return { organizationId, connectorInstanceId: id, category, enabled, syncEnabled: enabled, updatedById: userId };
        }), skipDuplicates: true }));
        if (defaultCategories.length && defaultAssistants.length) await persistOperation('assistant_permission_snapshot', () => tx.assistantConnectorDataPermission.createMany({
          data: defaultAssistants.flatMap((assistant: { id: string }) => defaultCategories.map((category) => ({ organizationId, connectorInstanceId: id, assistantId: assistant.id, category, enabled: true, updatedById: userId }))),
          skipDuplicates: true,
        }));
        if (row.integrationConnectionId) {
          await persistOperation('unsupported_data_cleanup', async () => {
            if (!verifiedCapabilities.includes('PRODUCT_CATALOG')) await this.purgeDisabledCategory(tx, organizationId, row.integrationConnectionId, id, 'PRODUCTS');
            else if (!verifiedCapabilities.includes('PRODUCT_PRICES')) await this.purgeDisabledCategory(tx, organizationId, row.integrationConnectionId, id, 'PRICES');
            if (!verifiedCapabilities.includes('INVENTORY')) await this.purgeDisabledCategory(tx, organizationId, row.integrationConnectionId, id, 'INVENTORY');
            if (!verifiedCapabilities.includes('ORDERS')) await this.purgeDisabledCategory(tx, organizationId, row.integrationConnectionId, id, 'ORDERS');
            if (!verifiedCapabilities.includes('WEBSITE_CONTENT')) {
              await this.purgeDisabledCategory(tx, organizationId, row.integrationConnectionId, id, 'WEBSITE_PAGES');
              await this.purgeDisabledCategory(tx, organizationId, row.integrationConnectionId, id, 'FAQ_POLICIES');
            }
            for (const [category, requirement] of Object.entries(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS)) {
              if (!verifiedCapabilities.includes(requirement.capability)) await this.purgeDisabledCategory(tx, organizationId, row.integrationConnectionId, id, category as ConnectorDataCategory);
            }
          });
        }
        await persistOperation('verification_audit', () => this.audit(tx, organizationId, userId, 'connector.verified', id, { connectorId: row.connectorId, capabilities: verifiedCapabilities, grantedScopeCount: result.grantedScopes?.length ?? 0 }));
      }, { maxWait: 5_000, timeout: 10_000 });
      // Read the response after the atomic write. This avoids spending the
      // interactive transaction budget on a presentation-only read.
      const connected = await this.db.connectorInstance.findFirst({ where: { id, organizationId }, select: this.safeSelect() });
      if (!connected) throw new NotFoundException({ code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found after verification.' });
      return { ...connected, hasCredentials: true };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      const code = safeErrorCode(error);
      const cause = error && typeof error === 'object' ? error as { code?: unknown; constructor?: { name?: string } } : null;
      const causeCode = typeof cause?.code === 'string' && /^[A-Z0-9_-]{1,40}$/i.test(cause.code) ? cause.code : undefined;
      if (causeCode === 'P2028') {
        const details = error as { message?: unknown; meta?: unknown };
        const message = typeof details.message === 'string' ? details.message : '';
        const meta = details.meta && typeof details.meta === 'object' ? details.meta as Record<string, unknown> : {};
        const numberField = (key: string) => typeof meta[key] === 'number' && Number.isFinite(meta[key]) ? meta[key] as number : undefined;
        const transactionMessageClass = /timeout|expired/i.test(message) ? 'TRANSACTION_TIMEOUT' : /closed/i.test(message) ? 'TRANSACTION_CLOSED' : 'TRANSACTION_API_ERROR';
        const shopDomain = typeof configuration.shopDomain === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.myshopify\.com$/.test(configuration.shopDomain) ? configuration.shopDomain : undefined;
        this.logger.error(JSON.stringify({ event: 'connector_verification_diagnostic', requestId, operation: 'connector.verify', stage: verificationStage, ...(shopDomain ? { targetHost: shopDomain } : {}), elapsedMs: Math.max(0, Date.now() - verificationStartedAt), ...(databasePersistenceStartedAt ? { persistenceElapsedMs: Date.now() - databasePersistenceStartedAt } : {}), persistenceOperations: persistenceOperationTimings, errorCode: 'CONNECTOR_DATABASE_TRANSACTION_FAILED', prismaCode: causeCode, transactionMessageClass, causeType: typeof cause?.constructor?.name === 'string' ? cause.constructor.name.slice(0, 40) : 'UnknownError', ...(numberField('timeout') !== undefined ? { transactionTimeoutMs: numberField('timeout') } : {}), ...(numberField('timeTaken') !== undefined ? { transactionTimeTakenMs: numberField('timeTaken') } : {}) }));
        // The failed transaction rolled back its final state write. Recover the
        // claim with a short compare-and-set outside that expired transaction.
        // A previously verified connector may return to its last verified state;
        // a first verification becomes ERROR and can be retried explicitly.
        try {
          const hadPriorVerification = Boolean(row.lastVerifiedAt && Array.isArray(row.verifiedCapabilities) && row.verifiedCapabilities.length);
          const recoveryState = row.state === 'CONNECTING' ? (hadPriorVerification ? 'CONNECTED' : 'ERROR') : row.state;
          const recovered = await this.db.connectorInstance.updateMany({
            where: { id, organizationId, state: 'CONNECTING', updatedAt: verificationClaim },
            data: { state: recoveryState, lastErrorCode: 'CONNECTOR_DATABASE_TRANSACTION_FAILED' },
          });
          if (recovered.count === 1) await this.audit(this.db, organizationId, userId, 'connector.verification_persistence_failed', id, { connectorId: row.connectorId, errorCode: 'CONNECTOR_DATABASE_TRANSACTION_FAILED' });
        } catch (recoveryError) {
          const recoveryCode = safeErrorCode(recoveryError);
          this.logger.error(JSON.stringify({ event: 'connector_verification_recovery_failed', requestId, operation: 'connector.verify', errorCode: recoveryCode }));
        }
        throw new ServiceUnavailableException({ code: 'CONNECTOR_DATABASE_TRANSACTION_FAILED', message: 'Verification could not be saved because the database transaction failed. Retry verification.' });
      }
      const shopDomain = typeof configuration.shopDomain === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.myshopify\.com$/.test(configuration.shopDomain) ? configuration.shopDomain : undefined;
      this.logger.error(JSON.stringify({ event: 'connector_verification_diagnostic', requestId, operation: 'connector.verify', stage: verificationStage, ...(shopDomain ? { targetHost: shopDomain } : {}), elapsedMs: Math.max(0, Date.now() - verificationStartedAt), errorCode: code, causeCode, causeType: typeof cause?.constructor?.name === 'string' ? cause.constructor.name.slice(0, 40) : 'UnknownError' }));
      await this.db.$transaction(async (tx: any) => {
        const temporaryScopeFailure = row.connectorId === 'shopify_v1' && code === 'CONNECTOR_SHOPIFY_SCOPE_DISCOVERY_FAILED';
        const changed = await tx.connectorInstance.updateMany({ where: { id, organizationId, state: 'CONNECTING', updatedAt: verificationClaim }, data: { state: temporaryScopeFailure ? row.state : 'ERROR', verifiedCapabilities: temporaryScopeFailure ? row.verifiedCapabilities : [], lastErrorCode: code } });
        if (changed.count && row.integrationConnectionId && !temporaryScopeFailure) {
          await tx.integrationConnection.updateMany({ where: { id: row.integrationConnectionId, organizationId }, data: { state: 'ERROR', lastErrorCode: code, ...(code === 'CONNECTOR_SHOPIFY_SCOPE_MISSING' ? { grantedScopes: [], grantedScopeMetadata: [], grantedScopesVerifiedAt: null } : {}) } });
          if (code === 'CONNECTOR_SHOPIFY_SCOPE_MISSING') {
            await tx.commerceProduct.deleteMany({ where: { organizationId, connectionId: row.integrationConnectionId } });
            await tx.commerceOrder.deleteMany({ where: { organizationId, connectionId: row.integrationConnectionId } });
          }
        }
        if (changed.count) await this.audit(tx, organizationId, userId, 'connector.verification_failed', id, { connectorId: row.connectorId, errorCode: code });
      });
      throw new BadGatewayException({ code, message: 'The connector could not be verified. Check its configuration and credentials.' });
    }
  }

  async disconnect(userId: string, slug: string, id: string) {
    const { organizationId } = await this.owner(userId, slug);
    const row = await this.db.connectorInstance.findFirst({ where: { id, organizationId }, include: { credential: true } });
    if (!row) throw new NotFoundException({ code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found.' });
    let remoteRevokeError: string | null = null;
    if (row.credential) {
      try { await this.registry.adapter(row.connectorId).disconnect({ organizationId, connectorInstanceId: id }, object(row.configuration), this.vault.decrypt(row.credential, this.aad(organizationId, id, row.connectorId))); }
      catch (error) { remoteRevokeError = safeErrorCode(error); }
    }
    const result = await this.db.$transaction(async (tx: any) => {
      if (row.connectorId === 'shopify_v1') {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ConnectorInstance" WHERE "id" = ${id}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`;
        if (!locked.length) throw new NotFoundException({ code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found.' });
      }
      await tx.connectorCredential.deleteMany({ where: { organizationId, connectorInstanceId: id } });
      await tx.connectorSyncJob.updateMany({ where: { organizationId, connectorInstanceId: id, state: { in: ['PENDING', 'RETRY_WAIT', 'RUNNING'] } }, data: { state: 'CANCELLED', finishedAt: new Date(), leaseToken: null, leaseUntil: null } });
      let deletedProducts = 0;
      let deletedOrders = 0;
      // Commerce records belong to this specific Shopify connection. Keep
      // website crawler knowledge sources/pages, which are separate records.
      if (row.connectorId === 'shopify_v1' && row.integrationConnectionId) {
        const products = await tx.commerceProduct.deleteMany({ where: { organizationId, connectionId: row.integrationConnectionId } });
        const orders = await tx.commerceOrder.deleteMany({ where: { organizationId, connectionId: row.integrationConnectionId } });
        deletedProducts = products.count;
        deletedOrders = orders.count;
      }
      const updated = await tx.connectorInstance.update({ where: { id_organizationId: { id, organizationId } }, data: { state: 'DISCONNECTED', verifiedCapabilities: [], webhookPublicId: null, lastErrorCode: remoteRevokeError }, select: this.safeSelect() });
      if (row.integrationConnectionId) await tx.integrationConnection.updateMany({ where: { id: row.integrationConnectionId, organizationId }, data: { state: 'REVOKED', grantedScopes: [], grantedScopeMetadata: [], grantedScopesVerifiedAt: null, lastErrorCode: remoteRevokeError ?? 'CONNECTOR_DISCONNECTED' } });
      await this.audit(tx, organizationId, userId, 'connector.disconnected', id, { connectorId: row.connectorId, remoteRevocationError: remoteRevokeError, ...(row.connectorId === 'shopify_v1' ? { deletedCommerceProducts: deletedProducts, deletedCommerceOrders: deletedOrders, crawlerSourcesPreserved: true } : {}) });
      return updated;
    });
    return { ...result, hasCredentials: false };
  }

  async queueSync(userId: string, slug: string, id: string, input: { resourceType: string; mode: ConnectorSyncMode; idempotencyKey: string }, requestId = 'unknown') {
    const startedAt = Date.now();
    let stage = '02_workspace_authorization';
    const fields = { operation: 'connector.sync_job_create', connectorInstanceId: id, resourceType: input.resourceType, mode: input.mode };
    try {
    const { organizationId } = await this.owner(userId, slug);
    connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields, organizationId });
    stage = '03_request_payload_validated';
    connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields, organizationId, valid: true });
    stage = 'rate_limit';
    await this.rate(`connector-sync:${organizationId}:${id}:${userId}`, 60);
    stage = '04_connector_instance_lookup';
    const row = await this.instance(organizationId, id);
    connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields, organizationId, status: 'found' });
    stage = '05_tenant_organization_verification';
    if (row.organizationId !== organizationId) throw new NotFoundException({ code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found.' });
    connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields, organizationId, verified: true });
    stage = '06_commerce_connection_lookup';
    let commerceConnectionFound = !row.integrationConnectionId;
    if (row.integrationConnectionId) commerceConnectionFound = Boolean(await this.db.integrationConnection.findFirst({ where: { id: row.integrationConnectionId, organizationId, state: 'CONNECTED' }, select: { id: true } }));
    if (row.integrationConnectionId && !commerceConnectionFound) throw new ConflictException({ code: 'CONNECTOR_COMMERCE_LINK_INACTIVE', message: 'This store connection must be verified again before synchronization.' });
    connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields, organizationId, commerceConnectionId: row.integrationConnectionId ?? null, connected: commerceConnectionFound });
    stage = '07_connector_status_capability_verification';
    if (row.state !== 'CONNECTED') throw new ConflictException({ code: 'CONNECTOR_NOT_VERIFIED', message: 'Verify this connector before scheduling synchronization.' });
    this.registry.assertResourceSupport(row.connectorId, input.resourceType);
    const verifiedCapabilities: string[] = Array.isArray(row.verifiedCapabilities) ? row.verifiedCapabilities : [];
    const legacyContentCapability = verifiedCapabilities.includes('WEBSITE_CONTENT');
    const needed = input.resourceType === 'PRODUCTS' ? 'PRODUCT_CATALOG' : input.resourceType === 'ORDERS' ? 'ORDERS' : input.resourceType === 'CONTENT' && !legacyContentCapability && row.connectorId !== 'shopify_v1' ? 'WEBSITE_CONTENT' : null;
    if (needed && !verifiedCapabilities.includes(needed)) throw new ConflictException({ code: 'CONNECTOR_CAPABILITY_NOT_GRANTED', message: 'This resource was not included in verified provider permissions.' });
    const permissionCategories = input.resourceType === 'PRODUCTS' ? ['PRODUCTS'] as const : input.resourceType === 'ORDERS' ? ['ORDERS'] as const : [...new Set<ConnectorDataCategory>(['WEBSITE_PAGES', 'FAQ_POLICIES', ...(row.connectorId === 'shopify_v1' ? Object.keys(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS) as ConnectorDataCategory[] : [])])];
    let enabledCategories: ConnectorDataCategory[] = await this.businessCategorySyncEnabled(organizationId, id, permissionCategories);
    if (!enabledCategories.length) throw new ForbiddenException({ code: 'CONNECTOR_DATA_PERMISSION_DISABLED', message: 'The workspace owner has disabled this data category for synchronization.' });
    if (input.resourceType === 'CONTENT' && row.connectorId === 'shopify_v1') {
      const live = await this.db.connectorInstance.findFirst({ where: { id, organizationId, state: 'CONNECTED' }, select: { verifiedCapabilities: true, commerceConnection: { select: { grantedScopes: true, grantedScopesVerifiedAt: true } } } });
      const scopes: string[] = live?.commerceConnection?.grantedScopes ?? [];
      const fresh = isShopifyScopeSnapshotFresh(live?.commerceConnection?.grantedScopesVerifiedAt ?? row.lastVerifiedAt);
      const caps: string[] = Array.isArray(live?.verifiedCapabilities) ? live.verifiedCapabilities : [];
      enabledCategories = enabledCategories.filter((category) => isShopifyContentCategory(category) ? fresh && this.providerGranted(category, row.connectorId, caps, scopes) : legacyContentCapability && caps.includes('WEBSITE_CONTENT'));
      if (!enabledCategories.length) throw new ForbiddenException({ code: 'CONNECTOR_DATA_PERMISSION_DISABLED', message: 'No fresh, granted Shopify content operation is enabled for synchronization.' });
    }
    connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields, organizationId, connectorState: row.state, requiredCapability: needed, capabilityVerified: true });
    stage = '08_prisma_transaction_initialization';
    connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields, organizationId });
    const result = await this.db.$transaction(async (tx: any) => {
      stage = '09_postgres_advisory_lock_acquisition';
      const advisoryLockKey = `${organizationId}:${id}:${input.resourceType}:${input.mode}`;
      const lockResult = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        WITH advisory_lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtextextended(${advisoryLockKey}::text, 0::bigint))
        )
        SELECT TRUE AS acquired FROM advisory_lock
      `;
      if (lockResult[0]?.acquired !== true) throw new Error('CONNECTOR_SYNC_LOCK_NOT_ACQUIRED');
      connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields, organizationId, acquired: true });
      stage = '10_existing_pending_job_lookup';
      const active = await tx.connectorSyncJob.findFirst({ where: { organizationId, connectorInstanceId: id, resourceType: input.resourceType, mode: input.mode, state: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT'] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, resourceType: true, mode: true, state: true, cursor: true, itemCount: true, attemptCount: true, scheduledAt: true, createdAt: true } });
      connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields, organizationId, found: Boolean(active), ...(active ? { syncJobId: active.id } : {}) });
      if (active) { stage = '12_transaction_commit'; return active; }
      const prior = input.mode === 'INCREMENTAL' ? await tx.connectorSyncJob.findFirst({ where: { organizationId, connectorInstanceId: id, resourceType: input.resourceType, state: 'SUCCEEDED' }, orderBy: { finishedAt: 'desc' }, select: { checkpoint: true } }) : null;
      stage = '11_new_sync_job_creation';
      const created = await tx.connectorSyncJob.upsert({ where: { organizationId_connectorInstanceId_idempotencyKey: { organizationId, connectorInstanceId: id, idempotencyKey: input.idempotencyKey } }, create: { organizationId, connectorInstanceId: id, resourceType: input.resourceType, mode: input.mode, idempotencyKey: input.idempotencyKey, checkpoint: prior?.checkpoint ?? undefined, state: 'PENDING' }, update: {}, select: { id: true, resourceType: true, mode: true, state: true, cursor: true, itemCount: true, attemptCount: true, scheduledAt: true, createdAt: true } });
      connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields, organizationId, syncJobId: created.id, state: created.state });
      stage = '12_transaction_commit';
      return created;
    }, { timeout: 10000, maxWait: 5000 });
    stage = '12_transaction_commit';
    connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields, organizationId, syncJobId: result.id, state: result.state });
    return result;
    } catch (error) {
      connectorSyncDebug(this.logger, stage, requestId, startedAt, { ...fields }, error);
      if (!(error instanceof HttpException) || error.getStatus() >= 500) {
        const candidate = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
        const safeCode = typeof candidate === 'string' && /^(?:P\d{4}|[A-Z][A-Z0-9_]{1,79})$/.test(candidate) ? candidate : undefined;
        const rawName = error instanceof Error ? error.constructor?.name : 'UnknownError';
        const exceptionType = typeof rawName === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(rawName) ? rawName : 'Error';
        this.logger.error(JSON.stringify({ event: 'connector_sync_job_create_failure', requestId, operation: 'connector.sync_job_create', stage, exceptionType, ...(safeCode ? { errorCode: safeCode } : {}) }));
      }
      throw error;
    }
  }

  async syncHistory(userId: string, slug: string, id: string, before?: string, limit = 25) {
    const { organizationId } = await this.workspaces.requireAccess(userId, slug);
    if (!await this.instance(organizationId, id)) throw new NotFoundException('Connector not found');
    const take = Math.min(Math.max(limit, 1), 50);
    let cursorFilter: Record<string, unknown> = {};
    if (before) {
      const separator = before.indexOf('~'), createdAt = new Date(before.slice(0, separator)), cursorId = before.slice(separator + 1);
      if (separator < 1 || !Number.isFinite(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(cursorId)) throw new BadRequestException('Sync history cursor is invalid');
      cursorFilter = { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursorId } }] };
    }
    const rows = await this.db.connectorSyncJob.findMany({ where: { organizationId, connectorInstanceId: id, ...cursorFilter }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: take + 1, select: { id: true, resourceType: true, mode: true, state: true, cursor: true, itemCount: true, attemptCount: true, lastErrorCode: true, scheduledAt: true, startedAt: true, finishedAt: true, createdAt: true } });
    const hasMore = rows.length > take, items = rows.slice(0, take);
    return { items, hasMore, nextCursor: hasMore && items.length ? `${items[items.length - 1]!.createdAt.toISOString()}~${items[items.length - 1]!.id}` : null };
  }

  async updateSyncSchedule(userId: string, slug: string, id: string, input: { resourceType: string; mode: 'FULL' | 'INCREMENTAL'; enabled: boolean; paused: boolean; intervalMinutes: number }) {
    const { organizationId } = await this.owner(userId, slug);
    const connector = await this.instance(organizationId, id);
    this.registry.assertResourceSupport(connector.connectorId, input.resourceType);
    if (input.enabled && connector.state !== 'CONNECTED') throw new ConflictException({ code: 'CONNECTOR_NOT_VERIFIED', message: 'Verify the connection before enabling automatic refresh.' });
    if (!Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 60 || input.intervalMinutes > 10080) throw new BadRequestException('Refresh interval must be between 60 minutes and 7 days.');
    const nextRunAt = input.enabled && !input.paused ? new Date(Date.now() + input.intervalMinutes * 60_000) : null;
    return this.db.$transaction(async (tx: any) => {
      const schedule = await tx.connectorSyncSchedule.upsert({
        where: { organizationId_connectorInstanceId_resourceType: { organizationId, connectorInstanceId: id, resourceType: input.resourceType } },
        create: { organizationId, connectorInstanceId: id, resourceType: input.resourceType, mode: input.mode, enabled: input.enabled, paused: input.paused, intervalMinutes: input.intervalMinutes, nextRunAt },
        update: { mode: input.mode, enabled: input.enabled, paused: input.paused, intervalMinutes: input.intervalMinutes, nextRunAt },
        select: { connectorInstanceId: true, resourceType: true, mode: true, enabled: true, paused: true, intervalMinutes: true, nextRunAt: true, lastRunAt: true },
      });
      await this.audit(tx, organizationId, userId, 'connector.sync_schedule_updated', id, { resourceType: input.resourceType, mode: input.mode, enabled: input.enabled, paused: input.paused, intervalMinutes: input.intervalMinutes });
      return schedule;
    });
  }

  async retrySyncJob(userId: string, slug: string, connectorId: string, jobId: string) {
    const { organizationId } = await this.owner(userId, slug);
    const connector = await this.instance(organizationId, connectorId);
    if (connector.state !== 'CONNECTED') throw new ConflictException({ code: 'CONNECTOR_NOT_VERIFIED', message: 'Verify this connector before retrying synchronization.' });
    const job = await this.db.connectorSyncJob.findFirst({ where: { id: jobId, organizationId, connectorInstanceId: connectorId, state: 'FAILED' } });
    if (!job) throw new NotFoundException({ code: 'CONNECTOR_SYNC_RETRY_UNAVAILABLE', message: 'Only a failed sync job can be retried.' });
    const idempotencyKey = `retry:${job.id}:${job.attemptCount}`;
    return this.db.connectorSyncJob.upsert({ where: { organizationId_connectorInstanceId_idempotencyKey: { organizationId, connectorInstanceId: connectorId, idempotencyKey } }, create: { organizationId, connectorInstanceId: connectorId, resourceType: job.resourceType, mode: job.mode, cursor: job.cursor, checkpoint: job.checkpoint ?? undefined, idempotencyKey, state: 'PENDING' }, update: {}, select: { id: true, resourceType: true, mode: true, state: true, cursor: true, itemCount: true, attemptCount: true, scheduledAt: true, createdAt: true } });
  }

  async receiveWebhook(webhookPublicId: string, rawBody: Buffer | undefined, headers: Record<string, string | undefined>, ip: string) {
    const maximum = Number(process.env.CONNECTOR_WEBHOOK_MAX_BYTES ?? 262144);
    if (!rawBody || rawBody.length === 0 || rawBody.length > Math.min(Math.max(maximum, 1024), 1048576)) throw new BadRequestException('Webhook body is missing or too large');
    const instance = await this.db.connectorInstance.findFirst({ where: { webhookPublicId, state: 'CONNECTED', OR: [{ integrationConnectionId: null }, { commerceConnection: { is: { state: 'CONNECTED' } } }] }, include: { credential: true } });
    if (!instance?.credential) throw new NotFoundException('Webhook endpoint not found');
    const adapter = this.registry.adapter(instance.connectorId);
    if (!adapter.definition.webhooks.supported || !adapter.definition.webhooks.signatureScheme) throw new ForbiddenException('This connector does not accept webhooks');
    const perMinute = Number(process.env.CONNECTOR_WEBHOOK_RATE_LIMIT_PER_MINUTE ?? 60);
    const ipHash = createHash('sha256').update(ip).digest('hex');
    await this.rate(`connector-hook:${instance.id}:${ipHash}`, Math.max(1, Math.min(perMinute, 600)));
    let eventId = '', eventType = '', timestamp = Math.floor(Date.now() / 1000);
    if (adapter.definition.webhooks.signatureScheme === 'SHOPIFY_HMAC_SHA256') {
      eventId = headers['x-shopify-webhook-id']?.slice(0, 200) ?? '';
      eventType = headers['x-shopify-topic']?.slice(0, 120) ?? '';
      const triggered = headers['x-shopify-triggered-at'];
      if (triggered && Number.isFinite(Date.parse(triggered))) timestamp = Math.floor(Date.parse(triggered) / 1000);
    } else if (adapter.definition.webhooks.signatureScheme === 'WOOCOMMERCE_HMAC_SHA256') {
      eventId = headers['x-wc-webhook-delivery-id']?.slice(0, 200) ?? '';
      eventType = headers['x-wc-webhook-topic']?.slice(0, 120) ?? '';
    } else {
      eventId = headers['x-connector-event-id']?.slice(0, 200) ?? '';
      eventType = headers['x-connector-event-type']?.slice(0, 120) ?? '';
      timestamp = Number(headers['x-connector-timestamp']);
    }
    if (!eventId || !eventType || !Number.isInteger(timestamp) || (adapter.definition.webhooks.replayWindowSeconds !== null && Math.abs(Date.now() / 1000 - timestamp) > adapter.definition.webhooks.replayWindowSeconds!)) throw new BadRequestException('Webhook identity or timestamp is invalid');
    let payload: unknown;
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch { throw new BadRequestException('Webhook payload must be JSON'); }
    const payloadTime = adapter.definition.webhooks.signatureScheme === 'SHOPIFY_HMAC_SHA256' && payload && typeof payload === 'object'
      ? Date.parse(String((payload as Record<string, unknown>).updated_at ?? (payload as Record<string, unknown>).created_at ?? ''))
      : NaN;
    // Shopify's delivery timestamp is a header and is not covered by the body HMAC.
    // Persist a provider event time only when it came from the signed payload itself.
    const triggeredAt = Number.isFinite(payloadTime) ? new Date(payloadTime) : adapter.definition.webhooks.signatureScheme === 'SHOPIFY_HMAC_SHA256' ? null : new Date(timestamp * 1000);
    const input: ConnectorWebhookInput = { eventId, eventType, timestamp, rawBody, payload };
    const credentials = this.vault.decrypt(instance.credential, this.aad(instance.organizationId, instance.id, instance.connectorId));
    const verified = await adapter.verifyWebhook({ organizationId: instance.organizationId, connectorInstanceId: instance.id }, input, headers, object(instance.configuration), credentials);
    if (!verified) throw new ForbiddenException('Webhook signature is invalid');
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const encryptedBody = this.vault.encrypt({ body: rawBody.toString('base64') }, `carteio:webhook:${instance.organizationId}:${instance.id}:${eventId}`);
    if (instance.connectorId === 'shopify_v1' && eventType === 'app/scopes_update') {
      const prior = await this.db.connectorWebhookEvent.findFirst({ where: { connectorInstanceId: instance.id, externalEventId: eventId }, select: { id: true, payloadHash: true, state: true } });
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw new ConflictException('Webhook event identifier was reused with a different payload');
        return { accepted: true, duplicate: true, event: { id: prior.id, state: prior.state } };
      }
      await adapter.handleWebhook({ organizationId: instance.organizationId, connectorInstanceId: instance.id }, input, object(instance.configuration), credentials);
      try {
        const event = await this.db.connectorWebhookEvent.create({ data: { organizationId: instance.organizationId, connectorInstanceId: instance.id, externalEventId: eventId, eventType, triggeredAt, payloadHash, rawBodyCiphertext: encryptedBody.ciphertext, rawBodyNonce: encryptedBody.nonce, rawBodyAuthTag: encryptedBody.authTag, rawBodyKeyVersion: encryptedBody.keyVersion, state: 'PROCESSED', processedAt: new Date() }, select: { id: true, state: true, receivedAt: true } });
        return { accepted: true, duplicate: false, event };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2002') {
          const duplicate = await this.db.connectorWebhookEvent.findFirst({ where: { connectorInstanceId: instance.id, externalEventId: eventId }, select: { id: true, payloadHash: true, state: true } });
          if (duplicate?.payloadHash === payloadHash) return { accepted: true, duplicate: true, event: { id: duplicate.id, state: duplicate.state } };
          throw new ConflictException('Webhook event identifier was reused with a different payload');
        }
        throw error;
      }
    }
    try {
      const event = await this.db.connectorWebhookEvent.create({ data: { organizationId: instance.organizationId, connectorInstanceId: instance.id, externalEventId: eventId, eventType, triggeredAt, payloadHash, rawBodyCiphertext: encryptedBody.ciphertext, rawBodyNonce: encryptedBody.nonce, rawBodyAuthTag: encryptedBody.authTag, rawBodyKeyVersion: encryptedBody.keyVersion }, select: { id: true, state: true, receivedAt: true } });
      return { accepted: true, duplicate: false, event };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2002') {
        const prior = await this.db.connectorWebhookEvent.findFirst({ where: { connectorInstanceId: instance.id, externalEventId: eventId }, select: { id: true, payloadHash: true, state: true } });
        if (!prior || prior.payloadHash !== payloadHash) throw new ConflictException('Webhook event identifier was reused with a different payload');
        return { accepted: true, duplicate: true, event: { id: prior.id, state: prior.state } };
      }
      throw error;
    }
  }

  async receiveShopifyScopesUpdate(rawBody: Buffer | undefined, headers: Record<string, string | undefined>, ip: string) {
    const shopDomain = (headers['x-shopify-shop-domain'] ?? '').toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(shopDomain)) throw new BadRequestException('Shopify shop domain is invalid');
    const instances = await this.db.connectorInstance.findMany({ where: { connectorId: 'shopify_v1', state: 'CONNECTED', configuration: { path: ['shopDomain'], equals: shopDomain }, webhookPublicId: { not: null }, commerceConnection: { is: { state: 'CONNECTED' } } }, take: 2, select: { webhookPublicId: true } });
    if (instances.length !== 1 || !instances[0]?.webhookPublicId) throw new NotFoundException('Shopify connector endpoint not found');
    return this.receiveWebhook(instances[0].webhookPublicId, rawBody, headers, ip);
  }

  private async owner(userId: string, slug: string) { return this.workspaces.requireAccess(userId, slug, ['OWNER', 'ADMIN']); }
  private async instance(organizationId: string, id: string) {
    const row = await this.db.connectorInstance.findFirst({ where: { id, organizationId }, select: { id: true, organizationId: true, integrationConnectionId: true, connectorId: true, connectorType: true, connectorVersion: true, displayName: true, configuration: true, state: true, verifiedCapabilities: true, lastVerifiedAt: true, lastErrorCode: true, createdAt: true, updatedAt: true } });
    if (!row) throw new NotFoundException({ code: 'CONNECTOR_NOT_FOUND', message: 'Connector not found.' });
    return row;
  }
  private safeSelect() { return { id: true, connectorId: true, connectorType: true, connectorVersion: true, displayName: true, configuration: true, state: true, verifiedCapabilities: true, lastVerifiedAt: true, lastErrorCode: true, createdAt: true, updatedAt: true } as const; }
  private aad(organizationId: string, id: string, connectorId: string) { return `carteio:connector:${organizationId}:${id}:${connectorId}`; }
  private async audit(tx: any, organizationId: string, userId: string, action: string, id: string, metadata: Record<string, unknown>) { await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action, entityType: 'connector_instance', entityId: id, metadata } }); }
  private async rate(key: string, max: number) {
    const now = new Date(), window = new Date(Math.floor(now.getTime() / 60000) * 60000), scope = key.slice(0, 160);
    const rows = await this.db.$queryRaw<Array<{ requestCount: number }>>`INSERT INTO "PlaygroundRateLimit" ("scopeKey","windowStartedAt","requestCount","updatedAt") VALUES (${scope},${window},1,${now}) ON CONFLICT ("scopeKey") DO UPDATE SET "windowStartedAt"=CASE WHEN "PlaygroundRateLimit"."windowStartedAt"<${window} THEN ${window} ELSE "PlaygroundRateLimit"."windowStartedAt" END,"requestCount"=CASE WHEN "PlaygroundRateLimit"."windowStartedAt"<${window} THEN 1 ELSE LEAST("PlaygroundRateLimit"."requestCount"+1,${max + 1}) END,"updatedAt"=${now} RETURNING "requestCount"`;
    if ((rows[0]?.requestCount ?? 0) > max) throw new ConflictException({ code: 'CONNECTOR_RATE_LIMITED', message: 'Too many connector requests. Retry shortly.' });
  }
}
