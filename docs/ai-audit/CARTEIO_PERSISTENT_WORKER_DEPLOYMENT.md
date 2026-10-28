# Carteio Persistent Knowledge Worker Deployment Preparation

**Status:** worker-only startup is prepared in source; no dependency installation, build, test, database operation, Railway setup, deployment, crawl, or external request was performed.

## 1. Architecture and files changed

The existing `KnowledgeProcessingService` owns the PostgreSQL-backed queue consumer. It polls every 1.5 seconds, claims work with PostgreSQL locking, records a lease and heartbeat, and preserves its existing retry and expired-lease recovery behavior. Its current registration in `WorkspaceModule` is alongside ticket delivery, widget retention, and connector synchronization workers. Importing the full workspace/API module into a worker would initialize unrelated consumers.

A small `KnowledgeWorkerModule` now imports the existing `DatabaseModule` and registers only `WorkspaceService`, `KnowledgeBaseService`, and `KnowledgeProcessingService`. A new `knowledge-worker.main.ts` starts that module using `NestFactory.createApplicationContext`, which does not create an HTTP listener. It does not import the API `AppModule` or the other worker providers. `PrismaService` is still the existing implementation.

Files changed:

- `backend/src/modules/workspaces/knowledge-processing.service.ts` — blocks polling in Vercel, makes lifecycle initialization idempotent, keeps the timer referenced in standalone mode, and exposes an orderly stop that clears polling and waits for in-flight work. Existing queue code and sanitized crawler diagnostics remain in place.
- `backend/src/modules/workspaces/knowledge-worker.module.ts` — minimal provider graph for the worker.
- `backend/src/knowledge-worker.main.ts` — worker-only application context, configuration checks, sanitized start/stop/failure events, and SIGTERM/SIGINT shutdown handling.
- `backend/package.json` — adds `start:knowledge-worker` for the compiled worker entry point.
- `backend/test/knowledge-worker.spec.ts` — deterministic startup guard, provider-scope, and polling lifecycle regression tests; not run.
- This report.

The existing safe operation labels, sanitized Prisma categories, and early `knowledge_processing_job_failed` logging are preserved. `website-crawler.ts` was not changed in this phase.

## 2. Vercel safety

Use `KNOWLEDGE_WORKER_ENABLED=false` on the Vercel API. The existing service also now refuses to start its poller when `VERCEL=1`, even if the worker flag is accidentally set to `true`. The worker entry point independently rejects a Vercel runtime.

The worker still uses the same queue implementation; Vercel does not become the worker host. The Vercel API can enqueue jobs while the persistent Railway process polls them. No deployed Vercel variable was changed.

Other background consumers are independently controlled by `TICKET_OUTBOX_WORKER_ENABLED`, `WIDGET_RETENTION_WORKER_ENABLED`, and `CONNECTOR_SYNC_WORKER_ENABLED`. The standalone knowledge module does not register those providers, so those consumers are not started by the Railway knowledge worker.

## 3. Railway service configuration

Use the GitHub repository integration and configure a single Railway service with repository root (`/`) as its root directory. The repository is a pnpm workspace and the backend depends on `@carteio/shared-types`; using the repository root keeps the lockfile and workspace package available.

Suggested service commands:

```text
Install: pnpm install --frozen-lockfile
Build:   pnpm --filter @carteio/backend build
Start:   pnpm --filter @carteio/backend start:knowledge-worker
```

The backend build script runs `prisma generate` and Nest compilation. It emits `backend/dist/knowledge-worker.main.js`, which the start script runs. Pin Node to `24.11.x` (the package engine accepts `>=24.11.0 <25`) and pnpm to the repository's declared `9.15.0`. Do not run Prisma migrations from the worker service.

Required Railway variables:

| Variable | Value / handling |
|---|---|
| `NODE_ENV` | `production` |
| `KNOWLEDGE_WORKER_ENABLED` | `true` |
| `KNOWLEDGE_WORKER_STANDALONE` | `true`; keeps the polling timer referenced so Node remains alive without an HTTP server |
| `DATABASE_URL` | Secret Railway variable containing the intended Neon application connection URL, using TLS (`sslmode=require`) and the appropriate pooled endpoint |
| `KNOWLEDGE_BROWSER_RENDERING_ENABLED` | `false` until separately approved and proven compatible |
| `KNOWLEDGE_SEMANTIC_ENABLED` | `false` unless outbound embedding calls and their cost are separately approved |

The worker runtime uses `DATABASE_URL`; `PrismaService` constructs the existing Neon adapter from it. `DIRECT_URL` is used by Prisma CLI configuration for database administration, not by this runtime entry point. Do not put either database URL in repository files. Add `OPENAI_API_KEY` as a Railway secret only if semantic indexing is separately approved and enabled; it is not required for lexical indexing. No chat-provider credentials are needed by this worker.

Deploy one replica initially. A single worker instance processes at most one tick at a time. Database claim locking prevents two workers from claiming the same eligible job, and existing organization/global claim limits remain authoritative. A single replica also limits avoidable Neon connections and makes initial logs easier to interpret. Use Railway's restart-on-failure behavior; startup exits nonzero on invalid/missing required configuration, and transient polling/processing errors continue to use the existing bounded retry and lease recovery logic.

Use Railway deployment logs for `knowledge_worker_started`, existing safe tick/failure events, `knowledge_processing_job_failed`, and shutdown events. The start event proves initialization, not successful database polling. Verify actual queue progress through a controlled, approved job and its state transitions. Do not add healthcheck endpoints or an HTTP listener solely for this process.

Resource use depends on page sizes, crawl timeouts, Neon latency, and whether semantic embedding is enabled. Start with one small Node service and monitor memory, CPU, job durations, restart count, and database connection use before scaling. Railway pricing and available plans change; review the current Railway project estimate before resource approval rather than relying on a fixed price in this report.

## 4. Worker lifecycle and data safety

The application context is limited to the existing database client and knowledge processor dependencies. It does not start a second public API. On SIGTERM/SIGINT, the entry point asks the processor to stop polling and await its in-flight tick, then closes the Nest context so Prisma disconnects. The worker does not alter tenant predicates, queue ownership, crawl permissions, retry policy, or publication transactions.

The Railway build must use the same repository revision as the API and a generated client from that revision. Before enabling the worker, an operator must verify the deployed Vercel API and Railway worker revisions are compatible with the current Neon schema. This phase makes no migration recommendation and applies no migration.

The startup guard checks that `DATABASE_URL` is present and is a PostgreSQL URL with TLS required; it never emits the value. The worker does not run the API's full environment validator because that validator requires unrelated HTTP/CORS/email settings. Only the worker-specific requirements are checked.

## 5. Browser renderer limitation

Browser rendering remains a separate infrastructure requirement. The existing renderer expects a dedicated Linux environment with Docker and the approved `runsc` gVisor runtime, `--network=none`, and a locally available immutable renderer image digest. This preparation does not assume Railway provides Docker-in-Docker, gVisor, or the required isolation boundary. Keep rendering disabled until that environment is separately reviewed. Do not weaken TLS verification, SSRF protections, or browser isolation.

## 6. Manual Railway setup and deployment order

1. Confirm Vercel's API variable is `KNOWLEDGE_WORKER_ENABLED=false` through the Vercel operator console; do not enable polling there.
2. Confirm the API revision and intended Neon database/schema. Do not display credentials in logs or support tickets.
3. Connect the existing GitHub repository to a Railway service; set root directory to `/`, one replica, Node `24.11.x`, and the install/build/start commands above.
4. Add the non-secret worker flags in Railway variables. Add `DATABASE_URL` only through Railway's secret variable UI. Keep renderer and semantic indexing disabled unless separately approved.
5. Deploy the same reviewed code revision as the API. Confirm the Railway deployment SHA and `knowledge_worker_started` log event. Confirm there are no unrelated consumer events from this service.
6. Verify the worker remains alive beyond a normal function invocation window and inspect sanitized polling/processing logs. Startup alone does not prove database access.
7. Only after the operator confirms worker health and no active crawl exists, separately approve one authenticated `Sync now` for `carteio.in`. Capture the job ID, correlate its safe failure event if needed, and confirm job, sync run, pages, chunks, source readiness, and active index generation.
8. Link the ready source to the intended active assistant through the authorized tenant workflow and check a relevant knowledge preview.

Do not create duplicate source records or repeatedly enqueue the same crawl. Existing active-job deduplication, PostgreSQL claim locking, five-attempt ceiling, and expired-lease recovery remain in effect.

## 7. Diagnostic patch verification

The diagnostic changes in `knowledge-processing.service.ts` and `website-crawler.ts` must be present in the deployed worker revision. Compare Railway's commit SHA to the reviewed repository commit and verify the resulting `knowledge_processing_job_failed` event contains only safe operation labels, stage, retry classification, Prisma/SQL categories, and the job fingerprint. Do not collect SQL, SQL parameters, raw database messages, page contents, customer data, or secrets.

The startup and shutdown events added here include no database URL, tenant content, or credentials. The presence of a startup event is not a database health signal; a successful job claim/state transition is the operational proof.

## 8. Tests and verification plan

Created `backend/test/knowledge-worker.spec.ts` for:

- Required worker flags and safe database configuration checks.
- Refusal to start in Vercel even if the worker flag is mistakenly true.
- The worker module's limited providers and absence of controllers.
- Standalone polling timer remains alive, is initialized only once, and stops cleanly.
- Vercel mode starts no poll timer.

These tests were not run. Existing `backend/test/knowledge-processing.spec.ts` covers queue behavior and error paths, but was not run in this phase. Before deployment approval, run the focused worker spec and relevant queue tests, then build the backend in a separately approved verification step. Runtime acceptance still requires a Railway log/queue observation; unit tests cannot prove Neon connectivity or deployment health.

## 9. Rollback and approval gates

Rollback is to stop or remove the Railway worker service and keep `KNOWLEDGE_WORKER_ENABLED=false` on Vercel. The API remains able to enqueue jobs; processing pauses until a compatible persistent worker is restored. Do not roll back the database schema independently of the API revision, and do not modify queue rows manually. If the new worker revision has a startup issue, stop it, retain safe logs, and redeploy the last known compatible worker artifact after revision/schema review.

Separate approval is required before installing dependencies, running builds/tests, setting Railway variables, creating a Railway project/service, deploying, changing Vercel variables, running migrations, enabling semantic embeddings, or enabling browser rendering. This task performed none of those actions.

## 10. Remaining limitations

- Railway has not been configured or deployed; actual resource sizing, restart behavior, log retention, and Neon connectivity are unverified.
- There is no live worker heartbeat or dedicated health endpoint. Confirm queue polling through safe logs and an approved job's persisted state.
- The original `DATABASE_ERROR` cause remains unknown until the deployed diagnostic patch observes a controlled retry.
- JavaScript rendering remains blocked pending separately approved Linux/Docker/runsc infrastructure.
- No crawling or indexing success is claimed.
