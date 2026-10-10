import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkspaceService } from './workspace.service';
import type { CreateAssistantDto, UpdateAssistantDto } from './assistant.dto';
import type { WorkspacePaginationDto } from './workspace.dto';

const managers = ['OWNER', 'ADMIN'] as const;
const isUniqueConflict = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
const assistantSelect = {
  id: true, organizationId: true, createdById: true, name: true, description: true, businessPurpose: true,
  systemInstructions: true, defaultLanguage: true, responseTone: true, fallbackMessage: true,
  status: true, createdAt: true, updatedAt: true,
};

@Injectable()
export class AssistantService {
  private readonly db: any;

  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService) {
    this.db = prisma as any;
  }

  async create(userId: string, slug: string, input: CreateAssistantDto) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (name.length < 2) throw new BadRequestException({ code: 'INVALID_ASSISTANT_NAME', message: 'Assistant name must be at least 2 characters.' });
    try {
      const assistant = await this.db.$transaction(async (tx: any) => {
        const created = await tx.chatbot.create({ data: {
          organizationId: membership.organizationId,
          createdById: userId,
          name,
          description: input.description?.trim() || null,
          businessPurpose: input.businessPurpose?.trim() || null,
          systemInstructions: input.systemInstructions?.trim() || null,
          defaultLanguage: input.defaultLanguage?.trim() || 'en',
          responseTone: input.responseTone || 'professional',
          fallbackMessage: input.fallbackMessage?.trim() || 'I’m not able to help with that right now. Please contact the business directly.',
          status: 'DRAFT',
        }, select: assistantSelect });
        await this.audit(tx, membership.organizationId, userId, 'assistant.created', created.id);
        return created;
      });
      return this.view(assistant);
    } catch (error) {
      if (isUniqueConflict(error)) throw new ConflictException({ code: 'ASSISTANT_CONFLICT', message: 'The assistant could not be created because its data conflicts with an existing record.' });
      throw error;
    }
  }

  async list(userId: string, slug: string, pagination: WorkspacePaginationDto) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const where = { organizationId: membership.organizationId };
    const page = pagination.page ?? 1;
    const pageSize = Math.min(pagination.pageSize ?? 25, 100);
    const [records, total] = await Promise.all([
      this.db.chatbot.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: assistantSelect }),
      this.db.chatbot.count({ where }),
    ]);
    return { assistants: records.map((record: any) => this.view(record)), page, pageSize, total };
  }

  async get(userId: string, slug: string, assistantId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const record = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: membership.organizationId }, select: assistantSelect });
    if (!record) throw this.notFound();
    return this.view(record);
  }

  async update(userId: string, slug: string, assistantId: string, input: UpdateAssistantDto) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const data: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'businessPurpose', 'systemInstructions', 'defaultLanguage', 'responseTone', 'fallbackMessage'] as const) {
      if (input[key] !== undefined) data[key] = typeof input[key] === 'string' ? input[key]!.trim() : input[key];
    }
    if (!Object.keys(data).length) throw new BadRequestException({ code: 'EMPTY_ASSISTANT_UPDATE', message: 'Choose at least one assistant setting to update.' });
    if (typeof data.name === 'string') {
      const normalizedName = (data.name as string).replace(/\s+/g, ' ');
      data.name = normalizedName;
      if (normalizedName.length < 2) throw new BadRequestException({ code: 'INVALID_ASSISTANT_NAME', message: 'Assistant name must be at least 2 characters.' });
    }
    const existing = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: membership.organizationId }, select: { id: true } });
    if (!existing) throw this.notFound();
    const updated = await this.db.$transaction(async (tx: any) => {
      const record = await tx.chatbot.update({ where: { id_organizationId: { id: existing.id, organizationId: membership.organizationId } }, data, select: assistantSelect });
      await this.audit(tx, membership.organizationId, userId, 'assistant.updated', assistantId);
      return record;
    });
    return this.view(updated);
  }

  async setActive(userId: string, slug: string, assistantId: string, active: boolean) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const existing = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: membership.organizationId }, select: { id: true, status: true } });
    if (!existing) throw this.notFound();
    const nextStatus = active ? 'ACTIVE' : 'INACTIVE';
    if (existing.status !== nextStatus) {
      const updated = await this.db.$transaction(async (tx: any) => {
        const record = await tx.chatbot.update({ where: { id_organizationId: { id: existing.id, organizationId: membership.organizationId } }, data: { status: nextStatus }, select: assistantSelect });
        await this.audit(tx, membership.organizationId, userId, active ? 'assistant.activated' : 'assistant.deactivated', assistantId);
        return record;
      });
      return this.view(updated);
    }
    return this.get(userId, slug, assistantId);
  }

  private async audit(tx: any, organizationId: string, userId: string, action: string, assistantId: string) {
    await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action, entityType: 'chatbot', entityId: assistantId, metadata: null } });
  }

  private view(record: any) {
    return { ...record, status: String(record.status).toLowerCase() };
  }

  private notFound() {
    return new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Assistant not found in this workspace.' });
  }
}
