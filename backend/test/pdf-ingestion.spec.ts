import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalKnowledgeStorage } from '../src/modules/workspaces/local-knowledge-storage';
import { extractPdf, pdfChunks } from '../src/modules/workspaces/pdf-extraction';
import * as pdfExtraction from '../src/modules/workspaces/pdf-extraction';
import { KnowledgeService } from '../src/modules/workspaces/knowledge.service';

// A real, small text PDF fixture with an xref table; no parser mocking or provider calls.
function pdf(pages: string[]) {
  const objects = [ '<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' ];
  for (const [i, text] of pages.entries()) {
    const stream = `BT /F1 12 Tf 50 740 Td (${text}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let value = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(value)); value += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(value);
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new Uint8Array(Buffer.from(value));
}

describe('private PDF ingestion (offline)', () => {
  it('atomically queues an authorized document, retains restricted visibility and hides storage keys', async () => {
    const enabled = process.env.KNOWLEDGE_DOCUMENTS_ENABLED;
    process.env.KNOWLEDGE_DOCUMENTS_ENABLED = 'true';
    const parser = jest.spyOn(pdfExtraction, 'pdfParserAvailable').mockReturnValue(true);
    const storage = { isConfigured: () => true, put: jest.fn().mockResolvedValue({ storageKey: 'private-key' }), delete: jest.fn() };
    const db: any = { knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 'base-a' }), findMany: jest.fn().mockResolvedValue([]) }, knowledgeSource: { create: jest.fn(({ data }) => Promise.resolve({ ...data, id: 'source-a', sourceVersion: 1 })) }, knowledgeProcessingJob: { create: jest.fn().mockResolvedValue({ id: 'job-a' }) }, knowledgeBaseSource: { create: jest.fn() }, auditEvent: { create: jest.fn() } };
    db.$transaction = jest.fn((callback: (tx: any) => unknown) => callback(db));
    const service = new KnowledgeService(db, { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'tenant-a' }) } as any, storage as any);
    try {
      const result = await service.uploadPdf('owner', 'north', { knowledgeBaseId: 'base-a', knowledgeSection: 'SHIPPING_DELIVERY', visibility: 'INTERNAL_RESTRICTED' }, { buffer: Buffer.from(pdf(['Dispatch within 2 days.'])), originalname: 'policy.pdf', mimetype: 'application/pdf' });
      expect(result.processingStatus).toBe('queued'); expect(result.visibility).toBe('INTERNAL_RESTRICTED');
      expect(result.document.storageKey).toBeUndefined();
      expect(db.knowledgeProcessingJob.create).toHaveBeenCalledWith({ data: { organizationId: 'tenant-a', sourceId: 'source-a', sourceVersion: 1, kind: 'INDEX', status: 'QUEUED' } });
      expect(db.knowledgeBase.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'base-a', organizationId: 'tenant-a', status: 'ACTIVE' } }));
      db.$transaction.mockRejectedValueOnce(new Error('Database unavailable'));
      await expect(service.uploadPdf('owner', 'north', { knowledgeBaseId: 'base-a', knowledgeSection: 'SHIPPING_DELIVERY', visibility: 'INTERNAL_RESTRICTED' }, { buffer: Buffer.from(pdf(['Different content.'])), originalname: 'second.pdf', mimetype: 'application/pdf' })).rejects.toThrow('Database unavailable');
      expect(storage.delete).toHaveBeenCalledWith('private-key');
    } finally { parser.mockRestore(); if (enabled === undefined) delete process.env.KNOWLEDGE_DOCUMENTS_ENABLED; else process.env.KNOWLEDGE_DOCUMENTS_ENABLED = enabled; }
  });
  it('extracts real multi-page text and keeps numeric facts and page locators', async () => {
    const extracted = await extractPdf(pdf(['Dispatch within 2 business days.', 'Returns within 14 days, excluding final sale.']));
    expect(extracted.pages).toHaveLength(2);
    const chunks = pdfChunks(extracted, 'Policies');
    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ locator: 'Policies · page 1', content: expect.stringContaining('2 business days') }),
      expect.objectContaining({ locator: 'Policies · page 2', content: expect.stringContaining('14 days, excluding final sale') }),
    ]));
  });
  it('rejects empty/image-only content instead of publishing READY', async () => {
    await expect(extractPdf(pdf(['']))).rejects.toMatchObject({ code: 'PDF_OCR_REQUIRED' });
  });
  it('rejects malformed PDFs', async () => {
    await expect(extractPdf(new Uint8Array(Buffer.from('%PDF-invalid %%EOF')))).rejects.toMatchObject({ code: 'PDF_INVALID' });
  });
  it('round-trips private bytes, rejects another tenant and traversal, and deletes safely', async () => {
    const original = { NODE_ENV: process.env.NODE_ENV, KNOWLEDGE_DOCUMENTS_ENABLED: process.env.KNOWLEDGE_DOCUMENTS_ENABLED, KNOWLEDGE_PRIVATE_STORAGE_ROOT: process.env.KNOWLEDGE_PRIVATE_STORAGE_ROOT };
    const root = await mkdtemp(join(tmpdir(), 'knowledge-pdf-test-'));
    try {
      process.env.NODE_ENV = 'development'; process.env.KNOWLEDGE_DOCUMENTS_ENABLED = 'true'; process.env.KNOWLEDGE_PRIVATE_STORAGE_ROOT = root;
      const storage = new LocalKnowledgeStorage(), bytes = pdf(['Authorized facts.']);
      const result = await storage.put('tenant-a', bytes, 'application/pdf');
      expect(await storage.read('tenant-a', result.storageKey)).toEqual(bytes);
      await expect(storage.read('tenant-b', result.storageKey)).rejects.toThrow();
      await expect(storage.read('tenant-a', '../../file.pdf')).rejects.toThrow();
      await storage.delete(result.storageKey);
      await expect(storage.read('tenant-a', result.storageKey)).rejects.toThrow();
      process.env.NODE_ENV = 'production'; expect(storage.isConfigured()).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await rm(root, { recursive: true, force: true });
    }
  });
  it('uses tenant-scoped server pagination and accurate section totals without fetching document bodies', async () => {
    const db = { knowledgeSource: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(125), groupBy: jest.fn().mockResolvedValue([{ knowledgeSection: 'SHIPPING_DELIVERY', processingStatus: 'READY', _count: { _all: 125 } }]) }, $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)) };
    const workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'tenant-a' }) };
    const service = new KnowledgeService(db as any, workspaces as any);
    const result = await service.list('owner', 'north', undefined, { page: 6, pageSize: 20, section: 'SHIPPING_DELIVERY', search: 'policy' });
    expect(result.total).toBe(125); expect(result.pageCount).toBe(7);
    expect(result.counts[0]).toEqual({ section: 'SHIPPING_DELIVERY', status: 'ready', count: 125 });
    expect(db.knowledgeSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 20, where: expect.objectContaining({ organizationId: 'tenant-a', knowledgeSection: 'SHIPPING_DELIVERY' }), select: expect.objectContaining({ contentBody: false }) }));
  });
});
