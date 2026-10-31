import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkspaceService } from './workspace.service';
import type { UpdateKnowledgeSourceDto } from './knowledge.dto';
import { PrivateKnowledgeStorage } from './private-knowledge-storage';
import { PDF_MAX_BYTES, PDF_MAX_PAGES } from './local-knowledge-storage';
import { extractPdf, pdfParserAvailable, type PdfExtraction } from './pdf-extraction';
import type { KnowledgeListQueryDto, UploadKnowledgePdfDto } from './knowledge.dto';
import { isVerifiedPdfDocumentSource } from './knowledge-document-eligibility';

const managers = ['OWNER', 'ADMIN'] as const;
const safeSelect = {
  id: true, organizationId: true, createdById: true, type: true, status: true, processingStatus: true, visibility: true,
  name: true, description: true, sourceUrl: true, contentBody: true, document: true, category: true, knowledgeSection: true, languageHint: true,
  sourceVersion: true, lastSyncAt: true, lastSuccessfulSyncAt: true, lastSyncErrorCode: true,
  activeIndexGeneration: true, processingErrorCode: true,
  semanticIndexStatus: true, semanticIndexErrorCode: true,
  verificationStatus: true, verifiedAt: true, syncPolicy: true, syncPaused: true, nextSyncAt: true,
  lastSyncAttemptAt: true, crawlPathPrefix: true, crawlMaxPages: true, crawlMaxDepth: true,
  deletedAt: true, createdAt: true, updatedAt: true,
};
const uniqueConflict = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
const sourceKey = (type: string, value: string) => `${type}:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
export const canonicalFaqKey = (question: string) => sourceKey('faq', question.trim().replace(/\s+/g, ' ').normalize('NFKC').toLowerCase());

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa') || host.endsWith('.home') || host.endsWith('.corp') || host.endsWith('.intranet') || host.endsWith('.private') || host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.example')) return true;
  if (isIP(host) === 0 && !host.includes('.')) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = host.split('.').map(Number);
    const a = octets[0] ?? 0;
    const b = octets[1] ?? 0;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || (b === 88 && octets[2] === 99)))
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
    // Block IPv6 special-purpose and transition/documentation ranges as well as non-global unicast.
    const secondGroup = value.startsWith('2001:') ? Number.parseInt(value.split(':')[1] || '0', 16) : Number.NaN;
    if ((value.startsWith('2001:') && secondGroup <= 0x1ff) || value.startsWith('2001:db8:') || value.startsWith('2002:') || value.startsWith('3fff:') || value.startsWith('64:ff9b:')) return true;
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
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.hostname.includes('%') || parsed.port || blockedHostname(parsed.hostname)) {
    throw new BadRequestException({ code: 'UNSAFE_WEBSITE_URL', message: 'Enter a public website URL using http or https.' });
  }
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return { url: parsed.toString(), hostname: parsed.hostname.replace(/^\[|\]$/g, '') };
}

@Injectable()
export class KnowledgeService {
  private readonly db: any;

  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService, @Optional() private readonly storage?: PrivateKnowledgeStorage) { this.db = prisma as any; }

  async list(userId: string, slug: string, type?: 'WEBSITE' | 'FAQ' | 'TEXT', query: KnowledgeListQueryDto = {}) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const scope = { organizationId: membership.organizationId, type: type ?? { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } };
    const where = { ...scope, ...(query.section ? { knowledgeSection: query.section === 'UNCLASSIFIED' ? null : query.section } : {}),
      ...(query.search?.trim() ? { name: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
      ...(query.processingStatus ? { processingStatus: query.processingStatus } : {}),
      ...(query.pdfOnly ? { document: { path: ['extracted'], equals: true } } : {}) };
    const page = query.page ?? 1, pageSize = query.pageSize ?? 100;
    const [records, total, groups, pdfGroups] = await this.db.$transaction([
      this.db.knowledgeSource.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: { ...safeSelect, contentBody: query.page === undefined, _count: { select: { assistantLinks: true } } } }),
      this.db.knowledgeSource.count({ where }),
      this.db.knowledgeSource.groupBy({ by: ['knowledgeSection', 'processingStatus'], where: scope, _count: { _all: true } }),
      this.db.$queryRaw`SELECT "knowledgeSection" AS section, lower("processingStatus"::text) AS status, count(*)::int AS count
        FROM "KnowledgeSource"
        WHERE "organizationId"=${membership.organizationId}::uuid AND type='TEXT' AND status <> 'ARCHIVED'
          AND document->>'extracted'='true'
        GROUP BY "knowledgeSection", "processingStatus"`,
    ], { isolationLevel: 'RepeatableRead' });
    return { sources: records.map((source: any) => this.view(source)), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)),
      counts: groups.map((group: any) => ({ section: group.knowledgeSection, status: group.processingStatus.toLowerCase(), count: group._count._all })),
      pdfCounts: pdfGroups.map((group: any) => ({ section: group.section, status: group.status, count: group.count })) };
  }

  async documentCapabilities(userId: string, slug: string) {
    await this.workspaces.requireAccess(userId, slug);
    // New PDF ingestion is bounded and in-memory; permanent private-file storage is not a prerequisite.
    // Keep an explicit false value as an operator kill switch, but do not disable uploads by default.
    const enabled = process.env.KNOWLEDGE_DOCUMENTS_ENABLED !== 'false';
    const parser = pdfParserAvailable();
    return { uploadAvailable: enabled && parser, maxBytes: PDF_MAX_BYTES, maxPages: PDF_MAX_PAGES,
      workerEnabled: process.env.KNOWLEDGE_WORKER_ENABLED === 'true',
      blockedReason: !enabled ? 'DOCUMENTS_DISABLED' : !parser ? 'PDF_PARSER_NOT_INSTALLED' : null };
  }

  async uploadPdf(userId: string, slug: string, input: UploadKnowledgePdfDto, file?: { buffer: Buffer; originalname: string; mimetype: string }, sourceId?: string) {
    const temporaryBytes = file?.buffer;
    try { return await this.uploadPdfFromMemory(userId, slug, input, file, sourceId); }
    finally { temporaryBytes?.fill(0); }
  }

  async createShopifyDiscoveredWebsite(userId: string, slug: string, input: { sourceUrl: string; name: string; description: string; visibility: 'PUBLIC_REFERENCE' }) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const normalized = normalizePublicWebsiteUrl(input.sourceUrl);
    const name = input.name.trim().replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 200) || normalized.hostname;
    return this.createRecord(userId, membership.organizationId, {
      type: 'WEBSITE', name, description: input.description, sourceUrl: normalized.url,
      category: 'SHOPIFY_STOREFRONT', visibility: input.visibility,
      canonicalKey: sourceKey('website', normalized.url), verificationStatus: 'UNVERIFIED',
      verificationTokenHash: null, verificationExpiresAt: null, verifiedAt: null,
      syncPolicy: 'MANUAL', syncPaused: true, nextSyncAt: null,
    }, 'knowledge.shopify_storefront_discovered');
  }

  private async uploadPdfFromMemory(userId: string, slug: string, input: UploadKnowledgePdfDto, file?: { buffer: Buffer; originalname: string; mimetype: string }, sourceId?: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    if (!(await this.documentCapabilities(userId, slug)).uploadAvailable) throw new ServiceUnavailableException({ code: 'PDF_UPLOAD_UNAVAILABLE', message: 'PDF extraction is not configured.' });
    if (!file || file.mimetype !== 'application/pdf' || !/\.pdf$/i.test(file.originalname) || file.buffer.length > PDF_MAX_BYTES
      || file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-' || !file.buffer.subarray(-1024).includes(Buffer.from('%%EOF'))) {
      throw new BadRequestException({ code: 'INVALID_PDF', message: `Choose a complete PDF file no larger than ${(PDF_MAX_BYTES / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB.` });
    }
    await this.requireActiveKnowledgeBase(member.organizationId, input.knowledgeBaseId);
    const existing = sourceId ? await this.findSource(member.organizationId, sourceId) : null;
    if (existing && (!existing.document || existing.type !== 'TEXT' || existing.status !== 'REGISTERED')) throw this.invalidType();
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const canonicalKey = `pdf:${hash}`;
    if (existing?.document?.hash === hash && isVerifiedPdfDocumentSource(existing)) return this.uploadView(existing);
    if (!existing) {
      const duplicate = await this.db.knowledgeSource.findFirst({ where: { organizationId: member.organizationId, canonicalKey, type: 'TEXT', status: 'REGISTERED' }, select: safeSelect });
      if (duplicate) return this.attachDuplicatePdf(userId, member.organizationId, input.knowledgeBaseId, duplicate);
    }
    const filename = file.originalname.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 180);
    const title = input.title?.replace(/[\x00-\x1f\x7f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 200) || filename;
    let extracted: PdfExtraction;
    try {
      extracted = await extractPdf(file.buffer);
    } catch (error: any) {
      const code = typeof error?.code === 'string' && /^PDF_[A-Z_]+$/.test(error.code) ? error.code : 'PDF_EXTRACTION_FAILED';
      const unreadablePages = Array.isArray(error?.unreadablePages) ? error.unreadablePages.filter((page: unknown) => Number.isInteger(page) && Number(page) > 0).slice(0, PDF_MAX_PAGES) : [];
      const message = code === 'PDF_ENCRYPTED' ? 'This PDF is encrypted. Upload an unlocked copy.'
        : code === 'PDF_OCR_REQUIRED' ? 'No selectable English text was found. Upload a text-based PDF; OCR is not available.'
        : code === 'PDF_PARTIAL_OCR_REQUIRED' ? `Some pages need OCR and could not be read${unreadablePages.length ? ` (pages ${unreadablePages.join(', ')})` : ''}. Upload a complete text-based PDF.`
        : code === 'PDF_PAGE_LIMIT' ? `This PDF exceeds the ${PDF_MAX_PAGES}-page limit.`
        : code === 'PDF_TEXT_LIMIT' ? 'The extracted text exceeds the configured document limit.'
        : code === 'PDF_EXTRACTION_TIMEOUT' ? 'PDF extraction took too long. Split the document and upload smaller files.'
        : 'This PDF could not be read. Verify the file and try again.';
      throw new BadRequestException({ code, message, ...(unreadablePages.length ? { unreadablePages } : {}) });
    }
    const document = { provenance: 'AUTHENTICATED_PDF_EXTRACTION_V1', filename, bytes: file.buffer.length, hash, contentHash: createHash('sha256').update(extracted.content, 'utf8').digest('hex'),
      sourceLanguage: 'en', extracted: true, pages: extracted.pages, pageCount: extracted.pages.length,
      characterCount: extracted.characterCount, wordCount: extracted.wordCount, warnings: extracted.warnings };
    try {
      if (!existing) {
        const result = await this.createRecord(userId, member.organizationId, {
          type: 'TEXT', name: title, description: null, document, contentBody: extracted.content, languageHint: 'en',
          canonicalKey, visibility: input.visibility, knowledgeSection: input.knowledgeSection,
        }, 'knowledge.pdf_uploaded', input.knowledgeBaseId);
        return this.uploadView(result);
      }
      const result = await this.db.$transaction(async (tx: any) => {
        const changed = await tx.knowledgeSource.updateMany({ where: { id: sourceId, organizationId: member.organizationId, sourceVersion: existing.sourceVersion, status: 'REGISTERED' },
          data: { name: title, document, canonicalKey, contentBody: extracted.content, languageHint: 'en', knowledgeSection: input.knowledgeSection, visibility: input.visibility,
            sourceVersion: { increment: 1 }, activeIndexGeneration: null, processingStatus: 'QUEUED', processingErrorCode: null, semanticIndexStatus: 'NOT_CONFIGURED', semanticIndexErrorCode: null } });
        if (!changed.count) throw new ConflictException('Source changed; reload before replacing.');
        await tx.knowledgeProcessingJob.updateMany({ where: { organizationId: member.organizationId, sourceId, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', stage: 'CANCELLED', leaseOwner: null, leasedAt: null, heartbeatAt: null } });
        await this.queueIndex(tx, member.organizationId, sourceId!, existing.sourceVersion + 1);
        await this.audit(tx, member.organizationId, userId, 'knowledge.pdf_replaced', sourceId!, { sourceVersion: existing.sourceVersion + 1, pageCount: document.pageCount, wordCount: document.wordCount });
        return this.view(await tx.knowledgeSource.findFirst({ where: { id: sourceId, organizationId: member.organizationId }, select: safeSelect }));
      });
      await this.cleanupLegacyDocumentFiles(member.organizationId, userId, sourceId!, existing.document);
      return this.uploadView(result);
    } catch (error) {
      const response = error instanceof ConflictException ? error.getResponse() : undefined;
      const sourceConflict = uniqueConflict(error) || (typeof response === 'object' && response !== null && 'code' in response && response.code === 'KNOWLEDGE_SOURCE_CONFLICT');
      if (sourceConflict && !existing) {
        const duplicate = await this.db.knowledgeSource.findFirst({ where: { organizationId: member.organizationId, canonicalKey, type: 'TEXT', status: 'REGISTERED' }, select: safeSelect });
        if (duplicate) return this.attachDuplicatePdf(userId, member.organizationId, input.knowledgeBaseId, duplicate);
      }
      this.mapConflict(error);
    }
  }

  async get(userId: string, slug: string, sourceId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const source = await this.db.knowledgeSource.findFirst({ where: { id: sourceId, organizationId: membership.organizationId }, select: { ...safeSelect,
      knowledgeBaseLinks: { where: { organizationId: membership.organizationId, knowledgeBase: { status: 'ACTIVE' } }, select: { knowledgeBase: { select: { id: true, name: true, status: true, autoAddEligibleSources: true, assistantLinks: { where: { organizationId: membership.organizationId }, select: { assistant: { select: { id: true, name: true, status: true } } } } } } } },
      assistantLinks: { where: { organizationId: membership.organizationId }, select: { assistant: { select: { id: true, name: true, status: true } } } },
    } });
    if (!source) throw this.sourceNotFound();
    const { knowledgeBaseLinks = [], assistantLinks = [], ...sourceRecord } = source;
    return { ...this.view(sourceRecord), knowledgeBaseMemberships: knowledgeBaseLinks.map((link: any) => ({ ...link.knowledgeBase, status: String(link.knowledgeBase.status).toLowerCase(), assistantAssignments: (link.knowledgeBase.assistantLinks ?? []).map((assignment: any) => ({ ...assignment.assistant, status: String(assignment.assistant.status).toLowerCase() })) })), directAssistantAssignments: assistantLinks.map((link: any) => ({ ...link.assistant, status: String(link.assistant.status).toLowerCase() })) };
  }


  async update(userId: string, slug: string, sourceId: string, input: UpdateKnowledgeSourceDto) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const existing = await this.findSource(membership.organizationId, sourceId);
    if (!isVerifiedPdfDocumentSource(existing)) throw new BadRequestException({ code: 'LEGACY_KNOWLEDGE_RETIRED', message: 'Upload a PDF document to manage static knowledge.' });
    if (existing.document && input.content !== undefined) throw new BadRequestException({ code: 'PDF_REPLACEMENT_REQUIRED', message: 'Replace the PDF to change its extracted content.' });
    if (existing.type === 'FAQ' && input.name !== undefined) throw this.invalidType();
    const data: Record<string, unknown> = {};
    let canonicalKey = existing.canonicalKey as string;
    if (input.name !== undefined) data.name = input.name.trim().replace(/\s+/g, ' ');
    if (input.description !== undefined) data.description = input.description.trim() || null;
    if (input.category !== undefined) data.category = input.category.trim() || null;
    if (input.knowledgeSection !== undefined) data.knowledgeSection = input.knowledgeSection;
    if (input.languageHint !== undefined) data.languageHint = input.languageHint.trim() || null;
    if (input.visibility !== undefined) data.visibility = input.visibility;
    if (existing.type === 'WEBSITE') {
      if (input.sourceUrl !== undefined) {
        const normalized = normalizePublicWebsiteUrl(input.sourceUrl);
        data.sourceUrl = normalized.url;
        canonicalKey = sourceKey('website', normalized.url);
        data.verificationStatus = 'UNVERIFIED'; data.verificationTokenHash = null; data.verificationExpiresAt = null; data.verifiedAt = null;
        data.syncPaused = true; data.nextSyncAt = null; data.processingStatus = 'NOT_PROCESSED'; data.activeIndexGeneration = null;
      }
      if (input.question !== undefined || input.answer !== undefined || input.content !== undefined) throw this.invalidType();
    } else if (existing.type === 'FAQ') {
      if (input.question !== undefined) {
        const question = input.question;
        data.name = question;
        canonicalKey = sourceKey('faq', question.trim().replace(/\s+/g, ' ').normalize('NFKC').toLowerCase());
      }
      if (input.answer !== undefined) data.contentBody = input.answer;
      if (input.content !== undefined || input.sourceUrl !== undefined) throw this.invalidType();
    } else {
      if (input.content !== undefined) data.contentBody = input.content;
      if (input.sourceUrl !== undefined || input.question !== undefined || input.answer !== undefined) throw this.invalidType();
    }
    if (input.name !== undefined && !existing.document && existing.type !== 'FAQ' && existing.type !== 'WEBSITE') canonicalKey = sourceKey(String(existing.type).toLowerCase(), String(data.name).normalize('NFKC').toLowerCase());
    if (!Object.keys(data).length) throw new BadRequestException({ code: 'EMPTY_KNOWLEDGE_UPDATE', message: 'Choose at least one source setting to update.' });
    data.canonicalKey = canonicalKey;
    const indexedContentChanged = existing.type !== 'WEBSITE' || input.sourceUrl !== undefined;
    if (indexedContentChanged) {
      data.sourceVersion = { increment: 1 };
      data.processingStatus = existing.type === 'WEBSITE' ? 'NOT_PROCESSED' : 'QUEUED';
      data.processingErrorCode = null;
      data.semanticIndexStatus = 'NOT_CONFIGURED';
      data.semanticIndexErrorCode = null;
      data.lastSyncAt = null; data.lastSuccessfulSyncAt = null; data.lastSyncErrorCode = null;
    }
    try {
      return this.db.$transaction(async (tx: any) => {
        if (indexedContentChanged) {
          const jobs = existing.type === 'WEBSITE' ? await tx.knowledgeProcessingJob.findMany({ where: { organizationId: membership.organizationId, sourceId, kind: 'CRAWL', status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, select: { id: true } }) : [];
          await tx.knowledgeProcessingJob.updateMany({ where: { organizationId: membership.organizationId, sourceId, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', leaseOwner: null, leasedAt: null, heartbeatAt: null, errorCode: 'SOURCE_VERSION_CHANGED' } });
          if (jobs.length) await tx.knowledgeSyncRun.updateMany({ where: { organizationId: membership.organizationId, sourceId, jobId: { in: jobs.map((job: any) => job.id) }, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', errorCode: 'SOURCE_VERSION_CHANGED', finishedAt: new Date() } });
        }
        const updated = await tx.knowledgeSource.update({ where: { id_organizationId: { id: sourceId, organizationId: membership.organizationId } }, data, select: safeSelect });
        if (indexedContentChanged && existing.type !== 'WEBSITE') await this.queueIndex(tx, membership.organizationId, updated.id, updated.sourceVersion);
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
      const crawlJobs = existing.type === 'WEBSITE' ? await tx.knowledgeProcessingJob.findMany({ where: { organizationId: membership.organizationId, sourceId, kind: 'CRAWL', status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, select: { id: true } }) : [];
      await tx.knowledgeProcessingJob.updateMany({ where: { organizationId: membership.organizationId, sourceId, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', leaseOwner: null, leasedAt: null, heartbeatAt: null, errorCode: 'SOURCE_ARCHIVED' } });
      if (crawlJobs.length) await tx.knowledgeSyncRun.updateMany({ where: { organizationId: membership.organizationId, sourceId, jobId: { in: crawlJobs.map((job: any) => job.id) }, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', errorCode: 'SOURCE_ARCHIVED', finishedAt: new Date() } });
      const archived = await tx.knowledgeSource.update({ where: { id_organizationId: { id: sourceId, organizationId: membership.organizationId } }, data: { status: 'ARCHIVED', deletedAt: new Date(), processingStatus: 'NOT_PROCESSED', ...(existing.type === 'WEBSITE' ? { syncPaused: true, nextSyncAt: null } : {}) }, select: safeSelect });
      await this.audit(tx, membership.organizationId, userId, 'knowledge.source_archived', sourceId, { type: existing.type });
      return this.view(archived);
    });
  }

  async archiveMany(userId: string, slug: string, sourceIdsInput: string[]) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const sourceIds = [...new Set(sourceIdsInput)];
    if (!sourceIds.length || sourceIds.length > 100) throw new BadRequestException({ code: 'INVALID_SOURCE_BATCH', message: 'Select between 1 and 100 sources to archive.' });
    return this.db.$transaction(async (tx: any) => {
      const sources = await tx.knowledgeSource.findMany({ where: { id: { in: sourceIds }, organizationId: membership.organizationId }, select: { id: true, status: true } });
      if (sources.length !== sourceIds.length) throw this.sourceNotFound();
      const crawlJobs = await tx.knowledgeProcessingJob.findMany({ where: { organizationId: membership.organizationId, sourceId: { in: sourceIds }, kind: 'CRAWL', status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, select: { id: true } });
      await tx.knowledgeProcessingJob.updateMany({ where: { organizationId: membership.organizationId, sourceId: { in: sourceIds }, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', leaseOwner: null, leasedAt: null, heartbeatAt: null, errorCode: 'SOURCE_ARCHIVED' } });
      if (crawlJobs.length) await tx.knowledgeSyncRun.updateMany({ where: { organizationId: membership.organizationId, sourceId: { in: sourceIds }, jobId: { in: crawlJobs.map((job: any) => job.id) }, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', errorCode: 'SOURCE_ARCHIVED', finishedAt: new Date() } });
      const result = await tx.knowledgeSource.updateMany({ where: { id: { in: sourceIds }, organizationId: membership.organizationId, status: { not: 'ARCHIVED' } }, data: { status: 'ARCHIVED', deletedAt: new Date(), processingStatus: 'NOT_PROCESSED' } });
      await tx.knowledgeSource.updateMany({ where: { id: { in: sourceIds }, organizationId: membership.organizationId, type: 'WEBSITE' }, data: { syncPaused: true, nextSyncAt: null } });
      if (result.count) await this.audit(tx, membership.organizationId, userId, 'knowledge.sources_archived', sourceIds[0]!, { archivedCount: result.count });
      return { requested: sourceIds.length, archived: result.count, alreadyArchived: sourceIds.length - result.count };
    });
  }


  async restore(userId: string, slug: string, sourceId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const existing = await this.findSource(membership.organizationId, sourceId);
    if (existing.status !== 'ARCHIVED') throw new ConflictException({ code: 'KNOWLEDGE_SOURCE_NOT_ARCHIVED', message: 'Only archived sources can be restored.' });
    const publishedChunk = existing.activeIndexGeneration == null ? null : await this.db.knowledgeChunk.findFirst({ where: { organizationId: membership.organizationId, sourceId, sourceVersion: existing.sourceVersion, generation: existing.activeIndexGeneration }, select: { id: true } });
    const hasPublished = Boolean(publishedChunk);
    return this.db.$transaction(async (tx: any) => {
      const restored = await tx.knowledgeSource.update({ where: { id_organizationId: { id: sourceId, organizationId: membership.organizationId } }, data: {
        status: 'REGISTERED', deletedAt: null,
        processingStatus: existing.type === 'WEBSITE' ? (hasPublished && existing.verificationStatus === 'VERIFIED' ? 'READY' : 'NOT_PROCESSED') : hasPublished ? 'READY' : 'QUEUED',
        ...(existing.type === 'WEBSITE' ? { syncPaused: true, nextSyncAt: null } : {}),
      }, select: safeSelect });
      if (!hasPublished && existing.type !== 'WEBSITE') await this.queueIndex(tx, membership.organizationId, sourceId, restored.sourceVersion);
      await this.audit(tx, membership.organizationId, userId, 'knowledge.source_restored', sourceId, { type: existing.type });
      return this.view(restored);
    });
  }

  async permanentlyDelete(userId: string, slug: string, sourceId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug, ['OWNER']);
    const existing = await this.findSource(membership.organizationId, sourceId);
    const impact = await this.measureDeleteImpact(membership.organizationId, sourceId);
    await this.db.$transaction(async (tx: any) => {
      await tx.knowledgeProcessingJob.updateMany({ where: { organizationId: membership.organizationId, sourceId, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', leaseOwner: null, leasedAt: null, heartbeatAt: null, errorCode: 'SOURCE_DELETED' } });
      await this.audit(tx, membership.organizationId, userId, 'knowledge.source_permanently_deleted', sourceId, { type: existing.type, ...impact });
      await tx.knowledgeSource.delete({ where: { id_organizationId: { id: sourceId, organizationId: membership.organizationId } } });
    });
    if (existing.document?.storageKey && this.storage) {
      for (const key of [...(existing.document.retiredStorageKeys ?? []), existing.document.storageKey]) {
        try { await this.storage.delete(key); }
        catch { await this.db.auditEvent.create({ data: { organizationId: membership.organizationId, actorUserId: userId, action: 'knowledge.private_file_cleanup_required', entityType: 'knowledge_source', entityId: sourceId, metadata: { storageKey: key } } }); }
      }
    }
    return { sourceId, deleted: true, impact };
  }

  async permanentDeleteImpact(userId: string, slug: string, sourceId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug, ['OWNER']);
    await this.findSource(membership.organizationId, sourceId);
    return { sourceId, impact: await this.measureDeleteImpact(membership.organizationId, sourceId) };
  }

  private async measureDeleteImpact(organizationId: string, sourceId: string) {
    const [baseLinks, assistantLinks, pages, chunks, pendingJobs] = await Promise.all([
      this.db.knowledgeBaseSource.count({ where: { organizationId, sourceId } }),
      this.db.assistantKnowledgeSource.count({ where: { organizationId, sourceId } }),
      this.db.knowledgePage.count({ where: { organizationId, sourceId } }),
      this.db.knowledgeChunk.count({ where: { organizationId, sourceId } }),
      this.db.knowledgeProcessingJob.count({ where: { organizationId, sourceId, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } } }),
    ]);
    return { baseLinks, assistantLinks, pages, chunks, pendingJobs };
  }

  async listAssistantSources(userId: string, slug: string, assistantId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    await this.requireAssistant(membership.organizationId, assistantId);
    const [linked, available] = await Promise.all([
      this.db.assistantKnowledgeSource.findMany({ where: { organizationId: membership.organizationId, assistantId, source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] } } }, orderBy: [{ createdAt: 'asc' }, { sourceId: 'asc' }], include: { source: { select: safeSelect } } }),
      this.db.knowledgeSource.findMany({ where: { organizationId: membership.organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 100, select: safeSelect }),
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

  private async createRecord(userId: string, organizationId: string, data: Record<string, unknown>, action: string, baseId?: string, queueInitialWebsiteCrawl = false) {
    try {
      return await this.db.$transaction(async (tx: any) => {
        if (baseId) {
          const base = await tx.knowledgeBase.findFirst({ where: { id: baseId, organizationId, status: 'ACTIVE' }, select: { id: true } });
          if (!base) throw new NotFoundException({ code: 'KNOWLEDGE_BASE_NOT_FOUND', message: 'Active Knowledge Base not found in this workspace.' });
        }
        const website = data.type === 'WEBSITE';
        const initialWebsiteCrawl = website && queueInitialWebsiteCrawl;
        const now = new Date();
        const source = await tx.knowledgeSource.create({ data: { ...data, organizationId, createdById: userId, status: 'REGISTERED', processingStatus: website ? (initialWebsiteCrawl ? 'QUEUED' : 'NOT_PROCESSED') : 'QUEUED', ...(website ? { syncPolicy: 'MANUAL', syncPaused: false, nextSyncAt: null, ...(initialWebsiteCrawl ? { lastSyncAttemptAt: now } : {}) } : {}) }, select: safeSelect });
        if (initialWebsiteCrawl) {
          const job = await tx.knowledgeProcessingJob.create({ data: { organizationId, sourceId: source.id, sourceVersion: source.sourceVersion, kind: 'CRAWL', status: 'QUEUED' }, select: { id: true } });
          await tx.knowledgeSyncRun.create({ data: { organizationId, sourceId: source.id, jobId: job.id, status: 'QUEUED' } });
          await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action: 'knowledge.website_initial_crawl_enqueued', entityType: 'knowledge_source', entityId: source.id, metadata: { jobId: job.id, sourceVersion: source.sourceVersion } } });
        }
        if (!website) await this.queueIndex(tx, organizationId, source.id, source.sourceVersion);
        await this.audit(tx, organizationId, userId, action, source.id, { type: source.type });
        if (baseId) {
          await tx.knowledgeBaseSource.create({ data: { organizationId, knowledgeBaseId: baseId, sourceId: source.id } });
          await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action: 'knowledge_base.source_added', entityType: 'knowledge_base', entityId: baseId, metadata: { sourceId: source.id } } });
        }
        // Website sources join opted-in bases only after a successful crawl
        // publishes searchable content. Explicit baseId links remain immediate.
        if (!website) await this.autoLinkToOptedInBases(tx, organizationId, [source.id]);
        return this.view(source);
      });
    } catch (error) { this.mapConflict(error); }
  }

  private async requireActiveKnowledgeBase(organizationId: string, baseId: string) {
    const base = await this.db.knowledgeBase.findFirst({ where: { id: baseId, organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!base) throw new NotFoundException({ code: 'KNOWLEDGE_BASE_NOT_FOUND', message: 'Active Knowledge Base not found in this workspace.' });
  }

  private async queueIndex(tx: any, organizationId: string, sourceId: string, sourceVersion: number) {
    await tx.knowledgeProcessingJob.create({ data: { organizationId, sourceId, sourceVersion, kind: 'INDEX', status: 'QUEUED' } });
  }

  private async autoLinkToOptedInBases(tx: any, organizationId: string, sourceIds: string[]) {
    if (!sourceIds.length) return;
    const bases = await tx.knowledgeBase.findMany({ where: { organizationId, status: 'ACTIVE', archivedAt: null, autoAddEligibleSources: true }, select: { id: true } });
    if (!bases.length) return;
    await tx.knowledgeBaseSource.createMany({
      data: bases.flatMap((base: { id: string }) => sourceIds.map((sourceId) => ({ organizationId, knowledgeBaseId: base.id, sourceId }))),
      skipDuplicates: true,
    });
  }

  private async attachDuplicatePdf(userId: string, organizationId: string, baseId: string, source: any) {
    if (!isVerifiedPdfDocumentSource(source)) throw new ConflictException({ code: 'PDF_PROVENANCE_REPROCESS_REQUIRED', message: 'Replace the existing PDF with its original file to establish authenticated document provenance.' });
    await this.db.$transaction(async (tx: any) => {
      const base = await tx.knowledgeBase.findFirst({ where: { id: baseId, organizationId, status: 'ACTIVE' }, select: { id: true } });
      if (!base) throw new NotFoundException({ code: 'KNOWLEDGE_BASE_NOT_FOUND', message: 'Active Knowledge Base not found in this workspace.' });
      const linked = await tx.knowledgeBaseSource.createMany({ data: [{ organizationId, knowledgeBaseId: baseId, sourceId: source.id }], skipDuplicates: true });
      if (linked.count) await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action: 'knowledge_base.source_added', entityType: 'knowledge_base', entityId: baseId, metadata: { sourceId: source.id, sourceType: 'PDF' } } });
    });
    return this.uploadView(source);
  }

  private async cleanupLegacyDocumentFiles(organizationId: string, userId: string, sourceId: string, document: any) {
    if (!this.storage) return;
    const keys = [...new Set([...(Array.isArray(document?.retiredStorageKeys) ? document.retiredStorageKeys : []), document?.storageKey].filter((key): key is string => typeof key === 'string'))];
    for (const storageKey of keys) {
      try { await this.storage.delete(storageKey); }
      catch {
        await this.db.auditEvent.create({ data: { organizationId, actorUserId: userId, action: 'knowledge.private_file_cleanup_required', entityType: 'knowledge_source', entityId: sourceId, metadata: { storageKey } } }).catch(() => undefined);
      }
    }
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
    return { ...record, ...(record.document ? { document: { provenance: record.document.provenance === 'AUTHENTICATED_PDF_EXTRACTION_V1' ? record.document.provenance : null, filename: record.document.filename, bytes: record.document.bytes, hash: record.document.hash, contentHash: record.document.contentHash, sourceLanguage: record.document.sourceLanguage, pages: record.document.pages, pageCount: record.document.pageCount, characterCount: record.document.characterCount, wordCount: record.document.wordCount, warnings: record.document.warnings, extracted: record.document.extracted } } : {}), type: String(record.type).toLowerCase(), status: String(record.status).toLowerCase(), processingStatus: String(record.processingStatus).toLowerCase(), linkedAssistantCount: _count?.assistantLinks ?? undefined };
  }

  private uploadView(source: any) {
    const { contentBody: _contentBody, ...summary } = this.view(source);
    return summary;
  }

  private invalidType() { return new BadRequestException({ code: 'KNOWLEDGE_FIELDS_DO_NOT_MATCH_TYPE', message: 'The submitted fields do not match this source type.' }); }
  private sourceNotFound() { return new NotFoundException({ code: 'KNOWLEDGE_SOURCE_NOT_FOUND', message: 'Knowledge source not found in this workspace.' }); }
  private linkNotFound() { return new NotFoundException({ code: 'KNOWLEDGE_LINK_NOT_FOUND', message: 'This source is not linked to the assistant.' }); }
  private mapConflict(error: unknown): never {
    if (uniqueConflict(error)) throw new ConflictException({ code: 'KNOWLEDGE_SOURCE_CONFLICT', message: 'A source with the same website URL, question, or title already exists in this workspace.' });
    throw error;
  }
}
