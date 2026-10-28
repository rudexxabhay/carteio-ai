import 'reflect-metadata';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KnowledgeService, normalizePublicWebsiteUrl } from '../src/modules/workspaces/knowledge.service';
import { CreateTextSourceDto, CreateWebsiteSourceDto } from '../src/modules/workspaces/knowledge.dto';
import type { PrismaService } from '../src/infrastructure/database/prisma.service';
import type { WorkspaceService } from '../src/modules/workspaces/workspace.service';

const source = (overrides: Record<string, unknown> = {}) => ({ id: 'source-a', organizationId: 'org-a', createdById: 'user-a', type: 'FAQ', status: 'REGISTERED', processingStatus: 'NOT_PROCESSED', name: 'Return policy?', description: null, sourceUrl: null, contentBody: ' सात days में return करें ', category: null, languageHint: 'hi', sourceVersion: 1, lastSyncAt: null, lastSuccessfulSyncAt: null, lastSyncErrorCode: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...overrides });

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let db: Record<string, any>;
  let workspaces: { requireAccess: jest.Mock };

  beforeEach(() => {
    db = {
      knowledgeSource: { create: jest.fn().mockResolvedValue(source({ processingStatus: 'QUEUED' })), createMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([source()]), findFirst: jest.fn().mockResolvedValue(source()), update: jest.fn().mockResolvedValue(source()), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      knowledgeProcessingJob: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'job-a' }), createMany: jest.fn().mockResolvedValue({ count: 1 }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 'base-a' }), findMany: jest.fn().mockResolvedValue([]) },
      knowledgeBaseSource: { create: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      chatbot: { findFirst: jest.fn().mockResolvedValue({ id: 'assistant-a', archivedAt: null }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      assistantKnowledgeSource: { create: jest.fn().mockResolvedValue({ assistantId: 'assistant-a', sourceId: 'source-a' }), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    db.$transaction = jest.fn((callback: (tx: any) => unknown) => callback(db));
    workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-a', role: 'OWNER' }) };
    service = new KnowledgeService(db as unknown as PrismaService, workspaces as unknown as WorkspaceService);
  });

  it('normalizes public website URLs and rejects unsafe destinations', () => {
    expect(normalizePublicWebsiteUrl('HTTPS://Example.com/path/#section')).toEqual({ url: 'https://example.com/path', hostname: 'example.com' });
    for (const value of ['javascript:alert(1)', 'http://localhost/admin', 'http://127.0.0.1', 'http://2130706433', 'http://192.168.1.1', 'http://192.0.0.5', 'http://[::ffff:7f00:1]', 'http://[2001:1::1]', 'http://user:pass@example.com']) {
      expect(() => normalizePublicWebsiteUrl(value)).toThrow();
    }
  });

  it('validates website DTO payloads', async () => {
    const valid = plainToInstance(CreateWebsiteSourceDto, { sourceUrl: 'https://example.com' });
    const invalid = plainToInstance(CreateWebsiteSourceDto, { sourceUrl: 'x' });
    expect(await validate(valid)).toHaveLength(0);
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('validates static knowledge sections and persists the selected section on text sources', async () => {
    const valid = plainToInstance(CreateTextSourceDto, { title: 'Shipping', content: 'Policy details', knowledgeSection: 'SHIPPING_DELIVERY' });
    const invalid = plainToInstance(CreateTextSourceDto, { title: 'Shipping', content: 'Policy details', knowledgeSection: 'PRODUCTS' });
    expect(await validate(valid)).toHaveLength(0);
    expect(await validate(invalid)).not.toHaveLength(0);

    await service.createText('user-a', 'alpha', { title: 'Shipping', content: 'Policy details', knowledgeSection: 'SHIPPING_DELIVERY' });
    expect(db.knowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ knowledgeSection: 'SHIPPING_DELIVERY' }) }));
  });

  it('makes only explicitly selected owner-reviewed FAQ sources public and reports blocked records', async () => {
    db.knowledgeSource.findMany.mockResolvedValueOnce([
      { id: 'faq-private', type: 'FAQ', status: 'REGISTERED', visibility: 'INTERNAL_RESTRICTED', connectorInstanceId: null },
      { id: 'faq-public', type: 'FAQ', status: 'REGISTERED', visibility: 'PUBLIC_REFERENCE', connectorInstanceId: null },
      { id: 'text-private', type: 'TEXT', status: 'REGISTERED', visibility: 'INTERNAL_RESTRICTED', connectorInstanceId: null },
    ]);
    const result = await service.bulkMakeFaqSourcesPublic('owner-a', 'alpha', ['faq-private', 'faq-public', 'text-private']);
    expect(result).toEqual({ requested: 3, changedToPublic: 1, alreadyPublic: 1, blocked: 1, blockedReasons: { NOT_FAQ: 1 }, publicVisibilityRequiresOwnerReview: true });
    expect(workspaces.requireAccess).toHaveBeenCalledWith('owner-a', 'alpha', ['OWNER']);
    expect(db.knowledgeSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a', type: 'FAQ', connectorInstanceId: null, visibility: 'INTERNAL_RESTRICTED' }), data: { visibility: 'PUBLIC_REFERENCE' } }));
  });

  it('rejects bulk visibility changes for non-owners', async () => {
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.bulkMakeFaqSourcesPublic('admin-a', 'alpha', ['faq-a'])).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.knowledgeSource.updateMany).not.toHaveBeenCalled();
  });

  it('persists an explicitly customer-facing FAQ as PUBLIC_REFERENCE', async () => {
    await service.createFaq('owner-a', 'alpha', { question: 'Where can customers read the policy?', answer: 'See the published policy.', visibility: 'PUBLIC_REFERENCE' });
    expect(db.knowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'FAQ', visibility: 'PUBLIC_REFERENCE' }) }));
  });

  it('atomically enables assistant workspace knowledge and explicitly selected FAQs for an owner', async () => {
    db.chatbot.findFirst.mockResolvedValueOnce({ id: 'assistant-a', status: 'ACTIVE', archivedAt: null });
    db.knowledgeSource.findMany.mockResolvedValueOnce([
      { id: 'faq-a', type: 'FAQ', status: 'REGISTERED', visibility: 'INTERNAL_RESTRICTED', connectorInstanceId: null },
    ]);
    const result = await service.activateCustomerKnowledge('owner-a', 'alpha', 'assistant-a', ['faq-a']);
    expect(result).toMatchObject({ assistantId: 'assistant-a', useAllEligibleWorkspaceKnowledge: true, changedToPublic: 1, blocked: 0 });
    expect(db.chatbot.updateMany).toHaveBeenCalledWith({ where: { id: 'assistant-a', organizationId: 'org-a', archivedAt: null }, data: { useAllEligibleWorkspaceKnowledge: true } });
    expect(db.knowledgeSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a', id: { in: ['faq-a'] }, visibility: 'INTERNAL_RESTRICTED' }), data: { visibility: 'PUBLIC_REFERENCE' } }));
  });

  it('supports a single activation request for 100 selected FAQs', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `faq-${index}`);
    db.chatbot.findFirst.mockResolvedValueOnce({ id: 'assistant-a', status: 'ACTIVE', archivedAt: null });
    db.knowledgeSource.findMany.mockResolvedValueOnce(ids.map(id => ({ id, type: 'FAQ', status: 'REGISTERED', visibility: 'INTERNAL_RESTRICTED', connectorInstanceId: null })));
    db.knowledgeSource.updateMany.mockResolvedValueOnce({ count: 100 });
    const result = await service.activateCustomerKnowledge('owner-a', 'alpha', 'assistant-a', ids);
    expect(result).toMatchObject({ requested: 100, changedToPublic: 100, blocked: 0 });
  });

  it('rejects an assistant from another workspace without changing selected source visibility', async () => {
    db.chatbot.findFirst.mockResolvedValueOnce(null);
    await expect(service.activateCustomerKnowledge('owner-a', 'alpha', 'assistant-from-other-org', ['faq-a'])).rejects.toBeInstanceOf(NotFoundException);
    expect(db.knowledgeSource.updateMany).not.toHaveBeenCalled();
  });

  it('keeps customer knowledge activation owner-only', async () => {
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.activateCustomerKnowledge('admin-a', 'alpha', 'assistant-a', ['faq-a'])).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('preserves explicit public visibility on imported FAQ rows', async () => {
    const publicRow = { rowNumber: 2, question: 'How long does delivery take?', answer: 'See the published delivery terms.', visibility: 'PUBLIC_REFERENCE' as const, errors: [], duplicateInFile: false, duplicateExisting: false };
    db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'faq-public' }]);
    await expect(service.importFaqRows('owner-a', 'alpha', 'base-a', [publicRow], 'SKIP_EXISTING')).resolves.toMatchObject({ created: 1 });
    expect(db.knowledgeSource.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ visibility: 'PUBLIC_REFERENCE' })] }));
  });

  it('rejects website knowledge and atomically queues a new FAQ', async () => {
    await expect(service.createWebsite('user-a', 'alpha', { sourceUrl: 'http://127.0.0.1' })).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
    await service.createFaq('user-a', 'alpha', { question: 'Return policy?', answer: 'सात days में return करें', languageHint: 'hi' });
    expect(db.knowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'FAQ', languageHint: 'hi', organizationId: 'org-a', processingStatus: 'QUEUED' }) }));
    expect(db.knowledgeProcessingJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', sourceId: 'source-a', sourceVersion: 1, kind: 'INDEX', status: 'QUEUED' }) }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', actorUserId: 'user-a', action: 'knowledge.faq_created' }) }));
    expect(db.knowledgeBaseSource.createMany).not.toHaveBeenCalled();
  });

  it('creates knowledge directly inside a collection in the same transaction', async () => {
    await service.createFaqInBase('user-a', 'alpha', 'base-a', { question: 'Returns?', answer: 'Within seven days.' });
    expect(db.knowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', name: 'Returns?', contentBody: 'Within seven days.' }) }));
    expect(db.knowledgeBaseSource.create).toHaveBeenCalledWith({ data: { organizationId: 'org-a', knowledgeBaseId: 'base-a', sourceId: 'source-a' } });
  });

  it('auto-links newly created FAQ and text sources only to opted-in bases without changing visibility', async () => {
    db.knowledgeBase.findMany.mockResolvedValueOnce([{ id: 'base-opted-in' }]);
    await service.createFaq('user-a', 'alpha', { question: 'Shipping?', answer: 'See the policy.' });
    expect(db.knowledgeBase.findMany).toHaveBeenCalledWith({ where: { organizationId: 'org-a', status: 'ACTIVE', archivedAt: null, autoAddEligibleSources: true }, select: { id: true } });
    expect(db.knowledgeBaseSource.createMany).toHaveBeenCalledWith({ data: [{ organizationId: 'org-a', knowledgeBaseId: 'base-opted-in', sourceId: 'source-a' }], skipDuplicates: true });
    expect(db.knowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ visibility: 'INTERNAL_RESTRICTED' }) }));
  });

  it('creates a FAQ batch and collection memberships atomically with conservative visibility', async () => {
    db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'faq-a', canonicalKey: 'faq:a' }, { id: 'faq-b', canonicalKey: 'faq:b' }]);
    db.knowledgeBaseSource.createMany.mockResolvedValueOnce({ count: 2 });
    await expect(service.createFaqBatchInBase('user-a', 'alpha', 'base-a', { faqs: [{ question: 'प्रश्न?', answer: 'उत्तर', languageHint: 'hi' }, { question: 'Question?', answer: 'Answer', category: 'Help' }] })).resolves.toMatchObject({ created: 2, sourceIds: ['faq-a', 'faq-b'] });
    expect(db.knowledgeSource.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ visibility: 'INTERNAL_RESTRICTED', name: 'प्रश्न?', contentBody: 'उत्तर' })]) }));
    expect(db.knowledgeBaseSource.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ knowledgeBaseId: 'base-a' })]) }));
    expect(db.knowledgeProcessingJob.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ kind: 'INDEX', status: 'QUEUED' })]) }));
  });

  it('imports only valid new FAQ rows with internal visibility and reports duplicate skips', async () => {
    db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'imported-a' }]);
    db.knowledgeBaseSource.createMany.mockResolvedValueOnce({ count: 1 });
    const rows = [{ rowNumber: 2, question: 'नमस्ते?', answer: 'उत्तर', language: 'hi', errors: [], duplicateInFile: false, duplicateExisting: false }];
    await expect(service.importFaqRows('user-a', 'alpha', 'base-a', rows, 'SKIP_EXISTING')).resolves.toEqual({ created: 1, skipped: 0, failed: 0, updated: 0, duplicateRowsInFile: 0 });
    expect(db.knowledgeSource.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ name: 'नमस्ते?', contentBody: 'उत्तर', languageHint: 'hi', visibility: 'INTERNAL_RESTRICTED' })] }));
    expect(db.knowledgeBaseSource.createMany).toHaveBeenCalled();
    expect(db.knowledgeProcessingJob.createMany).toHaveBeenCalled();
  });

  it('preserves workspace authorization for FAQ imports and propagates persistence failures without queuing indexing', async () => {
    const row = { rowNumber: 2, question: 'How can I contact support?', answer: 'Use official channels.', errors: [], duplicateInFile: false, duplicateExisting: false };
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.importFaqRows('member-a', 'alpha', 'base-a', [row], 'SKIP_EXISTING')).rejects.toBeInstanceOf(ForbiddenException);

    db.knowledgeBase.findFirst.mockResolvedValueOnce(null);
    await expect(service.importFaqRows('user-a', 'alpha', 'foreign-base', [row], 'SKIP_EXISTING')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.knowledgeSource.createMany).not.toHaveBeenCalled();

    db.knowledgeSource.findMany.mockResolvedValueOnce([]);
    db.knowledgeSource.createMany.mockRejectedValueOnce(new Error('source insert failed'));
    await expect(service.importFaqRows('user-a', 'alpha', 'base-a', [row], 'SKIP_EXISTING')).rejects.toThrow('source insert failed');
    expect(db.knowledgeProcessingJob.createMany).not.toHaveBeenCalled();
  });

  it('persists all 154 valid FAQ rows and queues one indexing job for every created source', async () => {
    const rows = Array.from({ length: 154 }, (_, index) => ({ rowNumber: index + 2, question: `Question ${index + 1}?`, answer: `Answer ${index + 1}.`, errors: [], duplicateInFile: false, duplicateExisting: false }));
    db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(rows.map((_, index) => ({ id: `faq-${index + 1}` })));
    db.knowledgeSource.createMany.mockResolvedValueOnce({ count: rows.length });
    db.knowledgeProcessingJob.createMany.mockResolvedValueOnce({ count: rows.length });
    db.knowledgeBaseSource.createMany.mockResolvedValueOnce({ count: rows.length });
    await expect(service.importFaqRows('user-a', 'alpha', 'base-a', rows, 'SKIP_EXISTING')).resolves.toMatchObject({ created: 154, skipped: 0, failed: 0 });
    expect(db.knowledgeSource.createMany.mock.calls[0]?.[0].data).toHaveLength(154);
    expect(db.knowledgeProcessingJob.createMany.mock.calls[0]?.[0].data).toHaveLength(154);
    expect(db.knowledgeBaseSource.createMany.mock.calls[0]?.[0].data).toHaveLength(154);
  });

  it('archives selected sources with workspace scoping while retaining membership records', async () => {
    await expect(service.archiveMany('user-a', 'alpha', ['source-a'])).resolves.toEqual({ requested: 1, archived: 1, alreadyArchived: 0 });
    expect(db.knowledgeSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['source-a'] }, organizationId: 'org-a', status: { not: 'ARCHIVED' } } }));
    expect(db.knowledgeBaseSource.create).not.toHaveBeenCalled();
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.archiveMany('member-a', 'alpha', ['source-a'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires manager membership for mutations and rejects duplicate source keys', async () => {
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.createText('user-m', 'alpha', { title: 'Guide', content: 'Text' })).rejects.toBeInstanceOf(ForbiddenException);
    db.knowledgeSource.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.createFaq('user-a', 'alpha', { question: 'Q', answer: 'A' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows workspace admins to create knowledge while members remain read-only', async () => {
    workspaces.requireAccess.mockResolvedValueOnce({ organizationId: 'org-a', role: 'ADMIN' });
    await service.createText('admin-a', 'alpha', { title: 'Guide', content: 'Content' });
    expect(db.knowledgeSource.create).toHaveBeenCalled();
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.update('member-a', 'alpha', 'source-a', { content: 'Changed' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.knowledgeSource.update).not.toHaveBeenCalled();
  });

  it('scopes source and assistant access to current tenant', async () => {
    db.knowledgeSource.findFirst.mockResolvedValueOnce(null);
    await expect(service.get('user-a', 'alpha', 'source-org-b')).rejects.toBeInstanceOf(NotFoundException);
    db.chatbot.findFirst.mockResolvedValueOnce(null);
    await expect(service.attach('user-a', 'alpha', 'assistant-org-b', 'source-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.assistantKnowledgeSource.create).not.toHaveBeenCalled();
  });

  it('uses tenant-qualified source updates and excludes archived sources from active lists', async () => {
    await service.update('user-a', 'alpha', 'source-a', { answer: 'Updated' });
    expect(db.knowledgeSource.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id_organizationId: { id: 'source-a', organizationId: 'org-a' } } }));
    await service.list('user-a', 'alpha');
    expect(db.knowledgeSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', status: { not: 'ARCHIVED' }, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] } } }));
  });

  it('preserves Unicode text body exactly when creating a text source', async () => {
    const content = '\nनमस्ते दुनिया 🌏\n  ';
    await service.createText('user-a', 'alpha', { title: 'Hindi guide', content });
    expect(db.knowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contentBody: content }) }));
  });

  it('rejects duplicate links and unlinks the relation without deleting the source', async () => {
    db.assistantKnowledgeSource.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.attach('user-a', 'alpha', 'assistant-a', 'source-a')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.detach('user-a', 'alpha', 'assistant-a', 'source-a')).resolves.toMatchObject({ unlinked: true });
    expect(db.knowledgeSource.update).not.toHaveBeenCalled();
  });

  it('does not permit archived sources to be linked to an assistant', async () => {
    db.knowledgeSource.findFirst.mockResolvedValueOnce(source({ status: 'ARCHIVED' }));
    await expect(service.attach('user-a', 'alpha', 'assistant-a', 'source-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.assistantKnowledgeSource.create).not.toHaveBeenCalled();
  });
});
