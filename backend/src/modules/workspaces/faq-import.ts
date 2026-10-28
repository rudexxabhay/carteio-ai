import { inflateRawSync } from 'node:zlib';
import { posix } from 'node:path';
import type { KnowledgeSection } from './knowledge-sections';

export const FAQ_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const FAQ_IMPORT_MAX_ROWS = 500;
export const FAQ_IMPORT_HEADERS = ['question', 'answer', 'category', 'language', 'visibility'] as const;
export type ImportedFaq = { rowNumber: number; question: string; answer: string; category?: string; language?: string; knowledgeSection?: KnowledgeSection; visibility?: 'INTERNAL_RESTRICTED' | 'PUBLIC_REFERENCE'; errors: string[]; duplicateInFile: boolean; duplicateExisting: boolean };
type ParsedGrid = { rows: string[][]; rowNumbers: number[] };

const decodeXml = (value: string) => value.replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16))).replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xmlAttribute = (attributes: string, name: string) => attributes.match(new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
const columnIndex = (ref: string) => { const letters = ref.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ''; let index = 0; for (const char of letters) index = index * 26 + char.charCodeAt(0) - 64; return index - 1; };

function parseCsv(text: string): ParsedGrid {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) { if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"') { if (cell.length) throw new Error('Malformed CSV quoting.'); quoted = true; }
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((value) => value.trim())) rows.push(row); if (rows.length > FAQ_IMPORT_MAX_ROWS + 1) throw new Error(`Import files may contain at most ${FAQ_IMPORT_MAX_ROWS} FAQ rows.`); row = []; }
    else cell += char;
  }
  if (quoted) throw new Error('Malformed CSV quoting.');
  row.push(cell); if (row.some((value) => value.trim())) rows.push(row); if (rows.length > FAQ_IMPORT_MAX_ROWS + 1) throw new Error(`Import files may contain at most ${FAQ_IMPORT_MAX_ROWS} FAQ rows.`);
  return { rows, rowNumbers: rows.map((_, index) => index + 1) };
}

function decodeCsv(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  const utf8 = buffer.subarray(buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(utf8); }
  catch { return new TextDecoder('windows-1252').decode(buffer); }
}

function zipEntries(buffer: Buffer): Map<string, Buffer> {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw new Error('This is not a valid XLSX workbook.');
  let eocd = -1; for (let i = Math.max(0, buffer.length - 65557); i <= buffer.length - 22; i++) if (buffer.readUInt32LE(i) === 0x06054b50) eocd = i;
  if (eocd < 0) throw new Error('The XLSX workbook directory is malformed.');
  const count = buffer.readUInt16LE(eocd + 10); const dirSize = buffer.readUInt32LE(eocd + 12); let offset = buffer.readUInt32LE(eocd + 16);
  if (count > 200 || offset + dirSize > buffer.length) throw new Error('The XLSX workbook contains too many or malformed files.');
  const result = new Map<string, Buffer>(); let expandedBytes = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('The XLSX workbook directory is malformed.');
    const flags = buffer.readUInt16LE(offset + 8); const method = buffer.readUInt16LE(offset + 10); const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28); const extraLength = buffer.readUInt16LE(offset + 30); const commentLength = buffer.readUInt16LE(offset + 32); const localOffset = buffer.readUInt32LE(offset + 42);
    const nameEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (nameEnd > buffer.length) throw new Error('The XLSX workbook directory is malformed.');
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'); offset = nameEnd;
    if (/vbaProject|externalLinks|embeddings/i.test(name) || (flags & 1)) throw new Error('Macros, external links, embedded files and encrypted workbooks are not supported.');
    if (!(/^xl\/worksheets\/[^/]+\.xml$/.test(name) || ['xl/sharedStrings.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels'].includes(name))) continue;
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('The XLSX workbook contains a malformed entry.');
    const localName = buffer.readUInt16LE(localOffset + 26); const localExtra = buffer.readUInt16LE(localOffset + 28); const start = localOffset + 30 + localName + localExtra;
    if (start + compressed > buffer.length) throw new Error('The XLSX workbook contains a truncated entry.');
    const packed = buffer.subarray(start, start + compressed);
    let bytes: Buffer | null;
    try { bytes = method === 0 ? packed : method === 8 ? inflateRawSync(packed, { maxOutputLength: FAQ_IMPORT_MAX_BYTES * 8 }) : null; }
    catch { throw new Error('The XLSX workbook contains a corrupted compressed entry.'); }
    if (!bytes) throw new Error('This XLSX compression format is unsupported.');
    expandedBytes += bytes.length;
    if (expandedBytes > FAQ_IMPORT_MAX_BYTES * 8) throw new Error('The XLSX workbook expands beyond the safe import limit.');
    result.set(name, bytes);
  }
  if (![...result.keys()].some((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name))) throw new Error('The XLSX workbook has no worksheet.');
  return result;
}

function parseXlsx(buffer: Buffer): ParsedGrid {
  const entries = zipEntries(buffer);
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const relationships = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const firstSheet = workbook.match(/<(?:[\w.-]+:)?sheet\b([^>]*)\/?\s*>/i)?.[1] ?? '';
  const relationshipId = xmlAttribute(firstSheet, 'id');
  const relationship = relationshipId ? [...relationships.matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*)\/?\s*>/gi)].find((match) => xmlAttribute(match[1]!, 'Id') === relationshipId) : undefined;
  const target = relationship?.[1] ? decodeXml(xmlAttribute(relationship[1], 'Target') ?? '') : undefined;
  if (workbook && !firstSheet) throw new Error('The XLSX workbook contains no worksheets.');
  if (firstSheet && (!relationshipId || !relationship || !target)) throw new Error('The first worksheet reference in this XLSX workbook is incomplete.');
  const resolvedTarget = target ? posix.normalize(target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(resolvedTarget)) throw new Error('The first worksheet reference in this XLSX workbook is invalid.');
  const xml = entries.get(resolvedTarget)?.toString('utf8');
  if (!xml) throw new Error('The first worksheet referenced by this XLSX workbook is missing.');
  if (/<(?:[\w.-]+:)?f\b/i.test(xml)) throw new Error('Formula cells are not accepted. Replace formulas with plain text values.');
  const sharedXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  const shared = [...sharedXml.matchAll(/<(?:[\w.-]+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?si>/gi)].map((match) => [...match[1]!.matchAll(/<(?:[\w.-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?t>/gi)].map((part) => decodeXml(part[1]!)).join(''));
  const rows: string[][] = []; const rowNumbers: number[] = [];
  for (const rowMatch of xml.matchAll(/<(?:[\w.-]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?row\s*>/gi)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[2]!.matchAll(/<(?:[\w.-]+:)?c\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?c\s*>/gi)) {
      const attrs = cellMatch[1]!; const ref = attrs.match(/\br="([A-Z]+\d+)"/i)?.[1] ?? ''; const col = columnIndex(ref); if (col < 0 || col > 20) continue;
      const body = cellMatch[2]!; const type = xmlAttribute(attrs, 't'); const value = body.match(/<(?:[\w.-]+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?v>/i)?.[1];
      const inline = [...body.matchAll(/<(?:[\w.-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?t>/gi)].map((part) => decodeXml(part[1]!)).join('');
      row[col] = type === 's' ? shared[Number(value)] ?? '' : type === 'inlineStr' ? inline : value === undefined ? '' : decodeXml(value);
    }
    if (row.some((value) => value?.trim())) { rows.push(row.map((value) => value ?? '')); rowNumbers.push(Number(xmlAttribute(rowMatch[1]!, 'r')) || rows.length); }
    if (rows.length > FAQ_IMPORT_MAX_ROWS + 1) throw new Error(`Import files may contain at most ${FAQ_IMPORT_MAX_ROWS} FAQ rows.`);
  }
  if (!rows.length) throw new Error('The first worksheet is empty; it contains no header row.');
  return { rows, rowNumbers };
}

export function parseFaqImport(filename: string, buffer: Buffer): ImportedFaq[] {
  if (!buffer.length) throw new Error('The uploaded file is empty.');
  if (buffer.length > FAQ_IMPORT_MAX_BYTES) throw new Error('Import files must be 2 MB or smaller.');
  const extension = filename.toLowerCase().split('.').pop();
  const grid = extension === 'csv' ? parseCsv(decodeCsv(buffer).replace(/^\uFEFF/, '')) : extension === 'xlsx' ? parseXlsx(buffer) : (() => { throw new Error('Upload a .csv or .xlsx file.'); })();
  const { rows, rowNumbers } = grid;
  if (rows.length < 1) throw new Error(extension === 'csv' ? 'The CSV file is empty; it contains no header row.' : 'The import file has no header row.');
  if (rows.length > FAQ_IMPORT_MAX_ROWS + 1) throw new Error(`Import files may contain at most ${FAQ_IMPORT_MAX_ROWS} FAQ rows.`);
  const headers = rows[0]!.map((header) => header.replace(/^\uFEFF/, '').trim().toLowerCase());
  const questionIndex = headers.indexOf('question'); const answerIndex = headers.indexOf('answer');
  if (questionIndex < 0 || answerIndex < 0 || headers.some((header) => !FAQ_IMPORT_HEADERS.includes(header as typeof FAQ_IMPORT_HEADERS[number])) || new Set(headers).size !== headers.length) throw new Error('Required headers are question and answer. Supported optional headers are category, language, visibility; headers must not be duplicated.');
  const indices = Object.fromEntries(FAQ_IMPORT_HEADERS.map((header) => [header, headers.indexOf(header)])) as Record<typeof FAQ_IMPORT_HEADERS[number], number>;
  const parsed = rows.slice(1).map((cells, i) => {
    const at = (name: typeof FAQ_IMPORT_HEADERS[number]) => indices[name] >= 0 ? (cells[indices[name]] ?? '') : '';
    const question = at('question').trim(); const answer = at('answer').trim(); const category = at('category').trim(); const language = at('language').trim(); const rawVisibility = at('visibility').trim().toUpperCase(); const errors: string[] = [];
    if (cells.length > headers.length) errors.push('Row contains more values than the header row.');
    if (!question) errors.push('Question is required.'); else if (question.length > 200) errors.push('Question must be 200 characters or fewer.');
    if (!answer) errors.push('Answer is required.'); else if (answer.length > 20000) errors.push('Answer must be 20,000 characters or fewer.');
    if (category.length > 120) errors.push('Category must be 120 characters or fewer.');
    if (language && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language)) errors.push('Language must be a valid language tag.');
    if (rawVisibility && !['INTERNAL_RESTRICTED', 'PUBLIC_REFERENCE'].includes(rawVisibility)) errors.push('Visibility must be INTERNAL_RESTRICTED or PUBLIC_REFERENCE.');
    return { rowNumber: rowNumbers[i + 1] ?? i + 2, question, answer, ...(category ? { category } : {}), ...(language ? { language } : {}), ...(rawVisibility ? { visibility: rawVisibility as ImportedFaq['visibility'] } : {}), errors, duplicateInFile: false, duplicateExisting: false };
  });
  const groups = new Map<string, ImportedFaq[]>();
  for (const row of parsed) { const key = row.question.normalize('NFKC').toLowerCase().replace(/\s+/g, ' '); if (key) groups.set(key, [...(groups.get(key) ?? []), row]); }
  for (const group of groups.values()) if (group.length > 1) for (const row of group) row.duplicateInFile = true;
  return parsed;
}

export function faqImportTemplateCsv() { return `${FAQ_IMPORT_HEADERS.join(',')}\r\n`; }
