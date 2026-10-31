import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chunkKnowledgeText } from './knowledge-indexing';
import { PDF_MAX_PAGES } from './local-knowledge-storage';

export interface PdfPageReference { page: number; start: number; end: number; heading: string | null; contentHash: string; wordCount: number; extractionWarnings: string[]; }
export interface PdfExtraction { content: string; pages: PdfPageReference[]; warnings: string[]; characterCount: number; wordCount: number; }
export function pdfParserAvailable() {
  try { createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.mjs'); return true; } catch { return false; }
}

/** Parsing is isolated from the API/queue event loop with memory and wall-clock bounds. No network or LLM. */
export async function extractPdf(bytes: Uint8Array): Promise<PdfExtraction> {
  const moduleUrl = pathToFileURL(createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { createHash } = require('node:crypto');
      (async () => {
        const { getDocument } = await import(workerData.moduleUrl);
        const task = getDocument({ data: workerData.bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, stopAtErrors: true });
        let doc;
        try {
          doc = await task.promise;
          if (doc.numPages > workerData.maxPages) throw new Error('PDF_PAGE_LIMIT');
          let content = ''; const pages = [], warnings = [];
          for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
            const page = await doc.getPage(pageNumber);
            const text = await page.getTextContent();
            let value = '', previousY;
            for (const item of text.items) {
              if (typeof item.str !== 'string') continue;
              const y = item.transform[5];
              if (previousY !== undefined && Math.abs(y - previousY) > 3 && !value.endsWith('\\n')) value += Math.abs(y - previousY) > 18 ? '\\n\\n' : '\\n';
              value += item.str + (item.hasEOL ? '\\n' : ' '); previousY = y;
            }
            value = value.replace(/\\x00/g, '').trim();
            const pageWarnings = [];
            if (!value) { pageWarnings.push('OCR_REQUIRED'); warnings.push(pageNumber); }
            const start = content.length; content += value;
            const end = content.length;
            const lines = value.split('\\n').map(line => line.trim()).filter(Boolean);
            const heading = lines.find(line => line.length <= 140 && line.split(/\\s+/).length <= 14 && !/[.!?]$/.test(line)) || null;
            pages.push({ page: pageNumber, start, end, heading, contentHash: createHash('sha256').update(value, 'utf8').digest('hex'), wordCount: (value.match(/[\\p{L}\\p{N}]+/gu) || []).length, extractionWarnings: pageWarnings });
            content += '\\n\\n';
            if (content.length > 1000000) throw new Error('PDF_TEXT_LIMIT');
            page.cleanup();
          }
          // A partial policy can omit exceptions. Do not publish documents with unreadable pages.
          if (warnings.length === doc.numPages) throw new Error('PDF_OCR_REQUIRED');
          if (warnings.length) throw Object.assign(new Error('PDF_PARTIAL_OCR_REQUIRED'), { unreadablePages: warnings });
          if (!content.trim()) throw new Error('PDF_OCR_REQUIRED');
          parentPort.postMessage({ result: { content, pages, warnings: [], characterCount: content.length, wordCount: (content.match(/[\\p{L}\\p{N}]+/gu) || []).length } });
        } finally { await task.destroy(); }
      })().catch(error => parentPort.postMessage({ error: error.name === 'PasswordException' ? 'PDF_ENCRYPTED' : /^PDF_/.test(error.message) ? error.message : 'PDF_INVALID', unreadablePages: Array.isArray(error.unreadablePages) ? error.unreadablePages : undefined }));
    `, { eval: true, workerData: { moduleUrl, bytes, maxPages: PDF_MAX_PAGES }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 } });
    const fail = (code: string, unreadablePages?: number[]) => reject(Object.assign(new Error(code), { code, terminal: true, ...(unreadablePages ? { unreadablePages } : {}) }));
    const timer = setTimeout(() => { void worker.terminate(); fail('PDF_EXTRACTION_TIMEOUT'); }, 45000);
    worker.once('message', message => { clearTimeout(timer); void worker.terminate(); message.error ? fail(message.error, message.unreadablePages) : resolve(message.result); });
    worker.once('error', () => { clearTimeout(timer); fail('PDF_EXTRACTION_FAILED'); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) fail('PDF_EXTRACTION_FAILED'); });
  });
}

export function pdfChunks(extracted: PdfExtraction, title: string) {
  return extracted.pages.flatMap(page => chunkKnowledgeText(extracted.content.slice(page.start, page.end))
    .map(content => ({ content, locator: `${title} · page ${page.page}${page.heading ? ` · ${page.heading}` : ''}`, page: page.page, heading: page.heading })));
}
