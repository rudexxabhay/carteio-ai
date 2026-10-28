import { CARTEIO_QUALITY_BENCHMARK_V1 } from './fixtures/carteio-quality-benchmark.v1';
import { attributeEarliestFailure, estimateCost, percentile, scoreBinaryChecks, scoreClaimSupport, scoreRetrieval } from './fixtures/quality-metrics';

describe('synthetic Carteio quality benchmark fixtures', () => {
  it('contains at least 60 fully specified, uniquely identified scenarios across all requested categories', () => {
    expect(CARTEIO_QUALITY_BENCHMARK_V1.length).toBeGreaterThanOrEqual(60);
    expect(new Set(CARTEIO_QUALITY_BENCHMARK_V1.map((scenario) => scenario.id)).size).toBe(CARTEIO_QUALITY_BENCHMARK_V1.length);
    const categories = new Set(CARTEIO_QUALITY_BENCHMARK_V1.map((scenario) => scenario.category));
    for (const letter of 'ABCDEFGHIJKLMNOPQR') expect([...categories].some((category) => category.startsWith(`${letter} `))).toBe(true);
    for (const scenario of CARTEIO_QUALITY_BENCHMARK_V1) {
      expect(scenario.customerQuestion.length).toBeGreaterThan(0);
      expect(scenario.expectedFactualOutcome.length).toBeGreaterThan(0);
      expect(scenario.expectedConversationalBehavior.length).toBeGreaterThan(0);
      expect(scenario.failureConditions.length).toBeGreaterThan(0);
      expect(scenario.authoritativeEvidence.every((source) => source.sourceId.startsWith('synthetic:'))).toBe(true);
    }
  });

  it('supplies both conflicting records and explicit tenant ownership for cross-tenant fixtures', () => {
    const byId = new Map(CARTEIO_QUALITY_BENCHMARK_V1.map((scenario) => [scenario.id, scenario]));
    for (const id of ['cq01.conflict-policy', 'cq01.conflict-source-date', 'cq01.conflict-variant', 'cq01.conflict-contact']) {
      const evidence = byId.get(id)?.authoritativeEvidence ?? [];
      expect(evidence.length).toBeGreaterThanOrEqual(2);
      expect(new Set(evidence.map((source) => source.sourceId)).size).toBe(evidence.length);
    }
    expect(byId.get('cq01.tenant-private')?.authoritativeEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ tenantId: 'tenant-b' })]));
    expect(byId.get('cq01.tenant-citation')?.authoritativeEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ tenantId: 'tenant-b' })]));
  });

  it('scores retrieval using explicit relevant source labels and catches a wrong top result', () => {
    const correct = scoreRetrieval(['returns-v1', 'shipping-v1'], ['returns-v1', 'shipping-v1', 'irrelevant'], 3);
    expect(correct.recallAtK.value).toBe(1);
    expect(correct.precisionAtK.value).toBeCloseTo(2 / 3);
    const wrong = scoreRetrieval(['returns-v1'], ['irrelevant'], 1);
    expect(wrong.recallAtK.value).toBe(0);
    expect(wrong.correctSourceSelection.value).toBe(0);
  });

  it('measures supported and unsupported labeled claims separately', () => {
    expect(scoreClaimSupport(4, 3)).toEqual({ factualAccuracy: { numerator: 3, denominator: 4, value: 0.75 }, unsupportedClaimRate: { numerator: 1, denominator: 4, value: 0.25 } });
    expect(scoreClaimSupport(0, 0).unsupportedClaimRate.value).toBeNull();
    expect(scoreBinaryChecks(2, 3).value).toBeCloseTo(2 / 3);
  });

  it('marks non-applicable retrieval checks as null and rejects invalid metric inputs', () => {
    expect(scoreRetrieval([], ['unlabeled'], 1).correctSourceSelection).toEqual({ numerator: null, denominator: 0, value: null });
    expect(() => scoreRetrieval(['gold'], ['gold'], Number.NaN)).toThrow(RangeError);
    expect(() => scoreClaimSupport(2, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => scoreClaimSupport(2, 3)).toThrow(RangeError);
    expect(() => scoreBinaryChecks(2, 1)).toThrow(RangeError);
    expect(percentile([1, 2, 3], Number.NaN)).toBeNull();
    expect(percentile([Number.NaN, Number.POSITIVE_INFINITY], 0.5)).toBeNull();
  });

  it('estimates cost only with an explicit rate card and attributes only evidence-supported earliest failures', () => {
    expect(estimateCost(1000, 500)).toBeNull();
    expect(estimateCost(1_000_000, 500_000, { inputPerMillion: 2, outputPerMillion: 4 })).toBe(4);
    expect(attributeEarliestFailure([
      { stage: 'CRAWLING', outcome: 'PASS' },
      { stage: 'EXTRACTION', outcome: 'FAIL', evidenceId: 'trace-extract-1' },
    ])).toEqual({ stage: 'EXTRACTION', evidenceId: 'trace-extract-1' });
    expect(attributeEarliestFailure([{ stage: 'RETRIEVAL', outcome: 'FAIL', evidenceId: 'trace-retrieve-1' }])).toEqual({ stage: 'UNKNOWN' });
    expect(attributeEarliestFailure([{ stage: 'CRAWLING', outcome: 'PASS' }])).toEqual({ stage: 'UNKNOWN' });
  });
});
