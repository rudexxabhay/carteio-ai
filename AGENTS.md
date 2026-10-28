# Carteio regression requirements

Before each change:

- Read `lastwork.md`, `docs/development/phase-register.md`, and the current results in `docs/development/phase-00-verification.md`.
- Inspect Git status and preserve all existing modified and untracked work.
- Identify affected working capabilities, callers, API/DTO contracts, authorization boundaries, and existing regression tests. Record the current assertion baseline and make a selective source checkpoint.

After each change:

- Execute affected tests and related regression suites with offline fixtures and mocked external services. Follow `docs/development/regression-protection.md`.
- Check browser/backend contract compatibility, assistant selection, tenant isolation, permissions, and public-origin/session boundaries where affected.
- Record exact commands, exits, assertion identities, failures, and unexpected changes in the existing development evidence records.
- Repair newly introduced regressions before proceeding. Never disable tests, weaken valid assertions, remove working features, fabricate success, or add merchant-specific chatbot shortcuts.

Keep historical failure evidence immutable and current results separate. Offline tests do not establish deployed, database, merchant-data, or paid-provider readiness.

Do not install or upgrade dependencies, change secrets or configured providers/models, run migrations or database resets, invoke paid providers, crawl externally, perform live Shopify synchronization/writes, deploy, commit, push, or discard work without explicit authorization.

Phase 01 requires closure of the Phase 00 gate and explicit user approval. Do not start it automatically.
