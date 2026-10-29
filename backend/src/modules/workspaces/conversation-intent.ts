import { isValidatedConversationalContinuation, unknownSemanticInterpretation, validateMultilingualSemanticInterpretationDetailed } from './multilingual-semantics';
import type { MultilingualSemanticInterpretation, SemanticValidationDetail, SemanticValidationReason } from './multilingual-semantics';
import type { ConversationMemoryDiagnostic } from './conversation-diagnostics';
import { validateScopeSplit } from './scope-splitting';
import { decideSocialResponse } from './social-conversation';

export type PlaygroundTurn = { role: 'user' | 'assistant'; content: string; responseCategory?: string | null };
export type PlaygroundConversationHandle = { id: string; lockId: string; organizationId: string; assistantId: string; userId: string; nextSequence: number; turns: PlaygroundTurn[]; memory?: ConversationMemoryDiagnostic };
export type ConversationUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };
export type PlaygroundLanguage = string;

export type SocialIntent = 'greeting' | 'wellbeing' | 'thanks' | 'farewell' | 'capability';
export type DeterministicSocialLanguage = 'English';
export const isSocialIntent = (value: QueryInterpretation['intent']): value is SocialIntent => value === 'greeting' || value === 'wellbeing' || value === 'thanks' || value === 'farewell' || value === 'capability';
export const normalizeGreeting = (message: string) => message
  .toLocaleLowerCase()
  .trim()
  .replace(/^[\s.,!?¡¿]+|[\s.,!?¡¿]+$/gu, '')
  .replace(/\s+/g, ' ');

export const classifySocialIntent = (message: string): SocialIntent | null => {
  const normalized = normalizeGreeting(message);
  if (/^(?:h+i+|he+l+o+|hey(?: there| bro)?|namaste|namaskar|salaam|salam|assalamualaikum|नमस्ते|नमस्कार|हाय|हैलो|हेलो)$/iu.test(normalized)) return 'greeting';
  if (/^(?:thanks|thank you|thank you so much|thanks a lot|shukriya|dhanyavaad|धन्यवाद|शुक्रिया)$/iu.test(normalized)) return 'thanks';
  if (/^(?:bye|goodbye|good bye|see you|see you later|good night|alvida|फिर मिलेंगे|अलविदा)$/iu.test(normalized)) return 'farewell';
  if (/^(?:can you help me|what can you do|what do you do|how can you help|tum kya kar sakte ho|aap kya kar sakte hain|तुम क्या कर सकते हो|आप क्या कर सकते हैं)$/iu.test(normalized)) return 'capability';
  return null;
};

export const containsBusinessOrActionRequest = (message: string) => /\b(?:return|refund|shipping|delivery|price|pricing|cost|product|service|order|booking|book|appointment|policy|hours|open|close|cancel|track|tracking|account|customer|email|phone|address|discount|warranty|payment|subscription|plan)\b|(?:रिटर्न|रिफंड|डिलीवरी|कीमत|प्रोडक्ट|सेवा|ऑर्डर|नीति|समय|बुकिंग)/iu.test(message);

export const socialLanguage = (assistantLanguage: string, message: string): DeterministicSocialLanguage | null => {
  const configured = assistantLanguage.toLowerCase();
  if (configured !== 'auto' && configured !== 'en') return null;
  return /^(?:h+i+|he+l+o+|hey(?: there| bro)?|thanks|thank you|bye|goodbye|can you help me|what can you do)[.!? ]*$/iu.test(normalizeGreeting(message))
    ? 'English'
    : null;
};

export const socialLanguageFromLabel = (language: string): DeterministicSocialLanguage | null => {
  const normalized = language.trim().toLowerCase();
  return /^(?:english|en)(?:\b|$)/u.test(normalized) ? 'English' : null;
};

export const describeLanguagePreference = (languageTag: string) => {
  const normalized = languageTag.trim();
  if (normalized.toLowerCase() === 'hi-latn') return 'Hindi written in the Latin script (Hinglish)';
  try { return `${new Intl.DisplayNames(['en'], { type: 'language' }).of(normalized) ?? normalized} (${normalized})`; }
  catch { return `language identified by the configured tag ${normalized}`; }
};

export const socialReply = (intent: SocialIntent, language: DeterministicSocialLanguage, tone: string, configuredGreeting?: string | null) => {
  if (intent === 'greeting' && configuredGreeting?.trim()) return configuredGreeting.trim();
  const warm = ['friendly', 'casual', 'supportive', 'empathetic'].includes(tone.toLowerCase());
  const replies: Record<SocialIntent, Record<DeterministicSocialLanguage, string>> = {
    greeting: { English: warm ? 'Hello! How can I help you today?' : 'Hello. How may I help you?' },
    wellbeing: { English: warm ? "I'm ready to help, thanks for asking! What can I help you with?" : "I'm ready to assist. What would you like to know?" },
    thanks: { English: warm ? "You're welcome! Let me know if I can help with anything else." : "You're welcome. Let me know if you need anything else." },
    farewell: { English: warm ? 'Goodbye! Feel free to come back if you need help.' : 'Goodbye. Please reach out again if you need assistance.' },
    capability: { English: 'I can answer questions using this assistant’s linked public business information. I can’t access private customer records or perform live business actions.' },
  };
  return replies[intent][language];
};

// `conversation_feedback` is a legacy routing label. Its detailed meaning is
// still carried separately by semantics.intents[0].category.
const interpretationIntents = ['greeting', 'wellbeing', 'thanks', 'farewell', 'capability', 'business', 'follow_up', 'clarification', 'out_of_scope', 'private_action', 'conversation_feedback', 'conversation_continuation', 'unknown'] as const;
export const CONVERSATION_CONTINUITY_ACTS = ['NEW_REQUEST', 'FOLLOW_UP', 'SEMANTIC_REPEAT', 'DETAIL_REQUEST', 'SIMPLIFICATION_REQUEST', 'LANGUAGE_SWITCH', 'CORRECTION', 'CONTRADICTION', 'UNKNOWN'] as const;
export type ConversationContinuityAct = typeof CONVERSATION_CONTINUITY_ACTS[number];

/** Recover only a bounded dialogue cue and an index into server-supplied user turns. */
export function recoverContinuityFromInvalidInterpretation(raw: string, priorTurns: readonly PlaygroundTurn[]): { continuityAct: ConversationContinuityAct; referenceTurnOffset: number | null } | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!CONVERSATION_CONTINUITY_ACTS.includes(record.continuityAct as ConversationContinuityAct)) return null;
  const recentTurns = priorTurns.slice(-8);
  const offset = record.referenceTurnOffset;
  const referenceTurnOffset = Number.isSafeInteger(offset) && Number(offset) >= 0 && Number(offset) < recentTurns.length && recentTurns[Number(offset)]?.role === 'user'
    ? Number(offset)
    : null;
  return { continuityAct: record.continuityAct as ConversationContinuityAct, referenceTurnOffset };
}
export type InterpretedAnswerAspect = Readonly<{ questionSpan: string; retrievalQuery: string }>;
export type TicketIntentInterpretation = Readonly<{ ticketRequest: 'EXPLICIT' | 'NONE'; draftAction: 'COLLECT' | 'CONFIRM' | 'CANCEL' | 'NONE'; title?: string; description?: string; category?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' }>;
export type QueryInterpretation = { retrievalQueries: string[]; answerAspects: readonly InterpretedAnswerAspect[]; language: string; script: string; style: string; intent: typeof interpretationIntents[number]; needsClarification: boolean; semantics: MultilingualSemanticInterpretation; scopeSplit: Readonly<{ businessQuestion: string; unrelatedQuestion: string }> | null; continuityAct: ConversationContinuityAct; referenceTurnOffset: number | null; ticketIntent: TicketIntentInterpretation };
const isInterpretationIntent = (value: unknown): value is QueryInterpretation['intent'] => interpretationIntents.some((item) => item === value);
const semanticLegacyIntent = (semantics: MultilingualSemanticInterpretation): QueryInterpretation['intent'] => {
  const categories = semantics.intents.map(({ category }) => category);
  if (categories.some((category) => ['GREETING', 'WELLBEING_EXCHANGE'].includes(category))) return 'greeting';
  if (categories.includes('GRATITUDE')) return 'thanks';
  if (categories.includes('FAREWELL')) return 'farewell';
  if (categories.includes('CONVERSATION_FEEDBACK')) return 'conversation_feedback';
  if (categories.includes('CONVERSATION_CONTINUATION')) return 'conversation_continuation';
  if (categories.includes('FOLLOW_UP')) return 'follow_up';
  if (categories.includes('CLARIFICATION') || categories.includes('CORRECTION')) return 'clarification';
  if (categories.includes('OUT_OF_SCOPE_CANDIDATE')) return 'out_of_scope';
  if (categories.includes('ASSISTANT_IDENTITY_INQUIRY')) return 'capability';
  if (categories.some((category) => category !== 'UNKNOWN' && !['ACKNOWLEDGMENT'].includes(category))) return 'business';
  return 'unknown';
};
const safeLanguageDescriptor = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 80 && /^[\p{L}\p{M}\p{N} .,+()/'&_-]+$/u.test(value.trim());

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

/** Bounded schema metadata for diagnostics. Never returns model or customer text. */
export function describeInterpretationShape(raw: string, originalMessage = '', captureBoundaryDetails = false): Readonly<Record<string, string | number | boolean>> {
  const json = extractJsonObject(raw);
  if (!json) return { jsonObjectPresent: false };
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { jsonObjectPresent: true, rootObject: false };
    const record = parsed as Record<string, unknown>;
    const aspects = record.answerAspects;
    const semanticValidation = validateMultilingualSemanticInterpretationDetailed(record.semantics, originalMessage);
    const validatedSemantic = semanticValidation.value;
    const semantic = record.semantics && typeof record.semantics === 'object' && !Array.isArray(record.semantics)
      ? (record.semantics as Record<string, unknown>).intents : undefined;
    return {
      jsonObjectPresent: true,
      rootObject: true,
      ...(captureBoundaryDetails ? { validatorFunction: 'validateInterpretation',
      semanticValidationReason: semanticValidation.detail ?? semanticValidation.reason,
      usableRetrievalQueriesCount: Array.isArray(record.retrievalQueries) ? record.retrievalQueries.filter((value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 300).slice(0, 2).length : 0,
      semanticsPresent: record.semantics !== undefined,
      retrievalQueriesPresent: record.retrievalQueries !== undefined,
      answerAspectsPresent: aspects !== undefined } : {}),
      retrievalQueriesType: Array.isArray(record.retrievalQueries) ? 'array' : record.retrievalQueries === undefined ? 'omitted' : typeof record.retrievalQueries,
      retrievalQueriesCount: Array.isArray(record.retrievalQueries) ? Math.min(record.retrievalQueries.length, 100) : 0,
      semanticValid: Boolean(validatedSemantic),
      ...(validatedSemantic ? { informationNeed: validatedSemantic.informationNeed, socialClassification: validatedSemantic.socialClassification, semanticUncertainty: validatedSemantic.uncertainty } : {}),
      answerAspectsType: Array.isArray(aspects) ? 'array' : aspects === undefined ? 'omitted' : typeof aspects,
      ...(Array.isArray(aspects) ? { answerAspectsCount: Math.min(aspects.length, 100) } : {}),
      legacyIntentType: typeof record.intent,
      legacyIntentAccepted: isInterpretationIntent(record.intent),
      semanticIntentCount: Array.isArray(semantic) ? Math.min(semantic.length, 100) : -1,
    };
  } catch {
    return { jsonObjectPresent: true, rootObject: true, jsonParsed: false };
  }
}

/** Re-evaluates the validator's existing guards for metadata only; it never changes their decisions. */
export function describeInterpretationSocialGuard(raw: string, originalMessage: string): Readonly<Record<string, string | number | boolean>> {
  const json = extractJsonObject(raw);
  if (!json) return { socialGuardStatus: 'UNKNOWN' };
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { socialGuardStatus: 'UNKNOWN' };
    const record = parsed as Record<string, unknown>;
    const validation = validateMultilingualSemanticInterpretationDetailed(record.semantics, originalMessage);
    const semantic = validation.value;
    if (!semantic) return { socialGuardStatus: 'SEMANTIC_VALIDATION_REJECTED', socialGuardReason: validation.detail ?? validation.reason };
    const social = decideSocialResponse({ classification: semantic.socialClassification, semantic, legacyIntent: isInterpretationIntent(record.intent) ? record.intent : semanticLegacyIntent(semantic), message: originalMessage });
    const standaloneDialogue = semantic.intents.length === 1
      && (semantic.intents[0]!.category === 'CONVERSATION_FEEDBACK' && semantic.socialClassification === 'OTHER'
        || isValidatedConversationalContinuation(semantic))
      && semantic.informationNeed === 'UNKNOWN'
      && semantic.uncertainty === 'NONE' && !semantic.clarificationRequired && semantic.entities.length === 0
      && (!record.ticketIntent || typeof record.ticketIntent === 'object' && record.ticketIntent !== null && !Array.isArray(record.ticketIntent)
        && (record.ticketIntent as Record<string, unknown>).ticketRequest === 'NONE' && (record.ticketIntent as Record<string, unknown>).draftAction === 'NONE');
    const standaloneConversationalAct = (social.decision === 'SAFE_SOCIAL_RESPONSE' && semantic.informationNeed === 'UNKNOWN') || standaloneDialogue || isNonFactualSemanticTurn(semantic, record.continuityAct);
    const retrievalQueries = Array.isArray(record.retrievalQueries) ? record.retrievalQueries.filter((value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 300).slice(0, 2) : [];
    const answerAspects = record.answerAspects;
    const retrievalRejected = retrievalQueries.length === 0 && !(validation.value && standaloneConversationalAct);
    const factualNeed = ['STATIC_BUSINESS_INFORMATION', 'PERSONAL_LIVE_RECORD', 'MIXED_STATIC_AND_PERSONAL'].includes(semantic.informationNeed);
    const liveNeed = ['PERSONAL_LIVE_RECORD', 'MIXED_STATIC_AND_PERSONAL'].includes(semantic.informationNeed)
      || semantic.intents.some(({ category }) => ['STATUS_INQUIRY', 'BOOKING_INQUIRY', 'APPOINTMENT_INFORMATION'].includes(category));
    const conflict = (semantic.socialClassification === 'ACKNOWLEDGMENT' || ['GREETING', 'GRATITUDE', 'FAREWELL', 'WELLBEING_EXCHANGE'].includes(semantic.socialClassification)) && (factualNeed || liveNeed);
    const rejectedField = retrievalRejected ? 'retrievalQueries' : Array.isArray(answerAspects) && answerAspects.length === 0 && !standaloneConversationalAct ? 'answerAspects' : 'none';
    return {
      socialGuardStatus: 'EVALUATED', socialDecision: social.decision, socialDecisionReason: social.reason,
      socialClassification: semantic.socialClassification, informationNeed: semantic.informationNeed, semanticUncertainty: semantic.uncertainty,
      semanticValidationResult: 'VALID', semanticIntents: semantic.intents.map(({ category, polarity }) => `${category}:${polarity}`).join('|') || 'none',
      standaloneSocialAct: social.decision === 'SAFE_SOCIAL_RESPONSE' && semantic.informationNeed === 'UNKNOWN', standaloneDialogue,
      standaloneConversationalAct, retrievalRequirementConflict: conflict,
      expectedEmptyRetrievalAccepted: standaloneConversationalAct && !factualNeed && !liveNeed,
      actualRetrievalRejected: retrievalRejected, finalValidatorRule: retrievalRejected ? 'invalid_retrieval_queries' : rejectedField === 'answerAspects' ? 'invalid_answer_aspects' : 'none',
      rejectedField,
    };
  } catch { return { socialGuardStatus: 'UNKNOWN' }; }
}

export function validateInterpretation(raw: string, originalMessage = '', priorTurns: readonly PlaygroundTurn[] = []): { value: QueryInterpretation | null; reason: string; semanticValidationReason?: SemanticValidationReason; semanticValidationDetail?: SemanticValidationDetail; metadataWarnings?: readonly string[] } {
  const json = extractJsonObject(raw);
  if (!json) return { value: null, reason: 'json_object_missing' };
  let parsed: unknown;
  try { parsed = JSON.parse(json); }
  catch { return { value: null, reason: 'malformed_json' }; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { value: null, reason: 'invalid_root_shape' };
  const record = parsed as Record<string, unknown>;
  const supportedKeys = ['retrievalQueries', 'englishQuery', 'englishQueries', 'answerAspects', 'language', 'script', 'style', 'intent', 'needsClarification', 'semantics', 'scopeSplit', 'continuityAct', 'referenceTurnOffset', 'ticketIntent'];
  if (Object.keys(record).some((key) => !supportedKeys.includes(key))) return { value: null, reason: 'unsupported_interpretation_field' };
  if (!safeLanguageDescriptor(record.language)) return { value: null, reason: 'invalid_language_descriptor' };
  const retrievalQueries = Array.isArray(record.retrievalQueries)
    ? record.retrievalQueries.filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0 && candidate.length <= 300).slice(0, 2)
    : [record.englishQuery, ...(Array.isArray(record.englishQueries) ? record.englishQueries : [])].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0 && candidate.length <= 300).slice(0, 2);
  const semanticValidation = record.semantics === undefined
    ? { value: unknownSemanticInterpretation(), reason: 'valid' as const }
    : validateMultilingualSemanticInterpretationDetailed(record.semantics, originalMessage);
  // Semantic metadata is advisory. A malformed optional object must not discard
  // an otherwise valid query rewrite and force the whole turn through recovery.
  // Unknown semantics grant no shortcut or capability; the original message
  // remains the retrieval query and normal grounded routing continues.
  const semantics = semanticValidation.value ?? unknownSemanticInterpretation(
    semanticValidation.detail ?? semanticValidation.reason,
  );
  // Reuse the routing guard: neutral polarity and multiple purely social acts
  // must not invalidate an empty factual-aspect list. The legacy field is still
  // validated below; this decision grants no source access or tool capability.
  const standaloneSocialAct = decideSocialResponse({
    classification: semantics.socialClassification,
    semantic: semantics,
    legacyIntent: isInterpretationIntent(record.intent) ? record.intent : semanticLegacyIntent(semantics),
    message: originalMessage,
  }).decision === 'SAFE_SOCIAL_RESPONSE';
  const standaloneDialogue = semantics.intents.length === 1
    && (semantics.intents[0]!.category === 'CONVERSATION_FEEDBACK' && semantics.socialClassification === 'OTHER'
      || isValidatedConversationalContinuation(semantics))
    && semantics.informationNeed === 'UNKNOWN'
    && semantics.uncertainty === 'NONE'
    && !semantics.clarificationRequired
    && semantics.entities.length === 0
    && (!record.ticketIntent || typeof record.ticketIntent === 'object' && record.ticketIntent !== null && !Array.isArray(record.ticketIntent)
      && (record.ticketIntent as Record<string, unknown>).ticketRequest === 'NONE' && (record.ticketIntent as Record<string, unknown>).draftAction === 'NONE');
  const standaloneConversationalAct = (standaloneSocialAct && semantics.informationNeed === 'UNKNOWN') || standaloneDialogue
    || isNonFactualSemanticTurn(semantics, record.continuityAct);
  // Search fields are irrelevant only after the semantic contract establishes
  // a nonfactual act. Missing/invalid semantics never grant this exemption.
  if (!retrievalQueries.length && !(semanticValidation.value && standaloneConversationalAct)) {
    return { value: null, reason: 'invalid_retrieval_queries' };
  }
  let answerAspects: InterpretedAnswerAspect[];
  if (record.answerAspects === undefined) {
    answerAspects = standaloneConversationalAct ? [] : [{ questionSpan: originalMessage.trim().slice(0, 2000), retrievalQuery: retrievalQueries[0]! }];
  } else {
    if (!Array.isArray(record.answerAspects) || record.answerAspects.length > 4) return { value: null, reason: 'invalid_answer_aspects' };
    if (record.answerAspects.length === 0) {
      if (!standaloneConversationalAct) return { value: null, reason: 'invalid_answer_aspects' };
      answerAspects = [];
    } else {
      if (standaloneConversationalAct) return { value: null, reason: 'invalid_answer_aspects' };
      answerAspects = [];
      for (const item of record.answerAspects) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) return { value: null, reason: 'invalid_answer_aspect' };
        const aspect = item as Record<string, unknown>;
        if (Object.keys(aspect).some((key) => !['questionSpan', 'retrievalQuery'].includes(key))
          || typeof aspect.questionSpan !== 'string' || !aspect.questionSpan.trim() || aspect.questionSpan.length > 2000
          || !originalMessage.includes(aspect.questionSpan)
          || typeof aspect.retrievalQuery !== 'string' || !aspect.retrievalQuery.trim() || aspect.retrievalQuery.length > 300
          || /[\u0000-\u001f\u007f]/u.test(aspect.retrievalQuery)) return { value: null, reason: 'invalid_answer_aspect' };
        answerAspects.push({ questionSpan: aspect.questionSpan, retrievalQuery: aspect.retrievalQuery.trim() });
      }
      if (new Set(answerAspects.map((aspect) => aspect.questionSpan.normalize('NFKC').toLocaleLowerCase())).size !== answerAspects.length) return { value: null, reason: 'duplicate_answer_aspect' };
    }
  }
  const script = record.script === undefined ? 'not specified' : record.script;
  const style = record.style === undefined ? 'not specified' : record.style;
  if (!safeLanguageDescriptor(script) || !safeLanguageDescriptor(style)) return { value: null, reason: 'invalid_language_style' };
  // Some providers emit the semantic intent enum in the legacy field (for
  // example SUPPORT_REQUEST) although the legacy enum intentionally uses
  // broader labels. Translate only from the independently validated semantic
  // contract; never use this value to grant a capability or source access.
  const semanticAlias = typeof record.intent === 'string'
    && semantics.intents.some(({ category }) => category === record.intent)
    && semanticValidation.value
    ? semanticLegacyIntent(semantics)
    : null;
  if (!isInterpretationIntent(record.intent) && !semanticAlias) return { value: null, reason: 'invalid_intent' };
  const intent = isInterpretationIntent(record.intent) ? record.intent : semanticAlias!;
  if (record.needsClarification !== undefined && typeof record.needsClarification !== 'boolean') return { value: null, reason: 'invalid_clarification_flag' };
  // Advisory context hints may be discarded; they must not erase a valid
  // semantic interpretation. Tool/ticket arguments retain their strict checks.
  const metadataWarnings: string[] = semanticValidation.value ? [] : [semanticValidation.detail ?? semanticValidation.reason];
  const scopeSplit = record.scopeSplit === undefined || record.scopeSplit === null ? null : validateScopeSplit(record.scopeSplit, originalMessage);
  if (record.scopeSplit !== undefined && record.scopeSplit !== null && !scopeSplit) metadataWarnings.push('invalid_scope_split');
  const continuityAct = CONVERSATION_CONTINUITY_ACTS.includes(record.continuityAct as ConversationContinuityAct)
    ? record.continuityAct as ConversationContinuityAct : 'UNKNOWN';
  if (record.continuityAct !== undefined && continuityAct === 'UNKNOWN' && record.continuityAct !== 'UNKNOWN') metadataWarnings.push('invalid_continuity_act');
  const rawTicketIntent = record.ticketIntent;
  let ticketIntent: TicketIntentInterpretation = { ticketRequest: 'NONE', draftAction: 'NONE' };
  if (rawTicketIntent !== undefined) {
    if (!rawTicketIntent || typeof rawTicketIntent !== 'object' || Array.isArray(rawTicketIntent)) return { value: null, reason: 'invalid_ticket_intent' };
    const ticket = rawTicketIntent as Record<string, unknown>;
    if (Object.keys(ticket).some((key) => !['ticketRequest', 'draftAction', 'title', 'description', 'category', 'priority'].includes(key))
      || !['EXPLICIT', 'NONE'].includes(String(ticket.ticketRequest))
      || !['COLLECT', 'CONFIRM', 'CANCEL', 'NONE'].includes(String(ticket.draftAction))) return { value: null, reason: 'invalid_ticket_intent' };
    for (const key of ['title', 'description', 'category'] as const) if (ticket[key] !== undefined && (typeof ticket[key] !== 'string' || !ticket[key].trim() || ticket[key].length > (key === 'description' ? 8000 : key === 'title' ? 180 : 80))) return { value: null, reason: 'invalid_ticket_intent' };
    if (ticket.priority !== undefined && !['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(ticket.priority))) return { value: null, reason: 'invalid_ticket_intent' };
    ticketIntent = { ticketRequest: ticket.ticketRequest as TicketIntentInterpretation['ticketRequest'], draftAction: ticket.draftAction as TicketIntentInterpretation['draftAction'], ...(typeof ticket.title === 'string' ? { title: ticket.title.trim() } : {}), ...(typeof ticket.description === 'string' ? { description: ticket.description.trim() } : {}), ...(typeof ticket.category === 'string' ? { category: ticket.category.trim() } : {}), ...(typeof ticket.priority === 'string' ? { priority: ticket.priority as TicketIntentInterpretation['priority'] } : {}) };
  }
  let referenceTurnOffset: number | null = null;
  if (record.referenceTurnOffset !== undefined && record.referenceTurnOffset !== null) {
    const boundedTurns = priorTurns.slice(-8);
    if (!Number.isSafeInteger(record.referenceTurnOffset) || (record.referenceTurnOffset as number) < 0 || (record.referenceTurnOffset as number) >= boundedTurns.length || boundedTurns[record.referenceTurnOffset as number]?.role !== 'user') {
      metadataWarnings.push('invalid_reference_turn_offset');
    } else referenceTurnOffset = record.referenceTurnOffset as number;
  }
  return { value: { retrievalQueries: retrievalQueries.map((candidate) => candidate.trim()), answerAspects: Object.freeze(answerAspects.map((aspect) => Object.freeze(aspect))), language: record.language.trim(), script: script.trim(), style: style.trim(), intent, needsClarification: record.needsClarification === true, semantics, scopeSplit, continuityAct: continuityAct as ConversationContinuityAct, referenceTurnOffset, ticketIntent }, reason: 'valid', ...(metadataWarnings.length ? { metadataWarnings } : {}) };
}

/** A closed semantic contract, not message keywords, determines this shortcut. */
export function isNonFactualSemanticTurn(semantics: MultilingualSemanticInterpretation, continuityAct: unknown): boolean {
  if (!semantics.intents.length || semantics.uncertainty !== 'NONE' || semantics.clarificationRequired || semantics.informationNeed !== 'UNKNOWN') return false;
  if (isValidatedConversationalContinuation(semantics)) return true;
  const pureScopeRedirect = semantics.businessScopeAssessment === 'OUT_OF_SCOPE'
    && semantics.intents.every(({ category, polarity }) => category === 'OUT_OF_SCOPE_CANDIDATE' && polarity === 'AFFIRMATIVE');
  const pureLanguageChange = continuityAct === 'LANGUAGE_SWITCH' && Boolean(semantics.responseLanguagePreference)
    && semantics.entities.length === 0
    && semantics.intents.every(({ category, polarity }) => ['UNKNOWN', 'CLARIFICATION', 'CONVERSATION_FEEDBACK', 'CONVERSATION_CONTINUATION'].includes(category)
      && ['AFFIRMATIVE', 'NOT_APPLICABLE'].includes(polarity));
  return pureScopeRedirect || pureLanguageChange;
}

/**
 * Recover an independently valid semantic object when other interpretation
 * metadata fails. The original interpretation remains FAILED. Rebuilt routing
 * metadata is conservative, ticket actions are discarded, and authorization
 * still belongs to the services.
 */
export function recoverValidatedSemanticInterpretation(raw: string, originalMessage: string, priorTurns: readonly PlaygroundTurn[] = []): QueryInterpretation | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const semantics = validateMultilingualSemanticInterpretationDetailed(record.semantics, originalMessage).value;
  if (!semantics) return null;
  // Preserve a valid repair's factual decomposition and context metadata.
  // UNKNOWN must still never acquire manufactured factual requirements.
  const complete = validateInterpretation(raw, originalMessage, priorTurns).value;
  if (complete && (complete.answerAspects.length === 0 || semantics.informationNeed !== 'UNKNOWN')) {
    return { ...complete, ticketIntent: { ticketRequest: 'NONE', draftAction: 'NONE' } };
  }
  const language = safeLanguageDescriptor(record.language) ? record.language.trim() : semantics.language.primary ?? 'Unknown';
  const script = safeLanguageDescriptor(record.script) ? record.script.trim() : semantics.language.scripts.join(' and ') || 'Unknown';
  const style = safeLanguageDescriptor(record.style) ? record.style.trim() : 'plain';
  const recentTurns = priorTurns.slice(-8);
  const offset = record.referenceTurnOffset;
  const referenceTurnOffset = Number.isSafeInteger(offset) && Number(offset) >= 0 && Number(offset) < recentTurns.length && recentTurns[Number(offset)]?.role === 'user'
    ? Number(offset) : null;
  const continuityAct = CONVERSATION_CONTINUITY_ACTS.includes(record.continuityAct as ConversationContinuityAct)
    ? record.continuityAct as ConversationContinuityAct : 'UNKNOWN';
  const scopeSplit = record.scopeSplit === undefined || record.scopeSplit === null ? null : validateScopeSplit(record.scopeSplit, originalMessage);
  const repaired = {
    retrievalQueries: [originalMessage.slice(0, 300), ...recoverRetrievalQueriesFromInvalidInterpretation(raw, originalMessage)].filter(Boolean).slice(0, 2),
    language, script, style,
    intent: semanticLegacyIntent(semantics), semantics,
    needsClarification: semantics.clarificationRequired,
    continuityAct, referenceTurnOffset, scopeSplit,
    // Recovery never restores a ticket request or other side-effect action.
    ticketIntent: { ticketRequest: 'NONE', draftAction: 'NONE' },
  };
  const validated = validateInterpretation(JSON.stringify(repaired), originalMessage, priorTurns).value;
  // Structural validity alone is not an established factual information need.
  // Do not manufacture an answer aspect from UNKNOWN semantics and thereby
  // skip the model repair. Valid nonfactual acts already have zero aspects.
  if (validated && validated.answerAspects.length > 0
    && semantics.informationNeed === 'UNKNOWN') return null;
  return validated;
}

/**
 * Retains only a bounded English/search rewrite from a structurally parseable
 * interpretation when a later validation boundary rejects the interpretation. The original query
 * is always retained by the retrieval planner, and these candidates never
 * affect source authorization or answer grounding.
 */
export function recoverRetrievalQueriesFromInvalidInterpretation(raw: string, originalMessage: string): string[] {
  const json = extractJsonObject(raw);
  if (!json) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return []; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const record = parsed as Record<string, unknown>;
  if (!safeLanguageDescriptor(record.language)) return [];
  const original = originalMessage.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
  let rewrites: unknown[];
  if (Array.isArray(record.retrievalQueries)) {
    const candidates = record.retrievalQueries;
    if (candidates.length !== 2 || typeof candidates[0] !== 'string' || typeof candidates[1] !== 'string') return [];
    const first = candidates[0].normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (first !== original) return [];
    rewrites = [candidates[1]];
  } else {
    rewrites = typeof record.englishQuery === 'string' ? [record.englishQuery] : Array.isArray(record.englishQueries) ? record.englishQueries.slice(0, 2) : [];
  }
  return rewrites.flatMap((candidate) => {
    if (typeof candidate !== 'string') return [];
    const rewrite = candidate.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
    return rewrite && rewrite.length <= 300 && !/[<>\[\]{}]/u.test(rewrite) ? [rewrite] : [];
  }).slice(0, 2);
}
/** @deprecated Kept as an alias for existing callers. */
export const recoverRetrievalQueriesAfterSemanticFailure = recoverRetrievalQueriesFromInvalidInterpretation;

/** Recover only the small, non-authorizing language label from an otherwise
 * rejected interpretation. This keeps reply language useful when
 * the semantic object is malformed without accepting its intent or routing. */
export function recoverCustomerLanguageFromInvalidInterpretation(raw: string): { language: 'English' | 'Hindi' | 'Hinglish' } | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const language = (parsed as Record<string, unknown>).language;
  if (!safeLanguageDescriptor(language)) return null;
  const normalized = language.trim().toLocaleLowerCase().replaceAll('_', '-');
  if (['english', 'en', 'en-us', 'en-gb'].includes(normalized)) return { language: 'English' };
  if (['hinglish', 'hi-latn', 'romanized hindi', 'romanised hindi', 'hindi and english', 'english and hindi', 'hindi/english', 'english/hindi', 'hindi-english', 'english-hindi'].includes(normalized)) return { language: 'Hinglish' };
  if (['hindi', 'hi', 'hi-in'].includes(normalized)) {
    const script = (parsed as Record<string, unknown>).script;
    const scriptLabel = typeof script === 'string' ? script : '';
    return { language: /devanagari/iu.test(scriptLabel) && !/latin/iu.test(scriptLabel) ? 'Hindi' : 'Hinglish' };
  }
  return null;
}
/** @deprecated Kept as an alias for existing callers. */
export const recoverCustomerLanguageAfterSemanticFailure = recoverCustomerLanguageFromInvalidInterpretation;

