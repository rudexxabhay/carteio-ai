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

## Neon UAT migrations

The GitHub Actions workflow at `.github/workflows/prisma-migrate-uat.yml` applies pending migrations with `prisma migrate deploy`. It runs automatically on `uat` pushes that add or change files under `backend/prisma/migrations/`, and supports a manually confirmed `workflow_dispatch` for the initial migration. Runs share a non-canceling concurrency group.

Create a GitHub Environment named `uat`, then add the environment secret `UAT_DATABASE_URL` containing only the direct Neon PostgreSQL connection for the UAT database `neondb`. Use the direct endpoint (not the `-pooler` endpoint); the workflow validates the Neon host, direct endpoint, and database name without printing the URL. The workflow maps that one secret to Prisma's `DIRECT_URL`; it does not reference development or production secrets.

For the first run, select the `uat` branch in **Actions → Prisma UAT migrations → Run workflow**, enable `confirm_uat`, and start the workflow. Confirm it succeeds before manually redeploying the UAT backend. Later migration-file pushes to `uat` apply pending migrations automatically. Prisma reports incompatible existing schema or incomplete/failed migration history as an error; inspect and resolve that history deliberately. Never substitute `prisma db push`, reset, or manual migration-table edits.

Vercel's automatic deployment is not gated by this workflow today. A GitHub push can start the migration job and Vercel deployment concurrently. Configure Vercel deployment checks to wait for the migration workflow before relying on migration-first ordering, or keep UAT deployment manual until that gate is in place.
