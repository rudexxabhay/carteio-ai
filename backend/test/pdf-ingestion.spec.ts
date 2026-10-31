import { createHash } from 'node:crypto';
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

describe('in-memory PDF ingestion (offline)', () => {
  it('resolves the installed PDF.js parser from the backend runtime', () => {
    expect(pdfExtraction.pdfParserAvailable()).toBe(true);
  });

  it('enables uploads by default when the parser is installed and honors the explicit operator kill switch', async () => {
    const enabled = process.env.KNOWLEDGE_DOCUMENTS_ENABLED;
    const parser = jest.spyOn(pdfExtraction, 'pdfParserAvailable').mockReturnValue(true);
    const service = new KnowledgeService({} as any, { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'tenant-a' }) } as any);
    try {
      delete process.env.KNOWLEDGE_DOCUMENTS_ENABLED;
      await expect(service.documentCapabilities('owner', 'north')).resolves.toMatchObject({ uploadAvailable: true, blockedReason: null });
      process.env.KNOWLEDGE_DOCUMENTS_ENABLED = 'false';
      await expect(service.documentCapabilities('owner', 'north')).resolves.toMatchObject({ uploadAvailable: false, blockedReason: 'DOCUMENTS_DISABLED' });
      delete process.env.KNOWLEDGE_DOCUMENTS_ENABLED;
      parser.mockReturnValue(false);
      await expect(service.documentCapabilities('owner', 'north')).resolves.toMatchObject({ uploadAvailable: false, blockedReason: 'PDF_PARSER_NOT_INSTALLED' });
    } finally { parser.mockRestore(); if (enabled === undefined) delete process.env.KNOWLEDGE_DOCUMENTS_ENABLED; else process.env.KNOWLEDGE_DOCUMENTS_ENABLED = enabled; }
  });

  it('extracts before persistence, queues indexing, retains restricted visibility and never writes original bytes to storage', async () => {
    const enabled = process.env.KNOWLEDGE_DOCUMENTS_ENABLED;
    process.env.KNOWLEDGE_DOCUMENTS_ENABLED = 'true';
    const parser = jest.spyOn(pdfExtraction, 'pdfParserAvailable').mockReturnValue(true);
    const storage = { isConfigured: jest.fn(() => false), delete: jest.fn() };
    const db: any = { knowledgeBase: { findFirst: jest.fn().mockResolvedValue({ id: 'base-a' }), findMany: jest.fn().mockResolvedValue([]) }, knowledgeSource: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(({ data }) => Promise.resolve({ ...data, id: 'source-a', sourceVersion: 1 })) }, knowledgeProcessingJob: { create: jest.fn().mockResolvedValue({ id: 'job-a' }) }, knowledgeBaseSource: { create: jest.fn() }, auditEvent: { create: jest.fn() } };
    db.$transaction = jest.fn((callback: (tx: any) => unknown) => callback(db));
    const service = new KnowledgeService(db, { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'tenant-a' }) } as any, storage as any);
    try {
      const uploadBytes = Buffer.from(pdf(['Dispatch within 2 days.']));
      const result = await service.uploadPdf('owner', 'north', { knowledgeBaseId: 'base-a', knowledgeSection: 'SHIPPING_DELIVERY', visibility: 'INTERNAL_RESTRICTED' }, { buffer: uploadBytes, originalname: 'policy.pdf', mimetype: 'application/pdf' });
      expect(result.processingStatus).toBe('queued'); expect(result.visibility).toBe('INTERNAL_RESTRICTED');
      expect(result.document.storageKey).toBeUndefined();
      expect(result).not.toHaveProperty('contentBody');
      expect(db.knowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'tenant-a', knowledgeSection: 'SHIPPING_DELIVERY', languageHint: 'en', contentBody: expect.stringContaining('Dispatch within 2 days'), document: expect.objectContaining({ sourceLanguage: 'en', extracted: true, pageCount: 1, wordCount: expect.any(Number), contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) }) }) }));
      expect(db.knowledgeProcessingJob.create).toHaveBeenCalledWith({ data: { organizationId: 'tenant-a', sourceId: 'source-a', sourceVersion: 1, kind: 'INDEX', status: 'QUEUED' } });
      expect(db.knowledgeBase.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'base-a', organizationId: 'tenant-a', status: 'ACTIVE' } }));
      expect(storage.isConfigured).not.toHaveBeenCalled();
      expect(uploadBytes.every(byte => byte === 0)).toBe(true);
      db.$transaction.mockRejectedValueOnce(new Error('Database unavailable'));
      const failedUploadBytes = Buffer.from(pdf(['Different content.']));
      await expect(service.uploadPdf('owner', 'north', { knowledgeBaseId: 'base-a', knowledgeSection: 'SHIPPING_DELIVERY', visibility: 'INTERNAL_RESTRICTED' }, { buffer: failedUploadBytes, originalname: 'second.pdf', mimetype: 'application/pdf' })).rejects.toThrow('Database unavailable');
      expect(failedUploadBytes.every(byte => byte === 0)).toBe(true);
      expect(storage.isConfigured).not.toHaveBeenCalled(); expect(storage.delete).not.toHaveBeenCalled();
    } finally { parser.mockRestore(); if (enabled === undefined) delete process.env.KNOWLEDGE_DOCUMENTS_ENABLED; else process.env.KNOWLEDGE_DOCUMENTS_ENABLED = enabled; }
  });
  it('extracts real multi-page text and keeps numeric facts and page locators', async () => {
    const extracted = await extractPdf(pdf(['Dispatch within 2 business days.', 'Returns within 14 days, excluding final sale.']));
    expect(extracted.pages).toHaveLength(2);
    expect(extracted.pages.map(page => page.page)).toEqual([1, 2]);
    expect(extracted.pages.every(page => /^[a-f0-9]{64}$/.test(page.contentHash) && page.wordCount > 0)).toBe(true);
    expect(extracted.wordCount).toBeGreaterThan(0);
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
  it('keeps only a tenant-scoped legacy read/delete boundary and exposes no PDF write method', async () => {
    const storage = new LocalKnowledgeStorage();
    expect(storage).not.toHaveProperty('put');
    const key = `${createHash('sha256').update('tenant-a').digest('hex')}/00000000-0000-4000-8000-000000000000.pdf`;
    await expect(storage.read('tenant-b', key)).rejects.toThrow('tenant mismatch');
    await expect(storage.read('tenant-a', '../../file.pdf')).rejects.toThrow();
    await expect(storage.delete('../../file.pdf')).rejects.toThrow();
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
