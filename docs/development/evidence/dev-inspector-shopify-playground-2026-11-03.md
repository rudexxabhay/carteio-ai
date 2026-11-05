# Dev Inspector and Shopify API Playground — 2026-11-03

## Scope and preservation

Implemented the authorized conversation-level diagnostic capture and Shopify API Test Playground on top of the current existing Inspector, shared conversation orchestrator, connector adapter/service, and dashboard. The earlier in-memory toggle correction is retained. Historical Phase 00 verification and its BLOCKED status are unchanged. The initial working tree contained unrelated modified and untracked files; those were preserved.

## Implemented source areas

- `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261103120000_playground_diagnostic_capture/migration.sql`: durable conversation capture preference and tenant-linked per-attempt diagnostic trace rows with bounded payload and expiry.
- `backend/src/modules/workspaces/conversation-orchestrator.service.ts`, `playground-diagnostics.ts`, `conversation-intent.ts`, `conversation.contracts.ts`, `playground.dto.ts`, `saas.controller.ts`, `saas.dto.ts`: server-validated preference, tenant/session authorized trace and session APIs, bounded retention, outcome storage, protected diagnostic detail gating, shared pipeline summaries, structured logs.
- `backend/src/modules/workspaces/connectors/connector.service.ts`, `shopify.adapter.ts`, `saas.controller.ts`, `saas.dto.ts`: manager-only Shopify read test operations, connector/workspace ownership, current scope checks, credential decryption server-side, bounded allowlisted API calls, synced catalog and assistant readiness checks, safe outcome logs.
- `frontend/src/dashboard-source/pages.tsx`, dashboard CSS, API clients, `frontend/src/pages/saas/ShopifyApiTestPlayground.tsx`: persistent capture toggle, session history/trace pagination, message and stage JSON inspection, copy/export/search/status/filter controls, Shopify live/snapshot/assistant test panel.
- Focused backend/frontend regression tests, `backend/.env.example`, `backend/VERCEL.md`.

## Capture and security behavior

Capture preference is stored on the authorized Playground conversation and restored from authorized conversation/session APIs. A new conversation defaults OFF. Capture OFF leaves existing rows available while stopping later detailed captures. Failed and successful attempts use distinct request IDs; traces are grouped by session and the provided turn correlation. Trace and history queries apply organization, assistant, user, channel, expiry and authenticated-manager checks. The public Widget does not receive Inspector route access. Protected raw output is opt-in through development-only `PLAYGROUND_RAW_DEBUG_ENABLED`; UAT guidance keeps it false. Routine trace summaries redact customer text and Knowledge excerpts; structured JSON payloads are size-bounded and have expiry.

The shared orchestrator records the stages the real Playground execution path reaches, including interpretation/recovery, provider calls, retrieval/evidence, tool operations, validation, persistence/delivery and release summaries. Existing event contracts are retained; unexecuted branches are not synthesized as executed stages. Exact coverage varies by execution path. The captured envelope includes trace/request/session/message/attempt correlation, timestamps/durations, safe input/output/decision summaries, provider/model, retrieval and evidence metadata, tool outcomes, final delivery and safe error category. Raw model output is only included when the protected development gate permits it.

## Shopify test surface

Read-only allowlisted operations include connection verification, live product search/details/variants/prices/images, inventory when both required scopes are fresh/granted, collections, locations, online-store pages, policies, markets, discounts, and metaobject definitions. Separate operations test normalized catalog search and assistant product readiness. Credentials remain server-side. HTTP success with GraphQL errors is treated as failure. No test triggers a sync or mutation.

## Configuration and operations

- `PLAYGROUND_DIAGNOSTICS_ENABLED=true` (existing flag): optional, required to expose detailed capture, only honored in development or explicit `APP_ENV=uat`; keep false in production.
- `PLAYGROUND_RAW_DEBUG_ENABLED=false` (new): protected model/customer response detail; optional, development-only, recommended false locally unless specifically needed, false in UAT and production.
- `PLAYGROUND_TRACE_RETENTION_HOURS=24` (new): optional, bounded trace retention (1–24 hours), recommended 24 locally/UAT and 24-hour cap in production if diagnostics are explicitly enabled.
- `CONNECTOR_SYNC_DEBUG` remains unchanged; no sync is run by the test panel.

UAT Vercel functions emit their server logs under the backend Vercel project Function Logs; this deployment has no separately deployed worker process. If a separate worker is used in another deployment, its own stdout/runtime logs are managed by that host, not Vercel Function Logs. Persistent Inspector rows are separate from runtime logs. Redeploy backend after changing Vercel environment values. Apply the authored migration through the normal reviewed deployment migration process; it was not applied here.

## Validation evidence

Commands were run using repository offline fixtures and no external provider/Shopify requests:

1. Backend focused diagnostic/Shopify tests:
   `timeout 180 node --require ../scripts/phase00/offline.cjs node_modules/jest/bin/jest.js --config jest.phase00.config.cjs --runInBand --runTestsByPath src/modules/workspaces/playground-diagnostics.spec.ts src/modules/workspaces/connectors/connector.service.spec.ts src/modules/workspaces/connectors/platform-commerce.adapters.spec.ts --testNamePattern='retains structured JSON|persists conversation capture|returns retained traces|runs a live Shopify test|rejects cross-tenant Shopify|runs a bounded live product search|retains HTTP 200 GraphQL error' --reporters=default --json --outputFile=/tmp/carteio-inspector-shopify-focused.json`
   Exit 0; 3 suites passed; 5 tests passed and 82 skipped by the selective pattern.
2. Durable preference/trace API service tests:
   `timeout 180 node --require ../scripts/phase00/offline.cjs node_modules/jest/bin/jest.js --config jest.phase00.config.cjs --runInBand --runTestsByPath test/assistant.playground.spec.ts --testNamePattern='persists conversation capture|returns retained traces' --reporters=default`
   Exit 0; 1 suite passed; 2 tests passed and 179 skipped.
3. Frontend focused Playground/Shopify tests:
   `timeout 180 node --require ../scripts/phase00/offline.cjs node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 --minWorkers=1 --reporter=dot src/tests/playground-live-flow.test.tsx src/tests/shopify-api-test-playground.test.tsx --testNamePattern='keeps metadata capture|restores a saved conversation|sends the selected live search|allows a collection listing'`
   Exit 0; 2 files passed; 4 passed and 6 skipped.
4. TypeScript parser checks: backend 9 changed TS sources/specs, exit 0 with zero syntax diagnostics; frontend 6 changed TS/TSX sources/specs, exit 0 with zero syntax diagnostics.
5. `git diff --check` was started but had not completed at the time this record was authored; no pass is claimed.
6. An earlier frontend selective run using the same four-name filter exited 1 because its source assertion matched both the panel subtitle and result; the assertion was narrowed and the rerun above exited 0. An earlier wider frontend run exited 124 without a summary. `git diff --check` did not complete: it was interrupted after producing CRLF-related whitespace diagnostics across existing line-ending-sensitive files (exit 130); no clean-diff claim is made. Prisma validation/client generation, TypeScript typecheck, full suites, migration execution, browser/UAT verification, and live Shopify/provider requests were not completed. No test is claimed beyond the commands above.

## Remaining gaps and status

This is implementation evidence, not proof that every acceptance gate passed. Migration must be applied in an authorized environment before persistence works against deployed schema. Widget-equivalent durable trace inspection and exhaustive outcomes for every listed branch are not implemented; infra-wide log aggregation, full regression/typecheck, browser responsiveness and UAT/live-store behavior remain unverified. Current status: **PARTIALLY_IMPLEMENTED**.

## Final completion pass — 2026-11-03

The section above records the prior run and is retained as historical evidence. This pass continued the existing implementation; it did not replace the Inspector, AI runtime, Shopify integration, or Phase 00 evidence. Initial source checkpoints were stored under `/tmp/carteio-final-inspector-before/`; the existing modified and untracked work was preserved.

### Source work completed

- Shared `executeSharedAI()` diagnostics now retain structured safe summaries on success and failure, explicit stage coverage (`EXECUTED`, `EXECUTED_FAILED`, `SKIPPED`, `IN_PROGRESS`, `NOT_REACHED`, and event-cap `NOT_RECORDED_LIMIT`), and decision ownership/results. The trace records the actual interpretation and backend route separately, and records language/scope, answer plan, retrieval/source eligibility, tool request/authorization/execution, Shopify readiness, evidence, validation, persistence/delivery, and session-release events along branches that run. Earlier recorded events survive later failure. Safe JSON carries relevant bounded summaries/counts, provider/model/purpose, durations/timestamps, correlation IDs, and sanitized error categories; customer text and raw prompts remain redacted unless the existing protected development gate permits capture.
- Widget turns now use the same recorder and shared orchestrator stages with `PUBLIC_WIDGET` channel identity. Durable traces link to the actual support conversation, have distinct request/trace IDs and per-correlated-turn attempt numbers, and are retrievable only through authenticated manager routes. Organization, assistant, channel, conversation, and expiry constraints are applied in service queries. No diagnostics are added to public Widget responses. Securely associated Playground pre-session/authorization and lease failures are persisted when capture is enabled; Widget trace persistence errors are caught and cannot replace the original customer outcome. Failures before a secure tenant/session association remain sanitized runtime/security telemetry only; assigning them durably would risk fabricating or misattributing a conversation.
- The existing compact Inspector now selects Playground or Widget histories, pages real conversation/attempt records, filters outcome/searches stages, displays first failure and stage coverage, distinguishes missing/expired/redacted/unrecorded details, shows expiry, and copies safe attempt, stage, full-message, or conversation JSON. Capture preference remains persisted through the existing conversation API. Long histories remain paginated; trace JSON is bounded.
- Added the backward-compatible Widget trace migration: existing Playground conversation links become nullable, Widget support-conversation linkage and channel are added, and consistency/FK/index constraints are included. No database migration was run. Existing expiry and paginated tenant-scoped lookup remain the retention/access mechanism.
- Protected Widget history/trace routes reuse authenticated workspace sessions and manager checks. Shopify Playground implementation was preserved; its existing allowlisted read-only backend continues to separate live API outcome, normalized snapshot, and assistant authorization/readiness. GraphQL errors remain failures even for HTTP 200. No credential, arbitrary query, mutation, cross-tenant access, live sync, or paid provider call was introduced.
- UAT guidance is in `backend/VERCEL.md`. Exact recommended backend environment values are `APP_ENV=uat`, `PLAYGROUND_DIAGNOSTICS_ENABLED=true`, `PLAYGROUND_RAW_DEBUG_ENABLED=false`, `PLAYGROUND_TRACE_RETENTION_HOURS=24`; set `CONNECTOR_SYNC_DEBUG=false` on backend and enable it only in the worker deployment when investigating sync. The doc covers migration/redeployment, Vercel function logs, separate worker logs, Inspector record location, and requestId/traceId/jobId correlation. UAT was not accessed or tested.

### Regression coverage and verification limits

Added or extended focused source tests for structured stage failure, stage coverage status, Widget durable trace and persistence noninterference, tenant/assistant/channel/expiry query filters, route contract, and Widget Inspector channel/history/copy behavior. Existing Shopify regression cases remain in place for GraphQL errors, source differentiation, authorization/readiness, and allowlisting. Tests were authored but not executed. Per the task instruction, this run executed no test command, build, typecheck, migration, or background process; thus no fresh assertion identities, exits, or runtime outcomes are claimed. Required manual follow-up includes the authored migration on a disposable/local database, focused backend/frontend regression suites, browser checks of both channels and Shopify empty/error/loading/timeout states, and authenticated UAT verification. Live Shopify/provider and deployed readiness remain unverified.

Latest repository implementation status: **IMPLEMENTED_NOT_VERIFIED**. This means source work for the requested repository scope is present; it is not a runtime, UAT, database, or live-service pass. Phase 00 remains **BLOCKED**, with historical failure evidence unchanged.

## UAT full protected Inspector capture follow-up — 2026-11-03

The raw model output gate now accepts either local development or explicit `APP_ENV=uat` with `PLAYGROUND_DIAGNOSTICS_ENABLED=true`; `PLAYGROUND_RAW_DEBUG_ENABLED=true` remains required in both cases. Public production is rejected independently of `NODE_ENV`. Protected output is redacted for credentials/authorization values in the trace snapshot, bounded by the existing record limits and a 500,000-byte durable payload limit, and retained in the existing trace row for authenticated Inspector retrieval. Both Playground and Widget trace persistence preserve protected records; Widget HTTP/customer responses remain free of diagnostics. The persistent Playground conversation capture preference and existing protected owner/admin routes remain in effect.

Backend UAT settings: `APP_ENV=uat`, `PLAYGROUND_DIAGNOSTICS_ENABLED=true`, `PLAYGROUND_RAW_DEBUG_ENABLED=true`, `PLAYGROUND_TRACE_RETENTION_HOURS=24`. Public production: `PLAYGROUND_RAW_DEBUG_ENABLED=false`. New source tests cover the environment policy and redaction; existing tests cover protected capture bounds/expiry, persisted conversation preference, role scope and Widget tenant isolation/trace retrieval. Tests were not run. Do not claim UAT readiness until the authored migrations are applied through the reviewed deployment workflow, backend is redeployed with these settings, and owner/admin capture is manually checked end-to-end. Current status remains **IMPLEMENTED_NOT_VERIFIED**.
