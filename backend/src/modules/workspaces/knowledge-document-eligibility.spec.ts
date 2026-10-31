import { isVerifiedPdfDocumentSource } from './knowledge-document-eligibility';

const digest = 'a'.repeat(64);
const document = {
  filename: '01_Business_Introduction.pdf', bytes: 1200, hash: digest, contentHash: digest,
  sourceLanguage: 'en', extracted: true, pageCount: 1,
  pages: [{ page: 1, start: 0, end: 25, contentHash: digest, wordCount: 5 }],
};

describe('customer Knowledge PDF document eligibility', () => {
  it('accepts a structurally complete extracted PDF stored as TEXT', () => {
    expect(isVerifiedPdfDocumentSource({ type: 'TEXT', document })).toBe(true);
  });

  it.each([
    ['legacy FAQ', { type: 'FAQ', document: null }],
    ['legacy manual text', { type: 'TEXT', document: null }],
    ['legacy website', { type: 'WEBSITE', document: null }],
    ['unextracted PDF metadata', { type: 'TEXT', document: { ...document, extracted: false } }],
    ['missing PDF filename', { type: 'TEXT', document: { ...document, filename: 'policy.txt' } }],
    ['missing source hash', { type: 'TEXT', document: { ...document, hash: null } }],
    ['unreconciled page count', { type: 'TEXT', document: { ...document, pageCount: 2 } }],
    ['invalid page hash', { type: 'TEXT', document: { ...document, pages: [{ ...document.pages[0], contentHash: 'invalid' }] } }],
  ])('rejects %s', (_label, source) => {
    expect(isVerifiedPdfDocumentSource(source)).toBe(false);
  });
});
