import 'reflect-metadata';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KnowledgeService, normalizePublicWebsiteUrl } from '../src/modules/workspaces/knowledge.service';
import { CreateFaqSourceDto, CreateWebsiteSourceDto } from '../src/modules/workspaces/knowledge.dto';
import type { PrismaService } from '../src/infrastructure/database/prisma.service';
import type { WorkspaceService } from '../src/modules/workspaces/workspace.service';

const source = (overrides: Record<string, unknown> = {}) => ({ id: 'source-a', organizationId: 'org-a', createdById: 'user-a', type: 'FAQ', status: 'REGISTERED', processingStatus: 'NOT_PROCESSED', name: 'Return policy?', description: null, sourceUrl: null, contentBody: ' सात days में return करें ', category: null, languageHint: 'hi', sourceVersion: 1, lastSyncAt: null, lastSuccessfulSyncAt: null, lastSyncErrorCode: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...overrides });

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let db: Record<string, any>;
  let workspaces: { requireAccess: jest.Mock };

  beforeEach(() => {
    db = {
      knowledgeSource: { create: jest.fn().mockResolvedValue(source()), findMany: jest.fn().mockResolvedValue([source()]), findFirst: jest.fn().mockResolvedValue(source()), update: jest.fn().mockResolvedValue(source()) },
      chatbot: { findFirst: jest.fn().mockResolvedValue({ id: 'assistant-a' }) },
      assistantKnowledgeSource: { create: jest.fn().mockResolvedValue({ assistantId: 'assistant-a', sourceId: 'source-a' }), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    db.$transaction = jest.fn((callback: (tx: any) => unknown) => callback(db));
    workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-a', role: 'OWNER' }) };
    service = new KnowledgeService(db as unknown as PrismaService, workspaces as unknown as WorkspaceService);
  });

  it('normalizes public website URLs and rejects unsafe destinations', () => {
    expect(normalizePublicWebsiteUrl('HTTPS://Example.com/path/#section')).toEqual({ url: 'https://example.com/path', hostname: 'example.com' });
    for (const value of ['javascript:alert(1)', 'http://localhost/admin', 'http://127.0.0.1', 'http://192.168.1.1', 'http://[::ffff:7f00:1]', 'http://user:pass@example.com']) {
      expect(() => normalizePublicWebsiteUrl(value)).toThrow();
    }
  });

  it('validates website DTO payloads', async () => {
    const valid = plainToInstance(CreateWebsiteSourceDto, { sourceUrl: 'https://example.com' });
    const invalid = plainToInstance(CreateWebsiteSourceDto, { sourceUrl: 'x' });
    expect(await validate(valid)).toHaveLength(0);
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('creates tenant-owned website and FAQ sources without claiming processing', async () => {
    db.knowledgeSource.create.mockResolvedValueOnce(source({ type: 'WEBSITE', name: 'example.com', sourceUrl: 'https://example.com' }));
    const website = await service.createWebsite('user-a', 'alpha', { sourceUrl: 'https://example.com' });
    expect(db.knowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', createdById: 'user-a', status: 'REGISTERED', processingStatus: 'NOT_PROCESSED' }) }));
    expect(website.processingStatus).toBe('not_processed');
    await service.createFaq('user-a', 'alpha', { question: 'Return policy?', answer: ' सात दिन में वापस करें ', languageHint: 'hi' });
    expect(db.knowledgeSource.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'FAQ', contentBody: 'सात दिन में वापस करें', languageHint: 'hi', organizationId: 'org-a' }) }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', actorUserId: 'user-a', action: 'knowledge.faq_created' }) }));
  });

  it('requires manager membership for mutations and rejects duplicate source keys', async () => {
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.createText('user-m', 'alpha', { title: 'Guide', content: 'Text' })).rejects.toBeInstanceOf(ForbiddenException);
    db.knowledgeSource.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.createFaq('user-a', 'alpha', { question: 'Q', answer: 'A' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('scopes source and assistant access to current tenant', async () => {
    db.knowledgeSource.findFirst.mockResolvedValueOnce(null);
    await expect(service.get('user-a', 'alpha', 'source-org-b')).rejects.toBeInstanceOf(NotFoundException);
    db.chatbot.findFirst.mockResolvedValueOnce(null);
    await expect(service.attach('user-a', 'alpha', 'assistant-org-b', 'source-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.assistantKnowledgeSource.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate links and unlinks the relation without deleting the source', async () => {
    db.assistantKnowledgeSource.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.attach('user-a', 'alpha', 'assistant-a', 'source-a')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.detach('user-a', 'alpha', 'assistant-a', 'source-a')).resolves.toMatchObject({ unlinked: true });
    expect(db.knowledgeSource.update).not.toHaveBeenCalled();
  });
});
