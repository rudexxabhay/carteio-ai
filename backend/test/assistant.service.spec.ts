import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssistantService } from '../src/modules/workspaces/assistant.service';
import { CreateAssistantDto } from '../src/modules/workspaces/assistant.dto';
import type { PrismaService } from '../src/infrastructure/database/prisma.service';
import type { WorkspaceService } from '../src/modules/workspaces/workspace.service';

const record = (overrides: Record<string, unknown> = {}) => ({
  id: 'assistant-a', organizationId: 'org-a', createdById: 'user-a', name: 'Support', description: null,
  businessPurpose: null, systemInstructions: null, defaultLanguage: 'en', responseTone: 'professional',
  fallbackMessage: 'Contact the business.', status: 'DRAFT', createdAt: new Date(), updatedAt: new Date(), ...overrides,
});

describe('AssistantService', () => {
  let service: AssistantService;
  let db: Record<string, any>;
  let workspaces: Record<string, jest.Mock>;

  beforeEach(() => {
    db = {
      chatbot: {
        create: jest.fn().mockResolvedValue(record()), findMany: jest.fn().mockResolvedValue([record()]), count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(record()), update: jest.fn().mockResolvedValue(record({ status: 'ACTIVE' })),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    db.$transaction = jest.fn((callback: (tx: any) => unknown) => callback(db));
    workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-a', role: 'OWNER' }) };
    service = new AssistantService(db as unknown as PrismaService, workspaces as unknown as WorkspaceService);
  });

  it.each(['OWNER', 'ADMIN'])('%s can create an assistant for the authorized organization', async (role) => {
    workspaces.requireAccess.mockResolvedValue({ organizationId: 'org-a', role });
    await service.create('user-a', 'alpha', { name: ' Support   Helper ' });
    expect(db.chatbot.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', createdById: 'user-a', name: 'Support Helper', status: 'DRAFT' }) }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', actorUserId: 'user-a', action: 'assistant.created' }) }));
  });

  it('rejects member creation and preserves member read access', async () => {
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.create('user-a', 'alpha', { name: 'Support' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.chatbot.create).not.toHaveBeenCalled();
    await expect(service.list('user-a', 'alpha', { page: 1, pageSize: 25 })).resolves.toMatchObject({ total: 1 });
  });

  it('scopes list and detail queries to the server-authorized tenant', async () => {
    await service.list('user-a', 'alpha', { page: 1, pageSize: 25 });
    expect(db.chatbot.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a' } }));
    db.chatbot.findFirst.mockResolvedValueOnce(null);
    await expect(service.get('user-a', 'alpha', 'assistant-from-org-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.chatbot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'assistant-from-org-b', organizationId: 'org-a' } }));
  });

  it('persists updates and activation changes with tenant scope and audit events', async () => {
    await service.update('user-a', 'alpha', 'assistant-a', { name: 'Help Desk' });
    expect(db.chatbot.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id_organizationId: { id: 'assistant-a', organizationId: 'org-a' } }, data: { name: 'Help Desk' } }));
    await service.setActive('user-a', 'alpha', 'assistant-a', true);
    expect(db.chatbot.update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id_organizationId: { id: 'assistant-a', organizationId: 'org-a' } }, data: { status: 'ACTIVE' } }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'assistant.activated' }) }));
  });

  it('rejects invalid create payload values', async () => {
    const dto = plainToInstance(CreateAssistantDto, { name: '  ', defaultLanguage: 'not a language tag', responseTone: 'system' });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
