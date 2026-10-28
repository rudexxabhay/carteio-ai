# Carteio AI Phase 03A — Evaluation Foundation

**Review date:** 17 October 2026  
**Scope:** static readiness review of Phase 02 plus an offline, synthetic, multilingual answer-quality benchmark design.  
**Execution:** Tests, builds, typechecks, servers, website crawls, Shopify syncs and model calls were not run.

## 1. Executive summary

Phase 02 is **statically connected and ready for regression verification**, but it is not runtime-verified. `processTrustedCustomerTurn` and Playground history loading call the new bounded selector; both paths use the existing shared answer pipeline. The shared `RESPONSE_VERIFICATION` stage calls the deterministic grounding validator after evidence revalidation and before persistence. Source inspection confirms these integration points, but cannot establish that the code compiles, tests pass, or generated replies improve.

Carteio already contains Jest tests, synthetic semantic/retrieval/grounded-answer datasets, and an offline deterministic evaluation engine. Those assets mostly assess interpretation contracts, query-plan bounds, provenance and safety signals. They do not provide a complete set of merchant-grounded expected answers or score RAG answer quality. Phase 03A adds 72 synthetic customer scenarios and offline benchmark metric helpers. They contain no real merchant facts and do not claim production accuracy or parity with another platform.

## 2. Phase 02 verification readiness

### Static integration review

- Widget messages enter through the existing `WidgetController`/`WidgetService` and `SaasService.recordCustomerMessage` path, then `ConversationOrchestrator.processTrustedCustomerTurn`. The orchestrator loads only organization/conversation/session-matched prior support messages and invokes `selectBoundedHistory` at `conversation-orchestrator.service.ts:274`.
- Playground session resolution loads the latest bounded messages in descending sequence, revalidates stored messages, reverses them to chronological order, then calls `selectBoundedHistory` at `conversation-orchestrator.service.ts:1161`.
- The shared execution path constructs provider history separately from the current `context.message`; the Playground regression test asserts the current input is the final user message once. Existing widget idempotency keys exclude the current persisted customer message from prior history.
- Both history paths use the 12-message and 16 KiB history bounds. The selector takes newest adjacent user/assistant groups first and restores chronology. It clips an individually oversized newest user message to retain its ending, and marks clipped content.
- The shared response validator receives the generated response and the selected evidence after authorization/version/hash revalidation. The check is before a grounded answer is persisted. Unknown citations and unsupported deterministic claims take the existing uncertainty/fallback path.
- Shopify product evidence is synchronized catalog snapshot data. The validator rejects explicit live/current claims tied to a commerce snapshot and requires a snapshot label plus its sync date for stale snapshot prices. The execution path has no live per-turn Shopify catalog call.

### Static gaps and integration risks

1. No tests were run, so type/compile compatibility, actual persistence, widget behavior and full provider input remain unconfirmed.
2. New selector unit cases cover overflow and recent-turn selection. The added provider-input assertion is in Playground; a focused end-to-end widget fixture should prove the latest follow-up survives the support-message query, pairing, selector, final input and persistence path.
3. Boundary coverage should explicitly verify exact 12-message and 16 KiB limits with multibyte text, incomplete/odd user-assistant turn groups, current-message overlap by idempotency, and per-session isolation in both channels.
4. The validator's “numeric” matcher also sees bare numeric strings. Product size/date/identifier contexts need regression cases to measure false rejection. It is intentionally not a general semantic verifier.
5. Citation association is paragraph-based. A citation in a paragraph does not prove every qualitative assertion in that paragraph. Conversely, a safe response path that emits no citation for an answer requiring evidence may be rejected and replaced with a fallback; naturalness and false-rejection rates need measured fixtures.
6. Conflicting source policy precedence and qualifiers are not fully parsed. Evidence freshness and retrieval relevance are upstream responsibilities; deterministic answer checks cannot restore omitted evidence.
7. Test descriptions in earlier reports identify existing suites, but coverage of all requested variants should be verified by running the suites and reviewing actual assertions. This phase adds a benchmark inventory; it does not certify those existing tests.

Readiness means the changes are on the intended source path and there is a deterministic verification plan. It does **not** mean the implementation has passed tests or improved answer accuracy.

## 3. Existing evaluation and test infrastructure

- Backend tests use Jest with `ts-jest`, `backend/test/**/*.spec.ts`, and source-local `*.spec.ts`. No new test runner is needed.
- `intelligence-evaluation.ts` defines versioned cases/statuses, deterministic contract evaluation, bounded local dataset execution, aggregate status reporting and same-tenant safe report construction. It explicitly does not score semantic truth.
- `intelligence-evaluation-datasets.ts` already contains synthetic semantic, retrieval, and grounded-answer-plan cases. Existing tests cover schema rejection, authorized citation identities, query-plan constraints, status aggregation, provider-failure classification, cancellation and diagnostic report tenancy.
- `semantic-interpretation.v1.ts` contains synthetic multilingual interpretation inputs. Existing domain specs cover retrieval query planning, grounding plans, provider contracts, language semantics and conversation behavior.
- These tools do not currently calculate retrieval recall/precision from labeled relevant source IDs, claim-level unsupported rates, citation relevance, naturalness, language consistency or benchmark latency/cost. `intelligence-evaluation.ts` has a limited deterministic contract pass rate; it must not be presented as an AI quality score.

## 4. Synthetic benchmark dataset

`backend/test/fixtures/carteio-quality-benchmark.v1.ts` defines **72** deterministic scenario records. Each record has an ID, category, customer question, optional previous turns, required knowledge/tool, synthetic authoritative evidence with source ID/type and snapshot freshness, expected factual result, expected conversation behavior, failure conditions and severity.

All merchant names, prices, policy terms, contact details, source IDs and dates are synthetic (`Cedar & Loom`, `cedarloom.example`, and `synthetic:*`). They are controlled fixture facts only. They do not represent an actual merchant website or its accuracy.

| Category | Scenario IDs | Focus |
|---|---|---|
| A. Business Information | `biz-hours`, `biz-email`, `biz-phone`, `biz-address` | Exact hours, contact and address |
| B. Product Search | `prod-cheap`, `prod-no-match`, `prod-multi`, `prod-empty` | Matching, no-match and unsupported attributes |
| C. Product Variants and Prices | `variant-black`, `variant-blue`, `variant-sku`, `variant-live-stock` | Variant-level facts, currency, SKU and live boundary |
| D. Shipping and Returns | `ship-threshold`, `ship-fee`, `ship-time`, `ship-international` | Conditions, thresholds and time windows |
| E. Website Knowledge Accuracy | `web-care`, `web-unsupported`, `web-page-scope`, `web-contact-link` | Source text, unsupported inference and URL/contact facts |
| F. Multiple-Source Reasoning | `multi-shipping-return`, `multi-refund`, `multi-product-shipping`, `multi-no-unsupported` | Combining facts and preserving qualifiers |
| G. Hindi and Hinglish | `hi-policy`, `hi-price`, `hi-shipping`, `hi-contact` | Language consistency with English source evidence |
| H. Follow-Up Questions | `follow-black`, `follow-cheaper`, `follow-return`, `follow-ambiguous` | Reference resolution, constraints and clarification |
| I. Session Memory | `session-preference`, `session-refresh`, `session-isolation`, `session-correction` | Current-session preference, refresh and correction |
| J. Repeated Questions | `repeat-answer`, `repeat-rephrase`, `repeat-challenge`, `repeat-no-loop` | Consistency, correction and repetition |
| K. Missing Information | `missing-stock`, `missing-size`, `missing-policy`, `missing-delivery-pin` | Unknown data and uncertainty |
| L. Unsupported Claims | `unsupported-waterproof`, `unsupported-discount`, `unsupported-founder`, `unsupported-contact` | Unsupported product/business claims |
| M. Contradictory Evidence | `conflict-policy`, `conflict-source-date`, `conflict-variant`, `conflict-contact` | Conflict detection and no arbitrary precedence |
| N. Shopify Snapshot Freshness | `snapshot-label`, `snapshot-stale-live`, `snapshot-no-sync`, `snapshot-live-tool` | Snapshot date, current/live claims and tool boundary |
| O. Business-Scope Control | `scope-business`, `scope-mixed`, `scope-medical`, `scope-personal-order` | In-scope answers, mixed requests and live personal status |
| P. Cross-Tenant Isolation | `tenant-private`, `tenant-citation`, `tenant-session`, `tenant-id-probe` | Preventing other tenant and customer data access |
| Q. Prompt Injection Attempts | `inject-user`, `inject-document`, `inject-tool`, `inject-citation` | Untrusted instructions, tool limits and citation integrity |
| R. Natural Conversation | `natural-greeting`, `natural-thanks`, `natural-clarify`, `natural-followup-chain` | Natural social answers, contextual clarification and follow-up |

The four-turn natural conversation sequence is represented across `follow-black`, `follow-cheaper`, and `follow-return`: “Show me running shoes under 2000” → “Black colour me?” → “Aur sasta?” → “Iska return possible hai?” The expected outcome preserves category, variant, price and referent constraints, retrieves catalog/policy evidence when needed, and asks a natural clarification when the reference is ambiguous. No product, price, stock or policy fact may be invented.

### Real merchant evaluation template

Before a real baseline is built, the merchant must approve a specific test website and exact test facts. `MerchantBenchmarkApproval` in the fixture formalizes the required inputs: merchant ID, explicit test website, approved source IDs, exact fact text with optional effective/expiry times, approver identity/time and a permitted test session. A real-world case should additionally record the captured source version/hash, retrieval date, expected atomic claims, supported language, and whether Shopify evidence is a snapshot or an explicitly authorized live response. No website is crawled and no store is synchronized as part of Phase 03A.

## 5. Metrics and scoring definitions

Scores are reported independently by dataset version, category, language, severity, source type and evaluation method. Do not collapse them into a single “intelligence” number.

| Metric | Definition | Evaluation method / caveat |
|---|---|---|
| Website knowledge coverage | Answerable approved facts with at least one indexed, authorized evidence span ÷ all approved answerable facts | Deterministic labels plus source-version audit; separate discoverability, extraction and indexing failures |
| Retrieval recall@k | Relevant labeled source/chunk IDs in top k ÷ all relevant labeled IDs | Deterministic once a human/merchant has labeled relevant IDs; stratify lexical/vector/hybrid and language |
| Retrieval precision@k | Relevant IDs in top k ÷ returned IDs in top k | Same labels; duplicate chunks are deduplicated by stable chunk ID |
| Correct source selection | Cases whose selected/cited sources include the authoritative source required by the case ÷ applicable cases | Deterministic on approved source IDs; a selected source can still be irrelevant at span level |
| Factual answer accuracy | Supported expected atomic claims correctly answered ÷ expected atomic claims | Human or adjudicated evidence-aware labels; exact structured facts can be deterministic |
| Unsupported claim rate | Answer factual claims unsupported by authorized evidence ÷ all factual claims emitted | Requires atomic claim extraction and human adjudication; omissions are reported separately |
| Citation relevance | Cited claims whose citation span entails/supports the claim ÷ cited claims reviewed | Human evidence-span review or a separately validated semantic evaluator; citation-ID validity alone is not relevance |
| Multi-turn context accuracy | Correct referent/constraint/preferences resolved ÷ applicable follow-up cases | Deterministic for exact IDs/constraints; human review for natural reference and conversational coherence |
| Language consistency | Responses judged to follow requested/observed language and script appropriately ÷ reviewed responses | Human review, stratified by Hindi script, Romanized Hindi, Hinglish and code-switching |
| Tool selection correctness | Cases where the selected authorized tool/action matches labeled need ÷ cases requiring a tool decision | Deterministic for tool identity, arguments and authorization outcome; do not score unneeded tool calls as correct |
| Natural conversation quality | Human rubric dimensions (relevance, clarity, tone, repetition, useful clarification) per response | Human-reviewed ordinal dimensions with inter-rater agreement; no model-only naturalness truth claim |
| Response latency | End-to-end request duration plus stage durations; report median and p95 | Deterministic from request ID traces; distinguish provider, retrieval, tool and persistence time |
| Token usage and estimated cost | Provider-reported input/output tokens; cost = tokens × approved provider/model rate card ÷ 1,000,000 | Token counts from usage metadata; estimated cost is null unless a dated explicit rate card is supplied. No live price lookup here. |

`backend/test/fixtures/quality-metrics.ts` implements offline source recall/precision/hit rate, labeled claim support/unsupported ratio, binary check ratios, percentile and explicit-rate-card cost arithmetic. These functions do not label claims or produce model outputs. Human labels remain the source of truth for semantic metrics.

### Deterministic versus reviewed evaluation

Deterministic checks include exact product price/currency/SKU/contact/URL values when typed evidence is available, source-ID authorization, exact query and tool contracts, known numeric facts, trace stage outcomes, latency, tokens and status persistence. Retrieval precision/recall are deterministic only after relevance labels exist. Product description, compatibility, policy-condition interpretation, claim entailment, tone, naturalness, language quality and ambiguous references require human review or an independently validated model-assisted process. A model grader can assist triage, but must be calibrated against human labels and reported separately; it is not ground truth.

## 6. Retrieval and source evaluation

Use a frozen, merchant-approved test corpus with source/chunk IDs, version/hash, language, source type, effective dates, authorization state and atomic fact spans. For each question, label all relevant evidence IDs and at least one authoritative evidence span. Measure recall@k and precision@k before answer generation, then separately measure whether selected evidence reached the provider input. Track hybrid, lexical fallback and vector-enabled runs distinctly; never interpret retrieval candidate count as relevance.

Record the retrieval query plan, authorized candidate IDs, ranked IDs, selected IDs, evidence truncation counts and source versions in a local evaluation artifact. Keep query text and evidence excerpts out of general production logs; the evaluator may use synthetic local fixtures or merchant-approved isolated review artifacts under the relevant data rules. Compare source selection to labels, then inspect misses as crawl/discovery, extraction, indexing, embedding, authorization, retrieval ranking or context-budget failures. A source reference in the final answer is not a substitute for this trace.

## 7. Grounding coverage by claim type

| Claim type | Phase 02 deterministic coverage | Additional evaluation needed |
|---|---|---|
| Structured product facts | Some explicit prices/currencies, exact SKU, explicit stock-state fields and snapshot freshness | Product identity, correct variant joins, option/color/size association, field completeness and snapshot-to-answer claims |
| Numeric claims | Numeric values and selected recognized units are compared against cited paragraph evidence | Number words, localized units, dates, qualifiers, comparisons, ranges and false positives on identifiers/sizes |
| Prices and currencies | Explicit currency/amount pairs compared against cited text or commerce structured records | Discounts, ranges, tax/shipping totals, price interpretation, variant association and locale formatting |
| SKUs | Explicit `SKU:` claims compared with structured catalog SKU | SKU mentions without the label and identity joins across variant/product data |
| Contact information | Emails, labeled phone numbers and URLs checked against cited text/locator | Unlabeled numbers, hours/contact-role relationship, link redirection and source precedence |
| URLs | Explicit URL checked against cited locator/excerpt | Link destination behavior and whether the URL answers the user’s question |
| Shipping thresholds | Numeric values/units may be caught if citation is in the paragraph | Eligibility conditions, region, cart total semantics, exclusions and threshold inclusivity |
| Return durations | Numeric values/units may be caught | Start date, item condition, exceptions, final sale/personalized exclusions and conflicting policy versions |
| Product descriptions | Not semantically entailed | Human labeled claim-to-source spans; test negated/absent attributes and paraphrases |
| Product compatibility | Not covered | Human expert review; unsupported medical/electrical/fit/compatibility claim cases |
| Policy conditions | Numeric checks only; condition graph is not validated | Atomic rule/exception labels and claim-level entailment review |
| Multi-source factual synthesis | Existing plan can expose aspects/conflict references; individual measurable facts can be checked | Verify each atomic clause’s source, qualifiers, joins and conflict resolution; human review required |

Unsupported natural-language claims should be assessed with a two-part evidence-aware rubric: (1) decompose each response into atomic factual claims and label merchant-specific versus conversational claims; (2) for each merchant claim, record authorized supporting/contradicting source spans and verdict `SUPPORTED`, `CONTRADICTED`, `UNSUPPORTED`, `INSUFFICIENT`, or `CONFLICTED`. A reviewer must be able to trace each verdict to source ID/version/span. This phase does not add a paid secondary LLM verifier and does not replace Phase 02 deterministic checks.

## 8. Natural conversation and multilingual evaluation

Evaluate each multi-turn sequence from the same authorized session and also from a fresh session. Preserve the exact transcript and expected resolved constraints in the local test fixture, but never pull another customer’s session. Cases should verify that the model: (a) resolves “Black colour me?” to the most recent running-shoe request, (b) preserves the shoe constraint for “Aur sasta?”, (c) searches/uses product and policy evidence for “Iska return possible hai?”, and (d) asks which product when “iska” has multiple plausible referents.

For session memory, distinguish recent authorized message history from durable memory. Evaluate refresh/reopen continuity against the actual persisted session behavior and bounded latest turns. Do not assume preferences survive expired/replaced sessions or implement durable memory in this phase. Include correction tests where the latest user correction supersedes prior context. Include repetition tests for consistent facts without unnecessary verbatim looping.

The fixture includes English, Hindi and Hinglish, including Hindi script and Latin-script phrases. Score language consistency separately from factual correctness: the correct English source fact can support a Hindi answer, but a correct fact in the wrong requested language is a language failure. Human reviewers should judge language naturalness; deterministic checks should only enforce explicit language/format contracts.

## 9. Error-origin attribution

For a failing answer, join the request ID to Phase 01 request/stage traces and the answer’s evidence identities (source/chunk/version/hash). Follow the path: crawl/discovery → extraction → indexing → embedding (or explicit lexical-only skip) → retrieval → source ranking → history selection → prompt/context assembly → tool selection/execution → model generation → response verification/fallback → persistence. At each stage, attach a safe trace/event ID and the expected artifact: discovered page, extracted text/version, indexed chunk, embedding status, candidate/rank, selected history counts, provider-input byte/token estimate, authorized tool decision, provider outcome, validator result, or persisted message ID/status.

`attributeEarliestFailure` in `quality-metrics.ts` reports the first failed stage only when each earlier stage has explicit `PASS` or `SKIPPED` evidence. A missing earlier trace makes the result `UNKNOWN`; it never guesses from the final answer. Optional stages (for example embeddings on a lexical-only path) must be explicitly marked `SKIPPED`. Request IDs cover a conversation request; ingestion may have separate job IDs, so connect it through source version/hash and job references. If that join cannot be proven, keep the earlier ingestion stage unknown.

The existing Phase 01 trace provides request IDs and safe orchestrator stage diagnostics for the conversation pipeline. It is not a complete end-to-end crawl-to-answer trace; indexing/embedding/crawler telemetry must be correlated through source/job metadata, and any absent event is a diagnostic gap rather than proof of success.

## 10. Fixtures and helper changes

- `backend/test/fixtures/carteio-quality-benchmark.v1.ts` — 72 synthetic scenarios, all requested categories, synthetic merchant evidence, prior turns, expected results/behavior, failure conditions and severity; also includes a merchant approval/template type.
- `backend/test/fixtures/quality-metrics.ts` — offline retrieval metrics, labeled claim support rate, binary check rate, percentile, cost arithmetic with explicit rate card, and conservative earliest-stage attribution. Test-only; no runtime imports.
- `backend/test/quality-benchmark-fixtures.spec.ts` — checks scenario completeness/category coverage, observable wrong retrieval outcomes, factual support rate arithmetic, cost guard and `UNKNOWN` attribution when trace evidence is incomplete.
- `docs/ai-audit/CARTEIO_AI_PHASE_03A_EVALUATION_FOUNDATION.md` — this design and readiness report.

No production service, database schema, frontend contract, provider, crawler, retriever, Shopify path, environment file or dependency was changed. No tests were run.

## 11. Missing coverage and tests pending

The 72 fixture cases are evaluation specifications, not 72 executed end-to-end tests. The added test spec validates fixture shape and offline metrics; it does not invoke provider models or production orchestration. Before claiming real answer quality, adapt cases into authorized local integration tests with mocked retrieval/provider adapters, then run the approved suites.

Highest-priority missing runtime tests:

1. Widget history overflow through the complete widget/support-message path, including newest follow-up retention and single current-message inclusion.
2. Exact message/byte bounds, Unicode truncation, incomplete turn handling and current-message overlap/idempotent replay.
3. Grounded validator false-positive/false-negative matrix for size/date/identifier numbers, currency formats, stale snapshots without sync dates, unrelated citations and natural-language unsupported claims.
4. Rejected-answer fallback language, response contract and persistence behavior; successful persistence has not been exercised for the new verifier path.
5. Tool selection/permissions for knowledge and Shopify snapshots alongside no-live-tool cases.
6. Tenant/session isolation across both widget and Playground for histories, evidence references, stored citations and evaluation artifacts.
7. Retrieval gold labels and source-ranking measurement against a frozen corpus; no relevance benchmark is currently executed.
8. Human-reviewed accuracy, citation-span relevance, naturalness and Hindi/Hinglish consistency; no live-provider baseline exists.

All Phase 02 regression specs and this fixture spec remain **pending execution**. No builds, typechecks, test commands, external provider calls, website reads or Shopify synchronization were performed.

## 12. Improvement priority matrix

Complexity/security/compatibility are relative planning judgments based on source inspection, not measured estimates.

| Rank | Subsystem | Evidence of defect / likely effect | Complexity | Security impact | Compatibility risk | Required verification |
|---:|---|---|---|---|---|---|
| 1 | Retrieval and reranking | Hybrid path exists, but no gold-label recall/precision; bounded context and multilingual relevance can miss qualifiers. Highest leverage after baseline instrumentation. | Medium | Medium: tenant filters must remain invariant | Medium | Frozen corpus; recall/precision, source span and truncation review by language |
| 2 | Claim-level verification | Phase 02 covers selected typed facts only; qualitative entailment and policy conditions remain open. Direct hallucination prevention potential. | High | High: evidence authorization and privacy | Medium/High: false rejection/fallback risk | Human-labeled atomic claims, contradiction/unsupported set, false accept/reject rates |
| 3 | Website crawling and indexing | Existing audit identifies bounded discovery/extraction and text-forward indexing; facts absent upstream cannot be retrieved. Need corpus coverage evidence before algorithm changes. | Medium/High | Medium: source URL and ingestion controls | Medium | Approved websites, expected-page recall, extracted spans, indexed version/hash coverage |
| 4 | Conversation memory | Phase 02 corrects recent bounded history, but only recent turns are retained; no proven durable preference state. | Medium | High: session/tenant retention | Medium | Long conversation, reopen, expiry, session isolation and ticket 72-hour retention tests |
| 5 | Agent tool selection | Existing hybrid deterministic routing plus model-selected allowlisted search tools; no broad defect shown, but tool decision accuracy needs benchmark. | Medium | High: server allowlist/permissions | High | Labeled tool-needed/not-needed tasks, permission denial and bounded loop tests |
| 6 | Natural response generation | No measured human quality baseline; safe fallbacks can feel repetitive, but no current systematic failure evidence. | Medium | Medium | Medium | Blind human rating for relevance, language, tone, repetition and clarification; factual labels held constant |

Recommended next improvement is **retrieval/reranking evaluation first**, not an unmeasured rewrite: the system can only ground what reaches its bounded context, and the repository currently has no labeled retrieval quality baseline. In parallel, collect an atomic-claim benchmark so Phase 03B can scope semantic verification based on observed false accepts and false rejections.

## 13. Approval needed for an actual baseline

Before any live or merchant-specific baseline run, obtain explicit approval for the merchant/test website, approved source facts, test account/session, permitted provider/model, data handling and test window. If testing a live provider, approve the associated cost/latency and ensure no customer information is included. Shopify baseline tests must use an already authorized synthetic/test store and must not synchronize or expand scopes without separate approval. Phase 03A did none of these operations.

## 14. Proposed Phase 03B scope

1. Run approved Phase 02 unit and integration regressions without changing production behavior; fix verified defects only.
2. Adapt synthetic fixtures to mocked provider/retrieval execution and add full widget history ordering and persistence outcomes.
3. Establish a frozen synthetic retrieval corpus with labeled relevant source/chunk IDs, relevant spans, stale/conflicting/absent facts, tenant authorization labels and multilingual queries; report recall@k/precision@k by language and retrieval mode.
4. Collect a merchant-approved fact set and human-reviewed reference answers/atomic claims before any real website or provider test.
5. Measure claim-level supported/contradicted/unsupported outcomes and validator false accept/reject behavior; design any semantic verifier only after this evidence, with explicit approval before paid calls/dependencies.
6. Publish separated scorecards and request-ID failure attribution. Keep unobserved stages `UNKNOWN` and report dataset limitations.

Phase 03A ends here. Phase 03B has not started.
