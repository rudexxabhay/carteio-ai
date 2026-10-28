/**
 * Validated advisory output from the single query interpretation stage.
 * Nothing in this type grants capability, source access, or record ownership.
 */
export const SEMANTIC_INTENTS = [
  'GREETING', 'WELLBEING_EXCHANGE', 'ACKNOWLEDGMENT', 'GRATITUDE', 'FAREWELL',
  'ASSISTANT_IDENTITY_INQUIRY',
  'BUSINESS_INFORMATION', 'KNOWLEDGE_QUESTION', 'STATUS_INQUIRY',
  'PRODUCT_INQUIRY', 'PRICING_INQUIRY', 'AVAILABILITY_INQUIRY', 'BOOKING_INQUIRY', 'APPOINTMENT_INFORMATION',
  'PAYMENT_INQUIRY', 'REFUND_INQUIRY', 'SUPPORT_REQUEST', 'COMPLAINT', 'CONVERSATION_FEEDBACK', 'CONVERSATION_CONTINUATION',
  'CLARIFICATION', 'CORRECTION', 'FOLLOW_UP', 'OUT_OF_SCOPE_CANDIDATE', 'UNKNOWN',
] as const;
export type SemanticIntent = typeof SEMANTIC_INTENTS[number];
export const SOCIAL_CLASSIFICATIONS = [
  'GREETING', 'WELLBEING_EXCHANGE', 'ACKNOWLEDGMENT', 'GRATITUDE', 'FAREWELL',
  'BUSINESS_REQUEST_WITH_GREETING', 'OTHER', 'AMBIGUOUS', 'UNKNOWN',
] as const;
export type SocialClassification = typeof SOCIAL_CLASSIFICATIONS[number];
export const INFORMATION_NEEDS = [
  'STATIC_BUSINESS_INFORMATION', 'PERSONAL_LIVE_RECORD', 'MIXED_STATIC_AND_PERSONAL', 'AMBIGUOUS', 'UNKNOWN',
] as const;
export type InformationNeed = typeof INFORMATION_NEEDS[number];
export const BUSINESS_SCOPE_ASSESSMENTS = ['IN_SCOPE', 'OUT_OF_SCOPE', 'PARTIALLY_IN_SCOPE', 'UNCERTAIN', 'UNKNOWN'] as const;
export type BusinessScopeAssessment = typeof BUSINESS_SCOPE_ASSESSMENTS[number];
export type IntentPolarity = 'AFFIRMATIVE' | 'NEGATED' | 'UNCERTAIN' | 'NOT_APPLICABLE';
export const SEMANTIC_ENTITY_TYPES = [
  'ORDER_ID', 'SHIPMENT_ID', 'LR_NUMBER', 'BOOKING_REFERENCE', 'PRODUCT_NAME',
  'DATE_REFERENCE', 'DATE_RANGE', 'AMOUNT', 'CURRENCY', 'LOCATION',
  'PERSON_REFERENCE', 'SERVICE_NAME',
] as const;
export type SemanticEntityType = typeof SEMANTIC_ENTITY_TYPES[number];
export type SemanticEntity = Readonly<{ type: SemanticEntityType; raw: string }>;
export type MultilingualSemanticInterpretation = Readonly<{
  language: Readonly<{
    primary: string | null;
    scripts: readonly string[];
    mixed: boolean;
    certainty: 'CLEAR' | 'UNCERTAIN' | 'UNKNOWN';
    signals: readonly string[];
  }>;
  /** The active explicit language request from bounded conversation context; null is not guessed. */
  responseLanguagePreference: string | null;
  /** Advisory classification only; never authorizes bypassing factual grounding. */
  socialClassification: SocialClassification;
  /** Describes the type of information requested; never grants source access. */
  informationNeed: InformationNeed;
  /** Model advisory only; the server combines it with trusted assistant scope. */
  businessScopeAssessment: BusinessScopeAssessment;
  intents: readonly Readonly<{ category: SemanticIntent; polarity: IntentPolarity }>[];
  entities: readonly SemanticEntity[];
  uncertainty: 'NONE' | 'AMBIGUOUS' | 'UNKNOWN';
  clarificationRequired: boolean;
}>;

export function unknownSemanticInterpretation(reason = 'SEMANTIC_PAYLOAD_MISSING'): MultilingualSemanticInterpretation {
  return Object.freeze({
    language: Object.freeze({ primary: null, scripts: Object.freeze([] as string[]), mixed: false, certainty: 'UNKNOWN' as const, signals: Object.freeze([reason]) }),
    responseLanguagePreference: null,
    socialClassification: 'UNKNOWN' as const,
    informationNeed: 'UNKNOWN' as const,
    businessScopeAssessment: 'UNKNOWN' as const,
    intents: Object.freeze([Object.freeze({ category: 'UNKNOWN' as const, polarity: 'UNCERTAIN' as const })]),
    entities: Object.freeze([] as SemanticEntity[]),
    uncertainty: 'UNKNOWN' as const,
    clarificationRequired: true,
  });
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const shortText = (value: unknown, max = 80): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const polarities: readonly IntentPolarity[] = ['AFFIRMATIVE', 'NEGATED', 'UNCERTAIN', 'NOT_APPLICABLE'];

/**
 * Rejects malformed or contradictory shapes. Entity values are accepted only
 * as exact, case-sensitive spans of this user message; no fuzzy matching,
 * canonicalization, date inference, or model-generated IDs are trusted.
 */
export function validateMultilingualSemanticInterpretation(
  value: unknown,
  originalMessage: string,
): MultilingualSemanticInterpretation | null {
  return validateMultilingualSemanticInterpretationDetailed(value, originalMessage).value;
}

export type SemanticValidationReason = 'valid' | 'semantic_root_shape' | 'semantic_unsupported_field' | 'semantic_language_shape' | 'semantic_response_language_shape' | 'semantic_social_classification' | 'semantic_information_need' | 'semantic_scope_assessment' | 'semantic_intents_shape' | 'semantic_intent_shape' | 'semantic_duplicate_intent' | 'semantic_entities_shape' | 'semantic_entity_shape' | 'semantic_entity_not_exact_message_span' | 'semantic_uncertainty_shape' | 'semantic_uncertainty_conflict';
export type SemanticValidationDetail = 'language_object_shape' | 'language_fields_shape' | 'language_primary_shape' | 'language_scripts_shape' | 'language_mixed_shape' | 'language_certainty_shape' | 'language_signals_shape';
export function validateMultilingualSemanticInterpretationDetailed(value: unknown, originalMessage: string): { value: MultilingualSemanticInterpretation | null; reason: SemanticValidationReason; detail?: SemanticValidationDetail } {
  if (!record(value)) return { value: null, reason: 'semantic_root_shape' };
  if (!hasOnlyKeys(value, ['language', 'responseLanguagePreference', 'socialClassification', 'informationNeed', 'businessScopeAssessment', 'intents', 'entities', 'uncertainty', 'clarificationRequired'])) return { value: null, reason: 'semantic_unsupported_field' };
  const language = value.language;
  if (!record(language)) return { value: null, reason: 'semantic_language_shape', detail: 'language_object_shape' };
  if (!hasOnlyKeys(language, ['primary', 'scripts', 'mixed', 'certainty', 'signals'])) return { value: null, reason: 'semantic_language_shape', detail: 'language_fields_shape' };
  if (!(language.primary === null || shortText(language.primary, 80))) return { value: null, reason: 'semantic_language_shape', detail: 'language_primary_shape' };
  if (!Array.isArray(language.scripts) || language.scripts.length > 4 || !language.scripts.every((item) => shortText(item, 40))) return { value: null, reason: 'semantic_language_shape', detail: 'language_scripts_shape' };
  if (typeof language.mixed !== 'boolean') return { value: null, reason: 'semantic_language_shape', detail: 'language_mixed_shape' };
  if (!['CLEAR', 'UNCERTAIN', 'UNKNOWN'].includes(String(language.certainty))) return { value: null, reason: 'semantic_language_shape', detail: 'language_certainty_shape' };
  if (!Array.isArray(language.signals) || language.signals.length > 8 || !language.signals.every((item) => shortText(item, 80))) return { value: null, reason: 'semantic_language_shape', detail: 'language_signals_shape' };
  if (!(value.responseLanguagePreference === undefined || value.responseLanguagePreference === null || shortText(value.responseLanguagePreference, 80))) return { value: null, reason: 'semantic_response_language_shape' };
  // Missing classification stays backward compatible but cannot authorize a
  // social shortcut. Explicit values must be from the closed contract.
  const socialClassification = value.socialClassification === undefined ? 'UNKNOWN' : value.socialClassification;
  if (!SOCIAL_CLASSIFICATIONS.includes(socialClassification as SocialClassification)) return { value: null, reason: 'semantic_social_classification' };
  const informationNeed = value.informationNeed === undefined ? 'UNKNOWN' : value.informationNeed;
  if (!INFORMATION_NEEDS.includes(informationNeed as InformationNeed)) return { value: null, reason: 'semantic_information_need' };
  const businessScopeAssessment = value.businessScopeAssessment === undefined ? 'UNKNOWN' : value.businessScopeAssessment;
  if (!BUSINESS_SCOPE_ASSESSMENTS.includes(businessScopeAssessment as BusinessScopeAssessment)) return { value: null, reason: 'semantic_scope_assessment' };

  if (!Array.isArray(value.intents) || value.intents.length < 1 || value.intents.length > 4) return { value: null, reason: 'semantic_intents_shape' };
  const intents: Array<{ category: SemanticIntent; polarity: IntentPolarity }> = [];
  for (const candidate of value.intents) {
    if (!record(candidate) || !hasOnlyKeys(candidate, ['category', 'polarity'])
      || !SEMANTIC_INTENTS.includes(candidate.category as SemanticIntent)
      || !polarities.includes(candidate.polarity as IntentPolarity)) return { value: null, reason: 'semantic_intent_shape' };
    intents.push({ category: candidate.category as SemanticIntent, polarity: candidate.polarity as IntentPolarity });
  }
  if (new Set(intents.map(({ category }) => category)).size !== intents.length) return { value: null, reason: 'semantic_duplicate_intent' };

  if (!Array.isArray(value.entities) || value.entities.length > 12) return { value: null, reason: 'semantic_entities_shape' };
  const entities: SemanticEntity[] = [];
  for (const candidate of value.entities) {
    if (!record(candidate) || !hasOnlyKeys(candidate, ['type', 'raw'])
      || !SEMANTIC_ENTITY_TYPES.includes(candidate.type as SemanticEntityType)
      || !shortText(candidate.raw, 200)) return { value: null, reason: 'semantic_entity_shape' };
    if (!originalMessage.includes(candidate.raw)) return { value: null, reason: 'semantic_entity_not_exact_message_span' };
    entities.push(Object.freeze({ type: candidate.type as SemanticEntityType, raw: candidate.raw as string }));
  }
  const uncertainty = value.uncertainty;
  if (!['NONE', 'AMBIGUOUS', 'UNKNOWN'].includes(String(uncertainty)) || typeof value.clarificationRequired !== 'boolean') return { value: null, reason: 'semantic_uncertainty_shape' };
  const primaryIntent = intents[0]!.category;
  if ((primaryIntent === 'UNKNOWN' && uncertainty !== 'UNKNOWN')
    || (uncertainty === 'AMBIGUOUS' && value.clarificationRequired !== true)) return { value: null, reason: 'semantic_uncertainty_conflict' };

  return { value: Object.freeze({
    language: Object.freeze({
      primary: language.primary as string | null,
      scripts: Object.freeze([...language.scripts] as string[]),
      mixed: language.mixed,
      certainty: language.certainty as 'CLEAR' | 'UNCERTAIN' | 'UNKNOWN',
      signals: Object.freeze([...language.signals] as string[]),
    }),
    responseLanguagePreference: (value.responseLanguagePreference ?? null) as string | null,
    socialClassification: socialClassification as SocialClassification,
    informationNeed: informationNeed as InformationNeed,
    businessScopeAssessment: businessScopeAssessment as BusinessScopeAssessment,
    intents: Object.freeze(intents.map((intent) => Object.freeze(intent))),
    entities: Object.freeze(entities),
    uncertainty: uncertainty as 'NONE' | 'AMBIGUOUS' | 'UNKNOWN',
    clarificationRequired: value.clarificationRequired,
  }), reason: 'valid' };
}
