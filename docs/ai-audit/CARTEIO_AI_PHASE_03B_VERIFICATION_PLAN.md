# Carteio AI Phase 03B — Regression Verification Plan

**Review date:** 17 October 2026  
**Review type:** source and test inspection only. No tests, builds, typechecks, services, provider calls, website requests, Shopify syncs, migrations, or database operations were run.  
**Requested report paths:** the three requested Phase 01/02/03A files are present under `docs/ai-audit/` (not directly under `docs/`). I read those existing files.

## 1. Regression coverage review

Backend Jest configuration is `backend/jest.config.js`: Node environment, `ts-jest`, root directory `backend`, and `*.spec.ts` discovery. The tests inspected use Jest conventions and can be selected by path. The workspace contains `backend/node_modules/.bin/jest` and `pnpm` is on PATH; this is a static presence check, not a test run.

### `conversation-diagnostics.spec.ts`

The tests directly exercise the production `selectBoundedHistory` and `validateGroundedResponse` functions. They meaningfully cover basic empty/one/within-bound history, a newest-turn overflow case, a long message, repeated text, exact duration mismatch, Hindi numeric duration, unrelated citation, currency/price, stale price/date, stock, URL, email, SKU, invalid references and qualitative prose boundary.

Coverage still needed:

- Exact 12-message and 16 KiB edges, very small budgets, multibyte Unicode clipping, assistant-only/user-only groups, incomplete turns, and a group that cannot fit with one slot remaining.
- Current-message single inclusion through the actual final provider input with an identical earlier message in history. The existing pure helper test appends a message in the test itself; it does not exercise orchestration.
- Wrong bare numeric claims in each target domain (sizes, years, identifiers, dimensions), multiple currencies, numeric ranges, false rejection of valid formatting, and explicit evidence-source association.
- Whether the no-business-evidence branch returns its natural fallback and persists it, and whether the qualitative claim accepted by the validator is understood as **unchecked**, not supported.
- Cross-tenant source authorization is primarily an upstream orchestrator responsibility; a pure validator supplied with an unauthorized evidence object cannot establish tenant isolation.

The contradictory-evidence unit test only confirms that two cited values individually exist in their respective excerpts. It does not test whether the answer plan identifies conflict, whether conflict disclosure is required, or whether the shared pipeline falls back when conflict citations are missing.

### `assistant.playground.spec.ts`

This is the strongest current integration-style suite reviewed. It constructs an `AssistantService` with mocked Prisma/workspace/retrieval collaborators and replaces `global.fetch`; provider requests are intercepted and synthetic responses are returned. It exercises the Playground route through orchestration, retrieval, answer verification, source revalidation, fallbacks, persistence contract, provider errors, session history, language, tool selection, tenant checks and citations. The current-message assertion inspects the serialized final provider request; it also asserts that the message is the last user message.

Limitations:

- The 16 KiB history test uses 12 large user-only messages and string searches over serialized `fetchMock.mock.calls`. It verifies latest markers and an under-96-KiB request but does not directly assert history order, exact 12/16 KiB bounds, clipped Unicode content or newest complete user/assistant pair behavior.
- The current-message test checks text occurrence count in the serialized request. If an earlier history turn contains the same text, this can confuse historical repetition with current-turn duplication. Prefer asserting provider message roles/turn placement and normalized identity of the current input.
- It does not exercise the public widget HTTP/session/persistence path.

### `conversation-orchestrator.customer.spec.ts`

This tests trusted customer adapter authorization, lease/idempotency and persistence shape using fake database methods. It replaces `executeSharedAI` with a mock implementation that invokes `persistTurn` directly. Therefore it does **not** test Phase 02 history selection, provider prompt construction, retrieval, grounding, fallback, or the validator on the widget route. Its fixture answer text is not evidence of a completed AI turn.

### `quality-benchmark-fixtures.spec.ts`

The fixture spec directly tests offline metric arithmetic and some shape properties. It verifies 72-or-more unique IDs, category presence, nonempty expected fields, synthetic source ID prefixes, a few retrieval and claim arithmetic examples, explicit rate-card cost and `UNKNOWN` attribution. It does not run any of the benchmark scenarios against Carteio, validate expected facts against evidence, prove severity, or score generated answers. A green result would be **fixture/helper unit coverage only**, never chatbot accuracy.

## 2. Phase 02 code wiring assessment

### History

- Widget: `WidgetController.message` → `WidgetService.message` validates its session/origin/rate; `SaasService.recordCustomerMessage` persists the customer turn; `ConversationOrchestrator.processTrustedCustomerTurn` verifies the persisted message and scopes the support conversation to organization, assistant, channel and visitor-session hash. It loads up to 40 rows, associates AI rows with earlier customer idempotency keys, creates chronological `priorTurns`, applies `selectBoundedHistory(priorTurns, 12, 16 KiB)`, and calls the shared AI executor.
- Playground: `playgroundChat` resolves an organization/assistant/user-scoped session; `loadConversationHistory` loads latest sequence rows with an organization/session predicate, revalidates stored assistant sources, reverses descending rows into chronology, and applies the same selector. Persistence remains in the Playground adapter.
- Shared answer generation places bounded prior turns in a separate untrusted context message and the current `context.message` in the final user message. The answer-plan fields sent to the model omit the original question text. The 96 KiB serialized provider-input ceiling remains a final bound. Current input is not included in the persisted prior history before execution.
- Selection keeps newest groups first, returns them chronologically, limits message count/serialized history bytes, and marks oversized content. Product referents therefore have the intended selector behavior when the caller’s input list is correctly ordered.

### Grounding

The shared `executeSharedAI` revalidates source evidence after generation, then calls `validateGroundedResponse` inside the `RESPONSE_VERIFICATION` stage before persistence. The validator receives the evidence assembled for that request; current source authorization/version/hash revalidation remains the tenant/source gate. Unknown references and selected unsupported measurable facts take the existing uncertainty fallback path. No model-based semantic verification exists.

### Widget/Playground differences and specific history risk

Both paths use the same selector, provider construction, retrieval, validator, and shared response logic. Their history acquisition and persistence differ: Playground has a monotonic per-session sequence; widget history reconstructs order from `createdAt` and `id`.

In `processTrustedCustomerTurn`, prior rows are sorted by `createdAt.getTime()` and then `id.localeCompare()`. Support rows are created with `new Date()` and no per-conversation message sequence. If two turns share a millisecond timestamp, random IDs are not a causal order. The selector may then receive user/assistant rows in the wrong order, and pair boundaries/product references can be wrong. The selector correction does not correct ordering ambiguity in its input. This is a **static edge-case defect**, not a test result. Do not patch it in this review; first add a deterministic same-timestamp widget regression. If confirmed as observable, the safe patch should derive stable order from an authoritative sequence/transaction ordering or another persisted causal key, not random ID order.

Widget response persistence remains behind the existing support-message transaction/idempotency path. No new persistence code was introduced by Phase 02. This review cannot prove the database transaction behavior without executing the mocked tests or an approved database-backed integration test; the proposed local unit suites do not require a database.

## 3. Existing tests and missing coverage

The Phase 02 production functions are directly exercised by pure unit tests, and Playground exercises the shared pipeline with mocked provider/network and data adapters. The widget customer adapter suite exercises only trust, replay/lease and its persistence adapter. Existing tests provide useful coverage, but the coverage is not symmetric between widget and Playground.

Targeted gaps for follow-up coverage:

1. Widget selection from 40 rows through `processTrustedCustomerTurn`, verifying latest follow-up, selected order, current-message exclusion, session predicates and provider input.
2. Widget chronological ties with equal timestamps, delayed AI response ordering, missing/late assistant reply rows and idempotent retries.
3. Assert count/byte bounds directly on selected provider history for both channels, including 3-byte characters and giant newest messages.
4. Assert unsupported price, currency, SKU, URL, email, labeled phone, numeric duration and stock claims produce the existing fallback and that rejected provider text is not persisted as a grounded answer.
5. Assert valid values persist as grounded and citations correspond to revalidated authorized evidence; test cross-tenant denial at orchestrator/retrieval boundary.
6. Assert greetings/acknowledgments bypass evidence verification and remain natural, while merchant-specific factual claims without evidence get uncertainty behavior.
7. Test true contradiction-plan behavior, no-evidence branch, response contract and persistence in one mocked shared-path scenario.
8. Cover ticket-linked 72-hour retention as a regression guard only if a relevant lifecycle change occurs; Phase 02 did not change the retention worker.

## 4. Evaluation framework and 72-scenario review

There are 72 fixture rows, four each for A–R. The Jest fixture test checks shape/category presence, but does not check exact four-per-category counts, policy/source correctness, severity rationale, tool classification, or whether expected facts can be derived from the attached evidence.

### Specific fixture inconsistencies

- `conflict-policy`, `conflict-source-date`, `conflict-variant`, and `conflict-contact` each attach only one evidence object for the relevant data. They do not provide the two contradictory source records described by the questions/expected outcomes. These cannot currently be used as deterministic contradiction cases.
- `tenant-private` attaches the public synthetic business source, not the Tenant B private evidence. `tenant-citation` attaches Tenant A returns plus an unrelated Tenant B contact record, not a Tenant B policy. These cases do not verify the stated disclosure/citation behavior against matching private evidence.
- `snapshot-no-sync` expects a specific sync date, while its evidence only has a freshness string and a textual catalog date. That text is sufficient for the claimed date in this fixture, but it is not structured `syncedAt` metadata and should be labeled as a text-only date test rather than commerce freshness validation.
- `variant-live-stock` and `missing-stock` use a catalog excerpt that says there is no live inventory guarantee but contains no structured availability state. This tests abstention from the source content, not the validator’s explicit stock-state matcher.
- Some cases specify a required tool via a string label, but no fixture executes or checks the actual server tool manifest, arguments, permissions, or output. In particular, `search_store_products` denotes synchronized catalog search, not a live Shopify request.

The catalog and policy baseline evidence is internally useful for many exact synthetic facts, but contradiction and isolation cases need distinct, correct source records and explicit tenant/authorization labels before semantic scoring.

### Metric correctness and limitations

- `scoreRetrieval` deduplicates returned IDs, uses a nearest-result set, and correctly returns null recall when the gold relevant set is empty and null precision when nothing is returned. `k=0` yields empty results and null precision. Duplicate gold IDs are deduplicated by `Set`.
- `correctSourceSelection` is currently “at least one retrieved ID is in the relevant set.” It cannot distinguish a required authoritative source from a merely relevant source. Name/definition should be narrowed to “relevant-source hit,” or the input should include a separate labeled primary/authoritative source ID.
- The score helper has no explicit non-applicable status. For a case with no expected relevant source, `correctSourceSelection` still returns 0 or 1 over denominator 1. Report metrics should carry applicability and exclude non-applicable cases rather than treating them as failures/passes.
- `scoreClaimSupport` reports `factualAccuracy = supportedClaims / totalClaims`; this is a labeled claim support rate over emitted claims, not answer completeness or overall factual accuracy. It does not penalize omitted expected facts. Report claim correctness, completeness/recall and unsupported-claim rate separately, with human-adjudicated atomic claims.
- `percentile` implements nearest-rank indexing for ordinary finite quantiles and returns null for no finite samples, but does not reject `NaN` quantile (it falls through to the minimum) and silently drops non-finite latency observations. Validate input and report excluded sample counts before using it for a production scorecard.
- `scoreClaimSupport` and `scoreBinaryChecks` clamp ordinary negative/out-of-range integers, but do not reject `NaN`/infinity or non-integer inputs. Invalid values may produce non-finite metrics. Add input-contract tests before relying on output for gates.
- `estimateCost` returns null without a rate card and rejects negative/non-finite inputs. Rates must be provider/model/date-specific and approved; the helper does arithmetic only.
- `attributeEarliestFailure` returns `UNKNOWN` when a preceding stage is absent, which is appropriately conservative. It requires every earlier ordered stage to be recorded as `PASS` or `SKIPPED`; the existing request trace does not cover crawl/extraction/indexing/embedding, so many answer failures will correctly remain unknown until joined by source/job version metadata. Duplicate observations are silently last-write-wins and need either rejection or documented resolution.

The evaluation fixture test does not calculate a benchmark-wide pass rate. Keep future results split by metric, category, severity, language and method; do not present a fixture/helper test pass as real chatbot accuracy.

## 5. Widget and Playground consistency

Shared behavior is consistent after history acquisition: bounded selection, answer-plan prompt, evidence checks, provider loop, verification and response fallback all run through `executeSharedAI`. Playground is better suited to existing prompt-level regression because its test injects the actual orchestrator and intercepts `fetch`. Widget route tests need to traverse `WidgetService.message` and `SaasService.recordCustomerMessage` into `processTrustedCustomerTurn`; the current trusted customer adapter test mocks the shared AI method and therefore stops before the Phase 02 shared behavior.

The widget-specific timestamp ordering issue can invalidate a benchmark if messages have equal timestamps or if a response arrives late. A widget test should create a full synthetic support message history with same `createdAt`, controlled IDs and idempotency associations, then inspect selected history at the provider boundary. Playground sequence ordering should be a control case.

## 6. Exact proposed test commands and approval gate

Do not run these until you explicitly approve. Both commands invoke only local Jest specs; no install, build, server, database, external network, credential, model provider, Shopify API, crawler, or synchronization is required by the inspected test setup. The Playground suite uses a mocked `global.fetch` and test-only environment keys, then restores them. The customer adapter uses fake DB objects and mocks shared AI execution. If Jest reports missing dependencies, stop; do not install them.

**Command 1 — pure bounded history, grounding and offline benchmark helpers:**

```bash
pnpm --dir backend exec jest --runInBand --runTestsByPath src/modules/workspaces/conversation-diagnostics.spec.ts test/quality-benchmark-fixtures.spec.ts
```

Expected side effects: local CPU and Jest temporary/cache files only. No service or database is needed. No external network access or credentials should be used.

**Command 2 — mocked Playground and trusted customer adapter regressions:**

```bash
pnpm --dir backend exec jest --runInBand --runTestsByPath test/assistant.playground.spec.ts src/modules/workspaces/conversation-orchestrator.customer.spec.ts
```

Expected side effects: local CPU and Jest temporary/cache files; the Playground spec temporarily changes test process environment values and restores them in `afterEach`. No service/database is intended. Provider HTTP is intercepted by the spec’s `fetch` mock; no real model call should occur. The trusted customer spec uses mocked database methods and bypasses shared AI execution. No credentials are required.

These command paths are selected against `backend/jest.config.js` and the package scripts. Jest binary presence was checked. No test command has been run. Approval should name command 1, command 2, or both; after approval run only the named command(s). A full test suite, builds, typechecks, e2e suites and external provider-backed tests are outside this gate.

## 7. Required approvals

- Explicit approval before running either listed test command, as required in the request.
- Separate approval before any test that uses a live provider, merchant website, customer data, Shopify API, database service, crawling, synchronization, or paid requests.
- Merchant approval package before a real AI quality baseline: test website, approved facts/sources, test session, permitted provider/model, data handling, cost ceiling and test window.

## 8. Remaining runtime verification gaps

- Test execution and type/compile correctness remain unverified.
- The existing selected specs cannot validate the full public widget route with real in-process adapters, because the customer spec mocks `executeSharedAI`.
- No local test proves request ID trace correlation across widget/API, source freshness, rejected-answer persistence, or real transactional DB behavior.
- Crawler/indexing/embedding events have separate job lifecycles and are not all joined to conversation request IDs. Earliest source-side failure may remain `UNKNOWN`.
- No retrieval gold set has run. No human score for answer accuracy, citation relevance, Hindi/Hinglish quality or naturalness exists.

## 9. Real merchant benchmark requirements

Use an explicitly merchant-approved public test website and a fixed crawl/index snapshot. Obtain exact authoritative source facts (including effective dates and exceptions), stable source IDs/version/hash, and a reviewer-approved source span for each expected atomic claim. Include answerable, unanswerable and contradictory cases; label all relevant source/chunk IDs and authoritative source priority. Validate tenant/source authorization and freshness before scoring.

The question set should cover business information, products/variants/prices, policies, multi-source synthesis, multilingual paraphrases, follow-up references, missing facts, prompt injection, cross-tenant attempts and natural conversation. Include Hindi script and Romanized Hindi/Hinglish questions with merchant-approved English evidence. Use synthetic/test customer sessions only; never import actual customer transcripts without a separate approved privacy process.

For each run, record exact Carteio build/commit, dataset version, indexed source version/hash, provider/model/route, relevant configuration, request ID, retrieval mode, selected evidence IDs/ranks, bounded history counts, response category, validator outcome, latency and token usage. Keep content artifacts in an access-controlled evaluation location; general logs should remain metadata-only. Report deterministic exact-field metrics separately from human-reviewed claims, language and naturalness. Use a dated approved provider rate card and hard cost ceiling if any model run is authorized. This phase performed no crawl or provider call.

## 10. Recommended next development priority

Do not start a broad AI architecture change before the approved regression results. First, add a deterministic widget history test for equal `createdAt` values and verify the intended turn order. If it confirms the tie-order weakness, fix widget chronology using a stable causal ordering source while preserving schema/API contracts where possible; if no such ordering source exists, document the migration decision separately rather than relying on random IDs.

Next, repair the synthetic benchmark’s contradictory and tenant-scoped evidence so it can test those outcomes. Then execute the two offline Jest commands after approval. Once regressions pass, the first quality baseline should measure hybrid retrieval on a frozen, labeled corpus (recall@k, precision@k, source-span coverage and context truncation). Change retrieval/reranking only if those measurements show missed or misranked evidence. Evaluate semantic claim verification using human-labeled atomic claims before considering a model verifier. Do not prioritize memory, tool-engine replacement or response-generation redesign absent verified failures.

No application source, tests, fixtures, metrics or environment files were changed in Phase 03B review. The only intended change is this verification-plan report. No test has been run; approval is still required.
