# Phase 03 report — database foundation

## Scope delivered

- Added Prisma ORM 7.10.0 configuration and Neon driver adapter wiring for the existing NestJS backend.
- Added backend-only pooled/direct database URL validation, with explicit no-database limited mode for local development/test and required configuration in production.
- Added a shared Prisma service, safe lifecycle shutdown, database readiness probe at `GET /api/v1/ready`, and redacted database error classification.
- Added the initial relational tenant schema and schema-contract/unit tests. The existing liveness `GET /api/v1/health` remains unchanged.
- Updated environment templates and database/security/architecture guidance.

## Not done by design

Dependencies were not installed, generated Prisma Client was not generated, no Neon credentials or target were supplied, and no migration SQL was generated or applied. No PostgreSQL connection was tested. The `pnpm-lock.yaml` could not be safely updated without the prohibited dependency installation; it remains unresolved until the developer runs `pnpm install` and reviews the lockfile diff. No auth, RLS, tenant authorization, business CRUD, or pgvector functionality was added.

## Verification

Automated tests and Prisma schema validation: **NOT RUN**. Running them requires the Prisma dependencies and generated client, neither of which is present in this checkout. Source changes and test cases were reviewed; this is not evidence of a live Neon connection or migration.

## Manual setup after review

1. Run `pnpm install` to resolve the pinned backend Prisma dependencies and update `pnpm-lock.yaml`.
2. Run `pnpm --filter @carteio/backend prisma:generate` to generate the client without connecting to Neon.
3. Configure both backend-only Neon URLs with `sslmode=require` (or leave both absent for local limited mode).
4. Review the schema, create a disposable Neon branch, and generate/review the initial migration there. Do not apply production migrations until separately approved.
5. Run the focused backend test suite and typecheck after dependency installation; then verify `/api/v1/health` and `/api/v1/ready` manually.
