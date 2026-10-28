import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chunkKnowledgeText } from './knowledge-indexing';

export interface PdfPageReference { page: number; start: number; end: number; }
export interface PdfExtraction { content: string; pages: PdfPageReference[]; warnings: string[]; }
export function pdfParserAvailable() {
  try { createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.mjs'); return true; } catch { return false; }
}

/** Parsing is isolated from the API/queue event loop with memory and wall-clock bounds. No network or LLM. */
export async function extractPdf(bytes: Uint8Array): Promise<PdfExtraction> {
  const moduleUrl = pathToFileURL(createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { getDocument } = await import(workerData.moduleUrl);
        const task = getDocument({ data: workerData.bytes, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, stopAtErrors: true });
        let doc;
        try {
          doc = await task.promise;
          if (doc.numPages > 200) throw new Error('PDF_PAGE_LIMIT');
          let content = ''; const pages = [], warnings = [];
          for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
            const page = await doc.getPage(pageNumber);
            const text = await page.getTextContent();
            let value = '', previousY;
            for (const item of text.items) {
              if (typeof item.str !== 'string') continue;
              const y = item.transform[5];
              if (previousY !== undefined && Math.abs(y - previousY) > 3 && !value.endsWith('\\n')) value += '\\n';
              value += item.str + (item.hasEOL ? '\\n' : ' '); previousY = y;
            }
            value = value.replace(/\\x00/g, '').trim();
            if (!value) warnings.push('PAGE_' + pageNumber + '_NEEDS_OCR');
            const start = content.length; content += value;
            pages.push({ page: pageNumber, start, end: content.length }); content += '\\n\\n';
            if (content.length > 1000000) throw new Error('PDF_TEXT_LIMIT');
            page.cleanup();
          }
          if (!content.trim()) throw new Error('PDF_OCR_REQUIRED');
          // A partial policy can omit exceptions. Do not publish documents with unreadable pages.
          if (warnings.length) throw new Error('PDF_PARTIAL_OCR_REQUIRED');
          parentPort.postMessage({ result: { content, pages, warnings } });
        } finally { await task.destroy(); }
      })().catch(error => parentPort.postMessage({ error: error.name === 'PasswordException' ? 'PDF_ENCRYPTED' : /^PDF_/.test(error.message) ? error.message : 'PDF_INVALID' }));
    `, { eval: true, workerData: { moduleUrl, bytes }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 } });
    const fail = (code: string) => reject(Object.assign(new Error(code), { code, terminal: true }));
    const timer = setTimeout(() => { void worker.terminate(); fail('PDF_EXTRACTION_TIMEOUT'); }, 60000);
    worker.once('message', message => { clearTimeout(timer); void worker.terminate(); message.error ? fail(message.error) : resolve(message.result); });
    worker.once('error', () => { clearTimeout(timer); fail('PDF_EXTRACTION_FAILED'); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) fail('PDF_EXTRACTION_FAILED'); });
  });
}

export function pdfChunks(extracted: PdfExtraction, title: string) {
  return extracted.pages.flatMap(page => chunkKnowledgeText(extracted.content.slice(page.start, page.end))
    .map(content => ({ content, locator: `${title} · page ${page.page}` })));
}
