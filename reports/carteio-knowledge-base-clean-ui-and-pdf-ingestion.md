# Clean Knowledge Base and PDF ingestion

Status: **IMPLEMENTED — NOT RUNTIME VERIFIED** for source changes. Activation is **BLOCKED — MANUAL ACTION REQUIRED**. No PDF has been uploaded, parsed, indexed or used in a conversation during this work.

## Root cause and approach

The active dashboard had section navigation but no document upload endpoint, document metadata, configured private storage or PDF processor. Its source endpoint returned only the latest 100 records and the UI filtered that incomplete list locally.

PDF-derived sources now use the existing TEXT source type with private document metadata. This preserves the existing source resolver, public/private visibility, Knowledge Base assignments, lexical/semantic indexing and conversation grounding path. There is no second retrieval engine or change to provider routing.

## Feature coverage

| Feature | Source implementation | Status |
|---|---|---|
| Home | Six compact sections; counts from server; no long forms/source table on home; Legacy/Unclassified remains separate | IMPLEMENTED — NOT RUNTIME VERIFIED |
| Section details | Scoped server search, 20-row pages, Upload PDF, contextual Add Knowledge, unchanged FAQ import and visibility choices | IMPLEMENTED — NOT RUNTIME VERIFIED |
| PDF upload | Authenticated owner/admin, active base in same tenant, static section validation, PDF extension/MIME/header/EOF, 10 MiB cap, queued source/job/base link transaction | IMPLEMENTED — NOT RUNTIME VERIFIED |
| Private files | Explicit development-only filesystem root outside checkout, private modes, generated tenant-hashed keys, traversal/symlink checks, atomic writes, no public URLs | IMPLEMENTED — NOT RUNTIME VERIFIED |
| Extraction | PDF.js 5.4.296, isolated parser thread, 128 MiB JS old-generation/32 MiB young-generation bounds, 60-second deadline, 200 pages, 1M text characters | IMPLEMENTED — NOT RUNTIME VERIFIED |
| Index | Existing durable INDEX jobs, source hash verification, page offsets, existing meaningful text chunker, page locators, lease/version revalidation and atomic generation publication | IMPLEMENTED — NOT RUNTIME VERIFIED |
| Inspection | On-demand extracted page text, page/chunk counts, version, filename, errors, title editing, replacement and reprocess; bounded foreground-view status polling | IMPLEMENTED — NOT RUNTIME VERIFIED |
| Deletion | Existing archive/revocation and owner-only permanent deletion; private file cleanup on permanent deletion and replacement | IMPLEMENTED — NOT RUNTIME VERIFIED |
| Counts | Tenant-scoped server count/groupBy, section/status totals, search/pagination; default existing source response fields retained | IMPLEMENTED — NOT RUNTIME VERIFIED |
| Production durable storage | No compatible configured object-storage adapter was found. Local adapter explicitly refuses production | BLOCKED — MANUAL ACTION REQUIRED |
| OCR and complex tables | Empty/partially unreadable documents are rejected with OCR-required codes; OCR and guaranteed complex table reconstruction are not implemented | PARTIALLY IMPLEMENTED |

## API and lifecycle

- `GET /api/v1/workspaces/:slug/knowledge/document-capabilities`: actual local configuration/parser availability; does not claim worker liveness.
- `POST /api/v1/workspaces/:slug/knowledge/documents`: multipart `file`, `knowledgeBaseId`, `knowledgeSection`, `visibility`.
- `POST /api/v1/workspaces/:slug/knowledge/:sourceId/document`: replacement, retaining existing source identity, visibility and assignments. Same-content replacement is a no-op; new content increments the version and invalidates old current evidence.
- Existing source GET, processing, reindex, update, archive and permanent-delete endpoints remain in use.
- Source list accepts optional `page`, `pageSize` (max100), `search`, `section` (including `UNCLASSIFIED`), `processingStatus`; returns additive page/count metadata. Explicit paginated lists omit full extracted bodies. No-query legacy lists retain content fields and their default page size, with an accurate total.

Upload does not parse synchronously and never marks READY. The existing worker claims the queued job, extracts privately stored bytes, saves actual text/page offsets, then indexes page-aware chunks. READY is published only after the lexical index transaction succeeds. Semantic indexing retains the current optional configuration/error behavior: lexical READY does not imply semantic readiness. Extraction failures expose bounded codes, not parser stack traces. Encrypted, malformed, image-only, partially unreadable and over-limit documents fail explicitly. No LLM is used for extraction. PDF content remains untrusted evidence.

Page coordinates preserve basic line/row boundaries; complex multi-column/table layouts require manual inspection and are not guaranteed. Page boundaries are retained, and each page can yield multiple chunks according to existing limits. No canned customer replies were introduced.

## Files changed in this task

| Path | Change |
|---|---|
| `frontend/src/dashboard-source/pages.tsx` | Home/detail separation, server source filters/counts/pages, PDF panel, direct detail lookup beyond first100 |
| `frontend/src/dashboard-source/KnowledgePdfPanel.tsx` | Upload/setup state, base selection/creation, explicit visibility, lazy source inspection, replacement/reprocess/archive/title actions |
| `frontend/src/dashboard-source/knowledge-sections.css` | Bounded readable extracted-content preview |
| `frontend/src/services/api/knowledge.ts` | Additive document and paginated-list contracts, multipart upload |
| `frontend/src/tests/faq-import-dashboard.test.tsx` | Adapt preserved FAQ/access checks to section-detail navigation and server filtering |
| `frontend/src/tests/knowledge-pdf-panel.test.tsx` | Explicit upload payload/visibility, unavailable-storage behavior, no false READY |
| `backend/src/modules/workspaces/knowledge.controller.ts` | Capability/upload/replacement routes and bounded multipart limits |
| `backend/src/modules/workspaces/knowledge.dto.ts` | Validated document and source-list parameters |
| `backend/src/modules/workspaces/knowledge.service.ts` | Tenant/base checks, upload/version transaction, cleanup, sanitized metadata, accurate pagination/counts |
| `backend/src/modules/workspaces/private-knowledge-storage.ts` | Private read boundary with fail-closed default |
| `backend/src/modules/workspaces/local-knowledge-storage.ts` | Development storage adapter |
| `backend/src/modules/workspaces/pdf-extraction.ts` | Real bounded PDF.js extraction and page-aware use of existing chunker |
| `backend/src/modules/workspaces/knowledge-processing.service.ts` | PDF extraction inside existing INDEX job, integrity checks, safe error codes and source locators |
| `backend/src/modules/workspaces/workspace.module.ts` | API storage binding |
| `backend/src/modules/workspaces/knowledge-worker.module.ts` | Standalone worker storage binding |
| `backend/prisma/schema.prisma` | Nullable document JSON metadata |
| `backend/prisma/migrations/20261027170000_knowledge_document_metadata/migration.sql` | Additive metadata column; not executed |
| `backend/package.json` | Declare PDF.js; package/lock installation not executed |
| `backend/.env.example` | Disabled-by-default PDF flag and empty private-root example |
| `backend/test/pdf-ingestion.spec.ts` | Real PDF fixture extraction, malformed/empty documents, private storage isolation/cleanup, upload transaction/failure cleanup, counts beyond100 |
| `reports/carteio-knowledge-base-clean-ui-and-pdf-ingestion.md` | This report |

## Manual setup (not executed)

1. On the existing supported Node24 environment, review the new parser dependency and run the repository's normal `pnpm install --no-frozen-lockfile` process. Review/commit the resulting lockfile separately. The current lockfile is intentionally unchanged and frozen installation will require this update.
2. Review/back up the intended development database, then apply pending migrations using the established migration procedure. Required additions include the already pending `20261027120000_knowledge_source_sections` and new `20261027170000_knowledge_document_metadata`. Do not deploy this Prisma/client source against a database missing these columns. Commands, after your approval: `pnpm --filter @carteio/backend prisma:migrate:status`, `pnpm --filter @carteio/backend prisma:migrate:deploy`, `pnpm --filter @carteio/backend prisma:generate`. These can include other pending migrations; inspect the list first.
3. Create a dedicated backend-owned private directory outside the repository/public web trees with mode0700. Set `NODE_ENV=development`, `KNOWLEDGE_DOCUMENTS_ENABLED=true` and `KNOWLEDGE_PRIVATE_STORAGE_ROOT` to its absolute path in your own environment. API and existing knowledge worker must use the same root and OS permissions. Do not use this adapter for production/multiple unshared hosts.
4. Start the existing configured Knowledge worker yourself (`KNOWLEDGE_WORKER_ENABLED=true`) only after migrations/configuration. Nothing started here. The capability flag is not a heartbeat; queued jobs can wait if no worker is alive.
5. Production requires an approved durable private `PrivateKnowledgeStorage` implementation, credentials provisioned outside code, private bucket policy, retention/cleanup and API/worker bindings. No cloud resources or credentials were created.

## Verification still required

All written tests are **NOT RUN — USER RESTRICTION**. TypeScript, builds, lint, dependency resolution, parser compatibility and database integration are unverified. The historical Phase00 gate remains blocked; no prior test results were overwritten or relabelled.

After setup, manually verify real multipage PDFs; blank/encrypted/scanned/oversized failures; database/storage failures; concurrent replace/delete; worker crash/retry/lease recovery; exact page and numeric facts; current-generation lexical and configured semantic retrieval; public versus restricted assignments; two tenants; cross-section questions and mixed Shopify/policy questions. Verify existing FAQ/text/website suites and the new tests offline under the existing approved harness. Confirm mobile/dark layouts and collections/product navigation. No runtime result is claimed.

File/database operations cannot be one atomic transaction. Failed replacement cleanup keeps old opaque keys in private metadata; failed permanent-delete cleanup creates a tenant audit event `knowledge.private_file_cleanup_required`. A crash between filesystem write and database commit can leave an unreferenced private file; operational reconciliation is still required before production. Archive intentionally retains files for restore under existing retention semantics. No background garbage collector was added. Parser memory bounds do not constitute OS-level sandboxing.

Source version replacement preserves old rows until successful index publication, but old chunks cannot serve as current evidence after replacement. If the new PDF fails, correct/re-upload it; no stale facts are silently served. Duplicate uploads conflict using a tenant/content hash key; unchanged replacement does not duplicate indexing. Category labels do not restrict customer retrieval; source authorization still does.

No Orchestrator, prompts, LLM settings, Shopify permission logic, widget security, Agent Builder runtime, billing, ticketing or authentication code was changed. Existing files were read and selectively patched over their current modified state; no reset/restore/deletion of user work occurred. No tests/builds/typechecks/lint/install/migration/server/worker/deployment or external requests were executed.
