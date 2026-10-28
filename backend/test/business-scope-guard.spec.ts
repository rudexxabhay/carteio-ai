import { decideBusinessScope } from '../src/modules/workspaces/business-scope-guard';
import type { MultilingualSemanticInterpretation } from '../src/modules/workspaces/multilingual-semantics';

const semantic = (businessScopeAssessment: MultilingualSemanticInterpretation['businessScopeAssessment'], category: MultilingualSemanticInterpretation['intents'][number]['category'] = 'KNOWLEDGE_QUESTION', informationNeed: MultilingualSemanticInterpretation['informationNeed'] = 'STATIC_BUSINESS_INFORMATION'): MultilingualSemanticInterpretation => ({
  language: { primary: 'English', scripts: ['Latin'], mixed: false, certainty: 'CLEAR', signals: [] },
  responseLanguagePreference: null, socialClassification: 'OTHER', informationNeed, businessScopeAssessment,
  intents: [{ category, polarity: 'AFFIRMATIVE' }], entities: [], uncertainty: 'NONE', clarificationRequired: false,
});

describe('business scope guard', () => {
  const business = { businessName: 'Northwind Academy', businessPurpose: 'Education and admissions', businessDescription: 'Student admissions and learning services.' };
  it('redirects only an explicit out-of-scope candidate when server business context exists', () => {
    expect(decideBusinessScope({ semantic: semantic('OUT_OF_SCOPE', 'OUT_OF_SCOPE_CANDIDATE', 'UNKNOWN'), ...business })).toMatchObject({ outcome: 'OUT_OF_SCOPE', redirectAllowed: true });
    expect(decideBusinessScope({ semantic: semantic('OUT_OF_SCOPE') })).toMatchObject({ outcome: 'UNCERTAIN', reason: 'BUSINESS_CONTEXT_NOT_CONFIGURED', redirectAllowed: false });
    expect(decideBusinessScope({ semantic: semantic('OUT_OF_SCOPE', 'OUT_OF_SCOPE_CANDIDATE', 'UNKNOWN'), businessPurpose: 'Answer business questions' })).toMatchObject({ outcome: 'UNCERTAIN', reason: 'BUSINESS_CONTEXT_NOT_CONFIGURED', redirectAllowed: false });
  });
  it('does not let an out-of-scope estimate override a plausible business question', () => {
    for (const intent of ['PRICING_INQUIRY', 'AVAILABILITY_INQUIRY', 'BUSINESS_INFORMATION', 'KNOWLEDGE_QUESTION'] as const) {
      expect(decideBusinessScope({ semantic: semantic('OUT_OF_SCOPE', intent), ...business })).toMatchObject({ outcome: 'UNCERTAIN', reason: 'SCOPE_SIGNAL_CONFLICT', redirectAllowed: false });
    }
    expect(decideBusinessScope({ semantic: semantic('OUT_OF_SCOPE', 'OUT_OF_SCOPE_CANDIDATE', 'STATIC_BUSINESS_INFORMATION'), ...business })).toMatchObject({ outcome: 'UNCERTAIN', reason: 'SCOPE_SIGNAL_CONFLICT', redirectAllowed: false });
    expect(decideBusinessScope({ semantic: semantic('IN_SCOPE'), ...business })).toMatchObject({ outcome: 'IN_SCOPE', redirectAllowed: false });
  });
  it('represents partial and unknown scope separately', () => {
    expect(decideBusinessScope({ semantic: semantic('PARTIALLY_IN_SCOPE'), ...business }).outcome).toBe('PARTIALLY_IN_SCOPE');
    expect(decideBusinessScope({ semantic: semantic('UNKNOWN'), ...business }).outcome).toBe('UNCERTAIN');
    expect(decideBusinessScope({ semantic: semantic('OUT_OF_SCOPE', 'OUT_OF_SCOPE_CANDIDATE', 'UNKNOWN'), ...business }))
      .toMatchObject({ outcome: 'OUT_OF_SCOPE', redirectAllowed: true });
  });
});
