# Carteio Pending AI Quality Roadmap

**Scope:** source review, test/fixture review, targeted offline-fixture corrections, and Phase 05 conversation-routing correction. No test or build was executed, and no provider, database, worker, website, or live service was contacted.

## 1. Status summary

“Implemented” below means code exists in this checkout. It does not mean runtime verification passed.

| Development phase | Status | Evidence and remaining work |
|---|---|---|
| 01 — AI pipeline and decision foundation | Implemented, unverified | Shared NestJS orchestration, provider routing, source/tool gates, bounded history, and structured request diagnostics exist. Tests have not run; no production response-quality baseline exists. |
| 02 — Website learning engine | Existing capability implemented, operationally partial | Website ingestion, page/chunk indexing, generation publication, and a local persistent knowledge worker exist. Runtime evidence previously confirmed 7 pages and 8 chunks for carteio.in with 2 failed pages; that crawl was successful with warnings. Worker, database, and renderer readiness are environment-specific and not rechecked here. |
| 03 — Advanced RAG | Partial | Centralized effective Knowledge Base resolution and hybrid lexical/optional semantic retrieval exist. Semantic indexing has previously been reported disabled; do not treat vector retrieval as active. Cross-language query planning is model-informed but has not been runtime-verified. Reranking and labeled real-corpus measurement remain open. |
| 04 — AI agent brain | Partial | `ConversationOrchestrator` combines deterministic server-side routing with model interpretation, bounded tool calling, and provider fallback. This is not a general autonomous multi-step agent planner. Replace or expand it only if measured tool-selection failures justify that work. |
| 05 — Natural conversation and memory | Partial; focused correction added, unverified | Bounded session history and language/script instructions exist. A validated conversational-feedback intent now routes feedback and acknowledgements through the configured model with recent bounded context. No durable cross-session preference memory exists. Tests were added but not run. |
| 06 — Grounding and Shopify intelligence | Partial | Deterministic checks cover selected citations and structured/numeric/contact/URL/SKU/availability claims. Shopify catalog data is a synchronized snapshot unless an existing authorized live tool explicitly provides live data. Full semantic claim entailment and general live inventory verification are not implemented. |

| Verification phase | Status | Evidence and remaining work |
|---|---|---|
| 01 — History bug verification | Code and tests present; unverified | `selectBoundedHistory` keeps recent turns and chronological order. Unit tests cover core bounds. Widget history uses created-time ordering; equal timestamps can be ambiguous because IDs are not causal sequence numbers. Add/retain a deterministic widget tie-order test and resolve only with an authoritative persisted ordering key. |
| 02 — Grounding verification | Partial deterministic coverage; unverified | Shared validation is called after evidence revalidation and before persistence. Deterministic checks do not establish that every natural-language claim follows from a source. No semantic verifier or human-labeled runtime answer audit exists. |
| 03 — Widget vs Playground | Shared core verified statically; integration coverage incomplete | Both call `executeSharedAI`; widget origin/session checks remain upstream. Playground tests exercise orchestration with mocks. The widget customer adapter spec mocks `executeSharedAI`, so it does not verify the shared prompt, retrieval, or grounding path through the widget adapter. |
| 04 — 72-scenario evaluation | Fixtures present and corrected in this change; not executed | The 72 synthetic cases are fixtures only. They do not measure real merchant accuracy or invoke the production pipeline. The offline metrics now handle non-applicable source-selection cases and reject invalid count inputs. |
| 05 — Next accuracy improvements | Prioritized below; no live baseline | The next useful verification is bounded offline regression coverage, followed by an explicitly merchant-approved frozen-corpus baseline. No recommendation here asserts a measured accuracy defect without evidence. |

## 2. Compilation and stability gate

The earlier `knowledge-base.service.ts` Prisma namespace issue appears structurally corrected in this checkout: the schema uses the custom `prisma-client` generator output at `backend/src/generated/prisma`, that generated `client.ts` exports `Prisma`, and `knowledge-base.service.ts` imports it from that generated client and types `baseById` as `Map<string, EffectiveKnowledgeBase>`. This review did not run `tsc`, a build, or a watcher, so compilation is **not confirmed**; other current errors cannot be ruled out.

The current working tree contains many pre-existing modified and untracked files. Changes in this recovery are limited to the listed orchestration, semantic contract, tests, benchmark fixtures/metrics, and two new reports. No unrelated worktree changes were altered.

## 3. Conversation repeat investigation and correction

The repeated-response weakness was a turn-purpose routing problem, not a stored-response replay. Exact turn replay is keyed to the submitted `clientTurnId`. The interpretation schema previously had business complaint and social labels but no distinct label for feedback about assistant behavior. Such feedback could continue through business retrieval and reach the no-evidence response path. The no-evidence prompt appropriately avoids unsupported merchant facts, but it is the wrong response path for conversational feedback and can repeat a missing-information explanation. The exact semantic label emitted for the original customer turn is unavailable, so that individual runtime classification cannot be proven retrospectively.

Valid standalone acknowledgements also had a fixed response shortcut. The current correction adds `CONVERSATION_FEEDBACK` as a constrained advisory intent in the existing interpretation call, routes only a validated single feedback intent with unknown business information need/no entities/no ambiguity to the model-backed social response branch, includes bounded recent history, and explicitly asks the model to address feedback without repeating the old answer. Acknowledgements now use that model path on valid interpretation. Invalid interpretation and provider outages retain small safe deterministic fallbacks. No language-specific mapping or business answer template was added.

Tests added or updated but not run: contextual feedback after a prior missing-evidence response, model-backed acknowledgment, interpretation contract validation, and model-composed out-of-scope redirect. These are mocked Playground execution tests, not real-provider evidence. Valid acknowledgements and confidently out-of-scope redirects now make the normal configured response-generation call; this can add provider latency and usage/cost versus the old deterministic shortcut. No estimate is possible without a chosen provider/model rate card.

## 4. History and widget/Playground coverage

The Phase 02 report and Phase 03B review establish that both Playground history loading and the widget adapter use the bounded selector before the shared orchestrator. The selector chooses newest groups first, keeps selected history chronological, bounds message count/bytes, and keeps current input separately. Existing tests cover helper overflow and provider input in Playground. The widget history adapter has no test that asserts its selected provider context; equal `createdAt` timestamps remain a source-level ordering risk. This needs a stable causal key before any production order change; random ID tie-breaking is not proof of chronology.

Grounding checks run in shared orchestration after source revalidation. Existing verification is deterministic for bounded claim types. Source/citation identity checks prove authorization and identifier validity, not semantic entailment. Natural-language policy conditions, product compatibility, nuanced descriptions, and multi-source synthesis need human-labeled claim-to-span evaluation. No secondary paid LLM verifier was added.

## 5. 72 synthetic scenarios and evaluation math

The fixture file contains 72 cases across categories A–R, with synthetic evidence only. Earlier review identified that contradiction cases described multiple conflicting records but carried a single evidence record, and that a cross-tenant contact question did not include Tenant B evidence while another case mislabeled Tenant B contact data as a policy source. This change adds separate synthetic contradictory policy, shipping threshold, price, and contact sources; the corresponding four scenarios now carry two distinct records. Cross-tenant fixtures now identify Tenant B ownership and include a Tenant B returns policy where the question concerns a policy. No real merchant facts were added.

Metric helper changes:

- `correctSourceSelection` is null/not applicable when no gold relevant source IDs are labeled.
- `k`, claim counts, and binary counts must be non-negative safe integers. Impossible supported/passed counts throw rather than being silently clamped into a plausible score.
- Percentiles return null for invalid quantiles and no finite samples.
- Cost remains unknown without an explicit rate card; token counts must be integral.

Metrics remain limited: source selection currently means a relevant-source hit, not a separately labeled authoritative-source correctness score. Claim support is support among emitted labeled claims, not answer completeness. Latency excludes non-finite samples without reporting their count. These must be handled in the evaluation report before using a quality gate. Fixtures are not a benchmark runner and cannot establish model accuracy.

## 6. Existing tests and missing coverage

Relevant suites include `conversation-diagnostics.spec.ts`, `conversation-context.spec.ts`, `assistant.playground.spec.ts`, `conversation-orchestrator.customer.spec.ts`, `multilingual-semantics.spec.ts`, `grounded-answer-plan.spec.ts`, `quality-benchmark-fixtures.spec.ts`, and knowledge resolver/retrieval specs. Grounded-response checks are also exercised in `assistant.playground.spec.ts`. Their presence and assertions are not evidence that they pass.

Important gaps:

- Widget path through `processTrustedCustomerTurn` into actual shared provider context, retrieval, grounding, and persistence; current adapter test mocks shared execution.
- Equal-timestamp widget message ordering and delayed assistant-write ordering.
- End-to-end observable behavior for contradictions, supported answer completeness, and semantic claim-to-evidence judgments.
- Retrieval recall/precision on a frozen labeled corpus, including English-only source content with Hinglish/Devanagari queries.
- Tool-selection correctness against authorized manifests and actual bounded tool results.
- Live runtime check that evidence for the reported Carteio shipping policy reaches the configured model in Playground and authorized widget channels.

## 7. Exact files changed in this recovery

- `backend/src/modules/workspaces/multilingual-semantics.ts` — advisory conversation-feedback intent.
- `backend/src/modules/workspaces/conversation-orchestrator.service.ts` — model routing for validated feedback and acknowledgements with bounded history and no retrieval/tool access for these turns.
- `backend/test/assistant.playground.spec.ts` — mocked contextual-feedback and acknowledgment behavior cases.
- `backend/test/multilingual-semantics.spec.ts` — feedback intent contract case.
- `backend/test/fixtures/carteio-quality-benchmark.v1.ts` — evidence consistency and Tenant B fixture provenance.
- `backend/test/fixtures/quality-metrics.ts` — bounded input validation and not-applicable scoring.
- `backend/test/quality-benchmark-fixtures.spec.ts` — conflict/tenant fixture and metric edge cases.
- `docs/ai-audit/CARTEIO_PENDING_AI_QUALITY_ROADMAP.md` — this roadmap and recovery status.
- `docs/ai-audit/CARTEIO_NATURAL_CONVERSATION_INTELLIGENCE.md` — Phase 05 findings and changes.

No production database schema, crawler, index, Shopify integration, API contract, or widget authorization was changed.

## 8. Bounded test commands for separate approval

Past Jest discovery on WSL under `/mnt/c` stalled. Do not launch an unbounded process. The following local test commands have explicit limits; approval must be given before execution. They do not intentionally start a service or contact a provider, but this should be reconfirmed from the current test setup before execution. If dependency resolution/setup unexpectedly requests network, credentials, or a service, stop.

```bash
set -o pipefail
timeout --signal=TERM --kill-after=3s 60s pnpm --dir backend exec jest --runInBand --runTestsByPath src/modules/workspaces/conversation-diagnostics.spec.ts test/conversation-context.spec.ts 2>&1 | tee /tmp/carteio-history-regression.log
```

```bash
set -o pipefail
timeout --signal=TERM --kill-after=3s 60s pnpm --dir backend exec jest --runInBand --runTestsByPath test/quality-benchmark-fixtures.spec.ts 2>&1 | tee /tmp/carteio-quality-fixtures.log
```

```bash
set -o pipefail
timeout --signal=TERM --kill-after=3s 90s pnpm --dir backend exec jest --runInBand --runTestsByPath test/assistant.playground.spec.ts test/multilingual-semantics.spec.ts 2>&1 | tee /tmp/carteio-playground-conversation.log
```

```bash
set -o pipefail
timeout --signal=TERM --kill-after=3s 60s pnpm --dir backend exec jest --runInBand --runTestsByPath src/modules/workspaces/conversation-orchestrator.customer.spec.ts 2>&1 | tee /tmp/carteio-widget-adapter.log
```

These are proposed commands, not executed commands. The last suite alone does not prove widget RAG integration because it mocks the shared executor.

## 9. Runtime verification and approval gates

Before any runtime AI baseline:

1. Resolve compilation status using the existing approved developer workflow; no compile/build was run here.
2. Approve and execute the bounded offline Jest commands above. No paid call or database is expected for the mocked suites.
3. For provider-backed Playground/widget validation, approve the exact provider/model, a maximum request count, and a cost cap. This can create provider cost and requires configured credentials; do not reuse real customer data.
4. For a real merchant baseline, approve the test website, source facts, source snapshot/version, allowed test session, languages, and human reviewer labels. Do not auto-crawl or sync as part of a test plan.
5. For widget verification, use an authorized origin/session. Playground success does not validate public widget authorization or widget persistence.

## 10. Prioritized remaining work

1. **Verification gate first:** confirm compilation, then execute the finite offline tests. Prioritize history selector, benchmark fixtures/metrics, Playground orchestration, semantic contract, and widget adapter suites. Fix failures only with an approved implementation request.
2. **Widget shared-path integration coverage:** exercise the real trusted customer adapter into `executeSharedAI` with mocked provider/retrieval/DB boundaries; test history order, evidence, grounding, persistence, and tenant/session authorization.
3. **Labeled hybrid retrieval baseline:** use a frozen, merchant-approved corpus and English/Hinglish/Devanagari questions. Measure recall@k, precision@k, source-span relevance, context inclusion, and truncation before changing ranking or adding semantic indexing.
4. **Structured facts and source freshness:** improve extraction/field authority only where labeled misses are shown; distinguish snapshot values from live Shopify reads.
5. **Natural conversation and bounded memory evaluation:** review unseen multi-turn samples for feedback handling, topic shifts, repetition, script adaptation, and privacy retention. Do not add durable memory without separate approval.
6. **Semantic grounding evaluation:** human-label atomic claims and evidence spans first. Consider an additional model verifier only after quality/cost/latency measurement and explicit approval; deterministic numeric checks do not prove entailment.
7. **Agent/tool planning:** evaluate existing model-driven tools against permission-aware scenarios. Expand into multi-step execution only if observed failures justify added complexity and safety review.

Current highest priority is **offline verification readiness and widget-path test depth**, then a measured retrieval baseline. There is not enough verified evidence to recommend a broad RAG, memory, or agent rewrite.
