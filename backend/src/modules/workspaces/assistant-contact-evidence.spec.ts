import { buildAssistantContactEvidence, parseAssistantHelpContacts } from './assistant-contact-evidence';
import { buildAssistantBehaviorInstruction, buildAuthorizedWorkspaceContext, buildProtectedPlatformInstruction } from './assistant-behavior-context';

const assistant = (overrides: Partial<Parameters<typeof buildAssistantContactEvidence>[0]> = {}) => ({
  id: '1f825f72-3a73-4c85-90dc-f96d4f2ca42b',
  organizationId: 'f825f72a-3a73-4c85-90dc-f96d4f2ca42b',
  name: 'North Shop',
  systemInstructions: 'HELP CONTACTS\nWebsite: https://north-shop.example/\nEmail: support@north-shop.example\nPhone: +1 202 555 0144\nListed location: North City, Exampleland.',
  updatedAt: new Date('2026-10-23T00:00:00.000Z'),
  ...overrides,
});

describe('assistant behavior and support contact evidence', () => {
  it('passes the complete stored behavior configuration into the response instruction layer', () => {
    const instructions = `Detailed merchant behavior ${'x'.repeat(9500)}`;
    const first = buildAssistantBehaviorInstruction({ ...assistant(), businessPurpose: 'Retail', description: 'Store', systemInstructions: instructions, defaultLanguage: 'auto', responseTone: 'warm', responseStyle: 'concise', greetingMessage: 'Hello', fallbackMessage: 'Ask support', escalationMessage: 'Contact support' });
    const second = buildAssistantBehaviorInstruction({ ...assistant(), name: 'Another assistant', businessPurpose: null, description: null, systemInstructions: 'Use a formal voice', defaultLanguage: 'English', responseTone: null, responseStyle: null, greetingMessage: null, fallbackMessage: null, escalationMessage: null });
    expect(first).toContain(instructions);
    expect(first).toContain('auto');
    expect(first).not.toContain('verified business fact');
    expect(second).not.toBe(first);
    expect(second).toContain('Another assistant');
  });

  it('builds one protected platform policy with the tenant-resolved workspace identity and enabled tools', () => {
    const context = buildAuthorizedWorkspaceContext({ ...assistant(), organization: { name: 'North Shop' }, businessPurpose: 'Retail products', description: 'Online clothing store' }, ['search_store_products']);
    expect(buildProtectedPlatformInstruction()).toContain('genuinely unrelated general-knowledge question');
    expect(JSON.parse(context)).toMatchObject({ workspaceDisplayName: 'North Shop', configuredBusinessScope: 'Retail products', enabledReadTools: ['search_store_products'] });
    expect(buildProtectedPlatformInstruction()).not.toContain('North Shop');
    expect(buildProtectedPlatformInstruction()).not.toContain('support@north-shop.example');
    expect(buildProtectedPlatformInstruction()).not.toContain('+1 202 555 0144');
  });

  it('accepts only validated labeled fields under an explicit HELP CONTACTS heading', () => {
    const parsed = parseAssistantHelpContacts(assistant().systemInstructions);
    expect(parsed?.content).toContain('support@north-shop.example');
    expect(parsed?.content).toContain('+1 202 555 0144');
    expect(parsed?.website).toBe('https://north-shop.example/');
    expect(parseAssistantHelpContacts('Email: support@north-shop.example')).toBeNull();
    expect(parseAssistantHelpContacts('HELP CONTACTS\nEmail: invalid-address\nPhone: 123')).toBeNull();
  });

  it('creates stable tenant-scoped evidence identity and changes it when contact facts change', () => {
    const first = buildAssistantContactEvidence(assistant());
    const changed = buildAssistantContactEvidence(assistant({ systemInstructions: 'HELP CONTACTS\nEmail: care@north-shop.example' }));
    expect(first).toMatchObject({ sourceId: assistant().id, type: 'ASSISTANT_CONFIGURATION', sourceAuthority: 'MERCHANT_KNOWLEDGE', dataCompleteness: 'COMPLETE' });
    expect(first?.chunkId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(changed?.contentHash).not.toBe(first?.contentHash);
    expect(changed?.chunkId).not.toBe(first?.chunkId);
  });

  it('keeps each assistant contact evidence isolated and has no cross-tenant fallback', () => {
    const north = buildAssistantContactEvidence(assistant());
    const south = buildAssistantContactEvidence(assistant({
      id: '2f825f72-3a73-4c85-90dc-f96d4f2ca42b',
      organizationId: '3f825f72-3a73-4c85-90dc-f96d4f2ca42b',
      name: 'South Shop',
      systemInstructions: 'HELP CONTACTS\nEmail: support@south-shop.example\nPhone: +1 202 555 0188',
    }));
    const unconfigured = buildAssistantContactEvidence(assistant({ systemInstructions: 'Use a friendly tone.' }));

    expect(north?.content).toContain('support@north-shop.example');
    expect(north?.content).not.toContain('support@south-shop.example');
    expect(south?.content).toContain('support@south-shop.example');
    expect(south?.content).not.toContain('support@north-shop.example');
    expect(unconfigured).toBeNull();
  });
});
