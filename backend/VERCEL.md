# Backend on Vercel

The backend is a NestJS app in this pnpm monorepo. Configure its Vercel project with:

- Root Directory: `backend`
- Framework Preset: NestJS (also declared in `backend/vercel.json`)
- Include source files outside the Root Directory in the Build Step: enabled, for the workspace lockfile and `packages/shared-types`
- Node.js version: 22.x (also declared in `backend/package.json`)
- Build Command: `pnpm run build` if an override is required. This script runs `prisma generate` before `nest build`; do not use the repository-wide recursive build command for this project.

Set these environment variables for the UAT deployment, with Neon UAT credentials only:

- `NODE_ENV=production`
- `DATABASE_URL`: Neon pooled PostgreSQL URL, with `sslmode=require`
- `DIRECT_URL`: Neon direct PostgreSQL URL, with `sslmode=require`
- `CORS_ALLOWED_ORIGINS`: exact HTTPS origin of the UAT frontend
- `PUBLIC_APP_URL`: exact HTTPS origin of the UAT frontend, also listed in `CORS_ALLOWED_ORIGINS`
- `AUTH_OTP_HASH_SECRET`: private random value with at least 32 bytes
- `RESEND_API_KEY` and `AUTH_EMAIL_FROM`: UAT mail delivery configuration
- `GOOGLE_CLIENT_ID`: Google OAuth client ID used by the UAT frontend

For full authorized UAT Inspector capture, configure these exact values in the **backend Vercel project**:

```env
APP_ENV=uat
PLAYGROUND_DIAGNOSTICS_ENABLED=true
PLAYGROUND_RAW_DEBUG_ENABLED=true
PLAYGROUND_TRACE_RETENTION_HOURS=24
```

Raw capture is permitted only when `APP_ENV=uat` is explicit, diagnostics are enabled, the user has authenticated owner/admin access, and the conversation's persistent Capture Metadata preference is ON. Local development permits the same capture with `NODE_ENV=development`; public production rejects raw capture even if the raw flag is accidentally true. Keep `PLAYGROUND_RAW_DEBUG_ENABLED=false` in production. Raw model output is bounded, redacted, retained with the trace, and returned only through protected workspace APIs. Public Widget responses never include diagnostic fields. The persistent conversation toggle remains ON across refresh/reopen until explicitly turned OFF. Trace rows are durable Inspector records; Vercel runtime logs are supplemental and not required for retrieval.

After setting values, apply the authored Prisma migrations through the reviewed deployment migration workflow, then redeploy the backend so runtime functions load the configuration. Restart/redeploy any separately hosted worker only if its environment is changed; Widget trace retrieval is served by the backend. Changing Vercel environment values alone does not update an existing deployment. Local configuration may use `APP_ENV=local`, `NODE_ENV=development`, `PLAYGROUND_DIAGNOSTICS_ENABLED=true`, `PLAYGROUND_RAW_DEBUG_ENABLED=true`, and retention `24`. Never enable raw capture in public production.

### Inspector and Shopify UAT diagnostics (2026-11-03)

For an explicitly authorized UAT capture window, configure these **backend Vercel project** values exactly:

```env
APP_ENV=uat
PLAYGROUND_DIAGNOSTICS_ENABLED=true
PLAYGROUND_RAW_DEBUG_ENABLED=true
PLAYGROUND_TRACE_RETENTION_HOURS=24
```

Keep `CONNECTOR_SYNC_DEBUG=false` in the backend unless a Shopify sync-job investigation is separately approved; set it only in the environment that runs the sync worker when that worker emits the relevant job logs. The raw flag is enabled only for an explicitly approved UAT capture window; capture still requires authenticated owner/admin access and the conversation-scoped Capture Metadata toggle. Turn it off when the window ends. Keep it false in public production. No additional diagnostic environment variables are required.

Apply authored Prisma migrations through the reviewed deployment migration workflow before enabling retrieval, including `20261103190000_widget_diagnostic_capture_consent` after `20261103150000_widget_diagnostic_trace_parity`. Do not apply them from this documentation or against a live environment without its normal approval/backup procedure. Redeploy/restart backend functions after environment changes and regenerate the Prisma client through that deployment workflow. Vercel Function Logs are in the backend Vercel project's **Functions** logs; persistent Inspector records are read from the protected dashboard Inspector API/database and are distinct from runtime logs. If sync runs in a separate worker deployment, locate its stdout/runtime logs at that worker host; there is no separate Vercel worker process in this deployment architecture.

Correlate a request by its `requestId` (also the per-attempt `traceId`) in backend logs and Inspector stage events. Shopify API test logs carry the same request ID and operation. For sync issues, use `jobId` from connector sync history together with the worker's request/operation metadata; `CONNECTOR_SYNC_DEBUG=true` adds bounded job attempt and resource metadata without credentials or raw provider responses. Widget Inspector records are associated only after the signed visitor session, tenant, assistant, and persisted support conversation have been validated; public Widget responses contain no diagnostics.

This is configuration guidance only. It does not establish UAT or deployed verification.

Durable Inspector history is stored in PostgreSQL and is not a substitute for runtime logs. Backend `conversation_stage`, `conversation_request_completed`, and `shopify_api_test` structured events go to the Vercel backend Function Logs for the API invocation. Background connector workers, when run as a separate process, write to that worker process's own configured stdout/stderr destination; Vercel does not collect logs from a developer machine or an unrelated container. No infrastructure-wide log aggregation provider is configured by this repository.

The running Prisma adapter connects through `DATABASE_URL`; startup validation also requires `DIRECT_URL`. No migration command is part of the build or deployment. Prisma Client generation is part of the existing backend build script.

`src/main.ts` remains the conventional Nest server entrypoint and continues to listen on `PORT` for local development. Vercel's NestJS framework detects that entrypoint when the project root is set to `backend`.

## UAT migration-first deployment

The workflow at `.github/workflows/prisma-migrate-uat.yml` runs on every push to `uat`. It validates the UAT database target, Prisma schema and migration files, typechecks both applications, then applies pending migrations with `prisma migrate deploy`. The existing manual `workflow_dispatch` remains available and still requires `confirm_uat`; it runs the validation and migration path without deploying. Runs share a non-canceling concurrency group.

The Vercel backend, frontend and smoke-check jobs are gated by the GitHub Actions Environment variable `UAT_DEPLOY_ENABLED=true`. This repository deliberately does not set that variable, so database migrations continue to run while deployments remain off. The deploy jobs target the existing projects through Vercel CLI and serialize backend before frontend. The smoke check calls `/api/v1/health` and `/api/v1/ready` through the frontend's existing same-origin proxy, plus checks `/` and `/login` for SPA responses.

Keep the existing Vercel project Root Directories set to `backend` and `frontend`. The CLI runs from the monorepo root so both projects can access the workspace lockfile and `packages/shared-types`; the environment-provided Vercel project ID selects which existing project receives each deployment.

Before enabling `UAT_DEPLOY_ENABLED`, create/use the GitHub Environment named `UAT` and add:

- Secret `UAT_DATABASE_URL`: direct Neon PostgreSQL URL for UAT database `neondb`, not a pooled endpoint.
- Secret `VERCEL_TOKEN`: a Vercel token authorized for the existing Carteio AI team and both existing projects.
- Variable `UAT_VERCEL_ORG_ID`: Vercel team/owner ID.
- Variable `UAT_VERCEL_BACKEND_PROJECT_ID`: ID for `carteio-ai-uat-backend`.
- Variable `UAT_VERCEL_FRONTEND_PROJECT_ID`: ID for `carteio-ai-uat-frontend`.
- Variable `UAT_VERCEL_CLI_VERSION`: an approved exact Vercel CLI package version (for example, `x.y.z`; choose and review the current version before activation).

Also set these UAT-only backend variables in the existing Vercel backend project: `NODE_ENV=production`, Neon UAT `DATABASE_URL` (pooled), `DIRECT_URL` (direct), `CORS_ALLOWED_ORIGINS=https://uat.ai.carteio.in`, `PUBLIC_APP_URL=https://uat.ai.carteio.in`, `AUTH_OTP_HASH_SECRET`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, and `GOOGLE_CLIENT_ID`. Configure the existing frontend's `VITE_GOOGLE_CLIENT_ID` if needed. Keep all private values in Vercel's server-side environment settings; never use `VITE_*` for secrets.

**Ordering blocker:** GitHub Actions cannot disable Vercel's independent Git integration. In both existing Vercel projects, disable Git-triggered Production deployments for the `uat` branch (or configure an equivalent required deployment check tied to this workflow). Verify that a direct push to `uat` creates no deployment in Vercel before setting `UAT_DEPLOY_ENABLED=true`. Until then, migration-first ordering is not guaranteed. The frontend rewrites and SPA fallback in `frontend/vercel.json` are unchanged.

The migration validation rejects obvious destructive SQL for deliberate review. It is a guardrail, not a proof that arbitrary SQL is safe. Prisma migration deploy is idempotent for already-applied migrations and will stop on database errors; never substitute `prisma db push`, reset, or manual migration-table edits.
