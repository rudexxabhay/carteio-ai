# Knowledge implementation — 2026-10-30

## Natural conversation stabilization — 2026-10-30

**IMPLEMENTED — CODE REVIEWED; FOCUSED TEST VERIFIED (routing boundary only).** Found and reproduced a regression from the preceding change: `validateInterpretation()` synthesizes an answer aspect when an ordinary capability interpretation omits `answerAspects`. Therefore the previous `answerAspects.length > 0` condition disabled the intended capability shortcut even for “Who are you?”. Baseline direct check: 7 passed, 1 failed (capability), exit 1. Removed that unreliable factual signal; retained static-business and explicit business/Knowledge intent gates, added mixed-static/personal handling, and restricted the capability shortcut to certain, unambiguous UNKNOWN-information-need interpretations containing only affirmative assistant-identity intent. Mixed live-record requests cannot enter the capability shortcut. The preceding factual-identity fix is preserved.

Changed production file: `backend/src/modules/workspaces/conversation-orchestrator.service.ts` (`executeSharedAI` routing block). Added reproducible direct harness `scripts/regression/identity-routing-direct.cjs`; updated this record, `lastwork.md`, and `docs/development/phase-register.md`. Source checkpoint: `/tmp/carteio-stabilization/orchestrator-before.ts`. Required records and regression procedure read; `timeout 5 git status --short --untracked-files=no` timed out (124); existing work retained. The test uses Node type stripping to execute actual interpretation modules and extracts/evaluates the actual orchestrator gate, with controlled semantic fixtures; it does not execute the whole orchestrator, database, retrieval, or provider.

Command from repository root: `timeout 20 node --require ./scripts/phase00/offline.cjs scripts/regression/identity-routing-direct.cjs`. Post-change: **8 passed, 0 failed, exit 0**. Identities: capability; business identity; Hinglish business; Hindi business; mixed greeting; shipping; commerce; live mixed identity. No Jest retry, paid call, migration, dependency change, deployment or background test. Provider/model, prompts, memory, Shopify execution, source authorization, indexing and hybrid ranking unchanged. Migration required: **NO**.

Source review: existing social guard rejects substantive intents before a greeting shortcut; social generation retains bounded history and no citations. Off-topic generation redirects through protected dynamically resolved workspace context. The existing no-evidence path instructs natural uncertainty without asserting that a policy is absent; current evidence/citation verification remains. Workspace identity comes from `assistant.organization.name` with assistant-name fallback. The PDF predicate retains `AUTHENTICATED_PDF_EXTRACTION_V1` and rejects legacy source types/unmarked TEXT. These are source-review observations, not runtime guarantees or proof of general prose entailment.

**NOT VERIFIED:** real Gemini language/intent behavior, full social/follow-up generation, Shopify tool execution, missing-data versus retrieval-failure runtime distinction, assistant assignment/tenant isolation, revoked/replaced-generation denial, live PDF retrieval/evidence handoff. No full integration or live retrieval pass claimed. Owner acceptance: in an authorized development Playground run greeting → capability → business introduction → shipping → contextual follow-up → product request → off-topic request; inspect retrieval/skip reasons and supplied citations. Repeat with no Knowledge assignment, a different workspace, legacy-only sources, revoked/replaced source, and a controlled retrieval failure; verify unavailable facts are not asserted and error diagnostics differ from successful empty retrieval. Phase 04 remains open; Phase 00 remains BLOCKED with historical evidence untouched.


## P0 business-introduction routing correction — 2026-10-30

**IMPLEMENTED — CODE REVIEWED. FOCUSED TEST VERIFIED: NO. LIVE RETRIEVAL VERIFIED: NO.** The owner-supplied correlation IDs and stage facts were not found in repository logs/exports, and the saved Playground diagnostics do not persist full response traces with messages. The supplied trace identifies skipped retrieval but omits the interpretation result and skip reason; the exact historical branch and the origin of the jewellery/accessories wording are therefore **NOT VERIFIED**.

Confirmed matching source defect: `ConversationOrchestrator.playgroundChat` treated every affirmative `ASSISTANT_IDENTITY_INQUIRY` that was not a product request as an assistant capability inquiry and returned before Knowledge retrieval (`backend/src/modules/workspaces/conversation-orchestrator.service.ts`, identity/capability routing near the interpretation branch). That gate did not check whether validated interpretation carried `STATIC_BUSINESS_INFORMATION`, factual answer aspects, or a `BUSINESS_INFORMATION` / `KNOWLEDGE_QUESTION` intent. The branch records `KNOWLEDGE_RETRIEVAL_SKIPPED: assistant_capability_response`. The owner-supplied trace did not include this reason, so the defect matches the incident shape but is not asserted as the proven historical branch.

The capability shortcut now requires absence of all three factual signals; factual identity questions continue through the existing retrieval, authorized PDF eligibility, evidence selection/revalidation, answer-plan, citation and grounding path. Normal identity/capability questions with UNKNOWN information need and no factual aspects retain the existing natural capability answer. A bounded metadata log now reports `factualBusinessQuestion` and the actual `capabilityShortCircuit` decision. The safe diagnostics reason allowlist now preserves `assistant_capability_response` so actual capability skips can be distinguished. No keywords, business names, answer strings, provider/model, RAG scoring/fusion, PDF provenance, Shopify behavior, tenant/assistant access checks, or migrations changed. Added one Playground fixture for an identity-labeled static business question and one diagnostics fixture for the explicit skip reason; existing capability, social, greeting+business, shipping-policy and Shopify assertions were preserved.

Verification: selective source checkpoints created at `/tmp/carteio-p0-grounding-orchestrator-before.ts`, `/tmp/carteio-p0-grounding-playground-before.ts`, `/tmp/carteio-p0-grounding-diagnostics-before.ts`, and `/tmp/carteio-p0-grounding-diagnostics-spec-before.ts`; `diff -u` reviewed focused source diffs. `git status --short` was attempted with an 8-second bound and timed out; an untracked-free status capture was available and showed extensive pre-existing Knowledge/UI/report edits, which were preserved. Focused Jest first ran from the wrong directory (exit 1, missing spec/module path); the corrected command was `timeout 180s node node_modules/jest/bin/jest.js --config jest.phase00.config.cjs --runInBand --runTestsByPath test/assistant.playground.spec.ts --testNamePattern='factual assistant identity|company location|model-generated identity/capability|validated Hinglish wellbeing|does not swallow a greeting|shipping|Shopify tool' --json --outputFile=/tmp/carteio-p0-grounding-focused.json`. It produced no test/assertion output and was interrupted before its timeout (exit 130); **BLOCKED before assertions**, not a pass. The related assertion baseline is the existing 687 passed / 116 failed backend and 158 passed / 85 failed frontend recorded in Phase 00; it was not rerun. No database, provider, application, deployment, typecheck or migration operation was performed.

Grounding policy remains the existing policy: current authorized evidence must support business facts; unavailable facts use the existing natural no-evidence path. This patch does not change unsupported-claim enforcement in direct social/capability wording, so a model could still disobey those branch prompts; the exact historical source cannot be diagnosed without the redacted interpretation and answer-path metadata. New PDF readiness/eligibility, old FAQ/Website/manual Text exclusion, actual lexical/semantic retrieval, evidence supplied to the LLM, cross-tenant/assistant denials, Gemini response behavior, Shopify routing, repeated/follow-up correctness, and the incident's jewellery claim are **NOT VERIFIED**. Migration required: **NO**. Phase 04 remains open and Phase 00 remains **BLOCKED**, with historical failures untouched.

## Phase 04 final acceptance disposition — 2026-10-30

**BLOCKED — NOT ALL ACCEPTANCE CHECKS HAVE EVIDENCE.** Owner-reported UI shows the shipping PDF at 682 words, 2/2 pages, 2 chunks, 2 vectors, lexical/semantic READY, verified provenance and version/generation 1/1; owner also reports a Gemini response with two PDF citations. These observations are not treated as proof of branch execution, chunk coverage, LLM handoff stages, or runtime access denials.

The configured target matched the approved development Neon endpoint. Two bounded read-only Prisma SELECT probes failed to return rows and emitted an empty `Error` without code/message. No writes occurred. Database source/page/chunk identity and content coverage therefore remain unverified. Code review confirms the existing PDF-only current-generation eligibility/revalidation boundary; runtime legacy, assistant and tenant denial cases remain unverified. Search counts/durations and evidence stages exist in live Playground diagnostics, but full traces are not stored with `PlaygroundMessage`; no trace payload/ID for the reported turn was available. Historical records are not inferred from citations or READY status.

| Acceptance | Status |
|---|---|
| PDF text/chunk coverage | **BLOCKED** |
| Lexical retrieval execution | **BLOCKED** |
| Semantic retrieval execution | **BLOCKED** |
| Hybrid fusion execution | **BLOCKED** |
| Authorized PDF evidence supplied to LLM | **BLOCKED** |
| Legacy Knowledge exclusion | **BLOCKED** (code boundary reviewed; runtime denials not run) |
| Tenant and assistant isolation | **BLOCKED** (runtime denials not run) |
| PDF generation/version validity | **BLOCKED** (owner UI only) |

Next owner action: capture live Diagnostics/Sources from one fresh, owner-operated Playground turn with the same workspace/assistant and an English fact query; provide the summarized output of the read-only source/page/chunk query and run the existing negative authorization cases. This agent made no paid Gemini/embedding call, no schema/code change, and ran no tests/builds/typechecks. Migration required for acceptance: **NO new migration**. Phase 04 remains open; Phase 00 evidence is unchanged.

## Semantic indexing root-cause fix — 2026-10-30

**IMPLEMENTED — NOT RUNTIME VERIFIED.** Fixed a Knowledge configuration timing bug: the semantic-enabled flag was frozen at module import, before the API loads `backend/.env`. The Knowledge provider/config resolver now reads it at runtime, so service construction after env loading can create the OpenRouter embedding adapter. The local env file's requested Knowledge profile was inspected with secret-safe output and `OPENROUTER_API_KEY` is present; an already-running backend must restart. Actual process/worker state is unknown.

Local API mode starts its in-process Knowledge queue worker from the service lifecycle when enabled. Standalone mode loads `.env` before importing Knowledge code and requires the explicit standalone flag; serverless API mode requires an external worker. Added redacted worker/profile startup diagnostics. The existing **Reprocess saved text** action enqueues one verified source/version INDEX job and reuses persisted extracted text to generate vectors and publish a new generation. It is user-triggered and may incur OpenRouter charges.

Status now distinguishes missing/disabled configuration from configured-but-unindexed (`PENDING`), active indexing, failed indexing, and `READY` backed by complete current-generation vectors with a matching provider/model/dimension profile. The drawer reads the status response. Existing lexical fallback and hybrid fusion remain. No additional migration is required; owner reports the OpenRouter embedding migration applied. Database state was not queried. No paid embedding call or test ran. pnpm typecheck could not initialize due a pnpm temporary-directory `ENOENT`; direct `tsc` timed out at 45 seconds without output. Runtime vectors and semantic retrieval remain pending. Prior conversation output exposed credentials; rotate the exposed OpenRouter key and any other exposed credentials.

## OpenRouter Knowledge embeddings update — 2026-10-30

**IMPLEMENTED — NOT RUNTIME VERIFIED.** Added OpenRouter as a Knowledge-only OpenAI-compatible embedding adapter. It reuses the existing backend `OPENROUTER_API_KEY` and sends `openai/text-embedding-3-small` requests to `https://openrouter.ai/api/v1/embeddings` with 1536 dimensions. The direct OpenAI embedding adapter remains supported. Chat provider/model configuration, Gemini/OpenRouter chat routing, AI execution, query generation, prompts, answer behavior and retrieval ranking/fusion are unchanged.

The existing PDF worker/indexer and semantic query path were already connected to the adapter contract: current chunk embeddings are persisted with source/chunk identity, workspace, source version, generation, model and dimensions; PDF replacement/reindex uses a fresh generation; query embeddings use the configured same profile. Provider errors leave lexical indexing available and are surfaced as safe processing/retrieval status. The document processing response now includes actual vector count/profile, and the PDF details UI only labels semantic indexing Ready when persisted current-generation vectors and the supported profile are reported.

**Migration required: YES.** pgvector `vector(1536)` storage and extension setup already exist in prior migrations; actual remote database readiness was not inspected. Apply the new forward migration `backend/prisma/migrations/20261030120000_openrouter_knowledge_embeddings/migration.sql` manually to extend the permitted provider/model check and recreate the partial HNSW index. Do not execute it automatically.

Backend `.env.example` now has the complete Knowledge profile. The local backend `.env` already has the OpenRouter key and Knowledge semantic/provider/model variables; its provider/model remain unconfigured, and the missing base URL variable was added blank. The key is reused by variable name only and is not duplicated. Owner configuration block:

```env
KNOWLEDGE_SEMANTIC_ENABLED=true
KNOWLEDGE_EMBEDDING_PROVIDER=openrouter
KNOWLEDGE_EMBEDDING_MODEL=openai/text-embedding-3-small
KNOWLEDGE_EMBEDDING_BASE_URL=https://openrouter.ai/api/v1
```

Dimensions are fixed at 1536 in schema/code. The semantic flag is billable once indexing jobs are run; owner should confirm OpenRouter model availability/credits, apply the migration to an approved isolated database, restart backend and Knowledge worker, and then explicitly reindex each authorized provenance-verified PDF using the existing document **Reprocess saved text** action. Historical unmarked PDFs still require authenticated original-file replacement first. Reindex is per-source and can incur embedding charges; no bulk reindex is configured. Backend UAT needs the env and restart/redeploy; a separate frontend Vercel redeploy is unnecessary unless it hosts the backend configuration.

Focused OpenRouter adapter/config regression cases were added but not executed. No tests, builds, typechecks, database access, migration, provider call, application startup or deployment was performed. Lexical is implemented and remains the fallback; real PDF retrieval remains unverified. Semantic vectors and hybrid retrieval are **CONFIGURATION / INDEXING PENDING**, not runtime verified. Phase 04 acceptance remains BLOCKED pending actual isolated database-backed ingestion, retrieval and legacy-exclusion evidence.

Embedding-update files: `backend/src/modules/workspaces/knowledge-indexing.ts`, `backend/src/modules/workspaces/knowledge-processing.service.ts`, `backend/src/modules/workspaces/playground-diagnostics.ts`, `backend/test/knowledge-indexing.spec.ts`, `backend/prisma/migrations/20261030120000_openrouter_knowledge_embeddings/migration.sql`, `backend/.env.example`, local `backend/.env` (new base URL variable only), `frontend/src/services/api/knowledge.ts`, and `frontend/src/dashboard-source/KnowledgeDocumentDialog.tsx`. Updated records: this report, `reports/carteio-knowledge-phase-03-retrieval.md`, `lastwork.md`, and `docs/development/phase-register.md`.

## Phase 04 acceptance disposition — 2026-10-30

**BLOCKED — real database and end-to-end acceptance pending.** The configured database URLs target remote Neon, which was not accessed. No isolated local PostgreSQL target was present. Therefore this task did not verify fresh PDF ingestion/persistence/restart durability, actual English lexical retrieval, legacy-source negative cases, replacement/revocation, or a real Playground/LLM evidence handoff. Existing audit and mocked results are not reported as live passes.

Semantic indexing is **CONFIGURATION / INDEXING PENDING**: the semantic enable flag is true but provider, model and OpenAI embedding credential are empty. Existing implementation uses opt-in OpenAI `text-embedding-3-small`/1536-dimensional vectors in PostgreSQL pgvector; no embedding call occurred. Lexical remains source-implemented but database retrieval is NOT VERIFIED. Historical PDFs without authenticated provenance remain ineligible until original-file replacement.

No source code changed in this acceptance turn. No tests, database calls, migration, app startup, provider calls or deployment were performed. To unblock, provide a disposable local PostgreSQL target for both database URLs, apply existing migrations locally, seed isolated old/new/authorization fixtures, perform authenticated upload and `search-preview` checks, then restart and re-read persisted records. Semantic verification additionally requires explicit supported embedding configuration and reindexing. For real LLM evidence delivery, an owner must run a fresh Playground conversation in the isolated workspace and inspect its per-message Sources diagnostics. **Phase 04 remains BLOCKED; no production readiness is claimed.**

## Phase 03 evidence metadata and hybrid retrieval update — 2026-10-30

Status: **IMPLEMENTED — NOT RUNTIME VERIFIED**. Added an authenticated, manager-only batch metadata resolver keyed by existing source/chunk/page/version/generation trace IDs. It uses workspace membership and the active assistant's current effective public PDF source set; it validates the exact current chunk and generation before returning trusted PDF filename, provenance, document title, section, Knowledge Base identity, page locator and chunk sequence. Stale generations are marked historical; unauthorized/unresolved references return no content. This read-only route is separate from chat execution and cannot affect provider requests or responses.

Updated Playground's existing per-message Sources inspector to show verified PDF identity and the recorded retrieved/selected/revalidated/supplied/cited stages. Search method is “Not recorded” per evidence when unavailable. Historical or unauthorized static source excerpts remain hidden. Updated the PDF detail view with persisted provenance, source version, generation, lexical/semantic status, customer visibility, assistant assignments and the original-PDF replacement requirement.

Existing semantic infrastructure is already wired in the Knowledge worker and retrieval service: opt-in OpenAI `text-embedding-3-small`, 1536 dimensions, persisted PostgreSQL vector metadata, version/generation scoping, semantic candidate query and existing lexical/semantic fusion. No ranking behavior changed and no embeddings were requested. Manual enablement requires owner configuration of `KNOWLEDGE_SEMANTIC_ENABLED=true`, `KNOWLEDGE_EMBEDDING_PROVIDER=openai`, `KNOWLEDGE_EMBEDDING_MODEL=text-embedding-3-small`, and `OPENAI_API_KEY`; use the existing pgvector schema/extension migration if not already applied and explicitly reindex current PDF documents. Lexical remains available without semantic configuration.

Changed source files: `backend/src/modules/workspaces/knowledge.dto.ts`, `knowledge.controller.ts`, `knowledge-processing.service.ts`, `knowledge.service.ts`, `frontend/src/services/api/knowledge.ts`, `frontend/src/pages/training/PlaygroundChat.tsx`, and `frontend/src/dashboard-source/KnowledgeDocumentDialog.tsx`. No migration is required for this update. No tests, builds, typechecks, application/runtime, database or provider operations were executed. Actual PDF retrieval/evidence delivery remains runtime-unverified. Phase 00 historical failures remain unchanged; Phase 04 was not started.

Compiler diagnostic follow-up: removed the final unreferenced `websiteAssistantCanUseSource` helper and its now-unused `sourceUrlMatchesVerifiedDomain` import from `knowledge-processing.service.ts`. Shopify discovery uses its active verification service and remains unchanged. No typecheck was run.

## Compiler feedback follow-up

- Removed six obsolete website dashboard helper functions/selectors from `knowledge-processing.service.ts`; retained authorization and crawler publication logic used by Shopify.
- Restored `KnowledgeService.createShopifyDiscoveredWebsite`, the active producer called by `ShopifyWebsiteDiscoveryService`. It requires workspace manager access, normalizes the URL, and creates a paused, unverified storefront source without granting static AI eligibility.
- No build or typecheck was run. The reported source errors were addressed, but compiler success remains unverified.

Status: **KNOWLEDGE BASE CODE IMPLEMENTATION COMPLETE — NOT RUNTIME VERIFIED**. No production readiness or runtime success is claimed.

## Final source closure

- Removed the unused `bulkMakeFaqSourcesPublic` and `activateCustomerKnowledge` FAQ visibility/activation methods from `backend/src/modules/workspaces/knowledge.service.ts`. Source inspection found no active runtime callers; no routes expose them.
- PDF source eligibility remains centralized in `knowledge-document-eligibility.ts` and is enforced in assistant source resolution, initial search candidate filtering, lexical/semantic SQL candidate selection, evidence revalidation, effective public source selection, and indexing admission. The checks require server-written `AUTHENTICATED_PDF_EXTRACTION_V1`, extracted English metadata and page/hash validity; tenant, assistant/base assignment, customer visibility, READY state, source version, active generation and chunks remain separately checked by existing Knowledge logic.
- Shopify storefront discovery, crawler workers and Shopify content synchronization remain in `knowledge-processing.service.ts` and their connector services because they have active Shopify callers. They were preserved.
- No migration or schema change: **NO**. Existing unmarked PDF sources remain excluded until replaced with their original PDF through the authenticated replacement path; source identity is retained and a new version is indexed.
- This closure edited `backend/src/modules/workspaces/knowledge.service.ts` and this report, `lastwork.md`, and `docs/development/phase-register.md`. Earlier continuations contain the UI/API/read-service changes listed above.

Tests, builds, typechecks, application startup, database queries, migrations, provider calls and deployment remain unexecuted. Runtime retrieval and LLM handoff require separate verification.

## Changes made in this continuation

- `backend/src/modules/workspaces/knowledge-base.controller.ts`: removed website, FAQ, batch FAQ, spreadsheet preview/import/template and manual text creation routes and their controller dependencies. Base and assistant assignment routes remain.
- `backend/src/modules/workspaces/knowledge.service.ts`: removed legacy creation/import methods; authenticated extraction writes `document.provenance = AUTHENTICATED_PDF_EXTRACTION_V1`; legacy edits fail closed; original-file replacement can re-extract an unmarked PDF even when its binary hash is unchanged. Duplicate upload of an unmarked record returns an actionable replacement error.
- `backend/src/modules/workspaces/knowledge-document-eligibility.ts`: requires server-written provenance plus extracted English PDF metadata, hashes and valid page metadata. Client filename alone is insufficient. Existing upload/update DTOs do not accept provenance.
- `backend/src/modules/workspaces/knowledge-base.service.ts`: source resolution requires valid PDF provenance, nondeleted state and authorized base membership, followed by existing current-generation chunk checks.
- `backend/src/modules/workspaces/knowledge-processing.service.ts`: all search-preview audiences require PDF provenance. Public evidence revalidation uses that boundary; SQL adds provenance checks. Static indexing rejects unproven sources. Existing lexical/semantic ranking and evidence shape retained.
- `frontend/src/dashboard-source/pages.tsx`: deleted Crawler and CrawlDetail implementations and their imports; old route aliases lead to PDF KnowledgeLibrary.
- `frontend/src/dashboard-source/data.ts`: removed crawler navigation and training-section entry.
- `frontend/src/pages/knowledge/BusinessDataVisibility.tsx`: removed website forms, state, handlers and page inspector; retained Shopify view and its existing sync/permission functions.
- `frontend/src/services/api/knowledge.ts`: removed unused website creation/details/sync/settings wrappers.
- Deleted `frontend/src/pages/training/TrainingCenterPage.tsx`, `frontend/src/tests/training-center.test.tsx`, `frontend/src/tests/knowledge-api-routes.test.ts` (retired feature tests).
- Updated `lastwork.md`, `docs/development/phase-register.md`, and this report.

Earlier dirty changes, including PDF library/dialog, extraction, controller route removal and old Knowledge-page deletions, were preserved. They are not attributed to this continuation.

## Storage and evidence contracts

The existing PDF upload persists extracted content and page metadata in PostgreSQL-backed source records and queues existing versioned chunk indexing. Replacement clears active generation, increments source version and cancels old jobs. Existing retrieval returns the original chunk content, identifiers and page references; no new evidence format or LLM adapter was introduced. Tenant membership and manager checks remain in authenticated APIs. Assistant resolution and current-generation chunk lookup remain prerequisites. Shopify runtime tools were not changed.

Provenance uses the existing JSON document field: schema migration required **NO**. Existing PDF rows are not deleted or automatically relabeled. Before deployment acceptance, replace each previously uploaded unmarked PDF through its existing replacement endpoint using the original file. This preserves source identity while re-extracting and publishing a new generation. Do not backfill the marker from filenames or source type alone.

## Final legacy read cleanup — 2026-10-30

- Removed the legacy `KnowledgeInspector` website page state, request, tab and renderer from `frontend/src/pages/training/PlaygroundChat.tsx`. The existing Sources inspector remains the authority for retrieved evidence, source/chunk IDs, page references, handoff and citation status.
- Deleted `frontend/src/pages/source/SourceKnowledgePages.tsx` (standalone FAQ visibility/source manager and website page viewer).
- Removed website page response types and the `listWebsitePages`/`getWebsitePage` clients from `frontend/src/services/api/knowledge.ts`; removed the legacy bulk FAQ visibility client. Shopify discovery clients remain.
- Removed `listWebsitePages` and `getWebsitePage` from `KnowledgeProcessingService`. No controller endpoint referenced them after prior route retirement. The source inspection found no remaining production callers.
- Replaced the old website-centric `BusinessDataVisibility` test cases with Shopify-only regression coverage, matching that component's retained responsibility.
- Preserved website crawler worker, Shopify storefront discovery, Shopify content sync, and related shared source authorization because active Shopify paths use them. No Shopify runtime files changed.

## Remaining limitations

- No actual PostgreSQL PDF retrieval, browser interaction, compilation or LLM handoff was executed. Mock and historical evidence cannot establish these outcomes.
- Older offline tests still reference removed service methods and require deliberate retirement/adaptation before a future authorized test run. They were not executed or claimed passing.
- Legacy FAQ visibility backend helper remains in `KnowledgeService` but has no controller route or production frontend wrapper; it is an uncalled service method and can be removed in a later explicitly scoped cleanup. Generic source read/archive operations remain necessary for PDF document management/lifecycle.
- Existing semantic provider/vector setup was not changed. No embedding request was made. Semantic readiness remains unverified; lexical retrieval remains independent of embedding availability.
- Previously stored conversation messages can contain old grounded text. Retrieval exclusion does not erase that history. Verify using a new conversation after deployment; do not delete existing conversations without separate approval.
- Existing unmarked PDFs intentionally cannot provide evidence until provenance is established by replacement. No database cleanup has occurred.

## Manual acceptance and cleanup

No setup commands or migrations were executed. In an independently approved environment, regenerate/review the normal application artifacts as needed, update affected fixtures, then verify upload, processing, current chunk IDs, assistant/base permissions, tenant denial, legacy exclusion, replacement/revocation and evidence handoff. Use fresh conversations and approve any paid-provider check separately.

Before any historical cleanup: take a restorable database backup; inventory tenant-scoped source IDs and their page/chunk/job/sync-run/base-link/assistant-link dependencies; protect **all PDF document records including unmarked historical PDFs**, not just records passing the new eligibility predicate. Review an explicit legacy-ID allowlist against extraction history. Approve a separate transaction scoped to those exact IDs and dependency relationships. Never delete all TEXT records or classify missing new provenance alone as permission to delete. No destructive SQL is supplied or executed here.

Tests, Jest, builds, typechecks, application startup, diagnostics, installs, database queries, migrations, remote calls and deployments were **not executed in this continuation**. Only approved source-inspection commands and file patches were used. ConversationOrchestrator, intent, providers/models, prompts, Bot Behavior, answer generation, memory, citation validation, retrieval ranking, Shopify execution, Agent Builder and Playground/widget execution logic were not edited. Phase 00 evidence is unchanged. Phase 04 was not started.


## Customer quotation provenance correction — 2026-10-31

IMPLEMENTED PARTIAL CONTRACT — TESTS NOT RUN. Added fact-provenance.ts and fact-provenance.spec.ts; integrated attributed verbatim user-turn quotations into validateGroundedResponse and supplied only current authorized conversation user turns/current message from executeSharedAI. Historical assistant replies are excluded. Business claims outside the quotation retain existing checks; mixed quotation/conclusion lines fail closed. Normalized Devanagari/Arabic decimal digits for existing numeric checks. Shared generation/recovery instructions distinguish quotations from policy/price/status authority. No extra model call, migration, provider, ranking, database or authorization change. Baseline owner results retained: planner 6/6, Phase06 38/39 before the subsequent single assertion edit; no new execution result inferred. Source checkpoint: /tmp/carteio-provenance-checkpoint/. Git status inspection timed out after 3 seconds; existing work preserved. Source diff whitespace review returned exit 0.

LIMITATIONS: this is a conservative exact-quotation boundary, not a complete multilingual claim-entailment system. Supported attribution labels currently cover English, Hindi and Romanized Hindi. Paraphrases, arbitrary language attribution, policy-condition entailment, accidental equal-number collisions and safe partial-answer delivery remain unresolved. No historical rejected draft was available; live incident cause remains unproven. No tests/builds/typechecks or runtime operations executed. Owner command (backend): pnpm exec jest --config jest.phase00.config.cjs --runInBand --runTestsByPath src/modules/workspaces/fact-provenance.spec.ts src/modules/workspaces/conversation-diagnostics.spec.ts src/modules/workspaces/grounded-answer-plan.spec.ts test/phase06-reliability-corrections.spec.ts. Phase04 remains open; Phase00 unchanged/BLOCKED.
