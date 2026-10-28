import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ConnectorAdapter, ConnectorDefinition, ConnectorOperationContext, ConnectorSyncPage, ConnectorWebhookInput, ConnectorVerification } from './connector.contracts';
import { SafeOutboundHttpService } from './safe-outbound-http.service';

@Injectable()
export class GenericRestConnectorAdapter implements ConnectorAdapter {
  readonly definition: ConnectorDefinition = {
    id: 'generic_https_health_v1', type: 'CUSTOM_API', version: '1.0.0', name: 'Generic HTTPS API',
    description: 'Verifies a configured HTTPS health endpoint. It does not synchronize business data.', authStrategy: 'BEARER_TOKEN',
    configurationSchema: { type: 'object', additionalProperties: false, required: ['baseUrl', 'healthCheckPath'], properties: { baseUrl: { type: 'string', minLength: 12, maxLength: 2048, format: 'uri' }, healthCheckPath: { type: 'string', minLength: 1, maxLength: 256, pattern: '^/' } } },
    credentialSchema: { type: 'object', additionalProperties: false, required: ['apiToken'], properties: { apiToken: { type: 'string', minLength: 1, maxLength: 4096 }, webhookSecret: { type: 'string', minLength: 32, maxLength: 512 } } },
    capabilities: ['CONNECTOR_HEALTH_CHECK'], syncResources: [], webhooks: { supported: true, signatureScheme: 'HMAC_SHA256_TIMESTAMPED', replayWindowSeconds: 300 },
  };
  constructor(private readonly outbound: SafeOutboundHttpService) {}
  async connect(_context: ConnectorOperationContext, _configuration: Record<string, unknown>, _credentials: Record<string, unknown>) { return; }
  async verify(_context: ConnectorOperationContext, configuration: Record<string, unknown>, credentials: Record<string, unknown>): Promise<ConnectorVerification> {
    const base = new URL(String(configuration.baseUrl));
    if (base.protocol !== 'https:' || base.username || base.password || base.port) throw new Error('CONNECTOR_CONFIG_INVALID');
    const path = String(configuration.healthCheckPath);
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('CONNECTOR_CONFIG_INVALID');
    const target = new URL(path, base);
    if (target.origin !== base.origin) throw new Error('CONNECTOR_CONFIG_INVALID');
    const result = await this.outbound.get(target.toString(), { Accept: 'application/json, text/plain', Authorization: `Bearer ${String(credentials.apiToken)}` });
    if (result.status < 200 || result.status >= 300) throw new Error(`CONNECTOR_HTTP_${result.status || 'ERROR'}`);
    return { verified: true, externalAccountId: base.hostname, grantedScopes: [], capabilities: await this.discoverCapabilities(_context, configuration, credentials) };
  }
  async disconnect(_context: ConnectorOperationContext, _configuration: Record<string, unknown>, _credentials?: Record<string, unknown>) { return; }
  async sync(_context: ConnectorOperationContext, _input: { resourceType: string; mode: 'FULL' | 'INCREMENTAL'; cursor?: string | null; checkpoint?: unknown }, _configuration: Record<string, unknown>, _credentials: Record<string, unknown>): Promise<ConnectorSyncPage> { throw new Error('CONNECTOR_RESOURCE_UNSUPPORTED'); }
  async verifyWebhook(_context: ConnectorOperationContext, input: ConnectorWebhookInput, headers: Record<string, string | undefined>, _configuration: Record<string, unknown>, credentials: Record<string, unknown>) {
    const secret = credentials.webhookSecret;
    const supplied = headers['x-connector-signature'] ?? '';
    if (typeof secret !== 'string' || !secret || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
    const expected = createHmac('sha256', secret).update(`${input.timestamp}.`).update(input.rawBody).digest();
    const actual = Buffer.from(supplied, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  // The generic adapter's supported webhook operation is durable, signed event intake.
  // It intentionally does not infer or mutate business resources from arbitrary payloads.
  async handleWebhook(_context: ConnectorOperationContext, _input: ConnectorWebhookInput, _configuration: Record<string, unknown>, _credentials: Record<string, unknown>) { return; }
  async discoverCapabilities(_context: ConnectorOperationContext, _configuration: Record<string, unknown>, _credentials: Record<string, unknown>) { return ['CONNECTOR_HEALTH_CHECK'] as ('CONNECTOR_HEALTH_CHECK')[]; }
}
