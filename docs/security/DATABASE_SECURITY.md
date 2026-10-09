# Database security foundation

## Implemented

- PostgreSQL is accessed only by the NestJS backend through Prisma; the frontend has no driver or connection string.
- `DATABASE_URL` and `DIRECT_URL` are backend-only settings, validated together as PostgreSQL URLs requiring `sslmode=require`. The validated public application config contains only a boolean indicating whether database mode is enabled.
- Runtime Prisma access uses the pooled Neon URL and `@prisma/adapter-neon`; Prisma CLI schema operations use the direct URL. Connection strings and raw driver errors are not returned or logged by the readiness endpoint.
- Referential integrity and composite organization/website constraints are present. Deletion is restrictive to avoid broad accidental cascades.
- Production configuration fails if either database URL is absent or malformed. Development/test without both URLs is an explicit limited mode, not a fake connected state.

## Required before production data

1. Create a Neon project/branch and store the pooled and direct URLs in the backend secret manager. Never use a `VITE_` variable or image build argument.
2. Use separate least-privilege runtime and migration roles. Runtime should not own schema objects; migration credentials belong only in the release environment.
3. Configure a trusted tenant context from authenticated server state inside each transaction. Add PostgreSQL RLS policies and use a runtime role that cannot bypass them. Test missing context, wrong organization IDs, forged IDs, and cross-tenant relationship writes.
4. Normalize email in the trusted write service; add a reviewed check constraint before any direct SQL write path is permitted.
5. Restrict audit metadata to reviewed keys and bounded values. Never store passwords, tokens, raw connection URLs, secrets, or unnecessary personal data in audit metadata.
6. Review migration SQL and take/verify backups before destructive changes. Establish retention, PITR, RPO/RTO, restore tests, and incident access procedures.
7. Set connection and statement timeouts and Neon pool budgets based on production concurrency. Add monitoring without logging SQL parameters or credentials.

No authentication, tenant authorization, RLS, encryption service for connector credentials, or production database role has been configured by this phase. A database health response only indicates that the configured query succeeded at that moment; it does not prove tenant isolation or production readiness.
