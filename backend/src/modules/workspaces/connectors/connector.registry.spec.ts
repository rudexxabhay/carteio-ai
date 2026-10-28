import { ConnectorRegistry } from './connector.registry';

describe('ConnectorRegistry capability gates', () => {
  const adapter: any = { definition: { id: 'real-v1', type: 'CUSTOM_API', version: '1', name: 'Real adapter', description: '', authStrategy: 'NONE', configurationSchema: { type: 'object', properties: {}, additionalProperties: false }, credentialSchema: { type: 'object', properties: {}, additionalProperties: false }, capabilities: ['CONNECTOR_HEALTH_CHECK'], syncResources: [], webhooks: { supported: false, signatureScheme: null, replayWindowSeconds: null } } };
  const registry = new ConnectorRegistry([adapter]);
  it('keeps platform adapters unavailable when they are not registered', () => {
    expect(registry.catalog().find((entry) => entry.id === 'shopify_v1')?.availability).toBe('COMING_SOON');
    expect(() => registry.adapter('shopify_v1')).toThrow();
  });
  it('rejects resource sync unless the registered adapter declares the resource', () => {
    expect(() => registry.assertResourceSupport('real-v1', 'products')).toThrow();
  });
});
