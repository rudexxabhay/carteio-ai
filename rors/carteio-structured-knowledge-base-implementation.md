# Structured Knowledge Base, Shopify Catalog & Natural Grounded AI

Status: **IMPLEMENTED — NOT RUNTIME VERIFIED**. No tests, builds, migrations, servers, workers, provider calls, Shopify requests, or external requests were run.

## A. Existing architecture

- FAQ, text, and website sources use the existing `KnowledgeSource` model and organization-qualified service operations. FAQ and text creation queue the existing knowledge processing/index jobs; website sources continue through the existing crawl and publication workflow.
- `KnowledgeProcessingService` and the existing indexing/chunk services own current-generation chunks, pages, lexical retrieval, and configured semantic indexing. This work does not create a new retrieval engine or change orchestrator evidence selection.
- `KnowledgeSource.category` already represents source/FAQ categories, so section organization is persisted separately as `knowledgeSection` to avoid changing its meaning. Existing uncategorized records remain `NULL` and are counted as `UNCATEGORIZED` in service summaries.
- The `KnowledgeSource` schema already carries source body, source version, processing state, and active index generation. Existing `KnowledgePage` and `KnowledgeChunk` records support page/chunk inspection for sources that produce them.
- Shopify catalog readiness, synchronized data, permissions, products, variants, collections, and sync state are supplied by the existing connector-backed `BusinessDataVisibility` component. The Knowledge Base catalog view embeds that component; it does not create product records or issue Shopify API calls itself.
- The current Knowledge Base detail page includes an owner/admin search preview that calls the existing authorized retrieval preview service. Static sections are metadata and UI filters; retrieval remains cross-section over the same eligible authorized sources.

### PDF/document ingestion blocker

The repository has no wired PDF extraction/OCR pipeline or generic document upload endpoint. `PrivateKnowledgeStorage` is bound to `UnconfiguredPrivateKnowledgeStorage`, whose `put()` reports `PRIVATE_STORAGE_UNAVAILABLE`; the Knowledge Base upload endpoints found are for FAQ CSV/XLSX imports. No PDF parser/OCR dependency or PDF-specific source lifecycle was found. Therefore this implementation does **not** claim PDF upload, extracted page preservation, OCR, document chunking, or document readiness. A real private storage provider and supported extraction worker/parser are required before that workflow can be implemented safely. No dependency or storage configuration was added.

## B. Implemented changes

| File | Change and preservation |
|---|---|
| `backend/src/modules/workspaces/knowledge-sections.ts` | Defines the five accepted static section identifiers used by DTO validation. Shopify is deliberately not a static source section. |
| `backend/prisma/schema.prisma` | Adds nullable `KnowledgeSource.knowledgeSection` and an organization/section/status index. Nullable default preserves existing source rows without reclassification. |
| `backend/prisma/migrations/20261027120000_knowledge_source_sections/migration.sql` | Adds the nullable column and index only. Migration was not applied. |
| `backend/src/modules/workspaces/knowledge.dto.ts` | Validates optional section metadata on existing website, FAQ, text, import, and source-update DTOs. Existing fields and routes remain. |
| `backend/src/modules/workspaces/knowledge-base.dto.ts` | Validates section filters for existing Knowledge Base source-list endpoints. |
| `backend/src/modules/workspaces/faq-import.ts` | Carries optional section metadata on imported FAQ rows without changing spreadsheet columns or existing import parsing. |
| `backend/src/modules/workspaces/knowledge.service.ts` | Returns and persists section metadata on existing source creation/import/update paths. Existing organization checks, visibility defaults, duplicate handling, and index job creation remain. Shopify-discovered website behavior was left alone. |
| `backend/src/modules/workspaces/knowledge-base.controller.ts` | Passes the authorized import request’s validated section into imported FAQ records. Existing preview/commit behavior is retained. |
| `backend/src/modules/workspaces/knowledge-base.service.ts` | Returns section metadata, filters base/unassigned/available source lists by section, and reports tenant/base-scoped source and processing counts by section. It does not filter the customer retrieval engine by a single section. |
| `frontend/src/services/api/knowledge.ts` | Adds the section union and optional source field to the existing source contract. |
| `frontend/src/services/api/knowledge-bases.ts` | Adds section metadata to FAQ/text/import contracts and section count summaries. Existing endpoints are reused. |
| `frontend/src/pages/knowledge/knowledge-sections.ts` | Defines five static section labels/descriptions plus the separate Shopify catalog tab. |
| `frontend/src/pages/knowledge/KnowledgeBasePage.tsx` | Adds five static section tabs/cards with real source/ready counts, section-scoped source listing and creation/import metadata, and a separate Products & Collections view backed by the existing Shopify component. Section views do not inherit stale FAQ/Text type filters. Existing FAQ, text, import, assistant assignment, source detail, and search preview flows remain in place. |
| `frontend/src/pages/knowledge/BusinessDataVisibility.tsx` | Allows the existing authorized Shopify status/catalog panel to render as a compact Products & Collections view while preserving its existing full-page Website/Shopify behavior. |
| `frontend/src/pages/knowledge/knowledge-bases.css` | Adds compact responsive section-card styles using existing theme variables. |
| `backend/test/knowledge.service.spec.ts` | Adds unexecuted DTO validation and source section persistence coverage. |
| `backend/test/knowledge-base.service.spec.ts` | Adds unexecuted tenant/base-scoped section filter and summary coverage. |

## C. Functional coverage

| Area | Source-level result |
|---|---|
| Six visible sections | Five static section cards/tabs plus a distinct Shopify catalog card/tab are wired in the existing Knowledge Base detail interface. |
| Static source organization | FAQ, text, and website source paths accept persisted section metadata. Existing uncategorized sources remain unchanged. |
| PDF/document upload | **Blocked**: no configured private object storage or extraction/indexing pipeline. No fake upload or READY state was added. |
| Existing chunk/index lifecycle | Preserved. Existing indexing jobs and active-generation handling remain authoritative; section assignment itself does not imply readiness. |
| Source inspection | Existing source details, content preview, current indexing state, chunks, and assignment APIs remain available. New section metadata is returned by source contracts. |
| Assistant assignments | Existing Knowledge Base and source assignment routes remain unchanged; no visibility is automatically changed. |
| Shopify catalog | Uses existing connector authorization, permissions, persisted catalog/sync state and UI. Shopify is not stored as uploaded static knowledge. |
| Cross-section retrieval | Preserved through the existing authorized retrieval path; section categories are not retrieval restrictions. |
| Natural grounded responses | Orchestrator, prompts, provider, grounding, and citations were not changed. Existing LLM response generation continues to receive selected evidence under current rules. |
| Playground diagnostics | Existing search preview remains; no new diagnostic contract was added. |

## D. Unverified items and manual steps

- Before deploying code that reads the new column, regenerate the Prisma client and apply migration `20261027120000_knowledge_source_sections` through the normal backend migration workflow: `cd backend && pnpm prisma:generate`, then `cd backend && pnpm prisma:migrate:deploy`. Neither command was run. Follow the repository’s deployment ordering for generated client and schema rollout.
- Run focused backend tests manually after migration: `cd backend && pnpm exec jest --runInBand test/knowledge.service.spec.ts test/knowledge-base.service.spec.ts`.
- Run the frontend’s normal typecheck/test commands manually after backend verification: `cd frontend && pnpm typecheck` and `cd frontend && pnpm test -- --run` (the latter runs the configured suite; scope it to the Knowledge Base test file if one exists in the current checkout).
- Verify section counts and source filtering against an organization with both legacy uncategorized and newly categorized sources; verify FAQ import assigns the selected section; confirm non-manager access remains read-only.
- Verify Shopify readiness/counts through an authorized connected workspace in the application. No live connector call was made here.
- PDF upload remains blocked pending an approved private storage implementation and actual parser/extraction/worker design. If image-only PDFs must be supported, OCR capability and its operational/security configuration are also required.
- No runtime behavior, schema compatibility, UI rendering, or deployment readiness is claimed.

## E. Preservation

The existing Orchestrator, retrieval/ranking, grounding/citations, Shopify permissions/catalog, FAQ import parsing, text ingestion, website crawler, Bot Behavior, widget, and Agent Builder implementations were not intentionally altered. Existing API routes are reused; the only data contract addition is optional nullable `knowledgeSection`, which requires the unapplied migration above. No test was executed, so regression safety is source-reviewed only.
