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
