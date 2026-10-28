# Carteio AI Phase 01 — Source Grounding and Diagnostic Foundation

**Review date:** 17 October 2026  
**Method:** static inspection of the current Carteio source and repository audits. No provider was called; no database, deployment, or external service was contacted. Tests were added but not run.

## 1. Current Carteio AI execution flow

### Customer widget path

1. `requestIdMiddleware` accepts a UUID shaped `x-request-id` or creates one, and returns it as `X-Request-ID`. `WidgetController` routes the widget message to `WidgetService.message`.
2. `WidgetService.session` validates the widget session and token and resolves its organization, assistant, conversation, and visitor. Origin, allowed domain, active assistant, and rate limit checks occur before inference.
3. `WidgetService.message` passes the resolved organization/assistant/visitor session, idempotency key, message, abort signal, and request ID to `SaasService.recordCustomerMessage`.
4. `SaasService` persists the customer message, then calls `ConversationOrchestrator.processTrustedCustomerTurn`. That method rechecks the organization, assistant, conversation, hashed visitor-session identity, and persisted customer message. It serializes turns with an active-request lease and returns an existing AI response for an idempotent replay.
5. The orchestrator loads up to 40 recent support messages, pairs AI responses to prior customer turns, then bounds prompt history to the newest 12 messages and 16 KiB. Widget and Playground conversations use the same `executeSharedAI` pipeline, while persistence stays in their respective adapters.
6. Provider configuration and approved fallback routes are validated. A constrained model interpretation and deterministic guards decide whether to handle social messages, policy/scope questions, clarification, tickets, or business questions. Language and response style are selected from validated interpretation, assistant settings, and recent turns.
7. Business questions use `buildRetrievalQueryPlan`, retaining the original query and allowing validated variants. `KnowledgeProcessingService.searchPreview` applies organization, assistant/base assignment, source visibility, active-index, source state, and connector-permission filters. It combines PostgreSQL lexical retrieval and optional vector retrieval with reciprocal-rank fusion; if vectors are unavailable, lexical-only search remains available. Shopify product evidence is queried from the authorized synchronized commerce records for product-intent turns.
8. Evidence is revalidated, capped to five items by default and 32 KiB, and each excerpt is capped at 1,600 characters. The model can also call `search_business_knowledge` and, when authorized, `search_store_products`. The server validates tool names/arguments and permissions; the loop allows at most five executions and three reasoning rounds, with a bounded tool timeout.
9. `ConversationProviderService` calls the configured provider/model with a bounded input (96 KiB) and timeout. Native tool calls may continue the turn. The response is checked for valid evidence references, unsupported numeric tokens, conflict citations, and unsupported personal-status claims. This checks citation identity and selected safety conditions; it does **not** prove claim-level entailment. The grounded-answer plan explicitly leaves entailment unverified.
10. Current source/version/hash/assignment authorization is checked again. The final response, answer origin, response category, provider/model metadata, and source references are persisted transactionally. Widget responses retain the existing transport shape and 72-hour ticket-linked conversation retention behavior.

### Playground path

`AssistantController.playgroundChat` passes the authenticated user/workspace/assistant plus request ID to `ConversationOrchestrator.playgroundChat`. Membership and assistant ownership are checked before an organization-scoped Playground session is resolved. Idempotent replay is supported. The request then enters the same shared AI pipeline and is saved to Playground conversation/message records.

## 2. ChatterMate reference comparison

The comparison uses `docs/CHATTERMATE_COMPLETE_AI_SYSTEM_ARCHITECTURE.md`, which is a static audit of ChatterMate commit `a2582a143c7a84024f2f0f5418b388dbf1cc9a15`.

| Pattern | ChatterMate report | Carteio source today |
|---|---|---|
| Tool registration and selection | Python Agno agent registers tools; the model selects among tools exposed for that run. App code controls eligibility and call limits. | NestJS orchestrator exposes two native model tools (`search_business_knowledge`, `search_store_products`) under server eligibility checks. It also runs pre-retrieval and source-routing logic before generation. Hybrid decision system; no new engine is needed for Phase 01. |
| Prompt separation | Code-owned grounding/guardrail instructions are assembled with agent/workflow instructions and context. | Orchestrator builds code-owned task prompts from assistant configuration, interpretation, evidence, and business rules. The distinction exists in code, but is distributed across branches and prompt templates rather than represented as a standalone prompt contract. |
| Bounded history | Agno history is bounded by response count and character budget; old tool results are stubbed; overflow gets one retry without history. | Persisted history is filtered and capped to 12 messages / 16 KiB. No summary or separate durable preference memory is implemented. Widget continuity uses durable support messages and session ownership. |
| Knowledge retrieval | Agent-filtered vector-only lookup, no explicit query rewrite, reranker, relevance threshold, or deterministic refusal based on score. | Tenant and assistant scoped hybrid FTS plus optional vectors, validated query variants, RRF merge, bounded context, revalidation, and lexical fallback. Keep this existing hybrid path. |
| Conversation and model session | Separate chat transcript and encrypted Agno session storage. | Playground uses `PlaygroundConversation`/`PlaygroundMessage`; widget uses `SupportConversation`/`SupportMessage`. There is no separate model-session database: the bounded model history is reconstructed from authorized messages. |
| Structured response | `ChatResponse` constrains response/action shape; it does not guarantee factual correctness. | Typed provider result and validated interpretation, response category, provenance and citation metadata. The response contract is stricter at some boundaries, but citation checks remain short of entailment verification. |
| Limits and timeouts | Report documents a default five tool-call limit, 90-second agent timeout, and overflow retry. | Five tool executions, three reasoning rounds, 6-second bounded tool operation timeout, 25-second provider call cap, and 52-second request deadline. |
| Shopify | Opt-in live GraphQL product and order tools. The report flags the public model's token storage as string/plaintext in inspected source. | OAuth credentials use the existing connector credential vault, granted scopes and data permissions. AI product lookup uses synchronized catalog snapshots, not a live per-question Shopify read. This is safer separation but may be stale; do not describe snapshot data as live. |
| Guardrails/grounding | Prompt and input/output guardrails; no deterministic evidence entailment verifier established by the audit. | Tenant authorization, source revalidation, citation-ID checks, numeric token checks, conflict citation checks and selected claim safety checks. Semantic entailment and full condition/claim verification are absent. |

ChatterMate's vector-only search and weaker documented source verification are not improvements for Carteio. Do not copy its Python/Agno architecture or replace Carteio's hybrid retrieval.

## 3. Existing functionality preserved

- NestJS/TypeScript provider adapters and the shared widget/Playground orchestrator.
- Tenant, assistant, visitor-session, source-assignment, visibility and connector-permission checks.
- Hybrid lexical/optional vector retrieval, RRF, query planning, source revalidation and bounded evidence assembly.
- Shopify OAuth/vault/scope/permission controls and synchronized catalog search.
- Existing response, widget, persistence, idempotency, ticket workflow and retention contracts.
- Language selection, social intent handling, business scope checks, clarification rules and repeated-request detection.
- No database tables, migrations, dependencies, environment changes, crawler changes or retrieval-algorithm changes were introduced.

Ticket-linked conversations and their associated ephemeral records continue to expire under the existing 72-hour ticket retention worker. This phase did not add any new memory store.

## 4. Confirmed gaps relevant to wrong replies

1. **Claim-level grounding is not verified.** The response check confirms that at least one known evidence reference is cited, rejects unknown references, checks certain numeric strings, and requires conflict citations. It does not determine whether every factual claim follows from cited evidence, whether qualifiers apply, or whether two prose facts contradict. `grounded-answer-plan.ts` explicitly retains `entailmentVerified: false`.
2. **Shopify is a synchronized snapshot path.** Freshness and staleness metadata exist, but there is no per-turn live Shopify product/order read in the current conversation tool manifest. Price, availability, variant and order answers can be wrong when the snapshot is old or lacks the relevant field; customer order authorization is not provided merely by a widget session.
3. **Website data can be missing or flattened before retrieval.** Existing audits confirm bounded discovery/crawl, text-centric chunks, optional rendering, and no typed structured website product projection. Missing source facts cannot be fixed by prompt changes.
4. **Retrieval/context are bounded.** Top-k, source diversity, excerpt, and total context caps can omit a useful policy qualifier or lower-ranked corroboration. FTS is language sensitive; cross-language coverage depends on indexed vectors and their availability.
5. **Conversation memory is recent-history only.** The 12-message/16 KiB window supports continuity, but there is no durable structured state for product constraints, corrections, preferences, or selected references. Older facts can drop out.
6. **Widget history ordering has a confirmed truncation defect.** `processTrustedCustomerTurn` loads at most 40 rows newest-first, then sorts the retained paired turns oldest-first and stops once 12 messages/16 KiB are reached. When more than 12 paired messages are in that fetched set, this keeps the oldest of those fetched turns and can omit the most recent follow-up. Playground history separately takes the latest 12 and reverses after bounding. This asymmetry can directly break product/policy references in widget conversations and should be fixed first in Phase 02.
7. **The runtime uses a hybrid route with overlapping retrieval.** Pre-retrieval, commerce snapshot lookup, and model-selected tools coexist. Current traces count operations, but did not previously make history truncation, selected source IDs, serialized provider-input size, and one end-to-end outcome directly observable together.
8. **Naturalness can be reduced by safe deterministic fallbacks.** This is a tradeoff visible in the code; the repository has no controlled end-to-end answer evaluation demonstrating how often it causes unnatural or repetitive replies.

These are code-supported explanations and risks, not proof that any one caused a particular customer reply. Confirming a root cause requires request-level trace review against the original source and answer.

## 5. AI decision and knowledge flow verification

### Decision mechanism

The architecture is **hybrid**. Deterministic social classification, validated intent interpretation, scope/source routing, capability checks, and clarification guards execute before the answer model. Business turns run authorized knowledge retrieval; product-intent turns also query authorized commerce snapshots. After evidence is assembled, the provider may select the two exposed search tools. Tool execution remains server-side allow-listed, tenant-scoped and permission-checked. Ticket drafts/status actions follow explicit code paths and ticket confirmation rules. Unrelated/out-of-scope requests can be redirected or declined through deterministic guards. There is no general-purpose agent planner, and this phase does not replace the tool engine.

Recommendations for a future decision engine: treat model output as a request for a capability, never as authorization; retain server-side allowlists and per-tenant permissions; pass explicit freshness/source authority into planning; prevent repeated identical tool calls; define when a missing field requires clarification; and measure tool selection against deterministic fixtures before rollout.

### Knowledge path

Website content is crawled and indexed as pages/chunks in existing knowledge tables. Search is invoked from `executeSharedAI` for business questions and from the model-callable knowledge tool. `searchPreview` constrains eligible sources by organization, assistant assignment/base, source state, active generation, visibility and connector permission. It returns lexical-only results if embeddings are unavailable; when vectors exist it merges lexical and semantic results. The orchestrator truncates each excerpt and selects bounded evidence before provider input. It revalidates current source identity/version/hash before returning a cited answer.

The runtime logs whether retrieval ran, candidate counts, eligible sources and a bounded set of source/chunk UUIDs. It does not log retrieved text. A high candidate count does not mean the evidence was relevant, and source IDs do not prove the excerpt contained the required fact. The existing response validator is not an entailment checker. Missing facts can originate in discovery, extraction, indexing, retrieval ranking, context budgeting, or model reasoning; the new trace helps locate the stage but does not itself correct content.

## 6. Actual diagnostic code changes

The existing request-ID middleware, structured HTTP logging, provider diagnostics and `ConversationStageEvent` tracer were reused. The orchestrator already emits authorized stage start/completion/failure events, model/provider outcomes, retrieval/evidence counts, tool outcomes, citation validation, persistence stages, and response-safety outcomes.

This phase adds:

- `conversation_request_received` and `conversation_request_completed` events keyed by request ID, with tenant/assistant/channel metadata, outcome/error category, retrieval-attempt flag, and total latency.
- `conversation_history_loaded` with loaded/included message counts, bounded context bytes, truncation flag, and configured limits. It never includes message content.
- `conversation_retrieval_candidates` with eligible source count, candidate count, commerce candidate count, and up to five validated source/chunk UUIDs. It never includes queries or excerpts.
- `conversation_model_input` with serialized input byte count, rough token estimate, message count, input bound and tool count. It never includes prompt content.
- Tool availability names and per-call success/denial/timeout/failure, result count, and duration. Tool arguments and results are not logged.
- A pure metadata helper with tests for bounded history reporting and source-ID validation/redaction.

No customer-visible response logic or API contract changed. No actual claim validator was added; the logs continue to distinguish citation/safety validation from verified entailment.

## 7. File-by-file change list

- `backend/src/modules/workspaces/conversation-orchestrator.service.ts` — emits the additional request, history, retrieval, model-input, and tool metadata events.
- `backend/src/modules/workspaces/conversation-diagnostics.ts` — provides safe, bounded history and source-ID metadata helpers.
- `backend/src/modules/workspaces/conversation-diagnostics.spec.ts` — deterministic unit cases for truncation metadata and safe UUID source identifiers.
- `docs/ai-audit/CARTEIO_AI_PHASE_01_FOUNDATION.md` — this source-grounded findings and follow-up report.

The workspace contains other pre-existing modified and untracked files. They were not part of this task's change list and were left untouched.

## 8. Security and privacy considerations

- Logs use the server-created/validated request ID and organization/assistant identifiers so authorized operators can correlate events. No new customer-facing trace endpoint or database storage was added.
- Message text, prompt content, retrieved excerpts, tool arguments/results, API keys, Shopify tokens, visitor IDs, emails and other personal data are excluded from the new metadata events.
- Retrieval IDs are UUID-validated and capped at five; tool names come from the two declared tools; counts, bytes and durations are bounded numeric metadata.
- Existing source retrieval and persistence continue to include organization predicates. The application does not provide tenant customers access to backend logs. Log-sink authentication, retention and per-tenant operator access are deployment controls outside this repository; the source cannot verify those controls. Do not expose raw backend logs in a tenant dashboard.
- Existing provider logging continues to record provider/model/stage and safe error categories; this phase does not log request/response bodies or credentials.

## 9. Regression coverage created; not executed

The new diagnostic spec covers history truncation and rejection/capping of non-UUID source identifiers. Existing repository tests already cover widget customer message persistence, authorized tenant-scoped retrieval contracts, provider failures/timeouts, tool/response behavior, session history, and ticket retention. No tests were run per instruction.

Focused cases to run after approval:

| Case | Expected diagnostic evidence |
|---|---|
| Normal message | request received/completed; provider/model stages; persistence outcome; total latency |
| Knowledge lookup | retrieval attempted; eligible/candidate counts; bounded source identifiers; evidence count |
| Shopify product request | authorized commerce candidate count; tool availability/selection and safe result count |
| Missing knowledge | retrieval attempted with zero candidates, or explicit not-attempted flag for deterministic social path; safe fallback stage |
| Model timeout | provider timeout category, failed/timed-out generation, request outcome and latency |
| Tool failure | allow-listed tool name, failure/timeout outcome, duration; no arguments or result content |
| Session history handling | loaded/included counts, byte size, truncation flag; existing session history test remains green |
| Cross-tenant isolation | retrieval/session predicates stay organization scoped; no source IDs from another organization |
| Sensitive data redaction | message/prompt/token/email content absent; malformed source identifiers dropped |
| Response persistence | persistence stage success/failure correlates to request ID without reply content |

No builds, test commands, external AI calls, development servers or migrations were run.

## 10. Remaining problems

- There is no claim-by-claim semantic entailment verifier. Current validation must not be labeled as proof of grounding.
- There is no live per-question Shopify product/order read; snapshot freshness can affect commerce answers.
- Current website ingestion is text-forward and bounded; a published index can still lack important pages or structured product attributes.
- Retrieval quality and naturalness have no measured production evaluation in this change. Diagnostics show where to inspect, not whether a result is semantically relevant.
- Structured long-term preferences and conversation summaries do not exist. Existing bounded history may forget older constraints.
- Per-tenant trace access controls are not exposed in application code because traces remain in backend logs. The deployment log sink must enforce operator access and retention.

## 11. Phase 02 implementation plan

Ranked by demonstrated gaps in current source:

1. **Claim-level grounding and source authority.** Add deterministic claim extraction for dates, prices, availability and conditions, then a verifier tied to cited evidence with supported/unsupported/ambiguous outcomes. Keep response provenance honest and fail closed for unsupported commerce claims. Files: `grounded-answer-plan.ts`, new `grounding-verification.service.ts`, `conversation-orchestrator.service.ts`, contracts/specs.
2. **Retrieval relevance and missing evidence diagnosis.** Build a fixed multilingual benchmark from merchant-approved facts; capture expected evidence IDs and score retrieval/context recall before changing ranking. Tune aspect-to-evidence selection and chunk/context budgets only against measured misses. Files: `intelligence-evaluation-datasets.ts`, `intelligence-evaluation.ts`, `knowledge-processing.service.ts`, `knowledge-context-builder.ts`, `conversation-orchestrator.service.ts`.
3. **Shopify freshness and product intelligence.** Make source/as-of/freshness explicit for each field. Add live reads only where granted scopes and assistant permissions authorize them, with bounded arguments/timeouts and customer identity checks for order data. Retain the current snapshot fallback and label it accurately. Files: `connectors/shopify.adapter.ts`, `commerce-read-contracts.service.ts`, `conversation-orchestrator.service.ts`, connector permission tests.
4. **Tool decision quality.** Evaluate the current hybrid pre-routing plus model tool selection against fixtures; then add typed server-side query plans and duplicate-call suppression if misses show the model selects wrong tools or arguments. Files: `conversation-intent.ts`, `business-source-router.ts`, `conversation-orchestrator.service.ts`, commerce/knowledge contract tests. Do not introduce another orchestration framework without evidence.
5. **Conversation memory and history ordering.** Correct widget history selection to retain the newest whole turns under the existing 12-message/16 KiB limits, then add a regression fixture for follow-up references. Measure whether older constraints still need structured session state; only then consider tenant/session-scoped, expiring state derived from customer claims and validated tool outputs. Preserve ticket-linked 72-hour retention. Files: `conversation-orchestrator.service.ts` (widget history assembly), `conversation-context.ts`, and only if proven necessary `schema.prisma` plus a migration.
6. **Natural answer generation.** Use labeled customer conversations to measure repetition, overlong replies, missed language/script matching, and unnecessary clarification. Add response repair/planning after grounding is reliable, without randomness or unsupported paraphrase. Files: `conversation-orchestrator.service.ts`, `conversation-context.ts`, response evaluation fixtures.

Stop here for Phase 01. Phase 02 requires a separate implementation request.
