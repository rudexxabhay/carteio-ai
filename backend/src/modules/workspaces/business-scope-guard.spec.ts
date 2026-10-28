import { decideBusinessScope } from './business-scope-guard';
import { unknownSemanticInterpretation } from './multilingual-semantics';

describe('authorized semantic business-scope routing', () => {
  it('redirects a clearly unrelated general question for the current authorized workspace', () => {
    const semantic = { ...unknownSemanticInterpretation(), businessScopeAssessment: 'OUT_OF_SCOPE' as const, informationNeed: 'STATIC_BUSINESS_INFORMATION' as const, intents: [{ category: 'OUT_OF_SCOPE_CANDIDATE' as const, polarity: 'AFFIRMATIVE' as const }] };
    expect(decideBusinessScope({ semantic, businessName: 'North Shop' }))
      .toMatchObject({ outcome: 'OUT_OF_SCOPE', redirectAllowed: true });
  });

  it('keeps mixed or business-classified requests on the normal authorized path', () => {
    const semantic = { ...unknownSemanticInterpretation(), businessScopeAssessment: 'OUT_OF_SCOPE' as const, informationNeed: 'STATIC_BUSINESS_INFORMATION' as const, intents: [{ category: 'PRODUCT_INQUIRY' as const, polarity: 'AFFIRMATIVE' as const }] };
    expect(decideBusinessScope({ semantic, businessName: 'North Shop', businessPurpose: 'Retail products' }))
      .toMatchObject({ outcome: 'UNCERTAIN', redirectAllowed: false });
  });
});
