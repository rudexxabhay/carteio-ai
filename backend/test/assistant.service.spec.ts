import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssistantService } from '../src/modules/workspaces/assistant.service';
import { initializeEffectiveProviderConfiguration } from '../src/modules/workspaces/conversation-provider.service';
import { AssistantListQueryDto, CreateAssistantDto, UpdateAssistantDto } from '../src/modules/workspaces/assistant.dto';
import { UpdateAssistantPlaygroundDto } from '../src/modules/workspaces/playground.dto';
import type { PrismaService } from '../src/infrastructure/database/prisma.service';
import type { WorkspaceService } from '../src/modules/workspaces/workspace.service';

const record = (overrides: Record<string, unknown> = {}) => ({
  id: 'assistant-a', organizationId: 'org-a', createdById: 'user-a', name: 'Support', description: null,
  businessPurpose: null, systemInstructions: null, defaultLanguage: 'en', responseTone: 'professional',
  responseStyle: 'balanced', greetingMessage: null, escalationMessage: null,
  fallbackMessage: 'Contact the business.', status: 'DRAFT', createdAt: new Date(), updatedAt: new Date(), ...overrides,
});

describe('AssistantService', () => {
  let service: AssistantService;
  let db: Record<string, any>;
  let workspaces: { requireAccess: jest.Mock };

  beforeEach(() => {
    db = {
      chatbot: {
        create: jest.fn().mockResolvedValue(record()), findMany: jest.fn().mockResolvedValue([record()]), count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(record()), update: jest.fn().mockResolvedValue(record({ status: 'ACTIVE' })), updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      assistantBusinessRule: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue({ id: 'rule-a' }), create: jest.fn().mockResolvedValue({ id: 'rule-a', title: 'Policy', instruction: 'Use approved facts.', enabled: true }), update: jest.fn().mockResolvedValue({ id: 'rule-a', title: 'Policy', instruction: 'Use current facts.', enabled: true }), delete: jest.fn().mockResolvedValue({}), },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    db.$transaction = jest.fn((callback: (tx: any) => unknown) => callback(db));
    workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-a', role: 'OWNER' }) };
    service = new AssistantService(db as unknown as PrismaService, workspaces as unknown as WorkspaceService);
  });

  it.each(['OWNER', 'ADMIN'])('%s can create an assistant for the authorized organization', async (role) => {
    workspaces.requireAccess.mockResolvedValue({ organizationId: 'org-a', role });
    await service.create('user-a', 'alpha', { name: ' Support   Helper ' });
    expect(db.chatbot.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', createdById: 'user-a', name: 'Support Helper', defaultLanguage: 'auto', status: 'DRAFT' }) }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', actorUserId: 'user-a', action: 'assistant.created' }) }));
  });

  it('round-trips all saved Bot Behavior fields through tenant-qualified persistence', async () => {
    let persisted = record({ providerMode: 'MANUAL', providerFallbacks: [] });
    db.chatbot.findFirst.mockImplementation(async () => persisted);
    db.chatbot.update.mockImplementation(async ({ data }: any) => { persisted = { ...persisted, ...data }; return persisted; });
    const settings = { businessPurpose: 'Customer support', description: 'Business help', systemInstructions: 'Use approved facts.\nHELP CONTACTS\nEmail: help@example.test', defaultLanguage: 'hi-Latn', responseTone: 'friendly', responseStyle: 'detailed', greetingMessage: 'Welcome', fallbackMessage: 'Ask for clarification.', escalationMessage: 'Offer the verified support channel.' };
    const updated = await service.update('user-a', 'alpha', 'assistant-a', settings as UpdateAssistantDto);
    const reloaded = await service.get('user-a', 'alpha', 'assistant-a');
    expect(updated).toMatchObject(settings);
    expect(reloaded).toMatchObject(settings);
    expect(db.chatbot.update.mock.calls[0][0].where).toEqual({ id_organizationId: { id: 'assistant-a', organizationId: 'org-a' } });
    expect(db.chatbot.findFirst.mock.calls.at(-1)[0].where).toEqual({ id: 'assistant-a', organizationId: 'org-a' });
  });

  it('uses the effective environment provider for new assistants and ignores stale stored routes without changing records', async () => {
    try {
      initializeEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_API_KEY: 'test-only' });
      await service.create('user-a', 'alpha', { name: 'New assistant' });
      const createCall = db.chatbot.create.mock.calls[0][0];
      expect(createCall.data).not.toHaveProperty('aiProvider');
      expect(createCall.data).not.toHaveProperty('aiModel');

      db.chatbot.findFirst.mockResolvedValueOnce(record({ aiProvider: 'groq', aiModel: 'legacy-model' }));
      await expect(service.get('user-a', 'alpha', 'assistant-a')).resolves.toMatchObject({ aiProvider: 'gemini', aiModel: 'gemini-2.5-flash', effectiveProviderConfiguration: { provider: 'gemini', model: 'gemini-2.5-flash', ready: true } });
      await expect(service.list('user-a', 'alpha', { page: 1, pageSize: 25 })).resolves.toMatchObject({ assistants: [{ aiProvider: 'gemini', aiModel: 'gemini-2.5-flash', effectiveProviderConfiguration: { provider: 'gemini', model: 'gemini-2.5-flash' } }] });
      expect(db.chatbot.update).not.toHaveBeenCalled();
    } finally {
      initializeEffectiveProviderConfiguration(process.env);
    }
  });

  it('returns explicit safe not-ready metadata when the environment provider configuration is missing', async () => {
    try {
      initializeEffectiveProviderConfiguration({});
      db.chatbot.findFirst.mockResolvedValueOnce(record({ aiProvider: 'groq', aiModel: 'legacy-model' }));
      await expect(service.get('user-a', 'alpha', 'assistant-a')).resolves.toMatchObject({ aiProvider: null, aiModel: null, effectiveProviderConfiguration: { status: 'MISSING_PROVIDER', ready: false } });
    } finally {
      initializeEffectiveProviderConfiguration(process.env);
    }
  });

  it('rejects member creation and preserves member read access', async () => {
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.create('user-a', 'alpha', { name: 'Support' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.chatbot.create).not.toHaveBeenCalled();
    await expect(service.list('user-a', 'alpha', { page: 1, pageSize: 25 })).resolves.toMatchObject({ total: 1 });
  });

  it('scopes list and detail queries to the server-authorized tenant', async () => {
    await service.list('user-a', 'alpha', { page: 1, pageSize: 25 });
    expect(db.chatbot.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', archivedAt: null } }));
    db.chatbot.findFirst.mockResolvedValueOnce(null);
    await expect(service.get('user-a', 'alpha', 'assistant-from-org-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.chatbot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'assistant-from-org-b', organizationId: 'org-a' } }));
  });

  it('filters archived assistants within the authorized organization and validates list status values', async () => {
    await service.list('user-a', 'alpha', { page: 1, pageSize: 25, status: 'ARCHIVED' });
    expect(db.chatbot.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', archivedAt: { not: null } } }));
    const valid = plainToInstance(AssistantListQueryDto, { status: 'archived' });
    expect(await validate(valid)).toHaveLength(0);
    const invalid = plainToInstance(AssistantListQueryDto, { status: 'DELETED' });
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('requires manager access before archiving an assistant', async () => {
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.archive('member-a', 'alpha', 'assistant-a')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.chatbot.updateMany).not.toHaveBeenCalled();
  });

  it('does not reactivate an assistant if archive wins the concurrent lifecycle update', async () => {
    db.chatbot.findFirst.mockResolvedValueOnce(record({ status: 'INACTIVE' }));
    db.chatbot.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.setActive('user-a', 'alpha', 'assistant-a', true)).rejects.toMatchObject({ response: { code: 'ASSISTANT_ARCHIVED' } });
    expect(db.auditEvent.create).not.toHaveBeenCalled();
  });

  it('persists updates and activation changes with tenant scope and audit events', async () => {
    await service.update('user-a', 'alpha', 'assistant-a', { name: 'Help Desk' });
    expect(db.chatbot.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id_organizationId: { id: 'assistant-a', organizationId: 'org-a' } }, data: { name: 'Help Desk' } }));
    await service.setActive('user-a', 'alpha', 'assistant-a', true);
    expect(db.chatbot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'assistant-a', organizationId: 'org-a', archivedAt: null }, data: { status: 'ACTIVE' } }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'assistant.activated' }) }));
  });

  it('saves the full Bot Behavior fields and returns the persisted assistant configuration', async () => {
    const behavior = { name: 'Carteio', businessPurpose: 'Customer support', description: 'Carteio online store', systemInstructions: 'x'.repeat(9_500), defaultLanguage: 'auto', responseTone: 'friendly', responseStyle: 'short', greetingMessage: 'Namaste', fallbackMessage: 'Please contact support.', escalationMessage: 'A support teammate can help.' } as const;
    db.chatbot.update.mockResolvedValueOnce(record(behavior));
    const saved = await service.update('user-a', 'alpha', 'assistant-a', behavior);
    expect(db.chatbot.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id_organizationId: { id: 'assistant-a', organizationId: 'org-a' } },
      data: behavior,
      select: expect.objectContaining({ systemInstructions: true, defaultLanguage: true, responseTone: true, responseStyle: true, fallbackMessage: true, greetingMessage: true, escalationMessage: true }),
    }));
    expect(saved).toMatchObject({ name: 'Carteio', systemInstructions: 'x'.repeat(9_500), defaultLanguage: 'auto', responseTone: 'friendly', responseStyle: 'short' });
    db.chatbot.findFirst.mockResolvedValueOnce(record(behavior));
    const reloaded = await service.get('user-a', 'alpha', 'assistant-a');
    expect(db.chatbot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'assistant-a', organizationId: 'org-a' } }));
    expect(reloaded).toMatchObject({ systemInstructions: behavior.systemInstructions, greetingMessage: 'Namaste', fallbackMessage: 'Please contact support.', escalationMessage: 'A support teammate can help.' });
  });

  it('persists assistant-level all-eligible workspace knowledge access only through owner-authorized updates', async () => {
    await service.update('user-a', 'alpha', 'assistant-a', { useAllEligibleWorkspaceKnowledge: true });
    expect(db.chatbot.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id_organizationId: { id: 'assistant-a', organizationId: 'org-a' } },
      data: { useAllEligibleWorkspaceKnowledge: true },
      select: expect.objectContaining({ useAllEligibleWorkspaceKnowledge: true }),
    }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'assistant.behavior_updated', entityId: 'assistant-a' }) }));
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.update('member-a', 'alpha', 'assistant-a', { useAllEligibleWorkspaceKnowledge: false })).rejects.toBeInstanceOf(ForbiddenException);
    workspaces.requireAccess.mockResolvedValueOnce({ organizationId: 'org-a', role: 'ADMIN' });
    await expect(service.update('admin-a', 'alpha', 'assistant-a', { useAllEligibleWorkspaceKnowledge: false })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('archives an active assistant without deleting its linked or historical records, and records the audit event', async () => {
    const archivedAt = new Date('2026-10-13T12:00:00.000Z');
    jest.useFakeTimers({ now: archivedAt });
    try {
    db.chatbot.findFirst.mockResolvedValueOnce(record({ status: 'ACTIVE' })).mockResolvedValueOnce(record({ status: 'INACTIVE', archivedAt }));
    await expect(service.archive('user-a', 'alpha', 'assistant-a')).resolves.toMatchObject({ status: 'archived', archivedAt });
    expect(db.chatbot.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'assistant-a', organizationId: 'org-a', archivedAt: null },
      data: expect.objectContaining({ archivedAt, status: 'INACTIVE' }),
    }));
    expect(db.chatbot.update).not.toHaveBeenCalled();
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'assistant.archived', metadata: { previousStatus: 'ACTIVE' } }) }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('restores an archived assistant as inactive and never reactivates it implicitly', async () => {
    db.chatbot.findFirst.mockResolvedValueOnce(record({ status: 'INACTIVE', archivedAt: new Date() })).mockResolvedValueOnce(record({ status: 'INACTIVE', archivedAt: null }));
    await expect(service.restore('user-a', 'alpha', 'assistant-a')).resolves.toMatchObject({ status: 'inactive', archivedAt: null });
    expect(db.chatbot.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { archivedAt: null } }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'assistant.restored' }) }));
  });

  it('refuses permanent deletion while cascade relationships could erase retained records', async () => {
    await expect(service.permanentDeleteUnavailable('user-a', 'alpha', 'assistant-a')).rejects.toMatchObject({ response: { code: 'ASSISTANT_DELETE_UNAVAILABLE' } });
    expect(db.chatbot.delete).toBeUndefined();
    expect(db.chatbot.deleteMany).toBeUndefined();
  });

  it('allows only authorized managers to change fallback routing and rejects direct provider/model overrides', async () => {
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    const override = Object.assign(new UpdateAssistantDto(), { aiProvider: 'openai', aiModel: 'gpt-4o-mini' });
    await expect(service.update('member-a', 'alpha', 'assistant-a', override)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.chatbot.update).not.toHaveBeenCalled();
    await expect(service.update('owner-a', 'alpha', 'assistant-a', override)).rejects.toMatchObject({ response: { code: 'PROVIDER_CONFIGURATION_SERVER_MANAGED' } });
    expect(db.chatbot.update).not.toHaveBeenCalled();
  });

  it('keeps fallback owner-approved and validates duplicates against the effective environment primary', async () => {
    initializeEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-2.5-flash' });
    try {
      db.chatbot.update.mockResolvedValueOnce(record({ providerMode: 'AUTO_FALLBACK', providerFallbacks: [{ provider: 'groq', model: 'openai/gpt-oss-20b' }] }));
      db.chatbot.findFirst.mockResolvedValueOnce(record({ providerMode: 'MANUAL', providerFallbacks: [] }));
      await expect(service.update('owner-a', 'alpha', 'assistant-a', {
        providerMode: 'AUTO_FALLBACK', providerFallbacks: [{ provider: 'groq', model: 'openai/gpt-oss-20b' }],
      })).resolves.toMatchObject({ providerMode: 'AUTO_FALLBACK' });
      expect(db.chatbot.update).toHaveBeenCalledWith(expect.objectContaining({ data: { providerMode: 'AUTO_FALLBACK', providerFallbacks: [{ provider: 'groq', model: 'openai/gpt-oss-20b' }] } }));

      db.chatbot.findFirst.mockResolvedValueOnce(record({ providerMode: 'MANUAL', providerFallbacks: [] }));
      await expect(service.update('owner-a', 'alpha', 'assistant-a', {
        providerMode: 'AUTO_FALLBACK', providerFallbacks: [{ provider: 'gemini', model: 'gemini-2.5-flash' }],
      })).rejects.toMatchObject({ response: { code: 'DUPLICATE_PROVIDER_FALLBACK' } });
    } finally { initializeEffectiveProviderConfiguration(process.env); }
  });

  it('rejects invalid create payload values', async () => {
    const dto = plainToInstance(CreateAssistantDto, { name: '  ', defaultLanguage: 'not a language tag', responseTone: 'system' });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects client-supplied primary provider and model fields at the DTO boundary', async () => {
    const dto = plainToInstance(UpdateAssistantPlaygroundDto, { aiProvider: 'openai', aiModel: 'gpt-4o-mini', providerMode: 'MANUAL' });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
  });

  it('persists Bot Behavior preferences and accepts automatic language as a future setting', async () => {
    const dto = plainToInstance(UpdateAssistantDto, { defaultLanguage: 'auto', responseTone: 'casual', responseStyle: 'detailed' });
    expect(await validate(dto)).toHaveLength(0);
    await service.update('user-a', 'alpha', 'assistant-a', dto);
    expect(db.chatbot.update).toHaveBeenCalledWith(expect.objectContaining({ data: { defaultLanguage: 'auto', responseTone: 'casual', responseStyle: 'detailed' } }));
  });

  it('stores rules within the authorized assistant and blocks MEMBER mutations', async () => {
    await service.createRule('user-a', 'alpha', 'assistant-a', { title: 'Stay factual', instruction: 'Use only approved business knowledge.' });
    expect(db.assistantBusinessRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', assistantId: 'assistant-a', title: 'Stay factual' }) }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'assistant.business_rule_created', entityId: 'assistant-a' }) }));
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.deleteRule('member-a', 'alpha', 'assistant-a', 'rule-a')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.assistantBusinessRule.delete).not.toHaveBeenCalled();
  });
});
