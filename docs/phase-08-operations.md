> **Product retirement notice (2026-10-11):** Public website knowledge ingestion has been removed from the active product. Website source creation, DNS challenge/verification, crawling, sync, scheduling, and browser rendering are disabled; legacy create/sync/verification routes return `410 WEBSITE_KNOWLEDGE_UNAVAILABLE`. Existing website sources, page records, migrations, and historical code are retained for compatibility and investigation, but are excluded from active Knowledge lists, processing, and assistant retrieval. Do not follow the historical activation instructions below. Current Knowledge supports manual FAQs, CSV/XLSX FAQ import, and manual text. Document ingestion is also unavailable.

# Phase 08 operations

## Prerequisites

The backend-hosted PostgreSQL worker is disabled unless `KNOWLEDGE_WORKER_ENABLED=true`. Keep it false until all pending Phase 08 migrations have succeeded and Prisma Client has been generated. The current migrations are:

1. `20261011120000_phase_08_index_foundation`
2. `20261011130000_phase_08a_embedding_profiles`
3. `20261011140000_phase_08_lexical_and_optional_semantic`
4. `20261011150000_phase_08_website_sync_lifecycle`
5. `20261011160000_phase_08_global_crawl_coordination`
6. `20261011170000_phase_08e_browser_extraction`

Review the database target and migration status before applying them. The reported Neon development branch has pgvector 0.8.6, but current status has not been re-read in this implementation checkpoint. Never run these commands against production/UAT. The first migration creates `vector(1536)` and requires pgvector; later migrations make the vector nullable for lexical-only indexing and restrict the supported optional profile. Do not use `db push` or reset the database.

PowerShell from the repository root, after confirming the backend's private `.env` points to the intended development branch:

```powershell
pnpm --filter @carteio/backend exec prisma migrate status
Get-Content .\backend\prisma\migrations\20261011120000_phase_08_index_foundation\migration.sql
Get-Content .\backend\prisma\migrations\20261011130000_phase_08a_embedding_profiles\migration.sql
Get-Content .\backend\prisma\migrations\20261011140000_phase_08_lexical_and_optional_semantic\migration.sql
Get-Content .\backend\prisma\migrations\20261011150000_phase_08_website_sync_lifecycle\migration.sql
Get-Content .\backend\prisma\migrations\20261011160000_phase_08_global_crawl_coordination\migration.sql
Get-Content .\backend\prisma\migrations\20261011170000_phase_08e_browser_extraction\migration.sql
```

`parse5` is an existing backend dependency and is installed in the inspected workspace. Phase 08E adds no root workspace dependency and requires no root `pnpm install` when existing dependencies are present. If setting up a fresh checkout, use the existing lockfile:

```powershell
pnpm install
```

After manual review and approval of the development database target, migrate and generate the client:

```powershell
pnpm --filter @carteio/backend exec prisma migrate deploy
pnpm --filter @carteio/backend exec prisma generate
```


Only then set `KNOWLEDGE_WORKER_ENABLED=true` in the local backend `.env` and start the existing app with `pnpm dev`. This repository's backend `dev` script itself invokes Prisma generate; the explicit generate step is shown so migration/client setup is clear. Semantic embeddings remain optional; do not set `KNOWLEDGE_SEMANTIC_ENABLED=true` or provide `OPENAI_API_KEY` unless that data transfer and provider billing are explicitly acceptable. Groq chat credentials do not enable embeddings.

## Website flow

1. Create a Website source in an active Knowledge Base. It remains unverified and is not crawled.
2. In Website settings, create a DNS challenge and publish the displayed TXT record at `_carteio-verify.<host>`. Wait for DNS propagation, then choose Verify DNS record.
3. Set the allowed path prefix, page/depth limits, and optional manual/daily/weekly schedule.
4. Select Sync now. The API only enqueues a durable job. The enabled backend worker performs the crawl.
5. Inspect source processing status, actual extraction stage, website page list/method, last sync fields and history. Initial HTML is always tried first. Insufficient content invokes the optional renderer automatically. Unconfigured rendering fails honestly; no pages are fabricated. Configure and verify the isolation boundary using [Phase 08E operations](phase-08e-rendering.md) before enabling it.
6. Link the Knowledge Base to an ACTIVE assistant and run the authenticated Knowledge Search Preview. It returns lexical excerpts/citations only.

Daily/weekly schedule polling occurs in the same worker process and requires no paid queue service. A failed sync retains the last published generation. A 404/410 confirms page removal. Pages omitted because of a crawl limit or scope are retained.

## FAQ/text and lifecycle

FAQ/text create, edit and import paths set processing state; the worker queues unprocessed records. Use Reindex/Retry for an eligible source. With semantic embeddings disabled, expected status is lexical `READY` and semantic `NOT_CONFIGURED`. Search preview labels results `lexical_only`; no AI answer is returned.

Archive makes a source ineligible immediately. Restore preserves its visibility; a Website requires a new DNS challenge and a fresh sync. Remove from a Knowledge Base removes only membership. Permanent Delete is OWNER-only and explicitly removes workspace source records and associated indexes/links after confirmation. There is no external-file cleanup because document upload is excluded.

## Troubleshooting

- `WEBSITE_HOST_NOT_PUBLIC`: DNS has no public answer, has a private/mixed answer, or lookup failed; correct DNS and issue a new challenge.
- `WEBSITE_VERIFICATION_PROOF_MISSING`: check TXT name/value and propagation; challenge expires after 24 hours.
- `CRAWL_DESTINATION_BLOCKED` / `CRAWL_REDIRECT_OUT_OF_SCOPE`: destination resolves privately or leaves the verified host; it is rejected by design.
- `ROBOTS_FETCH_FAILED` or a robots skip: make the policy publicly available and permit the crawler for intended paths.
- `CRAWL_DYNAMIC_CONTENT_UNSUPPORTED` on an older failed run: retry only after reviewing the Phase 08E renderer setup. New runs report specific `BROWSER_*` failure codes for dynamic content.
- `BROWSER_RENDERING_NOT_CONFIGURED` / `BROWSER_ISOLATION_REQUIRED` / `BROWSER_IMAGE_NOT_CONFIGURED`: static crawling remains available; the optional isolated deployment prerequisite is missing. No website modification or SDK is required.
- `BROWSER_SANDBOX_FAILED`: Chromium could not start with its required sandbox. Fix the approved isolated runtime; do not disable the sandbox or grant privileged capabilities.
- `BROWSER_RESOURCE_LIMIT` / `BROWSER_CONTENT_INSUFFICIENT`: page exceeds limits, depends on blocked destinations/APIs, or still renders no meaningful public text. Check controlled rendering fixtures and permitted scope.
- `BROWSER_CLEANUP_FAILED`: deployment administrator must remove the named orphan task and inspect Docker availability before retry. No successful publication is reported for that task.
- `CRAWL_PARTIAL_FAILURE`: previous published generation is retained; review page/job errors and retry.
- Processing remains queued: verify migration/client setup, `KNOWLEDGE_WORKER_ENABLED=true`, backend availability and job status. The worker starts only in the backend process.
- Migration failure: stop; inspect Prisma migration status and database schema on the development branch. Do not edit applied migration SQL, use `db push`, or reset.

Documents, PDF extraction, OCR, and object storage are explicitly unavailable. The existing Documents UI must remain disabled and must not claim upload success.
