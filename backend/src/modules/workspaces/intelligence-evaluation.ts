import { validateMultilingualSemanticInterpretation } from './multilingual-semantics';
import { validateScopeSplit } from './scope-splitting';
import { isValidProviderModel, type ConversationProvider } from './conversation-provider.service';
import { MAX_RETRIEVAL_QUERY_VARIANTS, type RetrievalQueryPlan } from './retrieval-query-plan';
import { validateGroundedAnswerPlan } from './grounded-answer-plan';

export const EVALUATION_SCHEMA_VERSION = '09D.7.1';
export const GROUNDED_ANSWER_EVALUATION_DATASET_VERSION = '09F.1';
export const EVALUATION_STATUSES = ['PASS', 'FAIL', 'NOT_EVALUATED', 'INCONCLUSIVE', 'BLOCKED', 'REQUIRES_HUMAN_REVIEW'] as const;
export type EvaluationStatus = typeof EVALUATION_STATUSES[number];
export type EvaluationSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type EvaluationMethod = 'DETERMINISTIC' | 'MOCKED_PROVIDER' | 'LIVE_PROVIDER' | 'HUMAN_REVIEW' | 'ADVERSARIAL';
export type EvaluationReportType = EvaluationMethod | 'MIXED';
export type EvaluationCase = Readonly<{
  id: string; datasetVersion: string; layer: number; domain: string; language: string; category: string;
  syntheticMessage: string; severity: EvaluationSeverity; method: EvaluationMethod;
  groundTruth: Readonly<Record<string, unknown>>;
  expected: Readonly<{ requiredLimitation?: boolean; forbiddenSourceTypes?: readonly string[]; requireAuthorizedCitation?: boolean; requireGroundedAnswerPlan?: boolean; requiresHumanReview?: boolean }>;
}>;
export type EvaluationObservation = Readonly<{
  status?: EvaluationStatus; detail?: string; semantic?: unknown; scopeSplit?: unknown; originalMessage?: string;
  citedReferences?: readonly string[]; authorizedReferences?: readonly string[]; sourceType?: string;
  provider?: ConversationProvider; model?: string; providerReported?: ConversationProvider; modelReported?: string;
  providerExecutionOutcome?: 'SUCCESS' | 'ERROR';
  retrievalQueryPlan?: RetrievalQueryPlan;
  groundedAnswerPlan?: unknown;
  liveCapabilityAvailable?: boolean; claimsLiveExecution?: boolean; requiredLimitationPresent?: boolean;
  identifier?: string; identifierInMessage?: boolean; referenceOffset?: number; boundedUserTurnCount?: number;
}>;
export type EvaluationCheck = Readonly<{ category: string; status: EvaluationStatus; severity: EvaluationSeverity; detailCode: string }>;
export type EvaluationCaseResult = Readonly<{ caseId: string; layer: number; method: EvaluationMethod; status: EvaluationStatus; checks: readonly EvaluationCheck[] }>;

const record = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const onlyKeys = (x: Record<string, unknown>, allowed: readonly string[]) => Object.keys(x).every((key) => allowed.includes(key));
const safeGroundTruth = (x: Record<string, unknown>) => Object.entries(x).length <= 24 && Object.entries(x).every(([key, value]) =>
  /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && (typeof value === 'string' && value.length <= 500 || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.length <= 12 && value.every((item) => typeof item === 'string' && item.length <= 200)));
const enums = { severity: ['CRITICAL','HIGH','MEDIUM','LOW'], method: ['DETERMINISTIC','MOCKED_PROVIDER','LIVE_PROVIDER','HUMAN_REVIEW','ADVERSARIAL'] } as const;
const isMember = <T extends readonly string[]>(values: T, value: unknown): value is T[number] => typeof value === 'string' && values.some((candidate) => candidate === value);
export function validateEvaluationCase(value: unknown): value is EvaluationCase {
  if (!record(value) || !record(value.groundTruth) || !record(value.expected)
      || !onlyKeys(value, ['id','datasetVersion','layer','domain','language','category','syntheticMessage','severity','method','groundTruth','expected'])
      || !onlyKeys(value.expected, ['requiredLimitation','forbiddenSourceTypes','requireAuthorizedCitation','requireGroundedAnswerPlan','requiresHumanReview'])
      || !safeGroundTruth(value.groundTruth)) return false;
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,99}$/.test(value.id)) return false;
  if ((value.datasetVersion !== EVALUATION_SCHEMA_VERSION && value.datasetVersion !== GROUNDED_ANSWER_EVALUATION_DATASET_VERSION) || !Number.isInteger(value.layer) || Number(value.layer) < 1 || Number(value.layer) > 16) return false;
  for (const key of ['domain','language','category','syntheticMessage'] as const) if (typeof value[key] !== 'string' || !value[key] || value[key].length > 2000) return false;
  if (!isMember(enums.severity, value.severity) || !isMember(enums.method, value.method)) return false;
  if (value.expected.requiredLimitation !== undefined && typeof value.expected.requiredLimitation !== 'boolean') return false;
  if (value.expected.requireAuthorizedCitation !== undefined && typeof value.expected.requireAuthorizedCitation !== 'boolean') return false;
  if (value.expected.requireGroundedAnswerPlan !== undefined && typeof value.expected.requireGroundedAnswerPlan !== 'boolean') return false;
  if (value.expected.requiresHumanReview !== undefined && typeof value.expected.requiresHumanReview !== 'boolean') return false;
  if (value.expected.forbiddenSourceTypes !== undefined && (!Array.isArray(value.expected.forbiddenSourceTypes) || !value.expected.forbiddenSourceTypes.every((x) => typeof x === 'string' && x.length < 80))) return false;
  return true;
}
export function validateEvaluationDataset(value: unknown): value is readonly EvaluationCase[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(validateEvaluationCase)) return false;
  const ids = value.map((c) => c.id);
  return new Set(ids).size === ids.length;
}

const check = (category: string, pass: boolean, severity: EvaluationSeverity, code: string): EvaluationCheck => ({ category, status: pass ? 'PASS' : 'FAIL', severity, detailCode: code });
function resultStatus(checks: readonly EvaluationCheck[]): EvaluationStatus {
  if (checks.some((x) => x.status === 'FAIL')) return 'FAIL';
  if (checks.some((x) => x.status === 'BLOCKED')) return 'BLOCKED';
  if (checks.some((x) => x.status === 'INCONCLUSIVE')) return 'INCONCLUSIVE';
  if (checks.some((x) => x.status === 'REQUIRES_HUMAN_REVIEW')) return 'REQUIRES_HUMAN_REVIEW';
  if (checks.some((x) => x.status === 'NOT_EVALUATED')) return 'NOT_EVALUATED';
  return 'PASS';
}
/** Only verifies properties that can be established from supplied contracts; it does not score semantic truth or entailment. */
export function evaluateDeterministicCase(testCase: EvaluationCase, observed: EvaluationObservation): EvaluationCaseResult {
  const checks: EvaluationCheck[] = [];
  if (observed.status && observed.status !== 'PASS') checks.push({ category: 'execution', status: observed.status, severity: testCase.severity, detailCode: observed.detail && /^[A-Z0-9_]{1,64}$/.test(observed.detail) ? observed.detail : 'EXECUTION_NOT_PASS' });
  if (observed.providerExecutionOutcome) checks.push({ category: 'provider_execution', status: observed.providerExecutionOutcome === 'SUCCESS' ? 'PASS' : 'BLOCKED', severity: testCase.severity, detailCode: observed.providerExecutionOutcome === 'SUCCESS' ? 'PROVIDER_COMPLETED' : 'PROVIDER_FAILURE' });
  if (observed.semantic !== undefined) checks.push(check('semantic_schema', Boolean(observed.originalMessage && validateMultilingualSemanticInterpretation(observed.semantic, observed.originalMessage)), testCase.severity, 'SEMANTIC_CONTRACT'));
  if (observed.scopeSplit !== undefined) checks.push(check('scope_split', Boolean(observed.originalMessage && validateScopeSplit(observed.scopeSplit, observed.originalMessage)), testCase.severity, 'VERBATIM_SCOPE_SPANS'));
  if (observed.identifier !== undefined) checks.push(check('identifier_integrity', observed.identifierInMessage === true, testCase.severity, 'EXACT_IDENTIFIER_SPAN'));
  if (observed.referenceOffset !== undefined) checks.push(check('reference_offset', Number.isSafeInteger(observed.referenceOffset) && observed.referenceOffset >= 0 && observed.referenceOffset < (observed.boundedUserTurnCount ?? 0), testCase.severity, 'BOUNDED_USER_TURN_OFFSET'));
  if (observed.retrievalQueryPlan !== undefined) {
    const plan = observed.retrievalQueryPlan;
    const validPlan = plan.queries.length > 0 && plan.queries.length <= MAX_RETRIEVAL_QUERY_VARIANTS
      && plan.queries.every((query) => query.length > 0 && query.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(query))
      && plan.queries.some((query) => query.normalize('NFKC').toLocaleLowerCase() === plan.originalQuery.normalize('NFKC').toLocaleLowerCase())
      && Number.isSafeInteger(plan.rejectedExpansionCount) && plan.rejectedExpansionCount >= 0;
    checks.push(check('retrieval_query_plan', validPlan, testCase.severity, 'BOUNDED_QUERY_PLAN'));
  }
  if (observed.groundedAnswerPlan !== undefined) {
    checks.push(check('grounded_answer_plan', validateGroundedAnswerPlan(observed.groundedAnswerPlan, observed.authorizedReferences ?? []), testCase.severity, 'BOUNDED_AUTHORIZED_EVIDENCE_MAPPING'));
  } else if (testCase.expected.requireGroundedAnswerPlan) {
    checks.push({ category: 'grounded_answer_plan', status: 'NOT_EVALUATED', severity: testCase.severity, detailCode: 'ANSWER_PLAN_OBSERVATION_MISSING' });
  }
  if (testCase.expected.requiresHumanReview) checks.push({ category: 'human_quality_review', status: 'REQUIRES_HUMAN_REVIEW', severity: testCase.severity, detailCode: 'SEMANTIC_QUALITY_NOT_DETERMINISTIC' });
  if (observed.citedReferences !== undefined) {
    const allowed = new Set(observed.authorizedReferences ?? []);
    checks.push(check('citation_identity', observed.citedReferences.every((x) => allowed.has(x)), testCase.severity, 'AUTHORIZED_REFERENCE_IDS'));
  }
  if (observed.provider !== undefined || observed.model !== undefined || observed.providerReported !== undefined || observed.modelReported !== undefined) {
    const consistent = observed.provider === observed.providerReported && observed.model === observed.modelReported && isValidProviderModel(observed.provider, observed.model);
    checks.push(check('provider_provenance', consistent, testCase.severity, 'OBSERVED_PROVIDER_PROVENANCE'));
  }
  if (observed.claimsLiveExecution) checks.push(check('live_capability', observed.liveCapabilityAvailable === true, testCase.severity, 'LIVE_EXECUTION_AUTHORITY'));
  if (testCase.expected.requiredLimitation) checks.push(check('limitation', observed.requiredLimitationPresent === true, testCase.severity, 'SERVER_OWNED_LIMITATION'));
  if (testCase.expected.forbiddenSourceTypes?.length) checks.push(check('source_restriction', !testCase.expected.forbiddenSourceTypes.includes(observed.sourceType ?? ''), testCase.severity, 'FORBIDDEN_SOURCE_TYPE'));
  if (testCase.expected.requireAuthorizedCitation && observed.citedReferences === undefined) checks.push({ category: 'citation_identity', status: 'NOT_EVALUATED', severity: testCase.severity, detailCode: 'CITATION_OBSERVATION_MISSING' });
  if (!checks.length) checks.push({ category: 'semantic_quality', status: testCase.method === 'HUMAN_REVIEW' ? 'REQUIRES_HUMAN_REVIEW' : 'NOT_EVALUATED', severity: testCase.severity, detailCode: 'NO_DECIDABLE_OBSERVATION' });
  return Object.freeze({ caseId: testCase.id, layer: testCase.layer, method: testCase.method, status: resultStatus(checks), checks: Object.freeze(checks) });
}

export type EvaluationMetric = Readonly<{ numerator: number | null; denominator: number; value: number | null; unavailableReason?: 'ZERO_DENOMINATOR' }>;
export type EvaluationSummary = Readonly<{ total: number; counts: Readonly<Record<EvaluationStatus, number>>; criticalHighFailures: number; deterministicPassRate: EvaluationMetric; providerErrors: EvaluationMetric; gate: Readonly<{ deterministic: 'READY' | 'NOT_READY'; liveMultilingual: 'NOT_EVALUATED' | 'READY' | 'NOT_READY' }> }>;
const metric = (numerator: number, denominator: number): EvaluationMetric => denominator ? { numerator, denominator, value: numerator / denominator } : { numerator: null, denominator: 0, value: null, unavailableReason: 'ZERO_DENOMINATOR' };
export function aggregateEvaluationResults(results: readonly EvaluationCaseResult[]): EvaluationSummary {
  const counts = Object.fromEntries(EVALUATION_STATUSES.map((s) => [s, results.filter((r) => r.status === s).length])) as Record<EvaluationStatus, number>;
  const deterministic = results.filter((r) => r.method === 'DETERMINISTIC' || r.method === 'ADVERSARIAL');
  const pass = deterministic.filter((r) => r.status === 'PASS').length;
  const deterministicPassRate = metric(pass, deterministic.length);
  const criticalHighFailures = results.filter((r) => r.status === 'FAIL' && r.checks.some((c) => ['CRITICAL','HIGH'].includes(c.severity))).length;
  const live = results.filter((r) => r.method === 'LIVE_PROVIDER');
  const deterministicReady = deterministic.length > 0 && criticalHighFailures === 0 && deterministic.every((r) => r.status === 'PASS');
  return Object.freeze({ total: results.length, counts: Object.freeze(counts), criticalHighFailures, deterministicPassRate,
    providerErrors: metric(results.filter((r) => r.checks.some((c) => c.category === 'provider_execution' && c.status === 'BLOCKED')).length, results.filter((r) => r.checks.some((c) => c.category === 'provider_execution')).length),
    gate: Object.freeze({ deterministic: deterministicReady ? 'READY' : 'NOT_READY', liveMultilingual: live.length === 0 ? 'NOT_EVALUATED' : criticalHighFailures || live.some((r) => r.status !== 'PASS') ? 'NOT_READY' : 'READY' }) });
}

export type SafeEvaluationReport = Readonly<{ schemaVersion: string; datasetVersion: string; evaluationType: EvaluationReportType; tenantId: string; generatedAt: string; results: readonly Readonly<{ caseId: string; layer: number; method: EvaluationMethod; status: EvaluationStatus; checks: readonly EvaluationCheck[] }>[]; summary: EvaluationSummary }>;
/** Tenant-scoped and allowlisted: no messages, prompts, evidence, details, credentials, or transcript fields enter reports. */
export function buildSafeEvaluationReport(input: { requesterTenantId: string; reportTenantId: string; datasetVersion: string; results: readonly EvaluationCaseResult[]; generatedAt: string }): SafeEvaluationReport | null {
  if (!input.requesterTenantId || input.requesterTenantId !== input.reportTenantId || !Number.isFinite(Date.parse(input.generatedAt)) || input.results.length === 0) return null;
  const methods = new Set(input.results.map((r) => r.method));
  const evaluationType = methods.size > 1 ? 'MIXED' : (methods.values().next().value ?? 'DETERMINISTIC');
  const safeResults = input.results.map((r) => ({ caseId: r.caseId, layer: r.layer, method: r.method, status: r.status, checks: r.checks.map((c) => ({ category: c.category, status: c.status, severity: c.severity, detailCode: c.detailCode })) }));
  return Object.freeze({ schemaVersion: EVALUATION_SCHEMA_VERSION, datasetVersion: input.datasetVersion, evaluationType, tenantId: input.reportTenantId, generatedAt: new Date(input.generatedAt).toISOString(), results: Object.freeze(safeResults), summary: aggregateEvaluationResults(input.results) });
}

export type EvaluationExecutor = (testCase: EvaluationCase, signal?: AbortSignal) => Promise<EvaluationObservation>;
/** Bounded explicit runner. It has no provider dependency; callers must supply any separately authorized executor. */
export async function runEvaluationDataset(cases: readonly EvaluationCase[], execute: EvaluationExecutor, options: { signal?: AbortSignal; maxCases?: number } = {}): Promise<readonly EvaluationCaseResult[]> {
  if (!validateEvaluationDataset(cases)) throw new Error('INVALID_EVALUATION_DATASET');
  const maxCases = Math.max(1, Math.min(options.maxCases ?? 500, 500));
  const results: EvaluationCaseResult[] = [];
  for (const testCase of cases.slice(0, maxCases)) {
    if (options.signal?.aborted) { results.push({ caseId: testCase.id, layer: testCase.layer, method: testCase.method, status: 'BLOCKED', checks: [{ category: 'execution', status: 'BLOCKED', severity: testCase.severity, detailCode: 'CANCELLED' }] }); continue; }
    try { results.push(evaluateDeterministicCase(testCase, await execute(testCase, options.signal))); }
    catch { results.push({ caseId: testCase.id, layer: testCase.layer, method: testCase.method, status: 'BLOCKED', checks: [{ category: 'execution', status: 'BLOCKED', severity: testCase.severity, detailCode: 'EXECUTOR_FAILURE' }] }); }
  }
  return Object.freeze(results);
}

export function evaluationDiagnosticsVisible(role: string, requesterTenantId: string, reportTenantId: string, enabled: boolean): boolean {
  return enabled && requesterTenantId.length > 0 && requesterTenantId === reportTenantId && ['OWNER','ADMIN'].includes(role.toUpperCase());
}
