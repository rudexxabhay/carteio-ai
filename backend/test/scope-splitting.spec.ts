import { validateScopeSplit } from '../src/modules/workspaces/scope-splitting';

describe('validated mixed-scope question splitting', () => {
  const original = 'What is your refund policy, and who won yesterday’s match?';

  it('accepts two distinct exact, non-overlapping spans of the original customer text', () => {
    expect(validateScopeSplit({ businessQuestion: 'What is your refund policy', unrelatedQuestion: 'who won yesterday’s match' }, original)).toEqual({
      businessQuestion: 'What is your refund policy', unrelatedQuestion: 'who won yesterday’s match',
    });
  });

  it('rejects invented paraphrases, overlapping spans, and extra model authority fields', () => {
    expect(validateScopeSplit({ businessQuestion: 'Explain the return rules', unrelatedQuestion: 'who won yesterday’s match' }, original)).toBeNull();
    expect(validateScopeSplit({ businessQuestion: original.slice(0, 30), unrelatedQuestion: original.slice(20, 42) }, original)).toBeNull();
    expect(validateScopeSplit({ businessQuestion: 'What is your refund policy', unrelatedQuestion: 'who won yesterday’s match', authorized: true }, original)).toBeNull();
  });
});
