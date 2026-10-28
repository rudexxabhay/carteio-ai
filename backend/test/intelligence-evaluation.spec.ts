import { GROUNDED_ANSWER_EVALUATION_CASES_V1, INTELLIGENCE_EVALUATION_DATASET_V1, RETRIEVAL_EVALUATION_CASES_V1 } from '../src/modules/workspaces/intelligence-evaluation-datasets';
import { buildRetrievalQueryPlan, MAX_RETRIEVAL_QUERY_VARIANTS } from '../src/modules/workspaces/retrieval-query-plan';
import { aggregateEvaluationResults, buildSafeEvaluationReport, evaluateDeterministicCase, evaluationDiagnosticsVisible, runEvaluationDataset, validateEvaluationCase, validateEvaluationDataset, type EvaluationCaseResult } from '../src/modules/workspaces/intelligence-evaluation';

describe('intelligence evaluation engine', () => {
  it('validates versioned synthetic cases and unique IDs', () => {
    expect(validateEvaluationDataset(INTELLIGENCE_EVALUATION_DATASET_V1)).toBe(true);
    expect(validateEvaluationDataset([INTELLIGENCE_EVALUATION_DATASET_V1[0], INTELLIGENCE_EVALUATION_DATASET_V1[0]])).toBe(false);
    expect(validateEvaluationCase({ ...INTELLIGENCE_EVALUATION_DATASET_V1[0], datasetVersion: 'old' })).toBe(false);
    expect(validateEvaluationCase({ ...INTELLIGENCE_EVALUATION_DATASET_V1[0], severity: 'URGENT' })).toBe(false);
  });

  it('validates the synthetic retrieval quality and authorization cases against the same versioned contract', () => {
    expect(validateEvaluationDataset(RETRIEVAL_EVALUATION_CASES_V1)).toBe(true);
    expect(RETRIEVAL_EVALUATION_CASES_V1.some((x) => x.category === 'retrieval_multilingual' && x.language === 'Hindi')).toBe(true);
    expect(RETRIEVAL_EVALUATION_CASES_V1.some((x) => x.category === 'retrieval_authorization' && x.severity === 'CRITICAL')).toBe(true);
  });

  it('validates the separate 09F grounded-answer dataset version and evaluates plan provenance', () => {
    expect(validateEvaluationDataset(GROUNDED_ANSWER_EVALUATION_CASES_V1)).toBe(true);
    const plan = {
      version: '09F.1', question: 'What is the return policy?', responseLanguage: 'English', coverage: 'CANDIDATES_FOR_ALL_ASPECTS', requiresLiveLimitation: false, citationRequired: true, entailmentVerified: false,
      aspects: [{ id: 'A1', questionSpan: 'What is the return policy?', retrievalQuery: 'return policy', status: 'EVIDENCE_CANDIDATE', evidenceReferences: ['S1'], differingValues: [] }],
      evidence: [{ reference: 'S1', sourceId: 'source-1', chunkId: 'chunk-1', sourceVersion: 1, contentHash: 'a'.repeat(64), locator: 'Return policy' }],
    };
    const result = evaluateDeterministicCase(GROUNDED_ANSWER_EVALUATION_CASES_V1[0]!, { groundedAnswerPlan: plan, authorizedReferences: ['S1'] });
    expect(result.checks).toContainEqual(expect.objectContaining({ category: 'grounded_answer_plan', status: 'PASS' }));
    const forged = evaluateDeterministicCase(GROUNDED_ANSWER_EVALUATION_CASES_V1[0]!, { groundedAnswerPlan: plan, authorizedReferences: [] });
    expect(forged.checks).toContainEqual(expect.objectContaining({ category: 'grounded_answer_plan', status: 'FAIL' }));
    const missing = evaluateDeterministicCase(GROUNDED_ANSWER_EVALUATION_CASES_V1[0]!, {});
    expect(missing.checks).toContainEqual(expect.objectContaining({ category: 'grounded_answer_plan', status: 'NOT_EVALUATED' }));
    const semanticReview = evaluateDeterministicCase(GROUNDED_ANSWER_EVALUATION_CASES_V1.find((item) => item.id === 'answer.claim-entailment')!, {});
    expect(semanticReview.status).toBe('REQUIRES_HUMAN_REVIEW');
  });

  it('checks exact identifiers, citations and required safety limitations', () => {
    const baseCase = INTELLIGENCE_EVALUATION_DATASET_V1.find((x) => x.id === 'l12.false-citation')!;
    const testCase = { ...baseCase, expected: { ...baseCase.expected, requiredLimitation: true } };
    const result = evaluateDeterministicCase(testCase, { citedReferences: ['S99'], authorizedReferences: [], requiredLimitationPresent: false });
    expect(result.status).toBe('FAIL');
    expect(result.checks.map((x) => x.detailCode)).toContain('AUTHORIZED_REFERENCE_IDS');
    expect(result.checks.map((x) => x.detailCode)).toContain('SERVER_OWNED_LIMITATION');
  });

  it('evaluates retrieval query count and exact original-query retention with the real evaluator', () => {
    const testCase = RETRIEVAL_EVALUATION_CASES_V1.find((x) => x.id === 'rag.expansion-bound')!;
    const valid = buildRetrievalQueryPlan({ originalMessage: 'What is the return policy?', semanticQueries: ['return conditions', 'return window'] });
    expect(evaluateDeterministicCase(testCase, { retrievalQueryPlan: valid }).checks).toContainEqual(expect.objectContaining({ category: 'retrieval_query_plan', status: 'PASS' }));
    const invalid = { ...valid, queries: [valid.originalQuery, ...Array.from({ length: MAX_RETRIEVAL_QUERY_VARIANTS }, (_, index) => `variant ${index + 1}`)] };
    expect(evaluateDeterministicCase(testCase, { retrievalQueryPlan: invalid }).status).toBe('FAIL');
  });

  it('does not count unevaluated cases as passes and has a zero denominator', () => {
    const one = evaluateDeterministicCase(INTELLIGENCE_EVALUATION_DATASET_V1[1]!, {});
    const summary = aggregateEvaluationResults([one]);
    expect(one.status).toBe('NOT_EVALUATED');
    expect(summary.counts.PASS).toBe(0);
    expect(summary.deterministicPassRate).toEqual({ numerator: null, denominator: 0, value: null, unavailableReason: 'ZERO_DENOMINATOR' });
    expect(aggregateEvaluationResults([]).deterministicPassRate).toEqual({ numerator: null, denominator: 0, value: null, unavailableReason: 'ZERO_DENOMINATOR' });
    expect(aggregateEvaluationResults([]).gate.deterministic).toBe('NOT_READY');
  });

  it('reports all explicit result statuses and applies severity release gates', () => {
    const statuses = ['PASS','FAIL','NOT_EVALUATED','INCONCLUSIVE','BLOCKED','REQUIRES_HUMAN_REVIEW'] as const;
    const results = statuses.map((status, index): EvaluationCaseResult => ({ caseId: `case-${index}`, layer: index + 1, method: 'DETERMINISTIC', status, checks: [{ category: 'contract', status, severity: index === 1 ? 'CRITICAL' : 'LOW', detailCode: 'FIXTURE' }] }));
    const summary = aggregateEvaluationResults(results);
    expect(summary.counts.BLOCKED).toBe(1);
    expect(summary.counts.NOT_EVALUATED).toBe(1);
    expect(summary.criticalHighFailures).toBe(1);
    expect(summary.gate.deterministic).toBe('NOT_READY');
  });

  it('keeps provider failure classification separate from evaluator failure and supports cancellation', async () => {
    const called: string[] = [];
    const cases = INTELLIGENCE_EVALUATION_DATASET_V1.slice(0, 2);
    const results = await runEvaluationDataset(cases, async (x) => { called.push(x.id); if (x.id.includes('prompt')) throw new Error('secret provider output'); return { status: 'BLOCKED', detail: 'PROVIDER_TIMEOUT', providerExecutionOutcome: 'ERROR' }; });
    expect(results[0]?.status).toBe('BLOCKED');
    expect(results[0]?.checks[0]?.detailCode).toBe('EXECUTOR_FAILURE');
    expect(results[1]?.status).toBe('BLOCKED');
    expect(aggregateEvaluationResults(results).providerErrors.value).toBe(1);
    expect(aggregateEvaluationResults([results[0]!]).providerErrors.value).toBeNull();
    const controller = new AbortController(); controller.abort();
    const cancelled = await runEvaluationDataset(cases, async () => { throw new Error('must not execute'); }, { signal: controller.signal });
    expect(cancelled.every((x) => x.status === 'BLOCKED')).toBe(true);
    expect(called).toHaveLength(2);
    await expect(runEvaluationDataset([{ ...cases[0]!, datasetVersion: 'invalid' }], async () => { throw new Error('must not execute'); })).rejects.toThrow('INVALID_EVALUATION_DATASET');
  });

  it('labels mocked and live evaluation separately and restricts diagnostics to same-tenant owners', () => {
    const mixed: EvaluationCaseResult[] = [
      { caseId: 'mock', layer: 2, method: 'MOCKED_PROVIDER', status: 'PASS', checks: [{ category: 'schema', status: 'PASS', severity: 'LOW', detailCode: 'OK' }] },
      { caseId: 'live', layer: 2, method: 'LIVE_PROVIDER', status: 'NOT_EVALUATED', checks: [{ category: 'quality', status: 'NOT_EVALUATED', severity: 'LOW', detailCode: 'NO_LIVE_RUN' }] },
    ];
    const report = buildSafeEvaluationReport({ requesterTenantId: 'tenant-a', reportTenantId: 'tenant-a', datasetVersion: '09D.7.1', results: mixed, generatedAt: '2026-01-01T00:00:00Z' });
    expect(report?.evaluationType).toBe('MIXED');
    expect(JSON.stringify(report)).not.toContain('syntheticMessage');
    expect(buildSafeEvaluationReport({ requesterTenantId: 'tenant-a', reportTenantId: 'tenant-b', datasetVersion: '09D.7.1', results: mixed, generatedAt: '2026-01-01T00:00:00Z' })).toBeNull();
    expect(evaluationDiagnosticsVisible('OWNER', 'tenant-a', 'tenant-a', true)).toBe(true);
    expect(evaluationDiagnosticsVisible('OWNER', 'tenant-a', 'tenant-b', true)).toBe(false);
    expect(evaluationDiagnosticsVisible('MEMBER', 'tenant-a', 'tenant-a', true)).toBe(false);
  });
});
