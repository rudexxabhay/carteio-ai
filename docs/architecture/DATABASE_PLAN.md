# Database plan

Carteio AI uses Neon-hosted PostgreSQL as its server-side database and Prisma as its typed data-access layer. PostgreSQL provides relational constraints for tenant-owned data. Neon provides managed PostgreSQL without requiring a local database. The browser talks only to NestJS; it never receives database credentials.

## Neon and Prisma connections

The backend uses a pinned Prisma ORM 7.10.0 toolchain (`prisma`, `@prisma/client`, and `@prisma/adapter-neon`). Prisma 7 uses `prisma.config.ts` for CLI connection configuration and a generated client with the Neon driver adapter at runtime. The Prisma 7 stable release line is selected; Prisma 8 is not used while it is a release candidate. See the [Prisma release status](https://www.prisma.io/docs/orm/release-status) and [Prisma 7 PostgreSQL/Neon adapter guidance](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql).

- `DATABASE_URL` is the Neon pooled endpoint (normally the `-pooler` hostname) for application queries.
- `DIRECT_URL` is the Neon direct endpoint used by Prisma CLI migration operations.
- Both values stay in `backend/.env` locally or a backend secret store in production. Both must use `sslmode=require`; they are never printed or copied into Vite configuration.
- In development and test, omitting both enables limited mode. The API's liveness route remains available and readiness reports `not_configured`; no database-backed operation is claimed to work. Supplying only one or an invalid URL fails configuration validation. Production requires both.

Prisma client generation runs before backend dev, build, typecheck, and test scripts. It does not connect to or mutate a database. No migration runs at application startup. The readiness probe issues `SELECT 1` only when called, coalesces concurrent checks, and caches the result for five seconds.

## Schema evolution and deployment

The initial Prisma schema is in `backend/prisma/schema.prisma`. There is intentionally no generated migration yet: dependencies have not been installed and there is no approved Neon target. After reviewing the schema and configuring a disposable development Neon branch, generate and review the first migration with `pnpm --filter @carteio/backend prisma:migrate:dev -- --name initial`. Commit the migration and `migration_lock.toml`; verify it against a fresh disposable branch before use. Production releases use `prisma:migrate:deploy` against the direct endpoint only after backup/recovery and migration review. Never run `db push` in production or deploy schema changes at app startup.

Before destructive production changes, take or verify a recoverable Neon backup/PITR point. Prefer additive migrations and expand/contract changes. Rollback may require a forward corrective migration; restoring a backup can lose writes after the recovery point. Define and test recovery point objective (RPO), recovery time objective (RTO), retention, and restore procedure before customer data is stored.

Use separate least-privilege Neon roles for runtime and migration work. The runtime role should not own schemas or have migration privileges; the migration role should be available only to the controlled release process. Size pooled connections to the deployment budget and set explicit timeouts after workload/load testing.

## Tenant and retrieval design

Every business record carries `organizationId`. Composite foreign keys make a chatbot or integration's optional website belong to that same organization. Those constraints are structural safeguards, not complete tenant isolation. Future service queries must derive organization scope from a server-verified identity and membership; a client-supplied organization ID is only a requested scope. Add transaction-scoped tenant context and PostgreSQL Row-Level Security (RLS) with a non-owner runtime role, then test missing, forged, and cross-tenant contexts. Do not claim RLS is active today.

Future retrieval may use PostgreSQL `pgvector`, versioned embeddings, and tenant-filtered similarity search. Keep source document/version metadata so derived chunks can be rebuilt and deleted. Enable the extension only through an explicitly reviewed migration on an approved database. No vector tables or RAG pipeline exist in this phase.

## Implemented status

Prisma configuration, the initial relational schema, a NestJS Prisma service, environment validation, and a minimal readiness probe are implemented. There is no Neon connection, migration, production data, authentication, tenant authorization, RLS policy, or database-backed business API yet. See [schema details](DATABASE_SCHEMA.md), [database security](../security/DATABASE_SECURITY.md), and the [Phase 03 report](../phases/PHASE_03_REPORT.md).
