import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConnectorAdapter, ConnectorCatalogItem, ConnectorDefinition, JsonSchema } from './connector.contracts';

export const CONNECTOR_ADAPTERS = Symbol('CONNECTOR_ADAPTERS');

export const FUTURE_CAPABILITIES = [
  { id: 'PRODUCT_CATALOG', label: 'Products and catalog', phase: 16 }, { id: 'PRODUCT_PRICES', label: 'Product prices', phase: 16 },
  { id: 'INVENTORY', label: 'Inventory', phase: 16 }, { id: 'ORDERS', label: 'Orders', phase: 16 }, { id: 'FULFILLMENT', label: 'Fulfillment', phase: 16 },
  { id: 'SHOPIFY_LOCATIONS', label: 'Shopify locations', phase: 16 }, { id: 'SHOPIFY_SHIPPING', label: 'Shopify shipping and delivery', phase: 16 },
  { id: 'SHOPIFY_LEGAL_POLICIES', label: 'Shopify legal policies', phase: 16 }, { id: 'SHOPIFY_ONLINE_STORE_PAGES', label: 'Shopify online store pages', phase: 16 },
  { id: 'SHOPIFY_MARKETS', label: 'Shopify markets and currencies', phase: 16 }, { id: 'SHOPIFY_DISCOUNTS', label: 'Shopify discounts', phase: 16 },
  { id: 'SHOPIFY_METAOBJECT_DEFINITIONS', label: 'Shopify metaobject definitions', phase: 16 }, { id: 'SHOPIFY_METAOBJECTS', label: 'Shopify metaobjects (restricted)', phase: 16 },
  { id: 'CUSTOMERS', label: 'Customers', phase: 16 }, { id: 'SERVICES', label: 'Services', phase: 18 }, { id: 'APPOINTMENTS', label: 'Appointments', phase: 18 },
  { id: 'LEADS', label: 'Leads', phase: 18 }, { id: 'WEBSITE_CONTENT', label: 'Website content', phase: 17 }, { id: 'CUSTOM_RESOURCE', label: 'Custom business resources', phase: 18 },
  { id: 'CONNECTOR_HEALTH_CHECK', label: 'Connection health verification', phase: 15 },
] as const;

const comingSoon: ConnectorCatalogItem[] = [
  ['shopify_v1', 'SHOPIFY', 'Shopify', 16], ['woocommerce_v1', 'WOOCOMMERCE', 'WooCommerce', 16],
  ['static_site_v1', 'STATIC_WEBSITE', 'Static website content', 17],
].map(([id, type, name, _phase]) => ({ id: String(id), type: String(type), version: '1.0.0', name: String(name), description: `Platform adapter planned for Phase ${_phase}. No adapter is currently registered.`, authStrategy: 'NONE', configurationSchema: { type: 'object', additionalProperties: false, properties: {} }, credentialSchema: { type: 'object', additionalProperties: false, properties: {} }, capabilities: [], syncResources: [], webhooks: { supported: false, signatureScheme: null, replayWindowSeconds: null }, availability: 'COMING_SOON' }));

export function validateSchemaValue(value: unknown, schema: JsonSchema, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  const properties = schema.properties ?? {};
  if (schema.additionalProperties === false && Object.keys(object).some((key) => !(key in properties))) throw new BadRequestException(`${label} contains an unsupported field`);
  for (const key of schema.required ?? []) if (!(key in object)) throw new BadRequestException(`${label} is missing ${key}`);
  for (const key of Object.keys(object)) {
    const rule = properties[key];
    if (!rule) continue;
    if (typeof object[key] !== rule.type) throw new BadRequestException(`${label}.${key} has an invalid type`);
    if (rule.type === 'string') {
      const text = object[key] as string;
      if (text.length < (rule.minLength ?? 0) || text.length > (rule.maxLength ?? 2048) || (rule.enum && !rule.enum.includes(text)) || (rule.pattern && !new RegExp(rule.pattern).test(text))) throw new BadRequestException(`${label}.${key} is invalid`);
      if (rule.format === 'uri') {
        try { const url = new URL(text); if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port) throw new Error(); }
        catch { throw new BadRequestException(`${label}.${key} must be a public HTTPS URL`); }
      }
    }
  }
  return object;
}

@Injectable()
export class ConnectorRegistry {
  private readonly adapters = new Map<string, ConnectorAdapter>();
  constructor(adapters: ConnectorAdapter[] = []) { for (const adapter of adapters) this.register(adapter); }
  register(adapter: ConnectorAdapter) {
    if (this.adapters.has(adapter.definition.id)) throw new Error(`Connector adapter already registered: ${adapter.definition.id}`);
    this.adapters.set(adapter.definition.id, adapter);
  }
  adapter(connectorId: string): ConnectorAdapter {
    const adapter = this.adapters.get(connectorId);
    if (!adapter) throw new NotFoundException({ code: 'CONNECTOR_ADAPTER_UNAVAILABLE', message: 'No adapter is registered for this connector.' });
    return adapter;
  }
  definition(connectorId: string): ConnectorDefinition { return this.adapter(connectorId).definition; }
  catalog(): ConnectorCatalogItem[] {
    return [...[...this.adapters.values()].map(({ definition }) => ({ ...definition, availability: 'AVAILABLE' as const })), ...comingSoon];
  }
  validateConfiguration(connectorId: string, configuration: unknown, credentials?: unknown) {
    const definition = this.definition(connectorId);
    const config = validateSchemaValue(configuration, definition.configurationSchema, 'Configuration');
    const normalizedCredentials = credentials === undefined ? undefined : validateSchemaValue(credentials, definition.credentialSchema, 'Credentials');
    const size = Buffer.byteLength(JSON.stringify({ config, credentials: normalizedCredentials ?? null }));
    const limit = Number(process.env.CONNECTOR_MAX_CONFIG_BYTES ?? 16384);
    if (!Number.isInteger(limit) || size > Math.min(Math.max(limit, 1024), 65536)) throw new BadRequestException('Connector configuration exceeds the size limit');
    return { definition, config, credentials: normalizedCredentials };
  }
  async capabilitiesFor(instances: Array<{ id: string; connectorId: string; displayName: string; state: string; verifiedCapabilities: unknown }>) {
    return {
      resources: FUTURE_CAPABILITIES.map((capability) => ({ ...capability, available: instances.some((instance) => instance.state === 'CONNECTED' && Array.isArray(instance.verifiedCapabilities) && instance.verifiedCapabilities.includes(capability.id)) })),
      connections: instances.map((instance) => ({ id: instance.id, connectorId: instance.connectorId, displayName: instance.displayName, state: instance.state, capabilities: Array.isArray(instance.verifiedCapabilities) ? instance.verifiedCapabilities : [] })),
    };
  }
  assertResourceSupport(connectorId: string, resourceType: string) {
    const adapter = this.adapter(connectorId);
    if (!adapter.definition.syncResources.includes(resourceType)) throw new ServiceUnavailableException({ code: 'CONNECTOR_RESOURCE_UNSUPPORTED', message: `This adapter does not support ${resourceType} synchronization.` });
  }
}
