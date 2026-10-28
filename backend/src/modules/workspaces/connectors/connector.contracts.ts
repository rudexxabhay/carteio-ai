export type ConnectorAuthStrategy = 'NONE' | 'BEARER_TOKEN' | 'API_KEY' | 'OAUTH2';
export type ConnectorCapability = 'PRODUCT_CATALOG' | 'PRODUCT_PRICES' | 'INVENTORY' | 'ORDERS' | 'FULFILLMENT' | 'CUSTOMERS' | 'SERVICES' | 'APPOINTMENTS' | 'LEADS' | 'WEBSITE_CONTENT' | 'SHOPIFY_LOCATIONS' | 'SHOPIFY_SHIPPING' | 'SHOPIFY_LEGAL_POLICIES' | 'SHOPIFY_ONLINE_STORE_PAGES' | 'SHOPIFY_MARKETS' | 'SHOPIFY_DISCOUNTS' | 'SHOPIFY_METAOBJECT_DEFINITIONS' | 'SHOPIFY_METAOBJECTS' | 'CUSTOM_RESOURCE' | 'CONNECTOR_HEALTH_CHECK';
export type ConnectorSyncMode = 'FULL' | 'INCREMENTAL';
export type JsonSchema = { type: 'object'; additionalProperties?: boolean; required?: string[]; properties: Record<string, { type: 'string' | 'number' | 'boolean'; minLength?: number; maxLength?: number; pattern?: string; enum?: string[]; format?: string }> };

export type ConnectorDefinition = {
  id: string;
  type: string;
  version: string;
  name: string;
  description: string;
  authStrategy: ConnectorAuthStrategy;
  configurationSchema: JsonSchema;
  credentialSchema: JsonSchema;
  capabilities: ConnectorCapability[];
  syncResources: string[];
  webhooks: { supported: boolean; signatureScheme: string | null; replayWindowSeconds: number | null };
};

export type ConnectorOperationContext = { organizationId: string; connectorInstanceId: string; requestId?: string };
export type ConnectorVerification = { verified: true; externalAccountId?: string; storefrontUrl?: string | null; grantedScopes?: string[]; grantedScopeMetadata?: Array<{ handle: string; description: string | null }>; capabilities: ConnectorCapability[] };
export type NormalizedCommerceRecord = { kind: 'PRODUCT'; externalId: string; name: string; description?: string | null; sku?: string | null; category?: string | null; productType?: string | null; taxonomyCategoryId?: string | null; taxonomyCategory?: string | null; collections?: Array<{ externalId: string; title: string; handle?: string | null; membershipType: 'MANUAL' | 'AUTOMATED' | 'UNKNOWN' }>; vendor?: string | null; handle?: string | null; currency?: string | null; price?: string | null; compareAtPrice?: string | null; inventory?: number | null; availability?: string | null; status?: string | null; productUrl?: string | null; imageUrl?: string | null; imageAltText?: string | null; imageWidth?: number | null; imageHeight?: number | null; imageEvidence?: Array<{ externalId: string; url: string; altText?: string | null; width?: number | null; height?: number | null }>; imagesComplete?: boolean; createdAt?: string | null; updatedAt?: string | null; variants: Array<{ externalId: string; title: string; sku?: string | null; selectedOptions?: Array<{ name: string; value: string }>; currency?: string | null; price?: string | null; compareAtPrice?: string | null; inventory?: number | null; availability?: string | null; status?: string | null }>; variantsComplete: boolean } | { kind: 'PRODUCT_DELETE'; externalId: string } | { kind: 'ORDER'; externalId: string; displayReference?: string | null; financialStatus?: string | null; fulfillmentStatus?: string | null; currency?: string | null; subtotal?: string | null; discountTotal?: string | null; shippingTotal?: string | null; taxTotal?: string | null; total?: string | null; refundedTotal?: string | null; orderedAt?: string | null; updatedAt?: string | null; status?: string | null; linesComplete?: boolean; lines: Array<{ externalId: string; productExternalId?: string | null; name: string; sku?: string | null; quantity: number; currency?: string | null; unitPrice?: string | null; total?: string | null }> } | { kind: 'KNOWLEDGE'; externalId: string; title: string; content: string; category?: string | null; permissionCategory?: string; visibility?: 'PUBLIC_REFERENCE' | 'INTERNAL_RESTRICTED'; sourceUrl?: string | null; language?: string | null; updatedAt?: string | null; deleted?: boolean };
export type ConnectorSyncPage = { checkpoint?: unknown; cursor?: string | null; itemCount: number; complete: boolean; records?: NormalizedCommerceRecord[] };
export type ConnectorWebhookInput = { eventId: string; eventType: string; timestamp: number; rawBody: Buffer; payload: unknown };

export interface ConnectorAdapter {
  readonly definition: ConnectorDefinition;
  connect(context: ConnectorOperationContext, configuration: Record<string, unknown>, credentials: Record<string, unknown>): Promise<void>;
  verify(context: ConnectorOperationContext, configuration: Record<string, unknown>, credentials: Record<string, unknown>): Promise<ConnectorVerification>;
  disconnect(context: ConnectorOperationContext, configuration: Record<string, unknown>, credentials?: Record<string, unknown>): Promise<void>;
  sync(context: ConnectorOperationContext, input: { resourceType: string; mode: ConnectorSyncMode; cursor?: string | null; checkpoint?: unknown; includePrices?: boolean; includeInventory?: boolean; enabledCategories?: string[]; grantedScopes?: string[] }, configuration: Record<string, unknown>, credentials: Record<string, unknown>): Promise<ConnectorSyncPage>;
  verifyWebhook(context: ConnectorOperationContext, input: ConnectorWebhookInput, headers: Record<string, string | undefined>, configuration: Record<string, unknown>, credentials: Record<string, unknown>): Promise<boolean>;
  handleWebhook(context: ConnectorOperationContext, input: ConnectorWebhookInput, configuration: Record<string, unknown>, credentials: Record<string, unknown>): Promise<void>;
  discoverCapabilities(context: ConnectorOperationContext, configuration: Record<string, unknown>, credentials: Record<string, unknown>): Promise<ConnectorCapability[]>;
}

export type ConnectorCatalogItem = ConnectorDefinition & { availability: 'AVAILABLE' | 'COMING_SOON' | 'NOT_SUPPORTED' };

/** Proposal-only contract for future Shopify writes; no provider mutation consumes this type today. */
export type ShopifyWriteProposal =
  | { action: 'CANCEL_ORDER'; orderId: string; reason: string }
  | { action: 'REFUND_ORDER'; orderId: string; amount: string; currency: string; reason: string }
  | { action: 'EDIT_ORDER'; orderId: string; changes: readonly { lineItemId: string; quantity: number }[] };
export type ShopifyWriteAuthorization = Readonly<{
  organizationId: string;
  connectorInstanceId: string;
  actor: { type: 'WORKSPACE_OPERATOR'; userId: string };
  proposal: ShopifyWriteProposal;
  merchantPermission: { enabled: true; permissionId: string };
  resourceAuthorization: { resourceId: string; ownerOrganizationId: string };
  confirmation: { confirmed: true; confirmationId: string; confirmedAt: string; expiresAt: string };
  idempotencyKey: string;
  audit: { requestId: string; conversationId?: string; reason: string };
}>;
export const SHOPIFY_WRITE_EXECUTION_ENABLED = false as const;
