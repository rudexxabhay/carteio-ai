# Interpretation contract correction — 2026-10-27

## Scope and baseline

- Working tree baseline: branch `uat`, HEAD `3928901`; the interpretation implementation, its current recovery spec, and the development evidence are pre-existing untracked work. All existing modifications and untracked files were preserved.
- Recorded assertion baseline remains the Phase 00 evidence: backend 813 pass / 0 fail and frontend 217 pass / 26 fail in the latest saved complete reports. These are historical saved runs, not results for this correction. Current relevant suites were not run.
- A prior source archive is documented at `/tmp/carteio-phase00-20261024T072637Z`; it predates this correction. No new checkpoint was created because the requested execution envelope permits read-only terminal commands and minimal `apply_patch` edits only.
- Affected capabilities: single-stage interpretation; semantic recovery; out-of-scope and language-switch routing; grounded Knowledge and catalog selection. API/DTO/database contracts are unchanged. Recovery remains advisory; existing service authorization, tenant checks, factual aspect validation, and provider routing are unchanged.
- Existing regression coverage: `backend/test/conversation-intent.recovery.spec.ts`, `backend/test/assistant.playground.spec.ts`, and `backend/test/conversation-orchestrator.customer.spec.ts`.

## Source-confirmed correction

The interpretation prompt had an earlier rule permitting empty factual aspects only for standalone social/feedback/continuation messages, while a later rule explicitly required empty aspects for clearly out-of-scope requests and pure response-language changes. The later rule now explicitly resolves that conflict. It also states the existing recovery behavior: independently validated semantics can survive an invalid legacy intent or answer-aspect field, while those recovered labels do not authorize data or tools.

Added a focused generalized validator/recovery regression case for factual availability semantics paired with invalid legacy/aspect metadata. It asserts semantic routing metadata is recovered without accepting the invalid values. No exact customer phrase response is asserted.

## Review and execution record

- Read-only final review command: `git status --short -- backend/src/modules/workspaces/conversation-orchestrator.service.ts backend/test/conversation-intent.recovery.spec.ts docs/development/evidence/interpretation-contract-correction-2026-10-27.md && rg -n "Contract clarification: this rule|recovers validated factual semantics|recoverValidatedSemanticInterpretation" backend/src/modules/workspaces/conversation-orchestrator.service.ts backend/test/conversation-intent.recovery.spec.ts && sed -n '1,180p' docs/development/evidence/interpretation-contract-correction-2026-10-27.md` — exit 0.
- Initial read-only baseline command: `git rev-parse --short HEAD && git status --short && sed -n '1,220p' lastwork.md && sed -n '1,220p' docs/development/phase-register.md && sed -n '1,220p' docs/development/phase-00-verification.md && sed -n '1,240p' docs/development/regression-protection.md` — exit 0; output was truncated by the terminal display, so the required records were inspected in subsequent scoped reads.
- Test/build/type-check commands: **none run** (exit code not applicable).
- `apply_patch` source/test edits: completed; no command runner was used.
- Tests, builds, type checks, installs, servers, migrations, database operations, external API calls, background tasks, and deployments: **not executed**.
- Post-edit assertion identities/results: not available under the no-test-execution restriction. The new assertions are written, not verified.
- Runtime diagnosis of the reported 7-second interpretation latency and repeated submission incident: unresolved; safe diagnostics or approved runtime traces are still required to identify those boundaries. This correction does not claim those issues fixed.

## Files changed by this correction

- `backend/src/modules/workspaces/conversation-orchestrator.service.ts`
- `backend/test/conversation-intent.recovery.spec.ts`
- `docs/development/evidence/interpretation-contract-correction-2026-10-27.md`
