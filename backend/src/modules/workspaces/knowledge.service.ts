import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkspaceService } from './workspace.service';
import type { CreateFaqSourceDto, CreateTextSourceDto, CreateWebsiteSourceDto, UpdateKnowledgeSourceDto } from './knowledge.dto';

const managers = ['OWNER', 'ADMIN'] as const;
const safeSelect = {
  id: true, organizationId: true, createdById: true, type: true, status: true, processingStatus: true,
  name: true, description: true, sourceUrl: true, contentBody: true, category: true, languageHint: true,
  sourceVersion: true, lastSyncAt: true, lastSuccessfulSyncAt: true, lastSyncErrorCode: true,
  deletedAt: true, createdAt: true, updatedAt: true,
};
const uniqueConflict = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
const sourceKey = (type: string, value: string) => `${type}:${createHash('sha256').update(value, 'utf8').digest('hex')}`;

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.example')) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = host.split('.').map(Number);
    const a = octets[0] ?? 0;
    const b = octets[1] ?? 0;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (octets[2] === 0 || octets[2] === 2)) || (b === 88 && octets[2] === 99)))
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 198 && ((b === 18 || b === 19) || (b === 51 && octets[2] === 100)))
      || (a === 203 && b === 0 && octets[2] === 113);
  }
  if (ipVersion === 6) {
    const value = host.toLowerCase();
    if (value.startsWith('::ffff:')) {
      const mapped = value.slice(7);
      if (isIP(mapped) === 4) return blockedHostname(mapped);
      const groups = mapped.split(':').map((part) => Number.parseInt(part, 16));
      if (groups.length === 2 && groups.every(Number.isFinite)) {
        const high = groups[0] ?? 0;
        const low = groups[1] ?? 0;
        return blockedHostname(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      }
      return true;
    }
    if (value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff')) return true;
    if (value.startsWith('2001:db8:')) return true;
    // Globally routable IPv6 unicast is within 2000::/3.
    return !/^2[0-9a-f]{0,3}:/i.test(value);
  }
  return false;
}

export function normalizePublicWebsiteUrl(input: string): { url: string; hostname: string } {
  const raw = input.trim();
  if (raw.length > 2048) throw new BadRequestException({ code: 'INVALID_WEBSITE_URL', message: 'Website URL must be 2048 characters or fewer.' });
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new BadRequestException({ code: 'INVALID_WEBSITE_URL', message: 'Enter a valid public http or https website URL.' }); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || blockedHostname(parsed.hostname)) {
    throw new BadRequestException({ code: 'UNSAFE_WEBSITE_URL', message: 'Enter a public website URL using http or https.' });
  }
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return { url: parsed.toString(), hostname: parsed.hostname.replace(/^\[|\]$/g, '') };
}

async function rejectPrivateDnsAnswers(hostname: string): Promise<void> {
  if (isIP(hostname)) return;
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.some(({ address }) => blockedHostname(address))) {
      throw new BadRequestException({ code: 'UNSAFE_WEBSITE_URL', message: 'Website host resolves to a private or reserved network address.' });
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    // Registration does not fetch the site. Unresolved domains may be registered, but a future crawler must resolve and validate again before every request.
  }
}

@Injectable()
export class KnowledgeService {
  private readonly db: any;

  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService) { this.db = prisma as any; }

  async list(userId: string, slug: string, type?: 'WEBSITE' | 'FAQ' | 'TEXT') {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const where = { organizationId: membership.organizationId, status: { not: 'ARCHIVED' }, ...(type ? { type } : {}) };
    const records = await this.db.knowledgeSource.findMany({
      where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 100,
      select: { ...safeSelect, _count: { select: { assistantLinks: true } } },
    });
    return { sources: records.map((source: any) => this.view(source)), total: records.length };
  }

  async get(userId: string, slug: string, sourceId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const source = await this.findSource(membership.organizationId, sourceId);
    return this.view(source);
  }

  async createWebsite(userId: string, slug: string, input: CreateWebsiteSourceDto) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const { url, hostname } = normalizePublicWebsiteUrl(input.sourceUrl);
    await rejectPrivateDnsAnswers(hostname);
    const name = input.name?.trim().replace(/\s+/g, ' ') || hostname;
    return this.createRecord(userId, membership.organizationId, {
      type: 'WEBSITE', name, description: input.description?.trim() || null, sourceUrl: url,
      canonicalKey: sourceKey('website', url),
    }, 'knowledge.website_registered');
  }

  async createFaq(userId: string, slug: string, input: CreateFaqSourceDto) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const question = input.question.trim().replace(/\s+/g, ' ');
    const answer = input.answer.trim();
    return this.createRecord(userId, membership.organizationId, {
      type: 'FAQ', name: question, contentBody: answer, category: input.category?.trim() || null,
      languageHint: input.languageHint?.trim() || null, canonicalKey: sourceKey('faq', question.normalize('NFKC').toLowerCase()),
    }, 'knowledge.faq_created');
  }

  async createText(userId: string, slug: string, input: CreateTextSourceDto) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const title = input.title.trim().replace(/\s+/g, ' ');
    return this.createRecord(userId, membership.organizationId, {
      type: 'TEXT', name: title, contentBody: input.content.trim(), description: input.description?.trim() || null,
      category: input.category?.trim() || null, languageHint: input.languageHint?.trim() || null,
      canonicalKey: sourceKey('text', title.normalize('NFKC').toLowerCase()),
    }, 'knowledge.text_created');
  }

  async update(userId: string, slug: string, sourceId: string, input: UpdateKnowledgeSourceDto) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const existing = await this.findSource(membership.organizationId, sourceId);
    if (existing.type === 'FAQ' && input.name !== undefined) throw this.invalidType();
    const data: Record<string, unknown> = {};
    let canonicalKey = existing.canonicalKey as string;
    if (input.name !== undefined) data.name = input.name.trim().replace(/\s+/g, ' ');
    if (input.description !== undefined) data.description = input.description.trim() || null;
    if (input.category !== undefined) data.category = input.category.trim() || null;
    if (input.languageHint !== undefined) data.languageHint = input.languageHint.trim() || null;
    if (existing.type === 'WEBSITE') {
      if (input.sourceUrl !== undefined) {
        const normalized = normalizePublicWebsiteUrl(input.sourceUrl);
        await rejectPrivateDnsAnswers(normalized.hostname);
        data.sourceUrl = normalized.url;
        canonicalKey = sourceKey('website', normalized.url);
      }
      if (input.question !== undefined || input.answer !== undefined || input.content !== undefined) throw this.invalidType();
    } else if (existing.type === 'FAQ') {
      if (input.question !== undefined) {
        const question = input.question.trim().replace(/\s+/g, ' ');
        data.name = question;
        canonicalKey = sourceKey('faq', question.normalize('NFKC').toLowerCase());
      }
      if (input.answer !== undefined) data.contentBody = input.answer.trim();
      if (input.content !== undefined || input.sourceUrl !== undefined) throw this.invalidType();
    } else {
      if (input.content !== undefined) data.contentBody = input.content.trim();
      if (input.sourceUrl !== undefined || input.question !== undefined || input.answer !== undefined) throw this.invalidType();
    }
    if (input.name !== undefined && existing.type !== 'FAQ') canonicalKey = sourceKey(String(existing.type).toLowerCase(), String(data.name).normalize('NFKC').toLowerCase());
    if (!Object.keys(data).length) throw new BadRequestException({ code: 'EMPTY_KNOWLEDGE_UPDATE', message: 'Choose at least one source setting to update.' });
    data.canonicalKey = canonicalKey;
    data.sourceVersion = { increment: 1 };
    data.processingStatus = 'NOT_PROCESSED';
    data.lastSyncAt = null; data.lastSuccessfulSyncAt = null; data.lastSyncErrorCode = null;
    try {
      return this.db.$transaction(async (tx: any) => {
        const updated = await tx.knowledgeSource.update({ where: { id_organizationId: { id: sourceId, organizationId: membership.organizationId } }, data, select: safeSelect });
        await this.audit(tx, membership.organizationId, userId, 'knowledge.source_updated', sourceId, { type: existing.type });
        return this.view(updated);
      });
    } catch (error) { this.mapConflict(error); }
  }

  async archive(userId: string, slug: string, sourceId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const existing = await this.findSource(membership.organizationId, sourceId);
    if (existing.status === 'ARCHIVED') return this.view(existing);
    return this.db.$transaction(async (tx: any) => {
      const archived = await tx.knowledgeSource.update({ where: { id_organizationId: { id: sourceId, organizationId: membership.organizationId } }, data: { status: 'ARCHIVED', deletedAt: new Date(), processingStatus: 'NOT_PROCESSED' }, select: safeSelect });
      await this.audit(tx, membership.organizationId, userId, 'knowledge.source_archived', sourceId, { type: existing.type });
      return this.view(archived);
    });
  }

  async listAssistantSources(userId: string, slug: string, assistantId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    await this.requireAssistant(membership.organizationId, assistantId);
    const [linked, available] = await Promise.all([
      this.db.assistantKnowledgeSource.findMany({ where: { organizationId: membership.organizationId, assistantId }, orderBy: [{ createdAt: 'asc' }, { sourceId: 'asc' }], include: { source: { select: safeSelect } } }),
      this.db.knowledgeSource.findMany({ where: { organizationId: membership.organizationId, status: { not: 'ARCHIVED' } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 100, select: safeSelect }),
    ]);
    return { linked: linked.map((link: any) => this.view(link.source)), available: available.map((source: any) => this.view(source)) };
  }

  async attach(userId: string, slug: string, assistantId: string, sourceId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireAssistant(membership.organizationId, assistantId);
    const source = await this.findSource(membership.organizationId, sourceId);
    if (source.status === 'ARCHIVED') throw this.sourceNotFound();
    try {
      return await this.db.$transaction(async (tx: any) => {
        const link = await tx.assistantKnowledgeSource.create({ data: { organizationId: membership.organizationId, assistantId, sourceId }, select: { assistantId: true, sourceId: true } });
        await this.audit(tx, membership.organizationId, userId, 'knowledge.source_linked', sourceId, { assistantId });
        return { ...link, linked: true };
      });
    } catch (error) {
      if (uniqueConflict(error)) throw new ConflictException({ code: 'KNOWLEDGE_ALREADY_LINKED', message: 'This source is already linked to the assistant.' });
      throw error;
    }
  }

  async detach(userId: string, slug: string, assistantId: string, sourceId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireAssistant(membership.organizationId, assistantId);
    await this.findSource(membership.organizationId, sourceId);
    const deleted = await this.db.$transaction(async (tx: any) => {
      const result = await tx.assistantKnowledgeSource.deleteMany({ where: { organizationId: membership.organizationId, assistantId, sourceId } });
      if (!result.count) throw this.linkNotFound();
      await this.audit(tx, membership.organizationId, userId, 'knowledge.source_unlinked', sourceId, { assistantId });
      return { assistantId, sourceId, unlinked: true };
    });
    return deleted;
  }

  private async createRecord(userId: string, organizationId: string, data: Record<string, unknown>, action: string) {
    try {
      return await this.db.$transaction(async (tx: any) => {
        const source = await tx.knowledgeSource.create({ data: { ...data, organizationId, createdById: userId, status: 'REGISTERED', processingStatus: 'NOT_PROCESSED' }, select: safeSelect });
        await this.audit(tx, organizationId, userId, action, source.id, { type: source.type });
        return this.view(source);
      });
    } catch (error) { this.mapConflict(error); }
  }

  private async findSource(organizationId: string, id: string) {
    const source = await this.db.knowledgeSource.findFirst({ where: { id, organizationId }, select: safeSelect });
    if (!source) throw this.sourceNotFound();
    return source;
  }

  private async requireAssistant(organizationId: string, assistantId: string) {
    const assistant = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId }, select: { id: true } });
    if (!assistant) throw new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Assistant not found in this workspace.' });
    return assistant;
  }

  private async audit(tx: any, organizationId: string, actorUserId: string, action: string, id: string, metadata: Record<string, unknown>) {
    await tx.auditEvent.create({ data: { organizationId, actorUserId, action, entityType: 'knowledge_source', entityId: id, metadata } });
  }

  private view(source: any) {
    const { _count, ...record } = source;
    return { ...record, type: String(record.type).toLowerCase(), status: String(record.status).toLowerCase(), processingStatus: String(record.processingStatus).toLowerCase(), linkedAssistantCount: _count?.assistantLinks ?? undefined };
  }

  private invalidType() { return new BadRequestException({ code: 'KNOWLEDGE_FIELDS_DO_NOT_MATCH_TYPE', message: 'The submitted fields do not match this source type.' }); }
  private sourceNotFound() { return new NotFoundException({ code: 'KNOWLEDGE_SOURCE_NOT_FOUND', message: 'Knowledge source not found in this workspace.' }); }
  private linkNotFound() { return new NotFoundException({ code: 'KNOWLEDGE_LINK_NOT_FOUND', message: 'This source is not linked to the assistant.' }); }
  private mapConflict(error: unknown): never {
    if (uniqueConflict(error)) throw new ConflictException({ code: 'KNOWLEDGE_SOURCE_CONFLICT', message: 'A source with the same website URL, question, or title already exists in this workspace.' });
    throw error;
  }
}
