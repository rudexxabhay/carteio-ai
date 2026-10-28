import type { PlaygroundTurn } from './conversation-intent';
import type { MultilingualSemanticInterpretation } from './multilingual-semantics';

export type ContextReferenceStatus = 'RESOLVED' | 'AMBIGUOUS' | 'MISSING_CONTEXT' | 'EXPIRED_CONTEXT' | 'UNSAFE_REFERENCE' | 'NOT_APPLICABLE';
export type ContextReferenceReason = 'FOLLOW_UP_WITH_RECENT_USER_TOPIC' | 'MULTIPLE_IDENTIFIERS' | 'MULTIPLE_POSSIBLE_TARGETS' | 'NO_AUTHORIZED_USER_TURN' | 'REFERENCE_NOT_PRESENT' | 'EXPLICIT_CURRENT_CORRECTION' | 'BOUNDED_HISTORY_EXPIRED' | 'ASSISTANT_ONLY_IDENTIFIER' | 'MODEL_REFERENCE_NOT_AUTHORIZED' | 'NOT_A_REFERENCE';
/** `sourceTurnOffset` is an index in the server-authorized bounded turn array, never a DB/public ID. */
export type ContextReferenceResolution = Readonly<{
  status: ContextReferenceStatus;
  reason: ContextReferenceReason;
  sourceTurnOffset: number | null;
  referencedTextSpan: string | null;
  entity: Readonly<{ type: string; raw: string }> | null;
  contextualQuery: string | null;
}>;

const explicitReference = /\b(?:it|this|that|these|those|same|previous|last one|the other one|uska|iska|unka|wo wala|ye wala|pichla|pichli|pehle wala|kal wali|aur uska|aur iska)\b|(?:इसका|उसका|इनका|उनका|वो वाला|ये वाला|पिछला|पिछली|पहले वाला)/iu;
const idToken = '([A-Z0-9-]{4,32}(?<!-))';
const identifierPatterns: readonly Readonly<{ type: string; pattern: RegExp }>[] = [
  { type: 'ORDER_ID', pattern: new RegExp(`\\border\\s*(?:id|no\\.?|number|#)?\\s*[:#-]?\\s*${idToken}(?=\\b|$)`, 'giu') },
  { type: 'SHIPMENT_ID', pattern: new RegExp(`\\b(?:shipment|tracking)\\s*(?:id|no\\.?|number|#)?\\s*[:#-]?\\s*${idToken}(?=\\b|$)`, 'giu') },
  { type: 'LR_NUMBER', pattern: new RegExp(`\\b(?:LR|lading\\s+receipt)\\s*(?:no\\.?|number|#)?\\s*[:#-]?\\s*${idToken}(?=\\b|$)`, 'giu') },
  { type: 'BOOKING_REFERENCE', pattern: new RegExp(`\\b(?:booking|reservation)\\s*(?:id|ref(?:erence)?|no\\.?|number|#)?\\s*[:#-]?\\s*${idToken}(?=\\b|$)`, 'giu') },
];

function identifiersIn(text: string): Array<{ type: string; raw: string }> {
  return identifierPatterns.flatMap(({ type, pattern }) => {
    pattern.lastIndex = 0;
    return [...text.matchAll(pattern)].map((match) => match[1]!).filter((raw) => /\d/u.test(raw)).map((raw) => ({ type, raw }));
  });
}

/**
 * Resolves only against the same server-authorized bounded session supplied by the orchestrator.
 * Prior assistant text is intentionally excluded as an entity/evidence source.
 */
export function resolveConversationReference(input: {
  message: string;
  turns: readonly PlaygroundTurn[];
  semantic: MultilingualSemanticInterpretation | null;
  legacyIntent?: string;
  historyWasTruncated?: boolean;
  modelReferenceTurnOffset?: number | null;
}): ContextReferenceResolution {
  const { message, turns, semantic } = input;
  const correction = semantic?.intents.some((intent) => intent.category === 'CORRECTION' && intent.polarity !== 'NEGATED') ?? false;
  const currentEntities = semantic?.entities ?? [];
  if (correction && currentEntities.length > 0) {
    return { status: 'RESOLVED', reason: 'EXPLICIT_CURRENT_CORRECTION', sourceTurnOffset: null, referencedTextSpan: currentEntities[0]!.raw, entity: { type: currentEntities[0]!.type, raw: currentEntities[0]!.raw }, contextualQuery: null };
  }
  const followUp = semantic?.intents.some((intent) => intent.category === 'FOLLOW_UP' && intent.polarity !== 'NEGATED')
    || input.legacyIntent === 'follow_up' || input.legacyIntent === 'clarification';
  // Quoted terms in a standalone question are literal text, not requests to
  // resolve an earlier turn (for example: What does "previous" mean?).
  const referenceText = message.replace(/"[^"]*"|“[^”]*”/gu, '');
  const referenceMatch = referenceText.match(explicitReference);
  const olderReference = /\b(?:previous|last one|the other one|pichla|pichli|pehle wala)\b|(?:पिछला|पिछली|पहले वाला)/iu.test(referenceText);
  const lastAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant');
  const pendingClarification = lastAssistant?.role === 'assistant' && ['source_clarification', 'business_scope_clarification', 'acknowledgment_pending_clarification'].includes(lastAssistant.responseCategory ?? '');
  const contextualShortReply = semantic !== null && semantic.uncertainty !== 'UNKNOWN'
    && (Boolean(semantic.responseLanguagePreference)
      || semantic.intents.some((intent) => !['GREETING', 'WELLBEING_EXCHANGE', 'ACKNOWLEDGMENT', 'GRATITUDE', 'FAREWELL', 'UNKNOWN'].includes(intent.category)));
  if (!followUp && !referenceMatch && input.modelReferenceTurnOffset == null && !(pendingClarification && contextualShortReply)) {
    return { status: 'NOT_APPLICABLE', reason: 'NOT_A_REFERENCE', sourceTurnOffset: null, referencedTextSpan: null, entity: null, contextualQuery: null };
  }

  const recentStart = Math.max(0, turns.length - 8);
  const userCandidates = turns.flatMap((turn, index) => {
    // A persisted acknowledgment of a pending clarification does not replace
    // the question being clarified. Use trusted response metadata, not wording.
    const acknowledgment = pendingClarification && turns[index + 1]?.role === 'assistant'
      && turns[index + 1]?.responseCategory === 'acknowledgment_pending_clarification';
    return turn.role === 'user' && index >= recentStart && !acknowledgment ? [{ turn, index }] : [];
  });
  if (olderReference && input.modelReferenceTurnOffset == null && input.historyWasTruncated) {
    return { status: 'EXPIRED_CONTEXT', reason: 'BOUNDED_HISTORY_EXPIRED', sourceTurnOffset: null, referencedTextSpan: referenceMatch?.[0] ?? message.trim(), entity: null, contextualQuery: null };
  }
  if (olderReference && input.modelReferenceTurnOffset == null && userCandidates.length > 1) {
    return { status: 'AMBIGUOUS', reason: 'MULTIPLE_POSSIBLE_TARGETS', sourceTurnOffset: null, referencedTextSpan: referenceMatch?.[0] ?? message.trim(), entity: null, contextualQuery: null };
  }
  if (!userCandidates.length) {
    const assistantMentionedIdentifier = turns.some((turn) => turn.role === 'assistant' && identifiersIn(turn.content).length > 0);
    if (assistantMentionedIdentifier) return { status: 'UNSAFE_REFERENCE', reason: 'ASSISTANT_ONLY_IDENTIFIER', sourceTurnOffset: null, referencedTextSpan: referenceMatch?.[0] ?? null, entity: null, contextualQuery: null };
    if (input.historyWasTruncated) return { status: 'EXPIRED_CONTEXT', reason: 'BOUNDED_HISTORY_EXPIRED', sourceTurnOffset: null, referencedTextSpan: referenceMatch?.[0] ?? null, entity: null, contextualQuery: null };
    return { status: 'MISSING_CONTEXT', reason: 'NO_AUTHORIZED_USER_TURN', sourceTurnOffset: null, referencedTextSpan: referenceMatch?.[0] ?? null, entity: null, contextualQuery: null };
  }
  const recentWindowStart = Math.max(0, turns.length - 8);
  const modelSourceIndex = input.modelReferenceTurnOffset === undefined || input.modelReferenceTurnOffset === null
    ? null
    : recentWindowStart + input.modelReferenceTurnOffset;
  const source = modelSourceIndex === null
    ? userCandidates[userCandidates.length - 1]!
    : userCandidates.find(({ index }) => index === modelSourceIndex);
  if (!source) return { status: 'UNSAFE_REFERENCE', reason: 'MODEL_REFERENCE_NOT_AUTHORIZED', sourceTurnOffset: null, referencedTextSpan: referenceMatch?.[0] ?? message.trim(), entity: null, contextualQuery: null };
  const allIdentifiers = modelSourceIndex === null
    ? userCandidates.flatMap(({ turn }) => identifiersIn(turn.content))
    : identifiersIn(source.turn.content);
  const uniqueIdentifiers = [...new Map(allIdentifiers.map((entity) => [`${entity.type}:${entity.raw}`, entity])).values()];
  if (uniqueIdentifiers.length > 1) {
    return { status: 'AMBIGUOUS', reason: 'MULTIPLE_IDENTIFIERS', sourceTurnOffset: null, referencedTextSpan: referenceMatch?.[0] ?? message.trim(), entity: null, contextualQuery: null };
  }
  const entity = uniqueIdentifiers[0] ?? null;
  const query = `${source.turn.content} ${message}`.replace(/\s+/gu, ' ').trim().slice(0, 300);
  return {
    status: 'RESOLVED', reason: 'FOLLOW_UP_WITH_RECENT_USER_TOPIC', sourceTurnOffset: source.index,
    referencedTextSpan: referenceMatch?.[0] ?? message.trim(), entity, contextualQuery: query,
  };
}

export function isRepeatedUserRequest(message: string, turns: readonly PlaygroundTurn[]): boolean {
  const normalized = message.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/gu, '');
  if (!normalized || normalized.length < 3) return false;
  return turns.slice(-8).some((turn) => turn.role === 'user' && turn.content.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/gu, '') === normalized);
}
