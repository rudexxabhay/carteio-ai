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

The existing 12-phase roadmap remains gated: its Phase 01 and later phases require closure of the Phase 00 gate and explicit user approval. Do not start those roadmap phases automatically.

## Owner-approved independent Knowledge Base rebuild track — 2026-10-29

The repository owner has authorized a separate **Knowledge Base Rebuild — Phases 01 to 04** track. This track may proceed independently of the existing Phase 00 closure gate, subject to its own explicit phase scope/approval and all safety and regression requirements above. This is an exception for the Knowledge Base rebuild and necessary supporting infrastructure only; it does not close Phase 00, resolve or reclassify any of its 201 recorded failures, or authorize unrelated roadmap work. Keep the historical Phase 00 evidence immutable and its status BLOCKED until its own closure criteria are met. Preserve the existing AI execution, provider, prompt, conversation, Shopify, widget, and RAG retrieval contracts unless a later Knowledge Base phase is separately approved to change a specifically identified integration point.
