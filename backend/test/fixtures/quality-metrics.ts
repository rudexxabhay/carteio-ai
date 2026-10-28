/** Offline benchmark metrics. Human labels are inputs; this module makes no semantic model calls. */
export type RatioMetric = Readonly<{ numerator: number | null; denominator: number; value: number | null }>;
export type RetrievalScore = Readonly<{ recallAtK: RatioMetric; precisionAtK: RatioMetric; correctSourceSelection: RatioMetric }>;
const ratio = (n: number, d: number): RatioMetric => ({ numerator: d ? n : null, denominator: d, value: d ? n / d : null });
const requireCount = (value: number, name: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
};

export function scoreRetrieval(expectedRelevantIds: readonly string[], retrievedIds: readonly string[], k: number): RetrievalScore {
  requireCount(k, 'k');
  const relevant = new Set(expectedRelevantIds);
  const selected = [...new Set(retrievedIds.slice(0, k))];
  const hits = selected.filter((id) => relevant.has(id)).length;
  return {
    recallAtK: ratio(new Set(selected.filter((id) => relevant.has(id))).size, relevant.size),
    precisionAtK: ratio(hits, selected.length),
    // No gold relevant source means the selection check is not applicable.
    correctSourceSelection: ratio(selected.length > 0 && selected.some((id) => relevant.has(id)) ? 1 : 0, relevant.size ? 1 : 0),
  };
}

/** Counts use human/merchant-labeled atomic factual claims, never raw model judgments. */
export function scoreClaimSupport(totalClaims: number, supportedClaims: number): Readonly<{ factualAccuracy: RatioMetric; unsupportedClaimRate: RatioMetric }> {
  requireCount(totalClaims, 'totalClaims');
  requireCount(supportedClaims, 'supportedClaims');
  if (supportedClaims > totalClaims) throw new RangeError('supportedClaims cannot exceed totalClaims');
  const total = totalClaims;
  const supported = supportedClaims;
  return { factualAccuracy: ratio(supported, total), unsupportedClaimRate: ratio(total - supported, total) };
}

export function scoreBinaryChecks(passed: number, applicable: number): RatioMetric {
  requireCount(passed, 'passed');
  requireCount(applicable, 'applicable');
  if (passed > applicable) throw new RangeError('passed cannot exceed applicable');
  return ratio(passed, applicable);
}

export function percentile(values: readonly number[], quantile: number): number | null {
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) return null;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.ceil(quantile * sorted.length) - 1] ?? sorted[0]!;
}

/** Cost stays unknown unless the run supplies an explicitly approved provider rate card. */
export function estimateCost(inputTokens: number, outputTokens: number, rateCard?: Readonly<{ inputPerMillion: number; outputPerMillion: number }>): number | null {
  if (!rateCard || ![inputTokens, outputTokens, rateCard.inputPerMillion, rateCard.outputPerMillion].every((value) => Number.isFinite(value) && value >= 0)
    || !Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) return null;
  return (inputTokens * rateCard.inputPerMillion + outputTokens * rateCard.outputPerMillion) / 1_000_000;
}

export const DIAGNOSTIC_STAGE_ORDER = [
  'CRAWLING', 'EXTRACTION', 'INDEXING', 'EMBEDDING', 'RETRIEVAL', 'SOURCE_RANKING', 'HISTORY_SELECTION',
  'PROMPT_CONTEXT', 'TOOL_SELECTION', 'MODEL_GENERATION', 'RESPONSE_VERIFICATION', 'PERSISTENCE',
] as const;
export type DiagnosticStage = typeof DIAGNOSTIC_STAGE_ORDER[number];
export type DiagnosticStageObservation = Readonly<{ stage: DiagnosticStage; outcome: 'PASS' | 'SKIPPED' | 'FAIL' | 'MISSING'; evidenceId?: string }>;

/** Attribute only when every earlier stage has evidence of completion. Otherwise the earliest cause is unknown. */
export function attributeEarliestFailure(observations: readonly DiagnosticStageObservation[]): Readonly<{ stage: DiagnosticStage | 'UNKNOWN'; evidenceId?: string }> {
  const byStage = new Map(observations.map((observation) => [observation.stage, observation]));
  for (let index = 0; index < DIAGNOSTIC_STAGE_ORDER.length; index++) {
    const stage = DIAGNOSTIC_STAGE_ORDER[index]!;
    const observation = byStage.get(stage);
    if (!observation || observation.outcome === 'MISSING') return { stage: 'UNKNOWN' };
    if (observation.outcome === 'FAIL') return index === 0 || DIAGNOSTIC_STAGE_ORDER.slice(0, index).every((prior) => ['PASS', 'SKIPPED'].includes(byStage.get(prior)?.outcome ?? ''))
      ? { stage, ...(observation.evidenceId ? { evidenceId: observation.evidenceId } : {}) }
      : { stage: 'UNKNOWN' };
  }
  return { stage: 'UNKNOWN' };
}
