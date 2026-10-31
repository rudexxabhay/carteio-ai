import { validateGroundedResponse } from './grounded-response-validation';
import type { ConversationEvidence } from './conversation.contracts';

const policy: ConversationEvidence = { reference: 'S1', chunkId: 'chunk', sourceId: 'source', sourceVersion: 1, contentHash: 'a'.repeat(64), title: 'Policy', type: 'TEXT', locator: 'policy.pdf · page 1', excerpt: 'The policy window is 30 business days.' };
const verify = (reply: string, statements: string[] = []) => validateGroundedResponse(reply, [policy], undefined, { customerStatements: statements, relevantReferences: ['S1'] });

describe('customer context remains separate from business evidence', () => {
  it.each([
    ['You mentioned', 'I purchased 4 items 12 days ago'],
    ['आपने बताया', 'मैंने ४ वस्तुएँ १२ दिन पहले खरीदीं'],
    ['Aapne bataya', 'Maine 4 items 12 din pehle kharide'],
    ['You reported', 'Maine 4 items १२ दिन pehle खरीदे'],
  ])('accepts a verbatim attributed user quotation: %s', (attribution, statement) => {
    expect(verify(`${attribution}: “${statement}”\nThe policy window is 30 business days. [S1]`, [statement]).accepted).toBe(true);
  });
  it('does not authorize merchant durations using a customer number', () => {
    expect(verify('The policy window is 12 days. [S1]', ['I purchased 4 items 12 days ago']).accepted).toBe(false);
  });
  it('rejects a quotation from a different conversation', () => {
    expect(verify('You mentioned: “I purchased 4 items 12 days ago”\nThe policy window is 30 business days. [S1]', ['A different user message']).accepted).toBe(false);
  });
  it('rejects a numeric business conclusion appended to the quoted context', () => {
    const statement = 'I purchased 4 items 12 days ago';
    expect(verify(`You mentioned: “${statement}”, so all 4 items qualify. [S1]`, [statement]).accepted).toBe(false);
  });
  it('does not bypass currency/price checks with customer quotations', () => {
    expect(verify('You mentioned: “I paid USD 50”\nThe price is USD 50. [S1]', ['I paid USD 50']).accepted).toBe(false);
  });
  it('preserves business-day distinctions', () => {
    expect(verify('The policy window is 30 days. [S1]').accepted).toBe(false);
  });
  it('still requires relevant citations and denies revoked evidence', () => {
    const reply = 'You mentioned: “12 days”\nThe policy window is 30 business days. [S1]';
    expect(validateGroundedResponse(reply, [], undefined, { customerStatements: ['12 days'] }).accepted).toBe(false);
    expect(validateGroundedResponse(reply, [policy], undefined, { relevantReferences: [], customerStatements: ['12 days'] }).accepted).toBe(false);
  });
  it('does not grant citation or URL authority to customer quotations', () => {
    expect(verify('You mentioned: “https://invalid.example [S9]”\nThe policy window is 30 business days. [S1]', ['https://invalid.example [S9]']).accepted).toBe(false);
  });
});
