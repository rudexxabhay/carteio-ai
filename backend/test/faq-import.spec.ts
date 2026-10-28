import { deflateRawSync } from 'node:zlib';
import { FAQ_IMPORT_HEADERS, faqImportTemplateCsv, parseFaqImport } from '../src/modules/workspaces/faq-import';

function crc32(data: Buffer) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function makeXlsx(files: Record<string, string>) {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let localOffset = 0;
  for (const [name, value] of Object.entries(files)) {
    const filename = Buffer.from(name); const content = Buffer.from(value); const compressed = deflateRawSync(content); const crc = crc32(content);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(filename.length, 26); locals.push(local, filename, compressed);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(localOffset, 42); centrals.push(central, filename); localOffset += local.length + filename.length + compressed.length;
  }
  const centralBytes = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(localOffset, 16); return Buffer.concat([...locals, centralBytes, end]);
}

describe('FAQ import parser', () => {
  it('accepts the generated CSV template contract and preserves Unicode FAQ text', () => {
    const template = faqImportTemplateCsv();
    expect(template).toBe(`${FAQ_IMPORT_HEADERS.join(',')}\r\n`);
    const rows = parseFaqImport('faqs.csv', Buffer.from(`${template}"वापसी नीति?","Aap 7 din ke andar return kar sakte hain.",Returns,hi-Latn,INTERNAL_RESTRICTED\r\n`));
    expect(rows[0]).toMatchObject({ question: 'वापसी नीति?', answer: 'Aap 7 din ke andar return kar sakte hain.', language: 'hi-Latn', errors: [] });
  });

  it('parses a plain XLSX inline-string worksheet', () => {
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>question</t></is></c><c r="B1" t="inlineStr"><is><t>answer</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>हिंदी सवाल</t></is></c><c r="B2" t="inlineStr"><is><t>उत्तर</t></is></c></row></sheetData></worksheet>';
    expect(parseFaqImport('faqs.xlsx', makeXlsx({ 'xl/worksheets/sheet1.xml': sheet }))).toMatchObject([{ question: 'हिंदी सवाल', answer: 'उत्तर', errors: [] }]);
  });

  it('reads the workbook-declared first worksheet when it is not sheet1 and accepts namespace-prefixed Excel XML', () => {
    const workbook = '<x:workbook xmlns:x="urn:workbook" xmlns:r="urn:relationships"><x:sheets><x:sheet name="FAQs" sheetId="1" r:id="rIdFaq"/></x:sheets></x:workbook>';
    const relationships = '<x:Relationships xmlns:x="urn:relationships"><x:Relationship Id="rIdFaq" Target="worksheets/sheet2.xml" Type="worksheet"/></x:Relationships>';
    const sheet = '<x:worksheet xmlns:x="urn:sheet"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t> Question </x:t></x:is></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>Answer</x:t></x:is></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>Category</x:t></x:is></x:c></x:row><x:row r="4"><x:c r="A4" t="inlineStr"><x:is><x:t>What is Carteio?</x:t></x:is></x:c><x:c r="B4" t="inlineStr"><x:is><x:t>Carteio is an online jewellery store.</x:t></x:is></x:c><x:c r="C4" t="inlineStr"><x:is><x:t>Store</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>';
    const rows = parseFaqImport('faqs.xlsx', makeXlsx({ 'xl/workbook.xml': workbook, 'xl/_rels/workbook.xml.rels': relationships, 'xl/worksheets/sheet2.xml': sheet }));
    expect(rows).toMatchObject([{ rowNumber: 4, question: 'What is Carteio?', answer: 'Carteio is an online jewellery store.', category: 'Store', errors: [] }]);
  });

  it('parses required-only CSV, UTF-8 BOM, quoted commas and multiline answers with normalized headers', () => {
    const csv = '\uFEFF Question , ANSWER \r\n"How can I contact support?","Use email, chat, or phone.\r\nWe reply soon."\r\n\r\n';
    expect(parseFaqImport('faqs.csv', Buffer.from(csv))).toMatchObject([{ question: 'How can I contact support?', answer: 'Use email, chat, or phone.\r\nWe reply soon.', rowNumber: 2, errors: [] }]);
  });

  it('decodes UTF-16LE CSV exported from spreadsheet software', () => {
    const content = 'question,answer\r\nWhat is Carteio?,An online jewellery store.';
    const file = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]);
    expect(parseFaqImport('faqs.csv', file)).toMatchObject([{ question: 'What is Carteio?', answer: 'An online jewellery store.', errors: [] }]);
  });

  it('parses all 154 FAQ rows in an XLSX worksheet without truncation', () => {
    const header = '<row r="1"><c r="A1" t="inlineStr"><is><t>question</t></is></c><c r="B1" t="inlineStr"><is><t>answer</t></is></c></row>';
    const data = Array.from({ length: 154 }, (_, i) => `<row r="${i + 2}"><c r="A${i + 2}" t="inlineStr"><is><t>Question ${i + 1}?</t></is></c><c r="B${i + 2}" t="inlineStr"><is><t>Answer ${i + 1}.</t></is></c></row>`).join('');
    const rows = parseFaqImport('154-faqs.xlsx', makeXlsx({ 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${header}${data}</sheetData></worksheet>` }));
    expect(rows).toHaveLength(154);
    expect(rows[153]).toMatchObject({ rowNumber: 155, question: 'Question 154?', answer: 'Answer 154.', errors: [] });
  });

  it('distinguishes empty, corrupt, headerless and missing-header files', () => {
    expect(() => parseFaqImport('empty.csv', Buffer.from(''))).toThrow(/uploaded file is empty/);
    expect(() => parseFaqImport('blank.csv', Buffer.from('\r\n\n'))).toThrow(/CSV file is empty; it contains no header row/);
    expect(() => parseFaqImport('empty.xlsx', makeXlsx({ 'xl/worksheets/sheet1.xml': '<worksheet><sheetData/></worksheet>' }))).toThrow(/first worksheet is empty/);
    expect(() => parseFaqImport('no-sheet.xlsx', makeXlsx({ 'xl/workbook.xml': '<workbook><sheets/></workbook>' }))).toThrow(/no worksheet/);
    expect(() => parseFaqImport('broken.xlsx', Buffer.from('not an xlsx'))).toThrow(/not a valid XLSX workbook/);
    expect(() => parseFaqImport('headers.csv', Buffer.from('title,answer\nTest,Answer'))).toThrow(/Required headers are question and answer/);
    expect(() => parseFaqImport('duplicate.csv', Buffer.from('Question, question, answer\nOne,Other,Answer'))).toThrow(/headers must not be duplicated/);
  });

  it('rejects unsupported headers, duplicate questions and spreadsheet formulas', () => {
    expect(() => parseFaqImport('bad.csv', Buffer.from('title,answer\nTest,Answer'))).toThrow(/headers/);
    expect(parseFaqImport('dupe.csv', Buffer.from('question,answer\nOne,Answer\none,Other'))[1]?.duplicateInFile).toBe(true);
    const formula = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>question</t></is></c></row><row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>';
    expect(() => parseFaqImport('formula.xlsx', makeXlsx({ 'xl/worksheets/sheet1.xml': formula }))).toThrow(/Formula cells/);
  });
});
