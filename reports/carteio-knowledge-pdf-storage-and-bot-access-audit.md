# Knowledge PDF Storage and Bot Access Audit

**Scope:** read-only audit of the uploaded `01_Business_Introduction.pdf`, plus a narrowly scoped Knowledge Library correction. The existing interpretation pipeline remains the only place that handles customer language and produces English retrieval queries. No new language, intent, or query rewriting logic was added.

## A. What currently works

- The configured Neon PostgreSQL database was queried with read-only `SELECT` statements. The uploaded source exists in the expected organization and Knowledge Base. Its persisted state is `REGISTERED` / `READY`, it has source version 1 and active index generation 1, and its document metadata marks it as an extracted PDF in `BUSINESS_INTRODUCTION`.
- The persisted source body is 5,261 characters and 765 words. Its SHA-256 matches the document content hash. Document metadata contains two page records with valid body offsets and page hashes; their word counts are 373 and 392. Both page hashes and counts reconcile with the stored body.
- Three chunks are persisted and belong to the current source version and active generation. Each chunk content hash matches its content. The active chunk set covers all 331 distinct normalized token types in the extracted body. Chunk locators point to page 1 and page 2 in nondecreasing sequence order.
- The PDF source is linked to the active `Carteio` Knowledge Base. A current assistant is linked to that base. The PDF visibility is `PUBLIC_REFERENCE`, so its saved visibility is eligible for public retrieval subject to the server-side assistant/base, source readiness, deletion, version, and generation checks below.
- The migration `20261027170000_knowledge_document_metadata` is present as finished in this database's Prisma migration history. No schema migration was needed for the inspection or UI correction in this report.

These findings establish stored PDF-derived text and chunks, not a real LLM answer or complete end-to-end bot behavior.

## B. Actual uploaded PDF records

| Property | Read-only database result |
|---|---|
| Organization / Knowledge Base | Correct Carteio organization and active `Carteio` base |
| Source kind | `TEXT` source with extracted-PDF document metadata (the existing retrieval contract accepts `TEXT`) |
| Section / visibility | `BUSINESS_INTRODUCTION` / `PUBLIC_REFERENCE` |
| Source status | `REGISTERED`, processing `READY` |
| Version / active generation | 1 / 1 |
| Body | 5,261 characters; 765 words; content hash matches |
| Pages | 2 metadata page records; no separate `KnowledgePage` rows for this PDF |
| Chunks | 3 records, all current-version/current-generation |
| Embeddings | 0 for this PDF |
| Semantic status | `NOT_CONFIGURED` |

PDF pages are persisted as page metadata (including offsets, hashes, and word counts) over the durable `KnowledgeSource.contentBody`; PDF chunk page references are in chunk locators. The absence of separate `KnowledgePage` rows is the current PDF representation, not evidence that the page text is absent.

## C. Chunk quality assessment

Database consistency checks found matching per-page hashes/counts, matching chunk hashes, current source version/generation on all three chunks, monotonically ordered page locators, no repeated exact page lines, and complete normalized distinct-token coverage. These checks support text preservation and indexing coverage.

This was not a line-by-line human review of the private document. Consequently, semantic fact entailment, table fidelity, header/footer quality, and every numeric condition are **NOT VERIFIED**. Token coverage cannot prove that all relationships or facts remain correctly grouped. No document text or private facts are reproduced in this report.

## D. Lexical and vector indexing

- The schema has a `KnowledgeChunk.embedding` vector column and an HNSW index, and a GIN lexical index over `to_tsvector('simple', content)`. Tenant/source/version/generation indexes are also present.
- This PDF has three persisted chunks but zero embeddings. Its semantic state is `NOT_CONFIGURED`; the presence of a vector column/index does not make these chunks vector-searchable.
- Existing lexical search remains the available path for this source. The runtime service uses PostgreSQL full-text search and applies organization, authorized-source, READY, source-version, active-generation, and public-visibility constraints. Semantic retrieval is optional and cannot be claimed for this PDF.
- No embedding provider was invoked or configured as part of this audit.

## E. Assistant and customer access

The read-only records show an active Knowledge Base link to an active assistant, and the PDF source is `PUBLIC_REFERENCE`. The existing `KnowledgeBaseService.resolveEffectiveSources()` additionally requires the source to be registered, not deleted, `READY`, and to have an active index generation; it resolves only sources linked to the requested active assistant/base or another existing authorized path. `KnowledgeProcessingService.searchPreview()` scopes the workspace membership, resolved source IDs, visibility audience, current source version and active generation before returning evidence.

**READY FOR AI** means processing completed and a current active index generation exists. It does not grant customer visibility. **AUTHORIZED FOR CUSTOMER BOT** additionally requires a public-eligible visibility/access path and the active assistant/base authorization to resolve the source for the public audience. Internal-only uploads must remain unavailable to public retrieval even when indexed. The existing upload default remains restricted; the UI communicates that customer use requires approved public visibility and assistant access. No permission was broadened by this audit.

The database state indicates this PDF meets the persisted visibility and assistant/base prerequisites. Runtime resolution through the service could not be completed within the bounded attempt (see section I), so final service-level eligibility is **NOT VERIFIED**.

## F. Knowledge-to-LLM flow

Source trace, with AI files left unchanged:

1. `ConversationOrchestrator` passes the `knowledgeRetrievalQueries` produced by its existing interpretation path to `KnowledgeProcessingService.searchPreview()`; the English query string is passed through unchanged. This audit adds no translation or query planning.
2. `KnowledgeBaseService.resolveEffectiveSources()` resolves assistant-authorized, public-eligible source IDs.
3. `KnowledgeProcessingService.searchPreview()` executes the existing lexical/optional semantic retrieval, constrained to authorized IDs and the current source version/active generation.
4. Existing result selection/evidence assembly preserves source references and builds the provider message context. Existing source authorization and citation verification remain in their current AI runtime.

Relevant code: `backend/src/modules/workspaces/conversation-orchestrator.service.ts` (retrieval query call near lines 1090–1175; provider context near 1318–1356); `backend/src/modules/workspaces/knowledge-processing.service.ts` (`searchPreview`, beginning near line 626); `backend/src/modules/workspaces/knowledge-base.service.ts` (`resolveEffectiveSources`, near line 298).

The bounded attempt to invoke `searchPreview()` against the configured remote service timed out (exit 124); therefore this report does not claim observed query-to-chunk retrieval, an actual provider handoff, or a real Gemini response. No paid provider call was made. The existing interpretation query must be captured from a safe trace in a separate authorized local/isolated runtime verification to prove that exact query and returned evidence end to end.

## G. Old source inventory and safe cleanup plan

The active, non-archived organization source inventory is 159 records: 155 `FAQ`, 2 `TEXT` (the uploaded PDF plus one legacy text source), and 2 `WEBSITE`. No other type was returned. FAQ, TEXT, and WEBSITE are all supported source kinds in the existing effective-source resolver; legacy sources can remain retrieval-eligible if their state, visibility, assignment, and current index satisfy its checks. They were not automatically hidden or deleted.

The Knowledge overview previously treated the generic source counts as PDF counts, which made legacy records appear to be PDF documents. The correction adds PDF-specific counts based on the persisted extracted-document marker and filters section document lists to those sources. Generic source counts and shared runtime behavior remain intact.

Before any owner-run cleanup, preview exact candidates in the intended organization and exclude extracted PDFs:

```sql
SELECT id, type, name, knowledge_section, status, processing_status, visibility
FROM "KnowledgeSource"
WHERE organization_id = '<target-organization-uuid>'
  AND archived_at IS NULL
  AND NOT COALESCE((document->>'extracted')::boolean, false)
  AND type IN ('FAQ', 'TEXT')
ORDER BY type, name, id;
```

Review WEBSITE sources separately because they may belong to the active Website Crawler; do not include them in a broad Knowledge cleanup unless the owner has confirmed each is obsolete. Before deletion, inspect `KnowledgeBaseSource`, `AssistantKnowledgeSource`, `KnowledgeChunk`, `KnowledgePage`, and queued/processing jobs for each exact source ID, then use only the application's authorized per-source deletion path after an explicit owner decision. Source deletion cascades to linked chunks and link records; it may not remove old references embedded in conversations. Do not delete the uploaded extracted PDF, its current chunks, workspace/assistant records, Shopify records, or migration history. No cleanup query or deletion was executed.

## H. Defects fixed

Confirmed issue: generic Knowledge counts included FAQ/text/website data in the PDF Library metrics and section lists. The new page now requests PDF-only results and displays PDF-specific real counts. The backend adds the `pdfOnly` list filter and PDF count aggregation while preserving the existing generic count contract for other callers.

Files changed for this correction:

- `backend/src/modules/workspaces/knowledge.dto.ts`
- `backend/src/modules/workspaces/knowledge.service.ts`
- `backend/test/knowledge.service.spec.ts`
- `frontend/src/services/api/knowledge.ts`
- `frontend/src/dashboard-source/KnowledgeLibrary.tsx`
- `frontend/src/tests/knowledge-library.test.tsx`

No AI runtime, retrieval algorithm, authorization, Shopify, or schema file was modified in this audit. The service's JSON document filtering/aggregation has unit coverage but still needs an API-level check against the target PostgreSQL version.

## I. Tests and runtime results

| Check | Result | Evidence / limit |
|---|---|---|
| Backend focused Knowledge service spec | **PASS** | 27/27 tests; Jest completed in 83.393 seconds |
| Frontend Knowledge Library spec | **PASS** | 11/11 tests; Jest completed in 77.52 seconds |
| Read-only PostgreSQL record audit | **PASS** | Actual configured Neon database; SELECT only; no content/PII printed |
| Migration history read | **PASS** | Target database reports `20261027170000_knowledge_document_metadata` finished/applied |
| Actual `searchPreview()` call | **TIMEOUT / NOT VERIFIED** | Bounded 35-second process exited 124; no retrieval result was observed |
| Actual Gemini/OpenRouter answer | **NOT RUN** | No paid provider call authorized or made |
| Full browser/widget E2E | **NOT RUN** | No runtime claim |
| Migration required for this correction | **NO** | Existing schema/migration suffices |

The first frontend rerun exposed an ambiguous test query (`findByText('1')`); the assertion was corrected to wait on the intended metric and the focused suite then passed 11/11. No production/UAT data was written. The temporary service verification timed out while constructing/running the service against the configured remote stack; the exact underlying cause is not established and is not reported as a product defect.

## J. Remaining blockers

- Run the actual retrieval test against an isolated development database or an explicitly approved read-only local runtime with the existing assistant and public PDF. Capture a redacted trace with the exact English interpretation query, eligible source count, retrieved source/chunk IDs, source version/generation, public authorization decision, and selected evidence.
- Exercise that evidence through a mocked provider request to prove the current context assembly receives it; this is not equivalent to a real Gemini response.
- If later authorized, manually verify one English and one Hindi/Hinglish customer scenario by observing the existing interpretation-generated English query and then the same retrieval path. No Knowledge-side language changes are required or proposed.
- Semantic embeddings are not configured for this PDF. Lexical search readiness is present in storage; real search execution was not verified in this audit.
- Fact-by-fact chunk meaning and table/header fidelity have not been manually verified.

## K. Migration requirement

**NO new migration required.** The target database records `20261027170000_knowledge_document_metadata` as applied. No migration was executed.

## L. Phase 03 readiness

**PARTIAL — database persistence and current lexical chunk generation are evidenced; end-to-end retrieval/evidence handoff is not yet verified.** The PDF is stored with consistent page/hash/count metadata and three current lexical chunks, and source code preserves the established retrieval contract. Do not mark retrieval reliability or chatbot use complete until the bounded service retrieval succeeds against an isolated/approved environment and the evidence context is verified. This is not an AI logic blocker, and no AI change is proposed.
