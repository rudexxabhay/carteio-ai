# Carteio Knowledge Base Rebuild — Phase 02 PDF Extraction

**Feature status: IMPLEMENTED AND FOCUSED VERIFIED**  
**Local API/PostgreSQL runtime: BLOCKED — MANUAL ACTION REQUIRED**  
**Scope:** Authenticated PDF upload, synchronous bounded English extraction, durable Knowledge persistence and existing indexing handoff. Phase 03 has not started.

## 1. Existing implementation reused

- `pdfjs-dist@5.4.296` was already a backend manifest and lockfile dependency. `backend/src/modules/workspaces/pdf-extraction.ts` runs it in an isolated Node worker with memory and wall-clock bounds; no project dependency or lockfile was changed. An isolated copy plus its existing locked Node canvas polyfill was installed under `/tmp` solely for offline parser verification.
- `KnowledgeSource` already persists tenant, section, source version, `contentBody`, language, status and JSON document metadata. Existing `KnowledgeProcessingJob` and `KnowledgeChunk` provide the versioned indexing handoff and searchable chunk contract. No Prisma schema change or migration was needed.
- Existing `chunkKnowledgeText()` and `KnowledgeProcessingService.process()` were reused. The worker consumes the persisted English text and produces the existing lexical and optionally configured semantic indexes. Retrieval and ranking algorithms were not changed.
- `KnowledgeBase` / `KnowledgeBaseSource` continue to determine selected Knowledge Base membership. No automatic assignment to every assistant was added; existing explicit/opted-in assignment behavior remains authoritative.

## 1A. Follow-up: screenshot root causes and corrections

**Two-second drawer change:** `KnowledgeDocumentDialog` initialized `bases` as an empty array and rendered the Knowledge Base creation form whenever `!bases.length`. That condition was true during the initial `listKnowledgeBases()` request, so the empty form appeared before the request returned. When the existing `Carteio` base arrived, React replaced it with the selector. The UI now has explicit `LOADING`, `LOADED_WITH_BASES`, `LOADED_EMPTY`, and `ERROR` states. The creation action appears only after a confirmed empty result and only opens its form on click. Loading/error state occupies a stable row. One base is selected automatically; multiple bases require a choice, and a valid manual choice is retained. A short-lived cache is scoped by workspace slug and authenticated API-session generation; pending requests are deduplicated. Failed requests have a retry state and are never interpreted as an empty list.

**`DOCUMENTS_DISABLED`:** `KnowledgeService.documentCapabilities()` previously required `KNOWLEDGE_DOCUMENTS_ENABLED === 'true'`. The example environment explicitly set it to `false`, and the local `backend/.env` had no value; therefore the API returned `DOCUMENTS_DISABLED`. This gate was unrelated to storage: new PDF upload extracts from bounded request memory and does not use `PrivateKnowledgeStorage`. The capability now defaults enabled when the variable is unset; only an explicit `KNOWLEDGE_DOCUMENTS_ENABLED=false` pauses uploads. `backend/.env.example` documents the default and the kill switch. Parser availability is still checked and reported separately.

The parser check exposed a separate local dependency-installation issue. `pdfjs-dist@5.4.296` and its optional `@napi-rs/canvas@0.1.100` are present in `backend/package.json` and `pnpm-lock.yaml`, but neither was linked under the current `backend/node_modules`. Without them `pdfParserAvailable()` is false; importing PDF.js 5 without its Node canvas polyfill also fails on `DOMMatrix`. I installed these exact locked packages under `/tmp` only for focused parser tests. No project package manifest or lockfile was changed. The WSL checkout’s pnpm modules metadata points to the Windows pnpm store; a local pnpm install prompted to remove/reinstall the existing modules directories. I did not accept that prompt. Therefore the current backend process still needs a normal repository dependency install in the matching Windows/pnpm 9.15 environment before the live capability endpoint can report parser-ready.

The upload drawer now uses the requested “Upload PDF” title and subtitle, displays the section, keeps Restricted as the default with an assistant-access explanation, and uses “Upload & Process”. Capability errors use an actionable message; exact diagnostic codes are behind an expandable manager-only detail. Upload-time extraction remains synchronous, so progress honestly remains indeterminate until the persisted indexing job is available.

## 2. Backend ingestion and PDF extraction

`POST /workspaces/:slug/knowledge/documents` and `POST /workspaces/:slug/knowledge/:sourceId/document` accept a multipart PDF. The controller caps the upload to one file and four metadata fields. The service requires OWNER/ADMIN access, resolves the workspace organization, verifies an active Knowledge Base owned by that organization, validates the static section, replacement source ownership, MIME type, `.pdf` name, `%PDF-` header and EOF marker, then parses the actual PDF. Maximum size defaults to 10 MiB and maximum pages to 200; `KNOWLEDGE_PDF_MAX_BYTES` / `KNOWLEDGE_PDF_MAX_PAGES` can lower these bounds, never raise them beyond the code cap.

The parser rejects corrupt/encrypted inputs, over-limit pages/text, and any page with no selectable text. OCR is not configured: image-only input returns `PDF_OCR_REQUIRED`; partially unreadable PDFs return `PDF_PARTIAL_OCR_REQUIRED` with page numbers. No translation, summarization or LLM call occurs. Page text, offsets, headings (heuristically detected from extracted lines), per-page SHA-256, word count and warnings are stored with the complete extracted text. PDF.js text extraction retains available paragraph/line breaks; it does not claim layout-perfect table reconstruction.

New source metadata includes a safe filename/title, upload byte count, original upload hash, extracted text hash, source language `en`, page metadata/count, character/word counts, and `extracted: true`. Source text is saved once in `KnowledgeSource.contentBody`; page records store offsets into it rather than duplicate full page bodies. The upload response omits full extracted text. The authorized detail endpoint exposes text for the document view.

## 3. Original-file non-retention

New uploads do not call the private-storage `put` path and never persist file bytes, storage keys, or a file-bearing job payload. The request buffer is overwritten with zeroes in `KnowledgeService.uploadPdf()`'s `finally` block for success and failure. PDF.js receives the bounded bytes through `workerData`; the parser worker is terminated after returning/failing. Extracted source text and metadata are durably created transactionally with an `INDEX` job before success is returned. A database failure returns an error and the upload buffer is still cleared.

Legacy sources can still have old private `storageKey` values. The existing indexing worker now saves extracted text first, deletes a legacy original after durable persistence, strips storage keys from metadata, and retries/report-codes cleanup failure. Legacy reindexing can therefore complete from persisted extracted text without reopening a PDF. The old private storage interface remains read/delete-only for this cleanup compatibility; no new permanent storage integration was introduced.

## 4. Chunking and indexing compatibility

`pdfChunks()` slices persisted extracted text by real page ranges and calls the existing bounded paragraph/heading-aware `chunkKnowledgeText()` (up to 2,800 characters with existing overlap behavior). Chunks retain actual English content and page locator/title/heading context. The existing indexing worker assigns source version/generation/order/hash and tenant identity through its established `KnowledgeChunk` insertion path. A new upload queues `INDEX`; it is not presented as READY before the worker publishes the generation. Existing semantic indexing remains optional/configuration-dependent, and lexical readiness behavior is unchanged.

## 5. Frontend upload and status

The active Knowledge Library opens `KnowledgeDocumentDialog` for a static section. The dialog selects an active Knowledge Base, supports section-scoped upload/replacement, displays real file size and server limits, and uses a synchronous indeterminate extraction message rather than simulated percentages. On success it opens the saved source, requests document details and tenant-scoped processing status, and bounded-polls persisted source/job state while indexing is pending. The detail view displays page text, real word/page metadata, current source status, published-generation chunk count, semantic status and Knowledge Base assignment summary. It supports reindexing saved extracted text, replacement and existing archive/permanent-delete operations.

The server status response scopes the source by authorized organization, then queries jobs/chunks by organization, source ID and current source version. It exposes processing ID, real stage, page totals/extracted/persisted counts, current published-generation chunk count, safe failure reason and persisted timestamps. Extraction is synchronous within the HTTP request, so upload-time page progress is not available; UI explicitly reports indeterminate progress. There is no timer-simulated progress.

## 6. Tenant and authorization boundaries

Upload and replacement require workspace OWNER/ADMIN and organization-scoped Knowledge Base/source lookups. Duplicate content lookup, unique-conflict recovery, job creation, source replacement and status counts are organization scoped. Replacements use a source-version compare-and-set, cancel stale pending jobs and enqueue the new version transactionally. Existing worker lease/source-version checks fence indexing publication. Products & Collections remain Shopify-only. No AI/RAG retrieval authorization code was modified.

## 7. Verification results

- **PASS:** `timeout 140s node --require ../scripts/phase00/offline.cjs node_modules/vitest/vitest.mjs run src/tests/knowledge-library.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1` from `frontend/` — exit 0; 1 file, 10 tests passed (61.43 seconds). Coverage includes delayed Knowledge Base loading, single/multiple/empty bases, selection retention on reopen, capability-disabled messaging, capability/list API retry, and upload details.
- **PASS, isolated parser dependency:** `NODE_PATH=/tmp/carteio-pdfdeps/node_modules timeout 120s node --require ../scripts/phase00/offline.cjs node_modules/jest/bin/jest.js --config jest.phase00.config.cjs --runInBand --runTestsByPath test/pdf-ingestion.spec.ts` from `backend/` — exit 0; 1 file, 8 tests passed. It exercised real multi-page PDF.js extraction, OCR-required/corrupt-file rejection, feature-flag behavior, tenant-scoped source construction, queued index-job creation, memory-buffer zeroing and no storage write. PDF.js emitted standard-font-data warnings; the assertions passed. Its database was mocked, not PostgreSQL.
- **PASS, mocked existing index transaction:** `NODE_PATH=/tmp/carteio-pdfdeps/node_modules timeout 120s node --require ../scripts/phase00/offline.cjs node_modules/jest/bin/jest.js --config jest.phase00.config.cjs --runInBand --runTestsByPath test/knowledge-processing.spec.ts` from `backend/` — exit 0; 1 file, 50 tests passed. This includes the new persisted-PDF-text-to-existing-chunk-index test and current-version/tenant-scoped progress checks. SQL calls and source/job publication were mocked; this does not establish PostgreSQL persistence.
- **PASS:** `timeout 100s node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` from `backend/` — exit 0.
- **FAIL, pre-existing/out of scope:** the same command from `frontend/` — exit 2 with only the two existing TS2367 diagnostics in `src/pages/training/playground-copy.ts:147` and `:154`. The protected Playground file was not edited.
- **BLOCKED:** PostgreSQL-backed upload and real local HTTP/widget verification were not run. The configured `DATABASE_URL` resolves to a remote Neon database, not an isolated local test database, so no connection or writes were attempted. No local PostgreSQL readiness tool/service was available in this environment. Do not treat mocked DB tests as proof of database persistence.
- **Dependency install not completed:** the existing WSL `pnpm` 10 command exited 1 with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Two repository-pinned pnpm 9.15 attempts (including one with the Windows-mounted store path recorded in `.modules.yaml`) displayed “The modules directories will be removed and reinstalled from scratch.” No replacement was authorized/accepted. Final inspection confirms `backend/node_modules/pdfjs-dist` and `backend/node_modules/@napi-rs/canvas` are still missing, and neither `backend/package.json` nor `pnpm-lock.yaml` changed. The parser tests used the `/tmp` copy and `NODE_PATH` explicitly.

### Phase 02 final runtime enablement follow-up — 2026-10-29

**Dependency root cause and resolution status:** this is an installation/linking mismatch, not a missing manifest/lock entry. Root `package.json` pins pnpm 9.15.0; `backend/package.json` declares `pdfjs-dist@5.4.296`; the frozen lock also resolves its optional `@napi-rs/canvas@0.1.100`. The existing `backend/node_modules` lacks both packages. Its `.modules.yaml` points at a Windows pnpm store and Windows absolute virtual-store path, while this shell is WSL and exposes pnpm 10.26.0. The pinned pnpm 9.15.0 invocation also detected a modules-directory layout mismatch and proposed removing/reinstalling the existing module tree. I declined that operation to preserve unrelated dependencies. No project install or dependency version change was made. The exact pinned versions were available only in the isolated `/tmp/carteio-pdfdeps` copy for prior parser tests; the project runtime still cannot resolve them.

`@napi-rs/canvas` is not used to rasterize PDFs or persist images. In this PDF.js 5 Node path it supplies the `DOMMatrix` polyfill expected during module initialization; without it, the legacy PDF.js entry fails before text extraction. Both lockfile-pinned packages are therefore required by the current parser execution path.

**Safe dependency setup:** run from a native Windows shell for the environment that owns this checkout and its pnpm store, after confirming the shell reports pnpm 9.15.0:

```powershell
Set-Location 'C:\Users\Karan Singh Gaharwar\desktop\ai carteio'
pnpm --version
pnpm install --filter @carteio/backend --frozen-lockfile
```

This should link the already locked dependency graph and must not change package versions or the lockfile; pnpm may run declared lifecycle scripts. Do not proceed if it again proposes replacing an unrelated modules tree; inspect the target/store and restore the matching project environment first. Then verify both `require.resolve('pdfjs-dist/legacy/build/pdf.mjs')` and `require.resolve('@napi-rs/canvas')` from `backend/`, and restart the backend. The isolated `/tmp` installation proves the parser packages can run in isolation, but does not enable the checkout's running backend.

**Database and migration status:** sanitized inspection of the active `DATABASE_URL` and Prisma `DIRECT_URL` showed provider Neon, database `neondb`, and non-loopback/remote targets; credentials and host are intentionally omitted. No database write or PDF upload was attempted. The requested read-only `prisma migrate status` attempt exited 1 before querying migration history because the current pnpm module tree lacks Prisma's `schema-engine-debian-openssl-3.0.x`. Therefore application status for migration `20261027170000_knowledge_document_metadata` is **NOT_VERIFIED** (neither applied nor pending is established). The migration in source adds `KnowledgeSource.document JSONB`; no new migration is indicated by the current source schema. Local PostgreSQL executables/services were not available, so an isolated database target could not be established. The remote Neon database was not queried or mutated.

For authorized integration verification, first configure both `DATABASE_URL` and Prisma's `DIRECT_URL` to a disposable local PostgreSQL database with no customer data, verify the target identity without printing credentials, resolve Prisma engine installation in the matching pnpm environment, and run `pnpm --filter @carteio/backend exec prisma migrate status`. If the migration is pending, stop and obtain the project's explicit local-migration approval before applying it to that disposable target; do not point these commands at Neon. Start the backend/Knowledge worker only after safe local configuration, then use a small deterministic English PDF fixture and verify persisted source/page/chunk/job state, READY publication, restart durability, replacement/deletion, and cross-tenant denial. None of those PostgreSQL/runtime assertions has been performed here.

**Final runtime evidence:** previous focused checks remain as recorded above: frontend Knowledge Library 10/10; real PDF.js extraction plus mocked upload persistence 8/8; mocked Knowledge processing/indexing 50/50; backend typecheck PASS; frontend typecheck FAIL only on the two pre-existing `playground-copy.ts` TS2367 diagnostics. They do not prove a real HTTP upload or PostgreSQL persistence. Drawer state and upload controls were verified by the frontend suite; a browser run, backend capability endpoint with project dependencies, actual upload UI, backend-driven live progress, saved-document preview, restart durability, real index publication, and API-level tenant denial remain **BLOCKED / NOT_VERIFIED**. No new verification command was run for this follow-up.

**Current Phase 02 status:** implementation and focused mocked/offline behavior remain **IMPLEMENTED AND FOCUSED VERIFIED**. Real dependency installation and end-to-end upload are **BLOCKED — MANUAL ACTION REQUIRED** by the WSL module-tree mismatch and absence of an approved isolated PostgreSQL target. Phase 03 readiness: **NO**; do not proceed until a safe local DB and the runtime checks above are available. No AI runtime code was changed.

### Owner follow-up: native dependency and migration verification — 2026-10-29

This later read-only inspection supersedes the dependency-presence snapshot above: `backend/node_modules/pdfjs-dist` is now a link into the shared root virtual store and `require.resolve('pdfjs-dist/legacy/build/pdf.mjs')` succeeds under WSL. `backend/node_modules/@napi-rs/canvas` is absent and `require.resolve('@napi-rs/canvas')` fails with `MODULE_NOT_FOUND`. The locked canvas package directory exists in the shared virtual store, but the backend dependency link is missing. The root `.modules.yaml` identifies pnpm 9.15.0 and a Windows `C:\Users\...\AppData\Local\pnpm\store\v3` plus Windows virtual-store paths. WSL reports Node 24.15.0; its pnpm shim failed before starting because it could not create its pnpm 9.15 tool directory under `/home/...`. Native PowerShell invocation from WSL failed with `WSL ERROR: UtilBindVsockAnyPort`, so Windows Node/pnpm versions could not be inspected in this session. No install was attempted and no modules directory was replaced.

Prisma 7.10.0 is declared/linked, but `timeout 15s node node_modules/prisma/build/index.js --version` from `backend/` exited 124 with no output. The read-only migration status was therefore not retried. Source inspection confirms `backend/prisma.config.ts` loads `backend/.env` and selects `DIRECT_URL` (not `DATABASE_URL`) for migrations. Earlier sanitized environment inspection identified this checkout's configured direct URL as remote Neon. No migration status is established: `20261027170000_knowledge_document_metadata` remains **NOT_VERIFIED**. No connection, migration, upload, or database write occurred in this follow-up.

**Safe native Windows recovery procedure:** do not run pnpm from WSL and do not allow it to relink this mixed-OS tree. In native PowerShell, create a disposable verification copy of the current working source that excludes `.git`, all `node_modules`, and all `.env*` files; preserve the original checkout. Run this from the source checkout root:

```powershell
$src = (Get-Location).Path
$dst = Join-Path $env:TEMP 'carteio-phase02-windows-verify'
if (Test-Path $dst) { throw "Destination already exists; inspect it and choose a new empty path: $dst" }
robocopy $src $dst /E /XD .git node_modules
if ($LASTEXITCODE -ge 8) { throw "Robocopy failed with exit code $LASTEXITCODE" }
Get-ChildItem $dst -Force -Recurse -File | Where-Object { $_.Name -like '.env*' } | Remove-Item -Force
Set-Location $dst
corepack pnpm@9.15.0 --version
corepack pnpm@9.15.0 install --filter @carteio/backend --frozen-lockfile
Set-Location (Join-Path $dst 'backend')
node -p "require.resolve('pdfjs-dist/legacy/build/pdf.mjs')"
node -p "require.resolve('@napi-rs/canvas')"
corepack pnpm@9.15.0 exec prisma --version
```

Require the pnpm version output to be `9.15.0`. The copy means frozen installation cannot replace or mix the original WSL/Windows module trees; package manifests and lockfile remain frozen. If the destination exists, stop and choose a different empty path rather than deleting it. To use the original checkout's direct URL for the **read-only** status query without printing it, run from PowerShell with `$src` still set:

```powershell
$directLine = Get-Content (Join-Path $src 'backend\.env') | Where-Object { $_ -match '^\s*DIRECT_URL\s*=' } | Select-Object -First 1
if (-not $directLine) { throw 'DIRECT_URL not found in backend/.env' }
$env:DIRECT_URL = ($directLine -replace '^\s*DIRECT_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
corepack pnpm@9.15.0 exec prisma migrate status --schema prisma/schema.prisma
Remove-Item Env:DIRECT_URL
```

Run that from the verification copy's `backend/`. The Prisma config explicitly selects `DIRECT_URL`; this command only inspects migration state. Do not run `migrate deploy` or `migrate dev` without explicit approval. Do not use the remote Neon URL for data-write tests.

Actual PDF upload/integration remains **BLOCKED**: no isolated development PostgreSQL endpoint/service is available in this environment. Once one is provisioned, use only that target for both application connection variables as appropriate, confirm the target identity without logging its URL, query migration status, and run bounded upload/index/restart/delete/tenant-denial checks. No upload, persisted source/page/chunk evidence, index readiness, or original-byte retention check against PostgreSQL is claimed here. No source-code correction was indicated by these setup checks, so Phase 02 code was not changed; no AI/RAG code was touched. Phase 03 readiness remains **NO**.

Before using the `/tmp` parser copy, the same focused PDF spec without `NODE_PATH` exited 1 (4 failed, 3 passed): PDF.js resolution failed with `MODULE_NOT_FOUND`. The service capability test with a mocked parser passed; the real extraction/upload cases failed at parser load. After placing the lockfile-pinned PDF.js and canvas packages in `/tmp`, the same spec passed 8/8. This separates the repository's stale local dependency installation from extraction behavior.

The earlier pre-test Jest timeouts are now explained for these specs: after a bounded `--listTests` pass, actual test execution spent roughly 40–50 seconds in ts-jest startup/transform and then completed when allowed the full 120-second bound. That startup latency was not an assertion hang. The backend focused suites now have actual passing assertion reports under the temporary parser path.

## 8. Files changed for Phase 02

- `backend/src/modules/workspaces/knowledge.controller.ts` — bounded PDF multipart fields/upload routes.
- `backend/src/modules/workspaces/knowledge.dto.ts` — title and persisted processing-stage contract.
- `backend/src/modules/workspaces/knowledge.service.ts` — validation, extraction-before-persistence, zeroed memory buffer, tenant-scoped create/replace/duplicate logic, durable indexing handoff and legacy file cleanup.
- `backend/src/modules/workspaces/pdf-extraction.ts` — bounded PDF.js worker, real page extraction/metadata and page-aware chunk preparation.
- `backend/src/modules/workspaces/local-knowledge-storage.ts`, `private-knowledge-storage.ts` — bounded deployment limits and read/delete-only legacy storage boundary.
- `backend/src/modules/workspaces/knowledge-processing.service.ts` — tenant/version-scoped real status DTO and persisted-text worker indexing/legacy-original cleanup.
- `backend/test/pdf-ingestion.spec.ts`, `backend/test/knowledge-processing.spec.ts` — real parser, upload non-retention, PDF index handoff and status-scope regression coverage; focused suites passed using `/tmp` parser dependencies.
- `frontend/src/dashboard-source/KnowledgeDocumentDialog.tsx`, `KnowledgeLibrary.tsx`, `knowledge-library.css` — active section upload/detail UI; the Phase 01 `KnowledgeLibrary` route integration was retained.
- `frontend/src/services/api/client.ts` — exposes a non-secret session generation so the short-lived Knowledge Base selector cache cannot survive authentication changes.
- `backend/.env.example` — corrects the document toggle default and clarifies the legacy-only storage root.
- `frontend/src/services/api/knowledge.ts`, `knowledge-bases.ts` — upload, metadata/status and Knowledge Base client contracts.
- `frontend/src/tests/knowledge-library.test.tsx` — upload/details coverage; all 4 tests passed.
- `reports/carteio-knowledge-phase-02-pdf-extraction.md` — this report.
- `docs/development/phase-register.md`, `lastwork.md` — current Knowledge Base track status and verification record; historical Phase 00 evidence was left unchanged.

The repository already contained uncommitted Phase 01 changes and other unrelated work; they were preserved. Phase 00 failure records and its BLOCKED state were not modified. The historical main-roadmap Phase 02 entry is unrelated and unchanged.

## 9. Manual setup and blockers

- **New migration required: NO.** The existing schema already has `KnowledgeSource.document Json?`, full extracted `contentBody`, and the existing tenant/version-scoped job/chunk tables. The repository contains `backend/prisma/migrations/20261027170000_knowledge_document_metadata/migration.sql`, which adds the `KnowledgeSource.document` JSONB column. No migration or Prisma Client generation was run. Whether that migration is applied in the remote configured database is **NOT_VERIFIED**.
- Before a genuine local upload, use the matching native Windows pnpm 9.15 environment and the frozen install procedure in section 7. Verify both PDF.js and canvas resolve from `backend/`, then restart the backend. The app flag can be left unset (enabled by default) or set to `KNOWLEDGE_DOCUMENTS_ENABLED=true`; set it to `false` only to intentionally pause uploads. `KNOWLEDGE_PRIVATE_STORAGE_ROOT` is not required for new PDF uploads. Run the existing Knowledge worker with `KNOWLEDGE_WORKER_ENABLED=true` to publish the index and reach READY.
- For DB verification, first select a disposable local PostgreSQL target for both `DATABASE_URL` and `DIRECT_URL`, then query migration status. The active target inspected here is remote Neon; it was not queried or mutated. Prisma migration status could not be established because the required schema engine is missing from the current installation. No claim is made that PostgreSQL stored a document in this run.
- OCR is unsupported; text-based English PDFs are required. The existing upload limits are 10 MiB / 200 pages maximum and must be lowered when deployment request/memory/duration limits require it. The two frontend Playground type diagnostics remain unrelated blockers.
- Phase 03 has not started. This follow-up verifies parser/extraction and mocked existing indexing contracts only. End-to-end PostgreSQL persistence, assistant retrieval, citation/answer behavior, public-widget use, and customer-visible bot accuracy remain unverified.

**AI runtime preservation:** No Conversation Orchestrator, intent interpretation, provider/model routing, system prompt, Bot Behavior, answer generation, citation validation, conversation memory, Shopify execution, Agent Builder runtime, Playground/widget conversation behavior, or RAG retrieval/ranking algorithm was modified.
