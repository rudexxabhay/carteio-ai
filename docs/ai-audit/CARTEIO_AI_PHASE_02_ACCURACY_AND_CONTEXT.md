# Carteio AI Phase 02 — Accuracy and Conversation Context

**Date:** 17 October 2026  
**Scope:** correct bounded conversation history selection and add deterministic, evidence-linked response checks in the existing NestJS pipeline.  
**Verification:** source inspection only. Test code was written but not run. No provider calls, builds, migrations, installs, synchronization, or deployments were performed.

## 1. Executive summary

Phase 02 fixes the confirmed widget history selection defect. History is now grouped into user/assistant turns, selected newest-first within the existing message and byte limits, and returned in chronological order. The current customer input remains a separate model message and is not copied into prior history. Oversized prior messages are clipped with an explicit marker rather than silently dropping the newest message.

The existing response verification stage now validates measurable claims against the cited source references. It checks cited numeric values and units, currency/amount pairs, URLs, contact details, structured SKUs, and explicit Shopify availability statements. Stale Shopify snapshot values need a freshness label and the recorded sync date. Explicit live/current claims backed by synchronized catalog evidence are rejected.

These checks are deterministic and deliberately partial. They do not prove semantic support for ordinary prose, identify every product name/variant assertion, or resolve all policy conditions. No paid model verifier or dependency was introduced. Existing fallback generation, language selection, response contracts, source authorization, provider routing, hybrid retrieval, Shopify integration, persistence, and ticket retention remain in place.

## 2. Original history bug and root cause

In `ConversationOrchestrator.processTrustedCustomerTurn`, the code loaded up to 40 recent widget messages newest-first, paired AI messages with earlier customer messages, sorted those pairs oldest-first, then appended them until reaching 12 messages or 16 KiB. Since it stopped at the first overflow, it selected the oldest qualifying messages from the fetched window and could omit a newer customer follow-up.

Playground history had a separate path: it loaded the latest 12 messages newest-first and reversed them for chronological prompt order. The two paths therefore used inconsistent selection logic.

The customer message currently being answered is already excluded from widget prior history by its idempotency key. Playground history is loaded before the current turn is committed. The current customer message is supplied separately to the answer model.

## 3. Exact history correction

`selectBoundedHistory` in `conversation-diagnostics.ts` now:

- Accepts only the prior turns already authorized and assembled by the caller.
- Groups adjacent user and assistant messages into complete turns where available.
- Selects from the newest group backward under the existing 12-message and 16 KiB budgets.
- Stops at an older group that cannot fit instead of skipping newer context to include stale history.
- Restores chronological order before model submission.
- Preserves the newest customer message if a newest group cannot fit whole; an oversized user message keeps its ending, while an oversized assistant message keeps its beginning. Both receive an omission marker.
- Reports loaded/included/dropped counts and content truncation metadata through the Phase 01 structured logs.

Both widget and Playground history now use this helper. The widget's source query, tenant/session predicates, idempotency checks, active-request lease, session refresh behavior, and message persistence are unchanged. The final grounded-answer prompt sends the exact current input as one user message; the textual question fields are omitted from the prompt's answer-plan metadata so that the current input is not repeated there. A resolved reference remains understandable from bounded prior turns and the current message.

## 4. Files and functions changed

- `backend/src/modules/workspaces/conversation-diagnostics.ts` — added `selectBoundedHistory`; retained bounded metadata helpers.
- `backend/src/modules/workspaces/conversation-orchestrator.service.ts` — applies newest-turn selection to widget and Playground history; preserves a single current user message in the final answer input; removes raw question text from the serialized answer plan; applies and logs evidence-linked response checks.
- `backend/src/modules/workspaces/grounded-response-validation.ts` — new deterministic checks used by the existing `RESPONSE_VERIFICATION` stage.
- `backend/src/modules/workspaces/conversation.contracts.ts` — adds internal verification reason codes and bounded counts; no HTTP response contract changed.
- `backend/src/modules/workspaces/conversation-diagnostics.spec.ts` — adds selection and validation cases.
- `backend/test/assistant.playground.spec.ts` — adds a provider-input regression assertion that the current message is sent once and separately from prior history.
- `docs/ai-audit/CARTEIO_AI_PHASE_02_ACCURACY_AND_CONTEXT.md` — this report.

No schema, frontend, environment, provider adapter, crawler, or retrieval algorithm was changed.

## 5. Existing functionality preserved

- Widget and Playground sessions remain scoped to the authenticated organization, assistant, user/session and channel. Existing authorization predicates and source revalidation remain in force.
- History stays bounded to 12 messages and 16 KiB; provider input remains subject to the existing 96 KiB ceiling. Current customer message size limits remain unchanged.
- Provider selection, owner-approved fallback routes, model interpretation, native tool calls and their server-side allowlists are unchanged.
- Hybrid lexical/vector retrieval, RRF, knowledge eligibility, query planning, source identity/version/hash, evidence budgeting and current revalidation are unchanged.
- Hindi, English, Hinglish, tone/style settings, deterministic social paths, natural clarification and business scope guards remain in place.
- Existing widget/API response shapes, citations/source metadata, support-ticket flows and persistence remain compatible.
- Ticket-linked conversations and corresponding ephemeral data still follow the existing 72-hour expiry worker behavior.
- Shopify remains the current tenant/assistant-permission-checked synchronized catalog path; this phase makes no API calls or sync changes.

## 6. Grounding mechanisms added or improved

The integration point is the existing `RESPONSE_VERIFICATION` stage, after model generation and current evidence revalidation but before the answer is persisted as grounded and returned. The verifier receives only evidence that the orchestrator has assembled from authorized search/tool results. Source references still use the existing turn-local `[S#]` and `[C#]` identities; unknown references are rejected.

For a claim to pass the new measurable checks, it must be associated with a known source reference in its sentence or paragraph. A citation elsewhere in an unrelated sentence cannot satisfy a numeric claim. The checker records `ACCEPTED` or `REJECTED`, a bounded reason code, count of unsupported measurable claims, count of measurable checks passed, and validation latency. It logs no claim text or evidence content.

The existing fallback remains responsible for a rejected answer. It generates a customer-language uncertainty/clarification response when possible, otherwise uses the configured safe fallback. Greetings and acknowledgments still bypass business evidence verification through existing deterministic paths.

## 7. Supported versus unsupported factual checks

| Fact type | Deterministic behavior in this phase |
|---|---|
| Numeric policy duration/threshold | Number and recognized unit must occur in cited evidence. `30 days` does not match `30 hours`. Word-number expressions such as “thirty days” are not parsed. |
| Currency and product amount | Explicitly formatted amounts are checked as a matching amount/currency pair against the cited textual evidence or structured Shopify product/variant price fields. Unknown or absent fields do not become facts. |
| Shopify snapshot freshness | A matching value from a stale structured product snapshot is accepted only when the answer labels it as a snapshot/last-synced/as-of value and includes the recorded date. Explicit live/current claims tied to catalog snapshot evidence are rejected. |
| Shopify stock state | Only explicit known states such as in-stock/out-of-stock/sold-out/unavailable are checked against structured evidence. The answer must label the status as snapshot/last-synced/as-of data; a stale snapshot requires its sync date. A generic “available” claim is not reliably classified. |
| SKU | An explicit `SKU:` claim is checked against the cited product or variant SKU. |
| Business contact | Email addresses, labeled phone numbers, and URLs are checked against cited text or the source locator. |
| Product/variant identity and options | SKU and cited product record provenance are available, but general natural-language product-name, color, size and variant relationships are not fully validated claim by claim. |
| Ordinary qualitative prose | Not semantically verified. A citation and absence of measurable contradictions do not prove that “family owned,” “best seller,” compatibility, feature, or other prose claims are supported. |
| Contradictory sources | The existing answer plan detects some numeric conflicts and requires the conflicting evidence references. It does not parse conditions or determine which conflicting policy applies. |

These checks are **partial verification**, not complete factual entailment. Unsupported claim counts only represent the listed deterministic classes.

## 8. Source provenance behavior

The verifier does not create or invent citations. It maps the answer's supplied source markers to the current authorized evidence set. Knowledge evidence retains source/chunk/version/hash/title/type/locator and any existing source authority, page timestamp and source freshness metadata. Commerce evidence retains product/connection identity, structured fields, snapshot `syncedAt`, and `stale` status in the existing bounded evidence object.

Before and after answer generation, the orchestrator revalidates current evidence identity, authorization, version/hash and content. Existing server-side tenant, assistant assignment, connector grants and data permissions remain the gate for evidence and tool results. The verifier cannot see evidence from another tenant unless an upstream authorization defect supplies it; existing source revalidation is still the primary isolation control.

## 9. Shopify snapshot handling

`CommerceReadContracts.searchCatalog` returns synchronized normalized product and variant fields under organization, assistant, connector-scope and data-permission checks. The conversation path does not have an existing live per-question product or order API tool. `stale` is computed from the synchronized snapshot age; structured evidence includes the sync time.

This phase does not claim synchronized values are live. Explicit “live/current/right now” price or stock wording is rejected when backed by snapshot evidence. Stale price claims require a visible snapshot/as-of label and sync date. Inventory/order lookup, customer-specific data, or new Shopify scopes were not added.

## 10. Regression tests created

New deterministic unit cases in `conversation-diagnostics.spec.ts` cover empty/one/within-limit history, overflow, newest-turn preservation, chronological order, repeated messages, oversized messages, exact current-message separation, cited policy durations and units, unrelated citations, structured product price/currency, missing/stale snapshot data, availability states, URLs, contact details, SKU, multi-source facts, and the explicit semantic-verification boundary.

`assistant.playground.spec.ts` now asserts that the current customer input appears once as the final user message, separately from prior history. Existing tests in that suite already cover tenant/session isolation, historical evidence authorization, session continuity, recent-history bounds, language-aware retrieval, no-result uncertainty, greeting bypass, provider failures/fallback, widget-compatible response behavior, and model-selected Knowledge tools. Existing connector tests cover authorized Shopify catalog access and permission checks.

The requested scenario inventory and existing coverage mapping:

| Scenario group | Coverage source |
|---|---|
| Policy duration correct/wrong, source attribution/unrelated citation, no evidence, conflicts, unsupported prose | New `conversation-diagnostics.spec.ts`; no-evidence and conflict flow also in `assistant.playground.spec.ts` / `grounded-answer-plan.spec.ts` |
| Product price/currency, fabricated/missing value, stale snapshot, availability | New deterministic validation cases; current provider integration remains covered by `assistant.playground.spec.ts` and `commerce-read-contracts.service.spec.ts` |
| Hindi evidence matching, Hinglish follow-up | New Hindi evidence check; existing cross-language and follow-up tests in `assistant.playground.spec.ts` |
| Overflow, newest message, ordering, no duplicate current input | New selector cases and provider-input regression in `assistant.playground.spec.ts` |
| Session continuity, cross-tenant isolation, unauthorized source reference | Existing session/source authorization cases in `assistant.playground.spec.ts` |
| Greeting without retrieval, provider timeout/invalid response, multi-source answers, response contract, authorized Shopify tools | Existing cases in `assistant.playground.spec.ts`, `grounded-answer-plan.spec.ts`, and connector contract tests |

All tests remain **unexecuted**, as requested. No build or typecheck was run.

## 11. Remaining hallucination risks

- Semantic claims without reliably extractable fields can still be unsupported despite a valid citation.
- Numeric validation does not parse number words, all date formats, conditional/exception clauses, measurements, comparative language, or every localized unit.
- Product identity, descriptive attributes, variant option applicability, shipping-region qualifiers, refunds/returns conditions and business compatibility statements are not fully claim-validated.
- The answer plan's source conflict logic is heuristic; it does not establish policy precedence or interpret all conditions.
- Search can miss relevant pages or evidence before the verifier receives it. Bounded retrieval/context can omit qualifiers, and verification cannot recover missing evidence.
- Fresh synchronized catalog information is still not a live Shopify read. A recently synced snapshot can change after synchronization; timestamp wording and staleness checks do not guarantee real-time correctness.
- The selected fallback may be less direct than a supported natural answer; the tests need to establish how often the new deterministic checks reject valid paraphrases.

## 12. Semantic verification limitations

No claim-to-evidence semantic model is included. Numeric checks, citation references, structured fields and prompt instructions do not prove that all answer sentences are entailed. Adding a model verifier would introduce cost, latency, provider availability and false-rejection risks; it would need an explicit approved design and labeled evaluation set. A future verifier must not override tenant/source permissions or report “verified” solely because a second model agrees.

## 13. Security considerations

- No new route, database table, memory store, dependency, token handling path, or source access path was added.
- Diagnostics continue to log only bounded counts, reason codes, durations and safe identifiers. They do not log messages, prompts, retrieved text, contact claims, tool arguments/results, Shopify tokens or API keys.
- Evidence identifiers are only checked after current source authorization/revalidation; unknown generated references are rejected.
- History remains scoped by the original organization/session predicates and support visitor-session hash. The selector does not accept tenant/session identity from message content.
- The output remains behind the existing evidence verification and persistence boundary. The verifier cannot authorize tool use or make a source eligible.

## 14. Expected improvements and verification criteria

No accuracy improvement or pass rate is claimed before execution. After approval, verify:

1. A widget fixture with more than 12 prior messages keeps the newest complete customer/assistant turns and retains the last product follow-up.
2. Both widget and Playground histories are chronological, at most 12 messages and at most the configured 16 KiB turn budget; an oversized prior message is visibly marked as shortened in provider input.
3. The original current message appears once in the final answer input and remains excluded from prior history; idempotent retries still replay persisted responses.
4. Correct cited numeric/unit/price/currency/URL/contact/SKU/availability values pass; fabricated values and unrelated citations take the existing safe fallback path.
5. Stale catalog facts cannot be described as live and need a sync-date disclosure; no new live Shopify call occurs.
6. Greetings, Hindi/Hinglish generation, provider fallback, tenant isolation, response contracts, tool permissions and ticket retention remain unchanged.
7. Logs correlate by request ID and contain only counts, safe reason codes and durations.

## 15. Recommended Phase 03 scope

1. Build a merchant-approved, multilingual evaluation set with atomic claims, source spans, conditions, variants and explicit unanswerable cases. Score false rejection and unsupported claim rates before widening deterministic validation.
2. Add structured claim checks only for additional fields with authoritative typed values and clear language cues; include source-specific conditions and freshness in the validator contract.
3. Evaluate context retrieval against multi-turn product/policy follow-ups and inspect trace evidence IDs before changing hybrid ranking or context budgets.
4. Design semantic claim-to-evidence verification only after the benchmark shows deterministic checks leave material unsupported prose risk. Keep it an evaluation/approval step before any model calls or new dependencies.
5. Define Shopify freshness expectations and supported read operations from current permission/scope data; retain snapshot labels until a separately approved live connector path is justified.

Phase 02 stops here. Phase 03 has not been started.
