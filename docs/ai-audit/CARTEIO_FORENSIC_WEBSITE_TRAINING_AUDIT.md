# Carteio AI — Evidence-First Forensic Website-Training Audit

**Scope:** read-only source, local workspace evidence, and sanitized read-only PostgreSQL inspection on 18 October 2026. No source changes, database writes, migration commands, builds, tests, server launches, website crawls, paid requests, or connector mutations were performed.

## Method and evidence boundary

The database inspection used the existing Prisma/Neon configuration and `SELECT` statements only. It returned status fields, counts, migration state, and irreversible short fingerprints for job IDs. It did not print credentials, website URLs, source contents, customer data, raw SQL parameters, or raw database error text.

The database is reachable outside the local sandbox. A minimal `SELECT 1` succeeded. The earlier in-sandbox connection failure was therefore sandbox networking, not application evidence.

## Evidence matrix

| Finding | Evidence | Exact file/method or runtime record | Confirmed / Hypothesis / Unknown | Required action |
|---|---|---|---|---|
| Three persisted CRAWL jobs failed with `DATABASE_ERROR`; all stopped at `BROWSER_RENDERING`, each with one attempt. | Read-only DB query of the five most recent processing jobs; fingerprints `310e9aee9a3f`, `0b0ea6a10345`, and `b67493cdb32b`. | `KnowledgeProcessingJob`, joined `KnowledgeSource`; paired `KnowledgeSyncRun`. | **Confirmed** | Preserve and obtain the corresponding worker JSON log events before changing code. |
| Those three failed jobs produced zero persisted pages and zero persisted chunks; their sources have no active index generation and are `FAILED`. | Same read-only DB result: `pages=0`, `chunks=0`, `activeIndexGeneration=null`; paired runs `FAILED/DATABASE_ERROR`. | `KnowledgePage`, `KnowledgeChunk`, `KnowledgeSource`, `KnowledgeSyncRun`. | **Confirmed** | Fix the original failing operation, then run one controlled verification sync. Do not treat registration or job claim as successful indexing. |
| An independent non-website INDEX job succeeded and published one chunk. | Read-only DB result for fingerprint `5a55d7bd7fe1`: `INDEX/SUCCEEDED/INDEX_PUBLISHED`, generation 1, one chunk. | `KnowledgeProcessingJob`, `KnowledgeSource`, `KnowledgeChunk`. | **Confirmed** | Keep website failure isolated from generic source indexing; it is not evidence that website indexing works. |
| A separate CRAWL failure is explicitly `BROWSER_RENDERING_NOT_CONFIGURED`, not a database failure. | Read-only DB result fingerprint `0e20907c1473`, stage `BROWSER_RENDERING`, zero pages/chunks. | `KnowledgeProcessingJob` and `KnowledgeSyncRun`. | **Confirmed** | Configure a compliant renderer only if rendering is required; this is distinct from the `DATABASE_ERROR` investigation. |
| The exact failed database operation and underlying database code/message cannot be recovered from persisted tables. | Job and sync schemas only retain `errorCode`; worker writes Prisma/SQL diagnostic fields to its JSON warning but does not persist them. No local runtime log containing the event was present. | `knowledge-processing.service.ts` `safeWorkerDatabaseDiagnostic` (187–210), failure handler (862–881); schema `KnowledgeProcessingJob.errorCode` (786–807), `KnowledgeSyncRun.errorCode` (839–861). | **Confirmed evidence gap** | Retrieve the original `knowledge_processing_job_failed` JSON for each fingerprint, including `operation`, `prismaCode`, `databaseCode`, and sanitized `databaseMessage`; or reproduce under controlled logging after approval. |
| `BROWSER_RENDERING` narrows the last recorded stage to the rendering fallback path, but does not establish the root cause as browser failure. | Crawler invokes its `onStage('BROWSER_RENDERING')` callback immediately before renderer work; the processing service callback writes job stage with `updateMany`. | `website-crawler.ts` 473–489; `knowledge-processing.service.ts` 914–915. | **Confirmed location; root cause unknown** | First inspect the missing JSON log’s `operation`. If it is the stage callback, inspect that update; if it is a later operation, follow that exact label. |
| Current applied migration history does not show a missing or rolled-back migration. | DB inspection found 37 migration records, all applied and none rolled back. | PostgreSQL `_prisma_migrations`; migration files under `backend/prisma/migrations`. | **Confirmed** | Do not run migrations as a speculative remedy. Compare deployed columns/constraints only after the original error identifies a schema-related failure. |
| The crawler supports robots handling, sitemap discovery, static HTML extraction, same-host canonical URL handling, FAQ JSON-LD-style extraction, deduplication by normalized canonical URL/content hash, ETag/Last-Modified reuse, and bounded rediscovery. | Source inspection. Sitemap depth is capped at 2, at most 10 sitemap documents, and crawl pages are bounded. | `website-crawler.ts` 213–242, 307–371, 407–525; `knowledge-processing.service.ts` 899–900, 917–1050; `website-sync.ts` `prepareWebsiteSyncPages`. | **Confirmed in code; not runtime-proven for the failed website sources** | After database root cause is fixed, prove each behavior with an authorized controlled source and inspect resulting page/chunk counts. |
| Website crawling does not implement structured product records, prices, image entities, or collection entities. It persists page text plus page metadata/category. | `CrawlPage` has URL/title/content/hash/category/language/extraction metadata only; website publication creates `KnowledgePage` and textual `KnowledgeChunk` rows. | `website-crawler.ts` 20–21, 213–242; `knowledge-processing.service.ts` 948–955, 1012–1049. | **Confirmed** | Do not promise Noupe-like product cards from website-only training. Use the separately implemented commerce connector contract when structured commerce data exists. |
| Website text can support product/about/contact/policy/FAQ answers only if discoverable in public page text and successfully indexed. | Link/sitemap discovery and category classification exist; FAQ text is appended to extracted content. | `website-crawler.ts` 239–242, 245 onward, 419–525; `knowledge-processing.service.ts` 1015–1035. | **Confirmed conditional** | Successful records and assignment are required before the assistant can use this data. |
| Crawls are restart/re-sync aware, not an arbitrary mid-crawl checkpoint/resume system. | Prior page snapshots/validators are read; unchanged pages/chunks can be reused and leases can retry. Queue/frontier state is not persisted. | `knowledge-processing.service.ts` 899–900, 957–999, 1062 onward; `website-crawler.ts` 419–525. | **Confirmed** | Call this incremental synchronization, not resumable crawling. |
| Visitor retrieval can use public website knowledge only when an assistant has eligible assigned public sources, indexed chunks, and the model/tool route permits it. | `searchPreview` filters tenant/source/assistant/public eligibility; orchestrator exposes a bounded knowledge tool. | `knowledge-processing.service.ts` `searchPreview` (447 onward); `conversation-orchestrator.service.ts` 754, 843–847, 886–946. | **Confirmed contract; no successful website runtime evidence** | Restore website indexing, then prove eligibility and an end-to-end cited answer. |
| Product name/price/image/collection retrieval is implemented through the connected commerce catalog, not website chunks. | Catalog contract returns name, description, collections, image evidence, currency/price and variants subject to granted permissions; the orchestrator supplies them as `[C#]` evidence. | `connectors/commerce-read-contracts.service.ts` 37–55, 103–164, 183–197; `conversation-orchestrator.service.ts` 783, 844, 886–946. | **Confirmed contract; actual catalog data unknown** | Verify a connected catalog, enabled permissions, fresh records, and a widget presentation contract. |
| The widget returns textual response plus sources; no explicit product-card rendering DTO is present in the inspected service. | Public message result uses response/sources/provider/model/pending ticket path; orchestrator evidence includes image URLs only inside product evidence text. | `widget.service.ts` `message()` around 151–155; `conversation-orchestrator.service.ts` 783 and 938. | **Confirmed for backend contract inspected** | Define and implement a product-card response contract only after website indexing is repaired and requirements are approved. |
| Hinglish and Hindi language handling is explicitly prompted; follow-up reference resolution is bounded to prior user turns. | Semantic classification prompt includes Hindi, romanized Hindi, Hinglish and follow-up support. | `conversation-orchestrator.service.ts` 487–493; conversation context resolver. | **Confirmed implementation** | Validate with evidence-backed Hinglish test turns after website source readiness is real. |
| Customer-specific order status is intentionally unavailable from public website knowledge. | System policy tells answers not to claim live orders/accounts; no customer/order tool is exposed in the listed tools. | `conversation-orchestrator.service.ts` 847 and 886–887. | **Confirmed** | Acceptance tests must expect an honest limitation, matching the Noupe behavioral reference rather than an invented lookup. |
| Noupe comparison is restricted to prior public observations: URL-first onboarding, public-site learning claims, multilingual experience, and visible chat/product-oriented behavior. | Earlier public/REA study only; no authenticated or private Noupe access. | `docs/ai-audit/NOUPE_PUBLIC_REFERENCE_STUDY.md`. | **Confirmed boundary** | Measure Carteio’s independently implemented behavior; do not infer Noupe’s crawler, prompts, database, or backend. |

## 1. Confirmed blocking bugs

1. Website training is blocked for the three recorded `DATABASE_ERROR` jobs. Their shared last persisted stage is `BROWSER_RENDERING`; none reached page persistence, chunk creation, index publication, or assistant readiness.
2. A distinct renderer configuration blocker also exists (`BROWSER_RENDERING_NOT_CONFIGURED`). It may affect websites whose initial HTML is insufficient, but it does **not** explain the three `DATABASE_ERROR` records without the missing worker diagnostic.
3. The worker’s failure record is insufficient for forensics: it stores the safe top-level `DATABASE_ERROR`, but not the labeled operation, Prisma code, SQLSTATE, or sanitized database message that it had available for logging.

## 2. Missing implementation versus missing data

**Missing data/runtime proof:** successful website pages, website chunks, an active website index generation, public eligibility/assistant assignment for the failed sources, and the source-specific worker failure logs. There is no database evidence that the failed websites supplied any business knowledge to an assistant.

**Implemented but dependent on data:** website textual extraction/indexing, lexical/optional semantic public retrieval, source assignment filtering, multilingual answer behavior, bounded follow-up context, citations, and explicit order-status limitations.

**Missing functionality for a Noupe-like catalog experience:** website-only structured product/price/image/collection extraction and a widget product-card response/rendering contract. Structured catalog fields exist only behind a connected commerce catalog and permission gates.

## 3. What is already functional

- The worker can claim jobs; the observed trace and the database records prove this.
- Generic non-website indexing has successfully published at least one chunk.
- Database connectivity works from the authorized environment.
- The migration ledger is present and fully applied.
- The code has a bounded crawler, authorization checks, robots/sitemap handling, canonicalization, chunking, and transactional publication.
- The orchestrator has explicit tool contracts for knowledge and commerce, public-source filtering, citations, multilingual interpretation, and honest live-data limitations.

These are implementation facts, not proof that the registered website source is assistant-ready.

## 4. Actual database readiness

The inspected database is **not website-ready** for the three failed CRAWL sources:

- 0 pages persisted for each;
- 0 chunks persisted for each;
- no active index generation;
- source processing state `FAILED`;
- paired sync run `FAILED/DATABASE_ERROR`.

It is not accurate to call the website path ready merely because registration returned HTTP 201 or because a worker claimed a job.

## 5. Exact first blocker to fix

The first blocker is **not yet root-cause-confirmed at operation level**. The exact required evidence is the original structured warning emitted by the worker:

```text
event=knowledge_processing_job_failed
stage=index_processing
operation=<failureOperation>
prismaCode=<Pxxxx, if present>
databaseCode=<five-character SQLSTATE, if present>
databaseMessage=<sanitized category, if present>
```

For each of the three job fingerprints, obtain the log event produced by `knowledge-processing.service.ts` line 881 from the worker process/runtime log sink. The database cannot reconstruct it because neither `KnowledgeProcessingJob` nor `KnowledgeSyncRun` persists those diagnostic fields.

The last stage makes `knowledge_processing_job.updateMany(... stage: 'BROWSER_RENDERING' ...)` a plausible early candidate, but it is only a hypothesis. Other calls can occur after the stage transition. It must not be presented as the exact failure until the `operation` value is recovered.

## 6. Minimal recommended correction

Do **not** alter crawler behavior, schema, migrations, or product features first.

1. Recover the existing worker log event for a failed job.
2. Classify strictly from its evidence:
   - `Pxxxx` with no SQLSTATE: inspect the Prisma/adapter operation identified by `operation`.
   - SQLSTATE `42601`: correct only the evidenced SQL statement.
   - SQLSTATE beginning `42` with `relation/column/function/operator missing`: compare that named object to the applied schema/migration.
   - SQLSTATE beginning `23`: correct the evidenced constraint/data conflict.
   - no Prisma/SQL metadata: treat diagnostics as insufficient; add durable *sanitized* failure metadata only under a separately approved implementation task.
3. Correct the single evidenced cause, then run one authorized controlled sync.
4. Address renderer configuration separately only if the controlled page genuinely needs client-side rendering.

## 7. How to prove the correction worked

The proof must be runtime evidence, not a 201 response or code review:

1. One new CRAWL job reaches `SUCCEEDED/INDEX_PUBLISHED`.
2. Its paired `KnowledgeSyncRun` is `SUCCEEDED` or a clearly explained `SUCCEEDED_WITH_WARNINGS` with nonzero page/chunk evidence.
3. Its `KnowledgeSource` has a non-null `activeIndexGeneration`, `processingStatus=READY`, and no processing error.
4. `KnowledgePage` and `KnowledgeChunk` counts are nonzero for that source/version/generation.
5. The source is `PUBLIC_REFERENCE` (where intended) and assigned to the tested assistant.
6. A public visitor turn has eligible-source count > 0, produces `[S#]` evidence, and correctly answers a fact actually present in a saved page.
7. For a connected catalog, separately prove `[C#]` evidence for product name, image URL, and price; do not infer it from website chunks.
8. Repeat the supplied Noupe-style acceptance cases: business introduction, product discovery, price, image presentation, pronoun follow-up, order-status limitation, and Hindi/Hinglish. Each answer must cite evidence or explicitly state that data is unavailable.

## 8. Remaining unknowns

- The exact original `failureOperation`, Prisma error code, PostgreSQL SQLSTATE, and sanitized database message for the three `DATABASE_ERROR` jobs.
- Whether the failed source's HTML truly required browser rendering, and whether the renderer was configured at the time of each job.
- Whether successful pages, once fixed, will have enough relevant business text for the desired questions.
- Whether the relevant assistant/source assignment and public visibility settings are configured.
- Whether a connected commerce catalog exists, has permission for prices/categories, contains fresh product records, and has a frontend card renderer.
- Whether any external runtime log retention contains the missing failure events.

## Noupe-derived measurable acceptance criteria

Without asserting anything about Noupe's private backend, Carteio can be measured against the visible benchmark as follows:

- **Business introduction:** answer in the visitor's language only from an assigned public page; include `[S#]` source attribution.
- **Product discovery:** return only real connected catalog records; use `[C#]`; say no catalog is available when it is not.
- **Price:** reproduce stored currency/price exactly, include freshness constraints, and never derive price from prose.
- **Product images:** return an explicit safe image/card field only once a widget rendering contract exists; a URL hidden inside model prose is not equivalent UX.
- **Follow-up:** “iska price?” resolves only to a bounded prior evidenced product; otherwise asks one clarification.
- **Order status:** state the public-knowledge limitation and direct the visitor to a verified support path; do not claim a lookup.
- **Hindi/Hinglish:** retain language preference and provide the same evidence-grounded behavior, not translated invented facts.

**Stop condition:** This report intentionally contains no implementation recommendation beyond the minimum evidence-gathering sequence. The first source-code change must wait for the original worker diagnostic or an approved controlled reproduction that captures it.
