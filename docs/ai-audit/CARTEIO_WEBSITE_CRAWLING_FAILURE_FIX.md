# Carteio Website Crawling Failure Investigation

**Status:** source diagnostics were narrowly improved; no runtime retry, website request, database operation, environment change, migration, or test execution was performed.

## 1. Observed issues

The Knowledge page reports two different failure codes:

- `carteio.in`: `DATABASE_ERROR`, with zero discovered, crawled, and saved pages.
- `expense.carteio.in`: `BROWSER_RENDERING_NOT_CONFIGURED`, with zero crawled and saved pages.

The supplied website detail response also says `renderer.configured=false`, `workerEnabled=true`, `verificationStatus=PENDING`, `crawlJobStatus=null`, and `syncPolicy=MANUAL`. These values describe configuration and current status; they do not prove renderer need, worker health, or successful processing.

## 2. Current execution flow

The source tree contains an active website ingestion path:

1. The Knowledge UI in `frontend/src/pages/knowledge/KnowledgeBasePage.tsx` and `BusinessDataVisibility.tsx` calls the knowledge API client in `frontend/src/services/api/knowledge.ts` to add or refresh a website.
2. Authenticated `POST workspaces/:slug/knowledge/website` and `POST workspaces/:slug/knowledge/:sourceId/website/sync` routes are handled by `backend/src/modules/workspaces/knowledge.controller.ts`.
3. `KnowledgeService.createWebsite()` in `backend/src/modules/workspaces/knowledge.service.ts` normalizes and validates a public URL, creates a tenant-owned `KnowledgeSource`, and queues its initial crawl. `createWebsiteInBase()` also links it to the selected Knowledge Base.
4. `KnowledgeProcessingService.queueWebsiteCrawl()` creates a `KnowledgeProcessingJob` (`kind=CRAWL`) and paired `KnowledgeSyncRun` transactionally. A duplicate active crawl is reused as `already_queued`.
5. `KnowledgeProcessingService.onModuleInit()` starts a local polling loop only when that backend process has `KNOWLEDGE_WORKER_ENABLED=true`. The loop claims work through `tick()` / `claim()` and invokes `processWebsite()`.
6. `WebsiteCrawler.crawl()` in `backend/src/modules/workspaces/website-crawler.ts` performs bounded static fetching, robots and sitemap handling, link discovery, parsing, and safe same-host traversal. It reports stages and operation labels back to the worker.
7. `extractWebsitePage()` extracts static HTML first. It invokes the renderer only when static extraction yields no indexable page. A renderer failure is surfaced; the crawler does not claim a successful page.
8. `processWebsite()` in `backend/src/modules/workspaces/knowledge-processing.service.ts` prepares chunks and optional embeddings, then transactionally writes `KnowledgePage` and `KnowledgeChunk` rows, publishes the active index generation, updates the source, completes the job, and updates the sync run.
9. Retrieval in `KnowledgeProcessingService` is tenant scoped and only exposes ready `PUBLIC_REFERENCE` sources assigned to an eligible assistant/Knowledge Base. Website page diagnostics report readiness only when the active generation has chunks and the source has an eligible assistant assignment.

Relevant database models are `KnowledgeSource`, `KnowledgeProcessingJob`, `KnowledgeSyncRun`, `KnowledgePage`, `KnowledgeChunk`, `KnowledgeBase`, `KnowledgeBaseSource`, and `AssistantKnowledgeBase` in `backend/prisma/schema.prisma`.

The repository also contains an operations guide that says legacy website ingestion was retired, while the current controller, service, and UI contain active routes and workflows. This documentation/runtime mismatch means the deployed application version and routes must be confirmed before comparing deployed behavior with this checkout.

## 3. `DATABASE_ERROR`: cause and evidence

### Confirmed

The existing sanitized forensic audit (`CARTEIO_FORENSIC_WEBSITE_TRAINING_AUDIT.md`) records three website crawl jobs that failed as `DATABASE_ERROR`. They were at stage `BROWSER_RENDERING`, had one attempt, and produced zero pages and chunks with no active index generation. A separate crawl job failed with `BROWSER_RENDERING_NOT_CONFIGURED`. The audit reports the migration ledger had all 37 recorded migrations applied, none rolled back. That is prior read-only evidence; this investigation did not reconnect to or query a database.

The worker maps Prisma `Pxxxx` failures to the public-safe `DATABASE_ERROR` code in `safeProcessingErrorCode()`. On failure it updates job/source/sync state and emits a `knowledge_processing_job_failed` JSON warning. `safeWorkerDatabaseDiagnostic()` limits optional diagnostic details to safe error type, Prisma code, valid SQLSTATE/category, and a small allowlist of sanitized database message categories.

### Unconfirmed

The specific failing database operation, Prisma error, SQLSTATE, and safe database message are not present in the persisted status. The prior diagnostic-capture report says the worker JSON warning for the failed jobs is unavailable, and this follow-up found no local `.log`, `.jsonl`, or `.out` files. The exact runtime failure is still unknown.

Before this follow-up, the worker event had safe SQLSTATE categories and granular labels for indexing/persistence, but the crawler operation label could be overwritten by the browser-stage update; host pacing SQL also had no individual operation label. Thus the existing code was not sufficient to reliably identify every failure near `BROWSER_RENDERING` during a future retry.

Therefore, the root cause for `carteio.in` remains **unconfirmed**. A missing migration is not supported by the available evidence. No database schema change is recommended without the original worker event identifying a schema or constraint issue.

## 4. `BROWSER_RENDERING_NOT_CONFIGURED`: cause and requirements

`rendererAvailability()` in `backend/src/modules/workspaces/website-renderer.ts` reports this code when `KNOWLEDGE_BROWSER_RENDERING_ENABLED` is not exactly `true`. It separately reports `BROWSER_ISOLATION_REQUIRED` when the runtime is not Linux and `BROWSER_IMAGE_NOT_CONFIGURED` when `KNOWLEDGE_RENDERER_IMAGE` is not a SHA-256 image digest.

The supported implementation is an isolated local Linux container renderer. It requires a Docker runtime named `carteio-renderer` backed by `runsc`, network-disabled container isolation, and a locally available immutable image. The source guide is `docs/phase-08e-rendering.md`; the build context is under `infrastructure/renderer/`. The renderer uses a local image (`--pull=never`) and fails closed if required isolation checks fail.

Static HTML is attempted first and remains usable without the renderer if it contains sufficient extractable text. The error means static extraction did not produce an indexable page and the fallback could not be used because it was not configured. It does **not** prove either supplied website requires JavaScript; no network requests were made to inspect them. A dynamic site should remain failed until rendering is configured or its content is made available in crawlable HTML. Do not switch to static-only success semantics or skip content that would be lost.

For UAT/production, an authorized deployment operator must confirm the Linux worker and isolated container runtime, set `KNOWLEDGE_BROWSER_RENDERING_ENABLED=true`, and set `KNOWLEDGE_RENDERER_IMAGE=sha256:<64 lowercase hex characters>` to an already installed, approved image. Do not configure this in an environment file until the isolation contract and deployment review are complete.

## 5. Worker, queue, and status findings

`workerEnabled=true` is derived from the serving process's `KNOWLEDGE_WORKER_ENABLED` environment variable. The code starts a 1.5-second polling timer when enabled; there is no worker heartbeat in the website details response. This flag alone cannot prove that the worker process is alive, has database connectivity, is polling, or is the same process that serves the status endpoint.

`crawlJobStatus=null` is also inconclusive: `WebsiteVerificationService.details()` looks for active job states and returns null when no queued/processing/retry-wait job is present. A previously failed job is not an active job. `syncPolicy=MANUAL` disables scheduled future crawls; it does not prevent a user-triggered initial crawl or explicit sync from being queued.

The prior database audit demonstrates that a worker claimed and processed some jobs, and that generic non-website indexing succeeded. It does not prove the worker is healthy now or that website crawls currently work.

Deployment metadata in this checkout does not establish a live worker. `backend/vercel.json` only identifies the NestJS framework; the gated UAT workflow can deploy Vercel projects but defines no separate knowledge-worker process. `README.md` says production hosting is not verified, and `infrastructure/nginx/` is a routing template. If the deployed backend runs as serverless Vercel functions, the unref'ed in-process polling timer is not proof of a durable worker. Confirm the actual hosting target and persistent worker process in the operator console.

## 6. URL safety and verification

`normalizePublicWebsiteUrl()` rejects unsafe URL schemes, credentials, ports, private/reserved hosts, and malformed URLs. The crawler resolves and pins public addresses, keeps redirects on the authorized host/path scope, verifies TLS, honors robots directives, applies time/page/byte limits, and uses bounded sitemap/link discovery. No DNS, HTTPS, or external crawling requests were made during this investigation, so access, redirects, content type, robots policy, sitemap behavior, and JavaScript dependence for either URL remain runtime-unknown.

`verificationStatus=PENDING` is not by itself a generic website crawl blocker. In the worker, explicit domain verification is required for sources categorized as `SHOPIFY_STOREFRONT` or marked as connected-Shopify-discovered storefronts. Generic websites created through `createWebsite()` are not subject to that gate. The actual source category and description should be checked in the tenant-authorized Knowledge page/API before treating verification as relevant.

## 7. Indexing and assistant linking

The UI's “not assigned to an active assistant” indication is a separate availability blocker. It does not explain the two crawl errors, but even a successful crawl will not necessarily be used in answers until it is indexed and assigned correctly.

The organization owner/admin should:

1. Confirm the source is `REGISTERED`, `processingStatus=READY`, `visibility=PUBLIC_REFERENCE`, and has a non-null active index generation.
2. Confirm the source has nonzero pages and chunks in that generation.
3. Link the source to the intended active Knowledge Base and link that Knowledge Base to the intended active assistant, or use the existing direct source-to-assistant linking workflow if applicable.
4. Confirm the source appears as `AI_READY` with that assistant in the website pages/visibility UI.
5. Confirm a tenant-authorized knowledge preview can retrieve a relevant chunk before relying on it in a customer conversation.

The existing services scope these links by organization. Do not assign the source to unrelated assistants or bypass those checks.

## 8. Diagnostic code improvement

The root database error is still unknown, so no SQL, schema, transaction-order, or retry fix was made. A narrow diagnostic change was justified because the existing labels could misidentify the failure point and the original error log was emitted only after failure-state persistence.

Changed files:

- `backend/src/modules/workspaces/knowledge-processing.service.ts`: emits `knowledge_processing_job_failed` before the failure-state transaction, so the original error is recorded even if the follow-up status write fails. Adds allowlisted `prismaCategory` values for known connection/pool, constraint, raw-query, missing-table, missing-column, and transaction-conflict codes. It logs no raw error text, SQL, values, secrets, or page content.
- `backend/src/modules/workspaces/website-crawler.ts`: labels host-rate cleanup/reservation queries and browser resource fetches, and preserves `crawl.browser_renderer` after the stage write. The stage write remains `crawl.stage_progress_update`. A future event can distinguish renderer execution, host pacing, and the BROWSER_RENDERING stage update.
- `docs/ai-audit/CARTEIO_WEBSITE_CRAWLING_FAILURE_FIX.md`: updated with this focused recovery plan.

The event includes `failureStatePersistence: PENDING` because it is deliberately emitted before that database write; check job/source/sync status separately. No migration or dependency is required. No crawler URL, TLS, SSRF, renderer-isolation, authorization, or response behavior was changed.

No migration is recommended or required based on the available evidence. The prior migration-ledger inspection did not show missing/rolled-back migrations. If the original worker event identifies a concrete schema mismatch, compare the deployed schema with the named operation before proposing a migration.

## 9. Existing regression coverage

Relevant existing deterministic tests include:

- `backend/src/modules/workspaces/website-crawler.spec.ts` — crawler URL/SSRF behavior, static extraction, renderer fallback, redirects, robots/sitemap and bounded crawling.
- `backend/src/modules/workspaces/website-sync.spec.ts` — page retention/removal, changed/unchanged content, and embedding reuse.
- `backend/src/modules/workspaces/knowledge-public-website.spec.ts` — generic website source registration and unsafe URL rejection.
- `backend/src/modules/workspaces/knowledge-processing.shopify-scopes.spec.ts` — Shopify-specific processing permission/scope behavior.
- `backend/test/knowledge-processing.spec.ts` — worker processing, publication, failures, and tenant-scoped behavior.
- `backend/test/website-pages-visibility.spec.ts` — website page readiness and assistant visibility.
- `backend/test/knowledge-base.service.spec.ts` — organization-scoped Knowledge Base/source/assistant linking.

One checked-in assertion conflicts with the current implementation: `backend/test/knowledge-processing.spec.ts` has a test named “rejects website processing requests while allowing FAQ/Text indexing jobs” that expects `enqueueWebsite()` to throw `GoneException`. The current `enqueueWebsite()` implementation instead performs tenant authorization and queues a website crawl. This appears to be stale test intent or a branch/documentation mismatch; it was not executed, and the intended product contract should be reconciled before relying on that test as coverage.

No regression tests were added for this narrow logging change. Tests have not been executed in this task. Existing local tests do not substitute for runtime proof of the production worker, database, renderer image, external site behavior, or assistant configuration.

## 10. Security considerations

- Do not share raw API keys, Shopify tokens, connection strings, SQL parameters, page content, or full customer data when requesting logs.
- Worker diagnostic logging is designed to emit safe categories. Retrieve only the structured `knowledge_processing_job_failed` fields for the affected jobs and redact identifiers except for the job fingerprint used for correlation.
- Keep tenant-bound source/status and assistant-link APIs authenticated.
- Keep SSRF validation, pinned DNS, TLS verification, redirect scope, robots handling, and renderer container isolation enabled.
- Do not pass credentials/cookies to the renderer.

## 11. One-crawl recovery plan (not executed)

### Read-only preflight

1. Confirm the deployed backend revision and route behavior. `docs/phase-08-operations.md` says legacy website routes return 410, while this checkout has active create/sync routes. Confirm which revision is deployed.
2. In the tenant-authorized Knowledge UI, confirm the `carteio.in` source is the intended generic website, is not paused, and has no active queued/processing/retry-wait crawl. Verify `MANUAL` is expected. Do not change its scope or verification status.
3. In the deployment console, verify a persistent backend worker is running with `KNOWLEDGE_WORKER_ENABLED=true`. Check process health and recent logs. Read-only queue/lease status may confirm pending jobs and stale heartbeats; do not update rows or claim a job manually.
4. Use deployment health/connection telemetry to confirm the worker can reach its configured database. Do not display connection strings. `workerEnabled=true` is insufficient.
5. Search worker logs for old job fingerprints `310e9aee9a3f`, `0b0ea6a10345`, and `b67493cdb32b`. This checkout has no retained runtime log files; the log sink is required.

### One authorized retry

After this diagnostic patch is deployed to the worker and an operator approves one crawl, use the tenant's authenticated Knowledge UI to select only `carteio.in` and click **Sync now** once. Capture the response `jobId`; correlate it to the log `jobFingerprint` using the first 12 hex characters of SHA-256(job ID). Do not call the route from an unauthenticated client, create a duplicate source, or repeatedly click. The queue deduplicates active crawls. The worker allows at most five attempts for errors explicitly marked retryable; monitor the bounded policy and do not enqueue another job while one is active.

For the resulting `knowledge_processing_job_failed` event, retain only `operation`, `jobStage`, `code`, `retryable`, `retryability`, `errorType`, `prismaCode`, `prismaCategory`, `databaseCode`, `databaseCategory`, `databaseMessage`, `failureStatePersistence`, and `jobFingerprint`. This should identify stage progress, host-rate cleanup/reservation, rendering, or publication. Never collect SQL parameters, raw database messages, credentials, source contents, or customer data.

### Acceptance criteria

- **Crawl/index success:** crawl job and sync run are `SUCCEEDED` (or reviewed `SUCCEEDED_WITH_WARNINGS`), page and chunk counts are nonzero, source is `READY`, and `activeIndexGeneration` is set.
- **Failure is diagnosable:** event correlates to the job and has a specific operation plus Prisma/SQL category when the driver provides it. If driver metadata is absent, report unavailable rather than guess.
- **Assistant can retrieve it:** link the ready public source to the intended active Knowledge Base/assistant through the tenant-scoped UI, then verify a relevant preview result.

For `expense.carteio.in`, do not retry until an operator confirms whether static HTML contains indexable text. The reported `BROWSER_RENDERING_NOT_CONFIGURED` maps to `KNOWLEDGE_BROWSER_RENDERING_ENABLED` not being `true`. If JavaScript rendering is needed, provision the approved isolated Linux Docker/runsc worker and local digest-pinned image first. No renderer configuration has been changed.

## 12. Remaining blockers

- The failed database operation and underlying error are unknown until the original safe worker event is recovered.
- Current worker health is unknown; the API's `workerEnabled` field is configuration, not a heartbeat.
- Website reachability, robots/sitemap behavior, static content sufficiency, and JavaScript dependence were not verified because external network access was not approved/performed.
- Browser rendering requires deployment configuration if a target page cannot be extracted from static HTML.
- Both sources need to become indexed and correctly linked to an active assistant before they can inform responses.
- The retirement notice in the operations documentation conflicts with active ingestion code; deployed version and intended product state need operator confirmation.

No tests, builds, migrations, servers, crawls, or provider calls were run.
