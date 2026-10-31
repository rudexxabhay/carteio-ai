type DocumentPageMetadata = {
  page: number;
  start: number;
  end: number;
  contentHash: string;
  wordCount: number;
};

type ExtractedPdfMetadata = {
  provenance: 'AUTHENTICATED_PDF_EXTRACTION_V1';
  filename: string;
  bytes: number;
  hash: string;
  contentHash: string;
  sourceLanguage: string;
  extracted: boolean;
  pageCount: number;
  pages: DocumentPageMetadata[];
};

const sha256 = /^[a-f0-9]{64}$/i;

/** Trust only the persisted shape written by the bounded English PDF extraction pipeline. */
export function isVerifiedPdfDocumentSource(source: { type?: unknown; document?: unknown }): boolean {
  if (source.type !== 'TEXT' || !source.document || typeof source.document !== 'object' || Array.isArray(source.document)) return false;
  const document = source.document as Partial<ExtractedPdfMetadata>;
  if (document.provenance !== 'AUTHENTICATED_PDF_EXTRACTION_V1' || document.extracted !== true || document.sourceLanguage !== 'en'
    || typeof document.filename !== 'string' || !/\.pdf$/i.test(document.filename)
    || !Number.isSafeInteger(document.bytes) || Number(document.bytes) <= 0
    || typeof document.hash !== 'string' || !sha256.test(document.hash)
    || typeof document.contentHash !== 'string' || !sha256.test(document.contentHash)
    || !Array.isArray(document.pages) || document.pages.length === 0
    || document.pageCount !== document.pages.length) return false;
  return document.pages.every((page) => page && Number.isSafeInteger(page.page) && page.page > 0
    && Number.isSafeInteger(page.start) && page.start >= 0
    && Number.isSafeInteger(page.end) && page.end > page.start
    && typeof page.contentHash === 'string' && sha256.test(page.contentHash)
    && Number.isSafeInteger(page.wordCount) && page.wordCount >= 0);
}
