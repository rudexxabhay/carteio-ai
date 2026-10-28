import type { ConversationEvidence } from './conversation.contracts';
import type { InterpretedAnswerAspect } from './conversation-intent';

export const GROUNDED_ANSWER_PLAN_VERSION = '09F.1';
const MAX_ANSWER_ASPECTS = 4;
const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'the', 'this', 'to', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your']);

export type AnswerAspectStatus = 'EVIDENCE_CANDIDATE' | 'NO_MATCHING_CANDIDATE' | 'POTENTIAL_CONFLICT';
export type PlannedEvidenceIdentity = Readonly<{
  reference: string;
  sourceId: string;
  chunkId: string;
  sourceVersion: number;
  contentHash: string;
  locator: string | null;
}>;
export type GroundedAnswerAspect = Readonly<{
  id: string;
  questionSpan: string;
  retrievalQuery: string;
  status: AnswerAspectStatus;
  evidenceReferences: readonly string[];
  differingValues: readonly string[];
}>;
export type GroundedAnswerPlan = Readonly<{
  version: typeof GROUNDED_ANSWER_PLAN_VERSION;
  question: string;
  responseLanguage: string | null;
  aspects: readonly GroundedAnswerAspect[];
  evidence: readonly PlannedEvidenceIdentity[];
  coverage: 'NO_EVIDENCE' | 'PARTIAL_CANDIDATES' | 'CANDIDATES_FOR_ALL_ASPECTS';
  requiresLiveLimitation: boolean;
  citationRequired: true;
  entailmentVerified: false;
}>;

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));

/** Strictly validates the bounded internal plan and optionally binds every reference to observed authorized evidence. */
export function validateGroundedAnswerPlan(value: unknown, authorizedReferences?: readonly string[]): value is GroundedAnswerPlan {
  if (!record(value) || !onlyKeys(value, ['version','question','responseLanguage','aspects','evidence','coverage','requiresLiveLimitation','citationRequired','entailmentVerified'])) return false;
  if (value.version !== GROUNDED_ANSWER_PLAN_VERSION || typeof value.question !== 'string' || value.question.length > 2000
      || !(value.responseLanguage === null || typeof value.responseLanguage === 'string' && value.responseLanguage.length <= 80)
      || !Array.isArray(value.aspects) || value.aspects.length < 1 || value.aspects.length > MAX_ANSWER_ASPECTS
      || !Array.isArray(value.evidence) || value.evidence.length > 5
      || typeof value.requiresLiveLimitation !== 'boolean' || value.citationRequired !== true || value.entailmentVerified !== false
      || !['NO_EVIDENCE','PARTIAL_CANDIDATES','CANDIDATES_FOR_ALL_ASPECTS'].includes(String(value.coverage))) return false;
  const references = new Set<string>();
  for (const item of value.evidence) {
    if (!record(item) || !onlyKeys(item, ['reference','sourceId','chunkId','sourceVersion','contentHash','locator'])
        || typeof item.reference !== 'string' || !/^(?:S|C)[1-5]$/u.test(item.reference) || references.has(item.reference)
        || typeof item.sourceId !== 'string' || !item.sourceId || typeof item.chunkId !== 'string' || !item.chunkId
        || !Number.isSafeInteger(item.sourceVersion) || Number(item.sourceVersion) < 1
        || typeof item.contentHash !== 'string' || !/^[a-f0-9]{64}$/iu.test(item.contentHash)
        || !(item.locator === null || typeof item.locator === 'string' && item.locator.length <= 500)) return false;
    references.add(item.reference);
  }
  const aspectIds = new Set<string>();
  for (const item of value.aspects) {
    if (!record(item) || !onlyKeys(item, ['id','questionSpan','retrievalQuery','status','evidenceReferences','differingValues'])
        || typeof item.id !== 'string' || !/^A[1-4]$/u.test(item.id) || aspectIds.has(item.id)
        || typeof item.questionSpan !== 'string' || !item.questionSpan || item.questionSpan.length > 2000
        || typeof item.retrievalQuery !== 'string' || !item.retrievalQuery || item.retrievalQuery.length > 300
        || !['EVIDENCE_CANDIDATE','NO_MATCHING_CANDIDATE','POTENTIAL_CONFLICT'].includes(String(item.status))
        || !Array.isArray(item.evidenceReferences) || item.evidenceReferences.length > 5
        || !item.evidenceReferences.every((reference) => typeof reference === 'string' && references.has(reference))
        || !Array.isArray(item.differingValues) || item.differingValues.length > 8
        || !item.differingValues.every((entry) => typeof entry === 'string' && entry.length <= 80)) return false;
    if (item.status === 'NO_MATCHING_CANDIDATE' && item.evidenceReferences.length > 0) return false;
    if (item.status !== 'NO_MATCHING_CANDIDATE' && item.evidenceReferences.length === 0) return false;
    if (item.status !== 'POTENTIAL_CONFLICT' && item.differingValues.length > 0) return false;
    aspectIds.add(item.id);
  }
  const candidateCount = value.aspects.filter((item) => record(item) && Array.isArray(item.evidenceReferences) && item.evidenceReferences.length > 0).length;
  const expectedCoverage = value.evidence.length === 0 || candidateCount === 0 ? 'NO_EVIDENCE' : candidateCount < value.aspects.length ? 'PARTIAL_CANDIDATES' : 'CANDIDATES_FOR_ALL_ASPECTS';
  if (value.coverage !== expectedCoverage) return false;
  return authorizedReferences === undefined || [...references].every((reference) => authorizedReferences.includes(reference));
}

function tokens(value: string): Set<string> {
  return new Set(value.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)?.map((token) => {
    const simple = token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token;
    return simple;
  }).filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? []);
}

function matchesAspect(query: string, evidence: ConversationEvidence): boolean {
  const queryTokens = tokens(query);
  if (queryTokens.size === 0) return false;
  const sourceTokens = tokens(`${evidence.title} ${evidence.locator ?? ''} ${evidence.excerpt}`);
  return [...queryTokens].some((token) => sourceTokens.has(token));
}

function numericMeasures(text: string): ReadonlyArray<Readonly<{ value: string; unit: string }>> {
  const pattern = /\b(\d+(?:\.\d+)?(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?)\s*(business\s+days?|days?|hours?|weeks?|months?|years?|percent|%)\b|(?:₹|INR\s*)(\d+(?:\.\d+)?)|(?:\$|USD\s*)(\d+(?:\.\d+)?)/giu;
  return [...text.matchAll(pattern)].map((match) => {
    if (match[3]) return { value: match[3], unit: 'INR' };
    if (match[4]) return { value: match[4], unit: 'USD' };
    const unit = (match[2] ?? '').toLocaleLowerCase().replace(/\s+/gu, ' ').replace(/s$/u, '');
    return { value: (match[1] ?? '').replace(/\s*(?:-|to)\s*/gu, '-').replace(/\s+/gu, ''), unit };
  }).filter((measure) => measure.value.length > 0 && measure.unit.length > 0);
}

function differingMeasures(evidence: readonly ConversationEvidence[]): string[] {
  const bySource = new Map<string, Map<string, Set<string>>>();
  for (const item of evidence) {
    const measures = numericMeasures(item.excerpt);
    const sourceMeasures = bySource.get(item.sourceId) ?? new Map<string, Set<string>>();
    for (const measure of measures) {
      const values = sourceMeasures.get(measure.unit) ?? new Set<string>();
      values.add(measure.value);
      sourceMeasures.set(measure.unit, values);
    }
    bySource.set(item.sourceId, sourceMeasures);
  }
  if (bySource.size < 2) return [];
  const units = new Set([...bySource.values()].flatMap((values) => [...values.keys()]));
  const conflicts: string[] = [];
  for (const unit of units) {
    // Multiple values inside one source may be conditional policy bands; without
    // condition parsing they cannot safely be compared with another source.
    if ([...bySource.values()].some((sourceValues) => (sourceValues.get(unit)?.size ?? 0) > 1)) continue;
    const values = new Set([...bySource.values()].flatMap((sourceValues) => [...(sourceValues.get(unit) ?? [])]));
    const sourcesWithValue = [...bySource.values()].filter((sourceValues) => (sourceValues.get(unit)?.size ?? 0) > 0).length;
    if (sourcesWithValue > 1 && values.size > 1) conflicts.push(...[...values].map((value) => `${value} ${unit}`));
  }
  return [...new Set(conflicts)].slice(0, 8);
}

/**
 * Builds bounded candidate-to-aspect traceability from current revalidated
 * evidence. Matching is a discovery hint only; it never proves claim entailment.
 */
export function buildGroundedAnswerPlan(input: {
  question: string;
  responseLanguage: string | null;
  aspects: readonly InterpretedAnswerAspect[];
  evidence: readonly ConversationEvidence[];
  requiresLiveLimitation: boolean;
}): GroundedAnswerPlan {
  const evidence = input.evidence.slice(0, 5);
  const aspects = input.aspects.slice(0, MAX_ANSWER_ASPECTS).map((aspect, index): GroundedAnswerAspect => {
    const candidates = evidence.filter((item) => matchesAspect(aspect.retrievalQuery, item));
    const values = differingMeasures(candidates);
    return Object.freeze({
      id: `A${index + 1}`,
      questionSpan: aspect.questionSpan.slice(0, 2000),
      retrievalQuery: aspect.retrievalQuery.slice(0, 300),
      status: values.length ? 'POTENTIAL_CONFLICT' : candidates.length ? 'EVIDENCE_CANDIDATE' : 'NO_MATCHING_CANDIDATE',
      evidenceReferences: Object.freeze(candidates.map((item) => item.reference)),
      differingValues: Object.freeze(values),
    });
  });
  const mappedCount = aspects.filter((aspect) => aspect.evidenceReferences.length > 0).length;
  const coverage = evidence.length === 0 || mappedCount === 0
    ? 'NO_EVIDENCE'
    : mappedCount < aspects.length ? 'PARTIAL_CANDIDATES' : 'CANDIDATES_FOR_ALL_ASPECTS';
  return Object.freeze({
    version: GROUNDED_ANSWER_PLAN_VERSION,
    question: input.question.slice(0, 2000),
    responseLanguage: input.responseLanguage?.slice(0, 80) ?? null,
    aspects: Object.freeze(aspects),
    evidence: Object.freeze(evidence.map((item) => Object.freeze({ reference: item.reference, sourceId: item.sourceId, chunkId: item.chunkId, sourceVersion: item.sourceVersion, contentHash: item.contentHash, locator: item.locator }))),
    coverage,
    requiresLiveLimitation: input.requiresLiveLimitation,
    citationRequired: true,
    entailmentVerified: false,
  });
}
