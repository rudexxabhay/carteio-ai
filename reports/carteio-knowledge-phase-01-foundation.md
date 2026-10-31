# Carteio Knowledge Base Rebuild — Phase 01 Foundation

**Status: IMPLEMENTED — NOT RUNTIME VERIFIED**  
**Scope:** PDF-first Knowledge Base foundation only. Phase 02 has not started.

## 1. Phase 00 gate decision and evidence

The owner-approved exception is recorded in `AGENTS.md` and `docs/development/phase-register.md`. It authorizes only Knowledge Base Rebuild Phases 01–04 and necessary supporting infrastructure independently of the existing 12-phase roadmap gate. The exception does not change or close Phase 00. `docs/development/phase-00-verification.md` remains untouched and continues to record Phase 00 as **BLOCKED**, with 201 failed assertions, 2 confirmed defects and 199 unresolved root causes.

## 2. New UI and navigation

The active dashboard `knowledge` route now renders `KnowledgeLibrary`. It provides five static business sections, a Products & Collections Shopify connector view, compact source-state metrics, section-specific search/list views, empty states, source detail navigation, and an assistant selector backed by the existing effective-Knowledge API. Counts come from the authorized Knowledge list response; the UI does not fabricate documents or processing progress.

The PDF action is disabled with a Phase 02 availability message. This view does not call upload, simulate processing, or claim PDF extraction is enabled. Shopify’s existing connector view remains the source for Products & Collections.

## 3. Legacy UI removed and retained

Removed the unreferenced duplicate `KnowledgeBasePage`/`KnowledgeBaseDetailPage` frontend, duplicate `CrawlerPages` component and stylesheet, their dedicated tests, the legacy FAQ-import dashboard assertion, and the now-unused `KnowledgePdfPanel` (which contained a live PDF upload form outside the Phase 01 contract) and its test. Removed the old `LegacyKnowledgeManagement` JSX and its exclusive imports/state/handlers from `dashboard-source/pages.tsx`. Removed the old section card constants/style, legacy `UNCLASSIFIED` frontend filter option, and dead FAQ/Text/activation and Knowledge Base/FAQ-import frontend API wrappers.

The active `/workspace/:slug/knowledge` route has one management UI: `KnowledgeLibrary`. Its PDF action is visibly disabled with a Phase 02 note. `BusinessDataVisibility` and `knowledge-bases.css` are intentionally retained because `KnowledgeLibrary` uses the existing Shopify connector view; assistant Knowledge access APIs and types are retained because Training Center, Assistant pages, Chatflow Builder and the new library consume them. The separate active Website Crawler remains dispatched by `case 'crawler'` to `Crawler` and `CrawlDetail` in `dashboard-source/pages.tsx`; they use `listWebsitePages`, `createWebsiteSource`, `crawlWebsiteSource`, `getWebsiteSourceDetails` and `updateWebsiteSyncSettings`. These frontend references and shared backend website source/crawl, indexing, authorization and retrieval services remain. FAQ/Text source and indexing services remain in backend for existing Knowledge runtime contracts. No backend management endpoint or RAG service was deleted. The crawler was verified by source references only, not by runtime execution.

## 4. Data and processing contracts

No Prisma schema change or migration is needed for this foundation. Existing structures already provide:

- `KnowledgeSource`: organization ownership, Knowledge section, source version, status, visibility, error code, display name and document metadata JSON.
- `KnowledgePage`: tenant/source/version scoped text and content hash for persisted page content.
- `KnowledgeChunk`: tenant/source/page/version/generation scoped chunk text, hash, locator and existing embedding fields.
- `KnowledgeBase`, `KnowledgeBaseSource`, `AssistantKnowledgeSource`, and `AssistantKnowledgeBase`: current source and assistant access relationships.
- `KnowledgeProcessingJob`: tenant/source/version, status, stage and failure code.

The current PDF representation reuses `KnowledgeSource.document` JSON and `contentBody`; source version and the existing chunk/index generation remain the chatbot-compatible contracts. The backend DTO now defines a validated future progress shape with processing ID, stage, optional total pages, page/chunk counters, failure reason, update time and completion time. A corresponding frontend type is prepared. The current processing-status endpoint does **not** yet return these progress counters, and the UI does not display them.

The current page metadata is ranges into the persisted extracted `contentBody`; heading, per-page hash, and word count remain optional future fields. No duplicate document/page/chunk tables were introduced.

## 5. Original PDF retention and Phase 02 prerequisites

The new UI does not accept PDF uploads in Phase 01. The existing backend upload/worker implementation was preserved and not invoked. In `backend/src/modules/workspaces/knowledge.service.ts`, `KnowledgeService.uploadPdf()` writes bytes via `this.storage.put()` and persists `document.storageKey`, hash, filename and byte count (lines 114–148). For replacement it attempts to delete the previous key at line 146; failed cleanup is ignored there, while retired keys are carried in metadata for later permanent deletion. In `backend/src/modules/workspaces/knowledge-processing.service.ts`, `KnowledgeProcessingService.process()` reads the original from `documentStorage.read()` (line 1079), verifies its hash, extracts it, then transactionally saves `contentBody` and page metadata (`extracted: true`) at lines 1084–1088. The successful extraction/indexing path does not delete the just-processed original. `KnowledgeService.permanentlyDelete()` only deletes current/retired storage keys when the whole source is permanently deleted (lines 472–477).

Phase 02 must add a cleanup boundary in `process()` after the transaction durably saves extracted content and page metadata. Remove the object and stop exposing/persisting the active `storageKey` after successful extraction; preserve a retryable cleanup record if storage deletion can fail. A failure before durable text/page persistence must leave a clear failed/re-uploadable source and must not falsely mark extraction complete. Replacement and worker races must use source ID/version/lease checks so they cannot delete a newer upload. Reindex must continue to use persisted extracted text without needing original bytes. Confirm bounded temporary storage and serverless file/page limits; no arbitrary size support is claimed. No PDF retention or ingestion code was changed in Phase 01.

## 6. Assistant access and authorization

The UI reads the existing workspace assistant list and `getEffectiveKnowledge` result. It shows the saved searchable/effective source counts and whether a listed source is available to the selected assistant. It does not grant access from client state. Existing server-side workspace/assistant/source checks and retrieval authorization were not changed.

## 7. Manual migration and cleanup

No Prisma migration is required or prepared. No database cleanup, reset, deletion, or migration was run. Existing user/workspace/assistant, Shopify, source, chunk, index and conversation data remain untouched. There are no Phase 01 manual data-cleanup steps.

## 8. Verification results

- **PASS:** `timeout 130s node node_modules/vitest/vitest.mjs run src/tests/knowledge-library.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1` from `frontend/` — exit 0; 1 test file and 3 tests passed. Test duration 81.36s.
- **PASS:** `timeout 90s node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` from `backend/` — exit 0.
- **FAIL (pre-existing, outside permitted scope):** `timeout 90s node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` from `frontend/` — exit 2 with only two TS2367 diagnostics at `src/pages/training/playground-copy.ts:147` and `:154`. That file is an existing Playground helper and was not changed because Playground runtime was explicitly protected.
- **TIMEOUT:** `timeout 180s node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/modules/workspaces/knowledge-document-contract.spec.ts` from `backend/` — exit 124, no assertion output. A bounded diagnosis, `timeout 20s node node_modules/jest/bin/jest.js --listTests --runTestsByPath src/modules/workspaces/knowledge-document-contract.spec.ts --runInBand`, also exited 124 without listing the test. The timeout therefore occurs before any visible test result; its underlying cause is undetermined. No assertion failure was observed, and the DTO test remains unverified.
- No build, lint, migration, database query, server, worker, paid provider call, Shopify API call, or deployment was run.

## 9. Files changed

- `AGENTS.md` — records the narrow owner-approved exception; original roadmap remains gated.
- `docs/development/phase-register.md` — records the independent four-phase track and Phase 01 source status.
- `frontend/src/dashboard-source/KnowledgeLibrary.tsx` and `knowledge-library.css` — new active interface.
- `frontend/src/dashboard-source/pages.tsx` — active route and crawler preserved; old management JSX and unused imports removed.
- `frontend/src/services/api/knowledge.ts` and `knowledge-bases.ts` — retain runtime and assistant-access contracts; remove dead management wrappers.
- `backend/src/modules/workspaces/knowledge.dto.ts` — future progress DTO and lifecycle validation.
- `backend/src/modules/workspaces/knowledge-document-contract.spec.ts` — focused DTO assertions (runner timed out; not verified).
- `frontend/src/tests/knowledge-library.test.tsx` — three focused interface tests (passed).
- `frontend/src/tests/api-client.test.ts` — remove the FAQ workbook workflow assertion.
- Deleted `frontend/src/dashboard-source/KnowledgePdfPanel.tsx`, `frontend/src/dashboard-source/knowledge-sections.css`, `frontend/src/pages/knowledge/knowledge-sections.ts`, and `frontend/src/tests/knowledge-pdf-panel.test.tsx`.
- Deleted `frontend/src/pages/knowledge/KnowledgeBasePage.tsx`, `CrawlerPages.tsx`, `crawler-pages.css`, and legacy-only `knowledge-base.test.tsx`, `knowledge-bases.test.tsx`, and `faq-import-dashboard.test.tsx`. `CrawlerPages.tsx` was a duplicate Knowledge-page component; the separate dashboard `Crawler` feature remains active.

## 10. Remaining blockers and Phase 02 prerequisites

1. The old active Knowledge management JSX and its dead UI wrappers are removed. The active Website Crawler remains present by source inspection; browser/runtime verification remains outstanding.
2. The two existing frontend TS2367 errors remain unrelated blockers in protected Playground code. No safe standalone correction was made under the Phase 01 scope.
3. The backend DTO test remains unverified because Jest did not finish startup/test discovery in bounded time; investigate the local Jest environment before relying on the new DTO validation test.
4. Phase 02 must implement bounded temporary PDF upload/extraction and delete original bytes only after durable extracted text/page persistence, including cleanup retry behavior and source-version race safety.
5. Extend progress APIs only from real persisted worker/job state. Confirm tenant-scoped source replacement/deletion and assistant eligibility before enabling uploads. No simulated counters are acceptable.

**AI protection:** No Conversation Orchestrator, intent, provider/model selection, prompt, Bot Behavior, response generation, citation validation, memory, Shopify execution, Agent Builder, Playground/widget conversation, or RAG retrieval logic was modified. Existing indexing/retrieval services and contracts remain in place.
