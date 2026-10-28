import { Injectable } from '@nestjs/common';
import type { ConnectorAdapter, ConnectorDefinition, ConnectorOperationContext, ConnectorSyncPage, ConnectorVerification, NormalizedCommerceRecord } from './connector.contracts';
import { SafeOutboundHttpService } from './safe-outbound-http.service';

const pathSchema = { type: 'string' as const, minLength: 1, maxLength: 256, pattern: '^/(?!/)[^?#]*$' };
const CONNECTOR_PAGE_SIZE = 20;
const text = (value: unknown, max: number): string | null => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const money = (value: unknown): string | null => typeof value === 'string' && /^\d{1,12}(?:\.\d{1,4})?$/.test(value) ? value : null;
const date = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const object = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Pull adapter for the documented Carteio Business Data API v1. Website stacks implement the same HTTP contract. */
@Injectable()
export class UniversalBusinessApiAdapter implements ConnectorAdapter {
  readonly definition: ConnectorDefinition;
  constructor(private readonly http: SafeOutboundHttpService, id = 'business_api_v1', name = 'Carteio Business API', type = 'CUSTOM_API') {
    this.definition = {
      id, type, version: '1.0.0', name, description: 'Versioned provider-neutral product and public business knowledge API.', authStrategy: 'BEARER_TOKEN',
      configurationSchema: { type: 'object', additionalProperties: false, required: ['baseUrl', 'productsPath', 'contentPath'], properties: { baseUrl: { type: 'string', minLength: 12, maxLength: 2048, format: 'uri' }, productsPath: pathSchema, contentPath: pathSchema } },
      credentialSchema: { type: 'object', additionalProperties: false, required: ['apiToken'], properties: { apiToken: { type: 'string', minLength: 32, maxLength: 4096 } } },
      capabilities: ['CONNECTOR_HEALTH_CHECK', 'PRODUCT_CATALOG', 'PRODUCT_PRICES', 'INVENTORY', 'WEBSITE_CONTENT', 'SERVICES'], syncResources: ['PRODUCTS', 'CONTENT'],
      webhooks: { supported: false, signatureScheme: null, replayWindowSeconds: null },
    };
  }
  async connect() {}
  async disconnect() {}
  async verify(_context: ConnectorOperationContext, config: Record<string, unknown>, credentials: Record<string, unknown>): Promise<ConnectorVerification> {
    const [products, content] = await Promise.all([
      this.fetchPage(String(config.productsPath), String(config.baseUrl), String(credentials.apiToken), null, null),
      this.fetchPage(String(config.contentPath), String(config.baseUrl), String(credentials.apiToken), null, null),
    ]);
    if (!Array.isArray(products.items) || products.contractVersion !== '1.0' || !Array.isArray(content.items) || content.contractVersion !== '1.0') throw new Error('CONNECTOR_CONTRACT_VERSION_UNSUPPORTED');
    return { verified: true, externalAccountId: new URL(String(config.baseUrl)).hostname, grantedScopes: ['PRODUCTS:READ', 'CONTENT:READ'], capabilities: this.definition.capabilities };
  }
  async discoverCapabilities() { return this.definition.capabilities; }
  async sync(_context: ConnectorOperationContext, input: { resourceType: string; mode: 'FULL' | 'INCREMENTAL'; cursor?: string | null; checkpoint?: unknown }, config: Record<string, unknown>, credentials: Record<string, unknown>): Promise<ConnectorSyncPage> {
    const path = input.resourceType === 'PRODUCTS' ? String(config.productsPath) : input.resourceType === 'CONTENT' ? String(config.contentPath) : '';
    if (!path) throw new Error('CONNECTOR_RESOURCE_UNSUPPORTED');
    const checkpoint = object(input.checkpoint) ? input.checkpoint : {};
    const page = await this.fetchPage(path, String(config.baseUrl), String(credentials.apiToken), input.cursor ?? null, input.mode === 'INCREMENTAL' && typeof checkpoint.updatedAfter === 'string' ? checkpoint.updatedAfter : null);
    if (!Array.isArray(page.items) || page.items.length > 100 || page.contractVersion !== '1.0' || typeof page.complete !== 'boolean' || !(page.nextCursor === null || typeof page.nextCursor === 'string' && page.nextCursor.length <= 2048) || (!page.complete && !page.nextCursor) || (page.deletedIds !== undefined && (!Array.isArray(page.deletedIds) || page.deletedIds.length > 100 || page.deletedIds.some((id: unknown) => typeof id !== 'string' || !id || id.length > 255))) || page.items.length + (Array.isArray(page.deletedIds) ? page.deletedIds.length : 0) > 100) throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
    const records: NormalizedCommerceRecord[] = input.resourceType === 'PRODUCTS'
      ? page.items.map((item: unknown) => this.product(item, String(config.baseUrl)))
      : page.items.map((item: unknown) => this.knowledge(item, String(config.baseUrl)));
    const deletedIds: string[] = page.deletedIds ?? [];
    for (const id of deletedIds) records.push(input.resourceType === 'PRODUCTS' ? { kind: 'PRODUCT_DELETE', externalId: id } : { kind: 'KNOWLEDGE', externalId: id, title: id, content: '', deleted: true });
    const highWatermark = page.complete ? date(page.updatedThrough) ?? new Date().toISOString() : null;
    return { records, itemCount: page.items.length + deletedIds.length, cursor: page.complete ? null : page.nextCursor, complete: page.complete, checkpoint: { ...(input.checkpoint && object(input.checkpoint) ? input.checkpoint : {}), ...(highWatermark ? { updatedAfter: highWatermark } : {}) } };
  }
  async verifyWebhook() { return false; }
  async handleWebhook() { throw new Error('CONNECTOR_WEBHOOK_UNSUPPORTED'); }

  private async fetchPage(path: string, base: string, token: string, cursor: string | null, updatedAfter: string | null): Promise<any> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('?') || path.includes('#')) throw new Error('CONNECTOR_CONFIG_INVALID');
    const root = new URL(base), target = new URL(path, root);
    if (root.protocol !== 'https:' || target.origin !== root.origin) throw new Error('CONNECTOR_CONFIG_INVALID');
    if (cursor) target.searchParams.set('cursor', cursor);
    if (updatedAfter) target.searchParams.set('updatedAfter', updatedAfter);
    target.searchParams.set('limit', String(CONNECTOR_PAGE_SIZE));
    const response = await this.http.request('GET', target.toString(), { Accept: 'application/json', Authorization: `Bearer ${token}` }, undefined, 1048576, 3);
    if (response.status < 200 || response.status >= 300) throw new Error(response.status === 401 || response.status === 403 ? 'CONNECTOR_AUTHORIZATION_FAILED' : `CONNECTOR_HTTP_${response.status}`);
    try { return JSON.parse(response.body.toString('utf8')); } catch { throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID'); }
  }
  private product(value: unknown, baseUrl: string): NormalizedCommerceRecord {
    if (!object(value) || typeof value.id !== 'string' || !value.id || value.id.length > 255 || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 500 || !Array.isArray(value.variants) || value.variants.length > 1000 || value.variantsComplete !== true) throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
    const variants = value.variants.map((variant: unknown) => {
      if (!object(variant) || typeof variant.id !== 'string' || !variant.id || variant.id.length > 255 || typeof variant.title !== 'string' || variant.title.length > 500) throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
      return { externalId: variant.id, title: variant.title, sku: text(variant.sku, 160), currency: text(variant.currency, 3), price: money(variant.price), inventory: Number.isSafeInteger(variant.inventory) ? variant.inventory : null, availability: text(variant.availability, 40), status: text(variant.status, 80) };
    });
    const currency = text(value.currency, 3);
    return { kind: 'PRODUCT', externalId: value.id, name: value.name.trim(), description: text(value.description, 20000), sku: text(value.sku, 160), category: text(value.category, 200), currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null, price: money(value.price), inventory: Number.isSafeInteger(value.inventory) ? value.inventory : null, availability: text(value.availability, 40), status: text(value.status, 80), productUrl: this.sameSiteUrl(value.url, new URL(baseUrl).hostname, false), imageUrl: this.httpsUrl(value.imageUrl), updatedAt: date(value.updatedAt), variants, variantsComplete: true };
  }
  private knowledge(value: unknown, baseUrl: string): NormalizedCommerceRecord {
    if (!object(value) || typeof value.id !== 'string' || !value.id || value.id.length > 255 || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 500 || typeof value.content !== 'string' || value.content.length > 50000) throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
    const sourceUrl = text(value.url, 2048);
    if (sourceUrl && !this.sameSiteUrl(sourceUrl, new URL(baseUrl).hostname, true)) throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID');
    return { kind: 'KNOWLEDGE', externalId: value.id, title: value.title.trim(), content: value.content.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, ' ').replace(/<[^>]+>/gu, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim(), category: text(value.category, 120), sourceUrl, language: text(value.language, 35), updatedAt: date(value.updatedAt), deleted: value.deleted === true };
  }
  private sameSiteUrl(value: unknown, hostname: string, rejectInvalid: boolean): string | null {
    if (typeof value !== 'string' || !value) return null;
    try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.hostname.toLowerCase() !== hostname.toLowerCase()) throw new Error(); url.search = ''; return url.toString().slice(0, 2048); }
    catch { if (rejectInvalid) throw new Error('CONNECTOR_PROVIDER_RESPONSE_INVALID'); return null; }
  }
  private httpsUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value) return null;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.toString().slice(0, 2048) : null; } catch { return null; }
  }
}
