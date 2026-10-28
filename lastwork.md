# Carteio AI — current handoff notes

Updated: 2026-10-27

> ## ★ TODAY'S AI WORK — READ FIRST ON RESUME ★
>
> **2026-10-27 — Carteio shared AI / Playground / Widget reliability**
>
> - **Knowledge search wiring:** Existing Gemini interpretation queries and answer-aspect queries flow through the bounded retrieval plan into tenant-authorized `searchPreview`; a single distinct LLM-planned Knowledge retry is permitted when initial evidence coverage is insufficient. Source-language hints include ready, authorized website-page language metadata. Runtime query quality is not verified.
> - **Evidence relevance and unsupported answers:** Fixed the relevance gate that treated any Knowledge result as relevant. Evidence now needs to map to a requested answer-plan aspect; support-contact configuration is usable when a support request makes it relevant. Valid citations outside the mapped aspects are rejected. If a search/tool completes without evidence for the requested aspects, the existing dynamic no-evidence response is used instead of citation recovery over unrelated content.
> - **Tool availability and absence:** AI tool results distinguish `UNAVAILABLE`, `NO_MATCH`, and `RESULTS`, report retrieved-record completeness, and carry `authoritativeAbsenceVerified: false`. Current catalog/search APIs do not prove exhaustive absence. The answer instruction now prohibits inferring nonexistence from a denied tool, an empty result, or partial/unknown data.
> - **Session cleanup / final delivery:** Best-effort session release now records a `SESSION_RELEASE` stage and sanitized backend failure details, without replacing a persisted reply or the original execution error. Playground failed-stage selection ignores secondary cleanup errors. Applied across shared execution, trusted Widget replay/error handling, and Playground history-load cleanup.
> - **Route / response corrections:** The existing Business Source Router now retains both static business Knowledge and live-record requirements for a mixed status request. The live-record limitation validator maps to a specific safe failure category; its failed predicate is traced. Stale Shopify OAuth scope checks remain fail-closed.
> - **Agent Builder / traceability:** Existing authorized traces record retrieval stages, lexical/semantic outcomes, query origin and safe failure reasons; prior work exposed actual Builder Knowledge-node retrieval reasons. No duplicate orchestration engine was introduced.
> - **Compilation follow-up:** Restored the full `SAFE_REASONS` declaration after an edit accidentally replaced it; added `session_release_failed` to the existing allowlist. The reported TS2304 root cause is corrected in source, but no compiler was run.
>
> **Regression specs added/updated, all NOT RUN.** No builds, typechecks, installations, migrations, servers, background work, database mutations, or external provider/Shopify calls were performed for this continuation. **All work remains IMPLEMENTED_UNVERIFIED.** No runtime proof ties the earlier reported trace IDs to a specific source defect. General prose entailment—especially multilingual negation against otherwise relevant evidence—and authoritative catalog absence remain unresolved; do not claim perfect factual verification. OpenRouter/Gemini, prompts apart from the noted safety clarifications, Shopify permissions, Knowledge authorization, tenant isolation, citation/numeric validation, and persistence architecture were preserved.
>
> **Main files touched in today's AI fixes:** `backend/src/modules/workspaces/conversation-orchestrator.service.ts`, `conversation.contracts.ts`, `grounded-response-validation.ts`, `playground-diagnostics.ts`, `conversation-diagnostics.spec.ts`, `conversation-orchestrator.customer.spec.ts`, `conversation-orchestrator.playground-failure.spec.ts`. The detailed dated notes below record additional search, route, diagnostics and regression changes. Inspect Git status before editing because these files were already part of a heavily uncommitted workspace.

## CURRENT STATE — PHASE 00 FINAL GATE IS BLOCKED

The latest approved roadmap task was **Phase 00 — Baseline & Regression Protection**. Do not start Phase 01 automatically. The Phase 00 architecture, capability inventory, test evidence, safety procedure, checkpoint and regression specs were created, but the final-gate review changed the status from the earlier `VERIFIED_PASS` claim to **BLOCKED**.

### Phase 00 evidence and result

- Recorded test baseline: backend **687 passed / 116 failed** across 76 files; frontend **158 passed / 85 failed** across 32 files; database-disabled local HTTP **7/7 passed**; offline network guard **3/3 passed**. Combined disjoint counts: **855 passed / 201 failed**. The totals are consolidated across scoped runs, not one successful full-suite run.
- All 201 red assertions are listed by exact test name in `docs/development/evidence/backend-latest-assertions.json` and `frontend-latest-assertions.json`; suite counts are in `test-suite-ledger.md`.
- Only **2 of 201** have independently confirmed root causes: (1) active inbox note API has no matching backend route (P1 candidate for Phase 01); (2) grounded response validation rejects a correctly sourced Shopify snapshot date (P0 candidate for Phase 06). The other **199 are classified unresolved root cause**. Do not assume they are harmless, test-only or pre-existing. Their severity and roadmap assignment remain incomplete.
- Checkpoint/hash comparison shows Phase 00 changed no production implementation files. This is evidence of no Phase 00 production-code change, but it does **not** prove test-outcome non-regression: no full pre-edit assertion baseline exists. No claims that the 199 failures predate Phase 00.
- No paid provider request, live Shopify sync/crawl, database mutation, migration, build, install, app server, deployment, commit or push was performed for Phase 00.
- Phase 01 remains **NOT_STARTED** and is not ready under the strict gate. Close Phase 00 only after every red assertion has an evidence-backed category/root cause, severity and target phase, and the gate record is reviewed again.

### Where the Phase 00 work is recorded

- `docs/development/architecture-baseline.md` — inspected frontend/backend/data/AI execution paths and diagram.
- `docs/development/capability-inventory.md` — source implementation and runtime states kept distinct.
- `docs/development/phase-00-verification.md` — commands/results, 201-failure reconciliation, limitations, gate criteria and final **BLOCKED** status.
- `docs/development/known-defects.md` — confirmed defects, unresolved failures and unverified runtime dependencies.
- `docs/development/regression-protection.md` — guarded test commands, protection targets and safe rollback.
- `docs/development/phase-register.md` — Phase 00 BLOCKED; every later phase NOT_STARTED.
- `docs/development/evidence/` — sanitized runner JSON, command ledger, assertion ledgers, baseline summary and current file hashes.
- `scripts/phase00/offline.cjs` / `.test.cjs`, `backend/jest.phase00.config.cjs`, and the four `phase00-*` regression specs are test-only guard/coverage.

### Next time: resume here

1. Read the six development documents above, then review both latest assertion JSON ledgers and raw reports in `/tmp/carteio-phase00-*` if still available.
2. Build a durable triage ledger for all 201 exact failing assertions. For each: category (confirmed application defect, fixture/selector mismatch, frontend/backend contract mismatch, test-harness defect, environment/configuration dependency, or unresolved), evidence/reason, severity, target phase, and whether release-blocking. Group only when a shared root cause is proven. Do not weaken/skip tests or change production behavior as part of this Phase 00 gate review.
3. Review the existing failure evidence against source and current test fixtures. If historical before/after assertion results cannot be recovered, leave test-result non-regression explicitly unproven; do not fabricate pre-existing status.
4. Keep Phase 00 **BLOCKED** until the reconciliation is complete; then update the verification/defect records and phase register. Only after closure and explicit user approval may Phase 01 begin.

### Workspace and checkpoint safety

- Preserve the extensive pre-existing modified/untracked work in this shared checkout. Do not run `git reset`, `clean`, `checkout`, `restore`, rebase, stash, or overwrite files to “return” to the checkpoint.
- Phase 00 checkpoint: `/tmp/carteio-phase00-20261024T072637Z`; pointer: `/tmp/carteio-phase00-current`. It contains initial status, tracked patch, source archive and checksums. `/tmp` is ephemeral; do not treat it as a permanent backup.
- Current repository state is intentionally dirty. Inspect `git status` before any additional edits. Do not commit or push unless explicitly requested.

---

## Earlier dashboard replacement handoff (2026-10-20; historical context)

Updated: 2026-10-20

## Current objective

Continue the full dashboard UI replacement using the root `carteio-ai-dashboard/` React source as the UI authority. Keep the existing React + TypeScript + Vite app, API integrations, authentication, workspace isolation, and business logic. Do not touch `backend/`, landing page, or login/signup. The standalone source `carteio-ai-dashboard/src/pages.tsx` is a design reference only: it contains demo data and fake actions, so it must not be mounted into production as-is.

## Working tree / safety

- The Git tree contains extensive unrelated user changes, including many backend files. Preserve all of them; do not reset, clean, or overwrite unrelated work.
- A pre-dashboard checkpoint is available at `/tmp/carteio-pre-dashboard-ui-frontend-checkpoint.tar.gz` (SHA-256 `6ac8b520e724ea26902767e8d67ef5b29dc068bccf414b8c38505aa8b26ddffb`) and the associated patch at `/tmp/carteio-pre-dashboard-ui-replacement.patch` (SHA-256 `339e9fe4faa019b1bb85b5b3b9fa51f5f31cd7ce554dbb6763fe022f407e3b44`). The archive was used to recover `frontend/src/styles/workspaces.css` after a selector cleanup left invalid CSS. The stylesheet was then cleaned safely using PostCSS AST traversal.
- No backend file was changed by the dashboard UI work described here.

## Work completed so far

Latest Phase 2 additions:

- `/knowledge` and `/knowledge/:baseId` now mount `SourceKnowledgePage` and `SourceKnowledgeDetailPage`, using the existing knowledge source, processing, and reindex APIs. Empty content is shown when the service has no content preview.
- `/integrations` now mounts `SourceIntegrationsPage`, using the connector catalog and live workspace connector list. A Shopify connection is shown only if the API returns one.
- `/team` and `/settings` now mount source-composition pages backed by existing workspace member, workspace read, and workspace update APIs. Invites, role changes, and unsupported settings remain unavailable.
- `/widget` and `/widget/appearance` now mount `SourceWidgetPage`, backed by real assistant and widget configuration APIs. Embed code is only generated from the configured hosting origin and the actual public widget ID; saving persists through `saveWidgetConfig`.
- Shopify integration detail now renders the source composition classes with real connector permissions and sync history; its obsolete page-specific `shopify-detail.css` was removed.
- `AppRoutes.tsx` lazy-loads these pages inside the existing protected BrowserRouter. No backend, auth, landing, or source-folder files were edited in this slice.
- Updated `rors/dashboard-critical-correction-2026-10-20.md` with actual route mappings and limitations.
- These are API-backed source-style compositions, not verbatim transplanted `pages.tsx` JSX. Exact source parity and visual verification remain outstanding; route switches alone do not complete the requested transplant.

- Adapted `frontend/src/layouts/DashboardLayout/DashboardLayout.tsx` to the supplied V2 shell: grouped navigation, 242px desktop sidebar, 74px topbar, workspace switcher, profile menu, mobile drawer/bottom navigation, and route search. Existing workspace access checks, role-filtered navigation, workspace switching, auth transition and logout behavior are retained.
- Added `frontend/src/layouts/DashboardLayout/dashboard-v2.css`, a dashboard-scoped stylesheet based on the supplied source styles. CSS is scoped to `.carteio-dashboard-v2` so it does not restyle landing/auth routes. It includes V2 shell, loading/error states, source palette overrides and responsive rules.
- Added `frontend/src/layouts/DashboardLayout/dashboard-v2-ui.tsx` with adapted source primitives. Demo product art, sample badges/data and local-only fake actions were excluded.
- Dashboard overview uses live authorized APIs for summary, Shopify products, recent conversations, tickets, workspace activity and recent orders. Removed the static 22% order bar and unsupported visitor/product-view/add-to-cart rows. Unsupported historical trends and AI resolution are labeled unavailable.
- Product catalog uses real product data/images, live count and supported search/pagination. Unsupported AI indexing filters were removed because the current product API does not expose those fields/filters.
- Replaced old generic workspace loading/error screens with V2 shell skeletons and categorized retry states (network, timeout, access, not found, invalid response). `/dashboard` and `/workspaces` lazy loading now use the V2 workspace skeleton. Dashboard child-route lazy loading has an in-shell skeleton.
- Frontend API network/timeout error messages now tell the user to check connectivity and retry.
- Shared loading state in commerce, sales, orders, conversations, handoff and billing uses responsive V2 skeleton blocks without artificial delays.
- Conversation detail/status errors are now visible instead of silently clearing to a blank/loading state.
- `frontend/src/pages/workspaces/WorkspaceEntry.tsx` uses the V2 loading/error presentation. WorkspaceProvider reports actionable network/timeout/permission messages.
- Removed `frontend/src/layouts/DashboardLayout/dashboard-layout-polish.css` and dead old shell/overview CSS selectors. Recovered `frontend/src/styles/workspaces.css` from the checkpoint and removed obsolete shell/account/old overview selectors through PostCSS AST parsing; shared workspace forms, membership and assistant styles were retained.
- Updated `rors/dashboard-source-merge-audit-2026-10-20.md` with design/source inventory, API map, limitations and current progress.

## Verification actually performed

- `./node_modules/.bin/tsc --noEmit -p frontend/tsconfig.json` passed after the latest changes (exit 0). It takes roughly 2–3 minutes in this workspace.
- `git diff --check` passed.
- PostCSS successfully parsed `frontend/src/styles/workspaces.css` after cleanup.
- Searches found no imports of the standalone demo `carteio-ai-dashboard/src/pages.tsx` or `data.ts` in production `frontend/src`, and no old shell selector references in the cleaned workspace stylesheet.
- No dev server, production build, tests, browser, visual screenshot comparison, package install, migration or deployment was run. The user explicitly prohibited those runtime/execution checks in the latest task instructions.

## Important: replacement is not complete

The V2 shell and selected overview/loading/data surfaces are in place, but many dashboard page bodies still use the existing page presentation and styles. Do not report the entire UI replacement as complete. The user has repeatedly asked for all supplied screens to use the new React source design and to remove old presentation code only after live behavior is safely transferred.

Routes/modules still needing source-layout transfer and cleanup include:

- Products/product details and sales/orders/order details (some existing screens already have source-inspired commerce styles, but verify every body against source).
- Assistants/editor and Bot Behavior.
- Train AI / Playground.
- Knowledge Base/source details and Website Crawler/crawl details.
- Agent Builder.
- Integrations/Shopify details.
- Widget install/appearance.
- Conversations and Human Handoff/case details.
- Analytics unavailable state, Billing/Invoices unsupported states, Settings, Team.

For each route, keep existing service/data logic, map it into the source UI, remove demo/static business values, provide honest unavailable/empty/error states, then delete only the superseded presentation CSS/components. The local source uses demo arrays/actions and cannot be mounted wholesale.

## Known API/design gaps (do not fabricate)

- No confirmed historical analytics/time-series API; do not render invented chart values or resolution rates.
- Billing API exposes usage/subscription status only; no verified invoices, payment method, or plan mutation operations.
- No handoff routing-rule administration API.
- Product contract does not expose AI indexing/visibility filtering states.
- No complete Shopify sync monitor/index consistency endpoint.
- Local Geist font file was not found; no external font request/package installation was made.
- Local dashboard source README says it is a close reconstruction and does not claim verified pixel-exact Figma parity.

## Next steps

1. Read this file and `rors/dashboard-source-merge-audit-2026-10-20.md` before continuing.
2. Inspect `git status --short` first; preserve the large set of unrelated user changes.
3. Continue route-by-route from the existing `AppRoutes.tsx`, `DashboardLayout.tsx`, and API/service modules. Keep public/auth UI and `backend/` unchanged.
4. Inspect the relevant source page composition in `carteio-ai-dashboard/src/pages.tsx` and its styles, but never use its sample business data or fake actions in production.
5. Replace page bodies with source compositions backed by existing APIs, then remove only confirmed dead old presentation CSS/components.
6. Static TypeScript/CSS checks are okay. Ask before builds/tests/server/browser visual verification because the user previously prohibited those execution steps. Do not install packages.
7. Keep `lastwork.md` and the `rors/` audit updated with real progress and gaps.

## Latest session checkpoint — Shopify lifecycle and Products consistency

Updated: 2026-10-20

The active task was the Shopify lifecycle forensic repair, limited to Shopify and the connected Commerce Products/Orders surfaces. The source was inspected and targeted safety/tenant-scoping fixes were made. The full OAuth → verification → sync → visible products → disconnect → reconnect lifecycle is **not runtime verified**. Final status: **PARTIAL**.

### What changed in the latest work

- `frontend/src/dashboard-source/pages.tsx`: the Products view now avoids an unfiltered workspace product request when no Shopify commerce connection is selected. The Shopify Sync Monitor first resolves the workspace's Shopify connector, prefers an actually `CONNECTED` connector, then requests products using that connector's `integrationConnectionId` and requests sync history for the same connector. Its UI distinguishes an API failure from having no Shopify connector, instead of treating both as an empty/disconnected state.
- `backend/src/modules/workspaces/connectors/connector.service.ts`: the disconnect transaction takes a tenant-scoped row lock on the connector before changing connector/credential/job/commerce state.
- `backend/src/modules/workspaces/connectors/connector-sync-worker.service.ts`: the worker takes the corresponding connector row lock before its final lease/status/permission check and publication. This serializes sync publication with disconnect: whichever operation obtains the lock first completes its state change before the other can proceed. No schema change was made.
- Focused regression coverage was added/updated in `backend/src/modules/workspaces/connectors/connector.service.spec.ts`, `backend/src/modules/workspaces/connectors/connector-sync-worker.service.spec.ts`, and `frontend/src/tests/shopify-dashboard-regression.test.tsx` for connector-scoped product requests, no unfiltered request when disconnected/missing a connector, and the worker/disconnect lock ordering.

### Source findings to remember

- OAuth install is an explicit authenticated action: the frontend calls `beginShopifyInstall`, which posts to `POST /api/v1/workspaces/:slug/connectors/shopify/install`; backend install reuses/creates a connector and returns Shopify's authorization URL. Callback handling is separate at `GET /api/v1/connectors/shopify/callback`; source validates HMAC/state/workspace, exchanges the code, discovers granted scopes and encrypts credentials. Callback leaves the connector in `DRAFT` for explicit verification. An install response `201` alone does not prove consent/callback completed.
- Retry Verification uses existing locally stored credentials and is different from Shopify OAuth. A fresh OAuth/reauthorization is needed when credentials/grants are absent or invalid. The Shopify adapter's `disconnect()` is a no-op, so local disconnect does not prove Shopify revoked the remote token or uninstalled the app. Do not describe local disconnect as remote revocation.
- Current disconnect source deletes local connector credentials, cancels pending/retry/running sync jobs, marks the connector disconnected/revoked and clears grants. It also physically deletes `CommerceProduct` and `CommerceOrder` records scoped by organization and connector; related variants/order lines cascade per schema. This is destructive retention behavior already present in source. It was not executed or changed. Do not change this policy without explicit approval. Knowledge/crawler records are not deleted by that transaction; their runtime visibility was not checked.
- Sync worker source claims leased jobs, performs Shopify API calls outside the persistence transaction, then validates lease/connector/permissions before publishing data scoped to organization and connector. The new row lock closes the identified publication-vs-disconnect race at source level; no live worker run verified it.
- Product list/details use commerce access checks and connector/organization scoping. Integration counts are connector-scoped. The previous Sync Monitor frontend request could omit the connector filter, and Products could issue an unfiltered request if a selected connector lacked its linked commerce connection ID. The frontend fixes above address those confirmed request-construction issues, but do not prove that database records currently exist or that counts now match at runtime.
- Verification source includes a 10-second transaction timeout, a moved nonessential read, per-operation timing diagnostics and compare-and-set recovery after persistence failure. Historical user logs showed a P2028 at 5 seconds / about 5.6 seconds and verify HTTP 503. There is no post-change successful verification evidence.

### Evidence limits and safety

- No authorized read-only database connection was available (`psql` was unavailable), and no connector records/counts were inspected. Current persisted status, timestamps, credential presence, grants, capabilities, product/variant/order counts, selected store and sync job outcome remain **UNKNOWN**. Never expose credential contents or customer order details when collecting diagnostics.
- Historical runtime logs supplied by the user showed successful Shopify credential/scope/capability probes, then failed final persistence. They do not establish current connection state. Earlier workspace/connector GETs were repeated and slow (roughly 1–4 seconds in supplied logs), but no request-count or latency measurement was made after source changes.
- No OAuth, verification, sync, disconnect, DB write, migration, build, test or server was run. The added tests are **not executed**. No runtime or performance improvement is claimed.
- The prior browser `ReferenceError: assistantId is not defined` was reported by the user. In the currently inspected source, `Shopify` has an `assistantId` declaration; this does not prove the browser route is now clean because no browser session was run.
- Keep all existing uncommitted work. Earlier notes about the broad dashboard work still apply; the Shopify files above may already have had user changes before this focused repair. Inspect `git status --short` and diffs before further edits; never reset/clean/restore the worktree.

### Continue tomorrow — exact safe sequence

1. Read this checkpoint and `rors/dashboard-source-merge-audit-2026-10-20.md`; inspect `git status --short` and relevant diffs without discarding anything.
2. If authorized read-only DB access becomes available, inspect only sanitized connector metadata for workspace `carteio` / store `dse940-vd.myshopify.com`: IDs, status/timestamps/version, credential-presence boolean, grant/capability state and latest job. Compare product/variant counts grouped by organization **and connector ID**. Do not print secrets or customer data.
3. For runtime verification, collect correlation IDs and durable backend responses for a user-initiated verification, then an explicitly user-initiated sync. Confirm persisted `CONNECTED`, terminal job status, connector-scoped product/variant counts, and that the Products UI requests/displays the same connector's records. Do not start OAuth/sync/verification unless the user authorizes those live actions in the continuing session.
4. Before exercising disconnect, call out that current source physically deletes that connector's products/orders and obtain explicit approval for the destructive retention behavior. Do not use an existing store for this check without that approval.
5. Run the newly added focused tests/build only after the user permits execution; report them as not run until then. If completing the wider dashboard replacement, resume the route-by-route list under “Important: replacement is not complete”; Shopify repair does not mean the overall dashboard task is done.

### Success evidence required

Do not call this complete until runtime evidence proves: fresh/authorized OAuth callback where applicable → durable verification state → explicit sync job reaches a real terminal success → products/variants persist under the selected connector → Products page shows those same records → disconnect excludes/deletes exactly the intended connector data according to approved policy → authorized reconnect behaves correctly. Two-store isolation must be checked before claiming multi-store lifecycle correctness.

---

# Playground Knowledge Inspector — handoff notes

Updated: 2026-10-22

## Current status

**PARTIAL — frontend/backend source changes are present; runtime verification is outstanding.** Do not claim that a real answer used website knowledge until a real Playground turn has a matching authorized retrieval trace and validated citation evidence.

## Implemented

- Added a bounded `PlaygroundTraceRecorder` in `backend/src/modules/workspaces/playground-diagnostics.ts`. It captures the actual orchestrator stage events, retrieval query/mode/counts, selected evidence, tool outcomes, citation references, source classification and safe failure categories. It limits event count, evidence count and excerpt length; it does not store traces in a new table.
- Instrumented the existing shared conversation execution path in `backend/src/modules/workspaces/conversation-orchestrator.service.ts`. Successful Playground responses include the trace only when `PLAYGROUND_DIAGNOSTICS_ENABLED=true` and the runtime environment is development or explicitly marked UAT. Diagnostic data reuses retrieval/evidence already produced by the answer pipeline; it does not trigger another retrieval or model call.
- Failed `HttpException`s during the traced execution path carry a sanitized trace in the authenticated Playground response. `backend/src/common/filters/all-exceptions.filter.ts` only passes that diagnostic property through for the Playground chat route, authenticated requests, and when the feature flag is active. Failures before the traced execution section can still have no trace.
- Added the flag as disabled by default in `backend/.env.example`; no actual `.env` or secret values were edited.
- Restored explicit per-message source labels using actual response provenance and validated sources. Historical messages without metadata remain unknown/unavailable rather than being inferred from answer wording.
- Added the Developer Inspector tabs (Execution Trace, Sources, Knowledge, Diagnostics) to the active dashboard Playground and the existing training Playground modal. Knowledge readiness uses current authenticated, workspace-scoped read APIs and shows bounded page excerpts and available page/chunk/source status fields.
- The inspector is restricted in the UI to workspace owners/admins. Diagnostic payloads are only attached to authenticated Playground responses after the existing server-side Playground authorization path. The public widget does not receive diagnostics. Trace/query/evidence display is bounded and excludes prompts, hidden reasoning and credentials.
- Updated Playground API error handling so a returned failure trace remains attached to its failed message. In-flight trace events are not streamed; the inspector is explicit that it only has the completed server trace.
- Added/updated focused provenance, diagnostics and Playground tests. Tests were not run.

## Files changed for this task

- `backend/.env.example`
- `backend/src/common/filters/all-exceptions.filter.ts`
- `backend/src/modules/workspaces/conversation.contracts.ts`
- `backend/src/modules/workspaces/conversation-orchestrator.service.ts`
- `backend/src/modules/workspaces/playground-diagnostics.ts`
- `backend/src/modules/workspaces/playground-diagnostics.spec.ts`
- `frontend/src/dashboard-source/pages.tsx`
- `frontend/src/dashboard-source/playground-provenance.ts`
- `frontend/src/dashboard-source/source-dashboard.css`
- `frontend/src/pages/training/PlaygroundChat.tsx`
- `frontend/src/pages/training/playground-chat.css`
- `frontend/src/services/api/assistants.ts`
- `frontend/src/services/api/client.ts`
- `frontend/src/tests/playground-chat.test.tsx`
- `frontend/src/tests/playground-provenance.test.ts`

Some of these files were already untracked/modified in the user worktree. Preserve all existing work; do not reset, clean, or restore files.

## Known limits / remaining verification

- No test, typecheck, build, server, browser session, database query, live crawl, Shopify action or paid model call was run for this task.
- Runtime UI/layout, actual environment flag configuration, API DTO behavior through the running app, authorization behavior and real retrieval/citation alignment remain unverified.
- Current code returns completed traces, not incremental trace events. Errors before/within workspace or session authorization are intentionally not surfaced with diagnostic data; the failure trace wrapper currently covers the later shared-AI execution call after the authenticated Playground route has resolved its context/session.
- Existing read APIs do not expose every requested index-generation/assistant-eligibility field for every source type. The Knowledge tab must show unavailable data honestly; do not fill gaps with inferred readiness.
- Source labels describe validated evidence/source metadata; they do not prove every answer claim is correct.

## Manual verification when allowed

1. In a development environment, set `PLAYGROUND_DIAGNOSTICS_ENABLED=true` through the normal local configuration (do not commit secrets); sign in as a workspace owner/admin and open `/workspace/:slug/training/playground`.
2. Send a question that should match a known assigned website page. Inspect the message trace: confirm retrieval attempted/query/mode/count, evidence retrieved and selected, and any cited references correspond to actual response sources. If there is no evidence or no validated citation, do not label it knowledge-backed.
3. Send a question that triggers a deterministic/system path and confirm it is labeled System response with the actual trace path.
4. Cause a safe request/provider failure only if an existing approved test setup is available; confirm the trace ends at the failed stage and does not expose prompts, secrets or customer data.
5. Verify a non-admin account and the public widget receive no developer diagnostics.
6. When execution is permitted, run the focused tests and typecheck; until then, retain “not run” status.

---

# P0 intent interpretation and product routing repair — handoff notes

Updated: 2026-10-23

## Status

**Source repair complete; runtime verification outstanding.** The Playground’s configured provider/model was not changed. No build, test, server, browser, database, or live provider call was run. All earlier worktree changes remain in place.

## Findings

- `PROVIDER_INVALID_RESPONSE` in the observed trace was not specific enough to identify the actual response shape. The orchestrator produced it both when validated interpretation JSON was rejected and when `safeErrorCategory()` collapsed the provider adapter’s truncated-output error into the same category. The trace alone did not distinguish those cases, and no raw response was available to identify malformed JSON versus missing fields or truncation.
- A confirmed compatibility defect was the 256-token interpretation output cap for ordinary routes, despite the large required JSON schema. The cap is now 768 tokens (Groq GPT OSS keeps its existing 1024-token budget). The adapter’s existing OpenRouter `response_format: { type: 'json_object' }`, message roles, content normalization, and selected route remain unchanged. OpenRouter documents JSON structured output support for `google/gemini-2.5-flash-lite`; its model page currently says the model was scheduled to go away on 2026-10-20, so availability must be checked during manual verification without switching models.
- Provider truncation and empty response failures now retain distinct safe diagnostic categories. Interpretation validator failures report an allow-listed reason such as `malformed_json` or `invalid_retrieval_queries` rather than only `invalid_interpretation_output`.
- Product intent started as `false` and was set only after successful interpretation. Therefore, invalid interpretation retained the original query for Knowledge retrieval but left catalog search skipped and recorded as `not_product_request`. The invalid-output recovery now recognizes clear English/Hindi/Hinglish product requests and broad browse wording, while preserving the original query and using the existing tenant-, assistant-, connection- and permission-scoped commerce search. It does not infer products or claim catalog readiness.

## Trace behavior

- The initial interpretation stage remains failed when recovery runs. A separate `INTERPRETATION_RECOVERY` event records original-query fallback, and `PRODUCT_ROUTING_DECISION` records whether product intent was model-interpreted or narrowly recovered.
- Provider request/response milestones remain separate from provider configuration selection. Knowledge retrieval still runs once using the existing retrieval and evidence pipeline.
- An empty commerce result is recorded as `NO_PRODUCT_EVIDENCE_RETURNED`; it is not labeled `CATALOG_EMPTY`, because current search results alone cannot distinguish an empty catalog from no authorized/readable rows or no matching rows.
- Saved assistant instructions and enabled business rules are included in final answer prompt assembly. They are not part of interpretation. No instruction change was made because this gap was not established as the cause of the incident.

## Files touched in this repair

- `backend/src/modules/workspaces/conversation-orchestrator.service.ts`
- `backend/src/modules/workspaces/conversation.contracts.ts`
- `backend/src/modules/workspaces/playground-diagnostics.ts`
- `backend/src/modules/workspaces/playground-diagnostics.spec.ts`
- `backend/src/modules/workspaces/connectors/commerce-read-contracts.service.ts`
- `backend/src/modules/workspaces/connectors/commerce-read-contracts.service.spec.ts`
- `backend/test/assistant.playground.spec.ts`
- `backend/test/conversation-provider.spec.ts`
- `backend/test/conversation-context.spec.ts`
- `frontend/src/dashboard-source/pages.tsx`
- `frontend/src/pages/training/PlaygroundChat.tsx`

Several paths were already untracked in the shared worktree. Do not reset, clean, restore, or overwrite unrelated changes.

## Regression coverage

Added coverage for multilingual product browse detection and negative browse wording, invalid-interpretation recovery with a single original-query Knowledge retrieval and authorized catalog search, OpenRouter JSON-mode request parameters for the configured Gemini model, precise interpretation validation reasons, and trace behavior that keeps failed interpretation separate from successful recovery. Existing provider/Playground/commerce tests cover valid responses, malformed/empty/truncated output, transport failures, authorization boundaries, provenance and non-fabrication. **All tests remain unexecuted.**

## Manual verification when allowed

1. Confirm OpenRouter still serves the configured `google/gemini-2.5-flash-lite` route; retain the configured provider/model.
2. With Playground diagnostics enabled in an authorized development/UAT environment, try “Tumhare paas kaunse products available hain?”, “Show me products,” “Mujhe shoes dikhao,” “Return policy kya hai?”, “Hi, kaise ho?”, “Mera order kahan hai?”, “Blue wale dikhao,” and “Size 9 available hai?”.
3. For an interpretation failure, confirm the trace shows the failure reason, original-query recovery, product decision, one Knowledge retrieval, connector/tool outcome, answer generation, and persistence as separate outcomes. The interpretation stage must remain failed.
4. Confirm only authorized catalog evidence can appear in a product answer. No match or unavailable permissions must not be presented as proof of an empty Shopify catalog, and no product claim may be fabricated.
5. Run focused tests/build only when execution is permitted. Until then, report all runtime behavior as unverified.

## Universal response reliability follow-up — 2026-10-27

- Removed the failed-interpretation phrase-list social bypass from `conversation-orchestrator.service.ts`. When LLM interpretation fails and no valid semantics can be recovered, the turn now follows the existing bounded, grounded retrieval and response path; no guessed social classification is introduced.
- Expanded `recoverValidatedSemanticInterpretation` in `conversation-intent.ts` to retain a validated semantic object when unrelated interpretation metadata fails. Recovery rebuilds bounded routing metadata from the original message, discards malformed optional portions and ticket actions, and continues through existing authorization and grounding.
- Added authorized Flow Builder failure diagnostics in `FlowService.run`: safe reason code, trace/run IDs, failed node, completed steps, traversed edges, and linked conversation trace when present. The existing exception filter exposes these only on the authenticated flow-run route; the Builder displays the stage and trace ID.
- Wrote/updated focused recovery, Playground, FlowService and exception-filter regressions. **Tests were not run.** No build, typecheck, server, migration, database operation, provider call, or background task was run.
- Semantic vector search remains configuration-dependent in existing code; no provider/model/configuration or retrieval architecture was changed. Runtime retrieval quality and the exact cause of prior customer failures remain unverified.

## Knowledge retrieval reliability follow-up — 2026-10-27

- The worker's `PENDING_SOURCE_RECOVERY` scan used Prisma `findMany` without `select`, so it selected scalar fields not used by the enqueue path. It now selects only source identity/version/type/index-generation fields. The worker tick diagnostic records a safe operation label and, when Prisma supplies a schema-shaped `meta.column`, the bounded column identifier; raw database errors remain excluded.
- Per-message semantic retrieval diagnostics now distinguish skipped/unconfigured search from attempted search failure, and preserve safe causes including `SEMANTIC_QUERY_FAILED`, semantic index status/profile/dimension problems and provider configuration failures.
- Source confirms two possible un-applied `KnowledgeSource` column migrations: `20261027120000_knowledge_source_sections` adds `knowledgeSection`; `20261027170000_knowledge_document_metadata` adds `document`. The supplied `P2022` log redacts its column metadata, and no database inspection was permitted, so the exact missing column and migration state are **UNKNOWN**. No migration was applied.
- Existing ingestion normalizes Unicode text, chunks FAQ/TEXT/PDF and website content, publishes generation-scoped indexes, and retrieval constrains both source and chunk organization IDs before evidence assembly. Semantic vectors remain opt-in and use the existing OpenAI `text-embedding-3-small` embedding adapter; multilingual query rewrites come from the existing Gemini interpretation. No provider/model/prompt change was made. Typo/transliteration coverage therefore remains dependent on valid model rewrites or enabled compatible vectors.
- Added regression coverage for narrow source projection, safe P2022 operation/column diagnostics, and preservation of semantic failure causes in a per-message trace. **Tests not run.**

## Knowledge retrieval and Builder diagnostics continuation — 2026-10-27

- Source review confirmed the retrieval path uses current authorized source IDs, tenant/version/generation-scoped chunks, bounded lexical full-text search, and optional profile-matched embeddings with reciprocal-rank merging. Semantic embedding/query/index errors fall back to lexical results; the configured vector adapter remains opt-in and environment-dependent. No runtime retrieval outcome was verified.
- The interpretation prompt already uses bounded dynamic answer-aspect queries and authorized source-language hints. Website crawl language metadata was stored on generation-scoped `KnowledgePage` records but omitted from the hints sent into interpretation. `publicSourceLanguageHints` now includes only READY page hints for currently authorized website source/version/generation tuples, alongside eligible source hints. This changes neither prompts nor provider/model configuration.
- AI-planned Knowledge tool executions now record per-attempt retrieval, lexical and semantic stage outcomes and safe reason codes; early tool rejection/reuse/budget paths are also recorded. Known Prisma schema failures map to safe P2022/P2021 reason codes for Builder runs. Successful Builder Knowledge runs expose lexical/semantic status in the response/UI, while failed retrievals correctly report `NOT_REPORTED` rather than claiming which method failed before the service returned diagnostics.
- Added regression coverage for authorized website language hints and the Builder P2022 diagnostic payload. Tests/build/typecheck were not run, per the active task restriction. No database, provider, Shopify, network, server, migration or background operation was performed.
- Remaining limitations: actual missing P2022 column/migration state is unknown without authorized runtime/database evidence; vector search requires existing compatible embedding configuration and indexed vectors; no new embedding provider or migration was added. Multilingual/typo search quality, citation behavior and end-to-end retrieval remain runtime-unverified.

## Gemini retrieval-query execution continuation — 2026-10-27

- Confirmed the existing interpretation prompt requests a concise source-language semantic query for non-English/mixed-language business messages, retains the original, and gives authorized source-language hints. Validated query variants and answer-aspect queries are merged by the existing bounded query planner and passed as an array into `KnowledgeProcessingService.searchPreview`; its lexical SQL expands that array in one tenant-scoped full-text search. Existing tests cover Hindi/Hinglish-to-English query execution and tenant/source gates.
- Added one complementary instruction to the existing interpretation prompt: retain original wording and emit a canonical query for substantive facts when it improves matching, including typo/slang/transliteration/context normalization, targeting English when source-language hints indicate English or do not identify another indexed language. Existing model, provider route, parser schema and permissions are unchanged.
- Fixed the recovery trigger so a nonempty but unmapped initial result set is reported to the answer model as `INSUFFICIENT_ASPECT_COVERAGE`, enabling the already-existing authorized Knowledge tool to request one distinct, meaning-preserving retry. Enforced one retry for both zero and partial candidate coverage; repeated initial queries and further retries are refused. Search results continue through existing authorization, deduplication, revalidation and grounding.
- Extended authorized Playground trace data with bounded, PII-pattern-redacted executed query previews, origin and target language. Initial customer/context/interpreter/aspect queries are distinguished; model tool retry outcomes and result counts remain in tool events. Added rendering in the existing admin-only Knowledge inspector. Builder successful zero-match results now prioritize the actual retrieval reason while separately exposing semantic unavailability; failed Knowledge nodes retain the safe stage/reason/trace details.
- Regression specs updated/added for a single zero-result retry, query diagnostic redaction/origin, and Builder no-match diagnostics. **Tests not executed.** No build, typecheck, server, migration, provider/API call, database query, script or background operation was run.
- Query quality and real provider tool-call behavior remain **UNVERIFIED**. Existing semantic embeddings are opt-in only: `KNOWLEDGE_SEMANTIC_ENABLED=true`, `KNOWLEDGE_EMBEDDING_PROVIDER=openai`, `KNOWLEDGE_EMBEDDING_MODEL=text-embedding-3-small`, `OPENAI_API_KEY` and current-generation vectors must all be configured/indexed. This implementation does not enable embeddings or change providers/models.

## Playground final-response failure follow-up — 2026-10-27

- Source confirms unexpected non-`HttpException` failures from shared AI execution escaped the authenticated Playground service without a diagnostics snapshot; the SSE controller consequently emitted only generic `INTERNAL_ERROR`. The source cannot establish the originating exception for supplied runtime trace IDs.
- `playgroundChat` now returns a sanitized `INTERNAL_ERROR` with the correlated failed trace for unexpected errors, retaining the original `HttpException` status/code for typed failures. Trace finalization marks `FINAL_RESPONSE` failed; raw exception text is not exposed.
- Added explicit Knowledge-retrieval-skipped reasons for capability, scope-redirect, clarification and live-record short-circuit branches. Therefore absent retrieval events in an old trace cannot identify which branch was taken; future traces distinguish these known skips from a failed/missing retrieval stage.
- Added a focused regression spec for redacted generic Playground failure diagnostics. Tests were not run because execution is prohibited by the active task. No builds, typechecks, servers, migrations, external calls, database operations or background tasks were run. Runtime origin of the two reported failures remains unknown.

## Playground INTERNAL_ERROR server correlation follow-up — 2026-10-27

- The authenticated Playground catch now writes `playground_execution_exception` to the Nest backend logger with request/trace ID, authorized workspace/assistant IDs, failed stage/operation, safe error category, original exception/cause types, allowlisted error codes, and bounded stack frames. Stack output omits raw exception messages and redacts URLs, credentials, emails, UUIDs and phone-like numbers. Browser SSE still receives only the safe code/message and authorized diagnostics.
- Wrapped errors retain the original exception through Nest `HttpException`'s `cause`; typed HTTP status/code is preserved. Unexpected errors remain `INTERNAL_ERROR` with the failed trace, rather than losing the original cause.
- Added regression specs for server log fields/redaction/cause retention and SSE trace correlation. Tests were not run (prohibited). Runtime logs are still required to identify the actual exception behind the supplied traces.
- Server-side exception logging runs for unexpected/5xx Playground execution failures even when optional trace diagnostics are disabled; expected client 4xx errors are not logged as internal exceptions. When a diagnostic recorder exists, the logged operation uses the failed stage, otherwise it is labeled `FINAL_RESPONSE` as the catch boundary.

## Playground live-record response rejection follow-up — 2026-10-27

- Source confirms line 939 is the fail-closed output validator on the `requiresLiveApi && !requiresKnowledge` branch. It rejects empty/oversized limitation text, citation markers, URLs, or a detected unsupported personal-status claim. This is not an unavailable Knowledge dependency; the branch runs before Knowledge retrieval by design.
- The safe error categorizer omitted `PLAYGROUND_LIVE_RECORD_LIMITATION_INVALID`, so its final trace category became `INTERNAL_ERROR`. It now maps to `PROVIDER_INVALID_RESPONSE`; the existing `ServiceUnavailableException` and its customer-safe message remain intact.
- The output guard now emits a `RESPONSE_VERIFICATION` failure event with a content-free reason identifying the failed predicate. Added focused reason-classification regression cases. Tests were not run. Actual LLM semantic plan and rejected answer for request `50fbdef7-a40b-484f-8d58-7f2deb514517` were not available, so whether its source plan was misclassified cannot be established. No Knowledge routing/security override was made.
- Follow-up source review found a route-plan conflict: `STATUS_INQUIRY` overwrote an explicit `STATIC_BUSINESS_INFORMATION` need when no separate static intent category was present. The planner now retains both Knowledge and live-record requirements in that case; public evidence remains permission-gated and cannot answer personal status. The existing router regression was updated to assert Knowledge partial-answer eligibility while preserving the live requirement. This is a confirmed generic defect, but its presence in the supplied runtime request remains unverified without its semantic interpretation trace.
- The no-Knowledge milestone now records the route planner's safe reason (`PERSONAL_RECORD_REQUIRES_LIVE_CONNECTOR`), distinguishing an intentional personal-record route from an unavailable search service in future traces.

## Shared conversation session-cleanup failure follow-up — 2026-10-27

- Source review confirmed that awaited session-lock cleanup could replace the primary request outcome in shared `executeSharedAI` finalization, its early conversation-context failure branch, trusted Widget replay/error cleanup, and Playground history-load cleanup. In particular, a cleanup exception after persistence could cause an already-saved answer to be reported as failed; a cleanup exception during failure handling could obscure the originating exception.
- Added a shared best-effort cleanup helper that emits a `SESSION_RELEASE` lifecycle event and sanitized server log with trace ID, operation, error category, original exception/cause types and redacted stack. Cleanup failure no longer replaces a completed/persisted response or the primary exception. Playground failure-stage selection excludes this secondary cleanup event so the original failed stage remains authoritative.
- Added regression specs for cleanup failure observability and preservation of the trusted-turn execution exception. Tests were not run because the active task explicitly prohibits all test execution. Source-level changes remain unverified; a failed lock release can still leave the lease active until its existing expiry.
- Follow-up compilation report identified that the allowlist edit replaced (rather than extended) the `SAFE_REASONS` declaration. Restored the full existing allowlist and added `session_release_failed` as an allowed safe reason. No compiler/build/test command was run; source inspection confirms the declaration is present again.

## Evidence relevance and unsupported absence claims — 2026-10-27

- Source review confirmed the final validator requires at least one valid citation and checks numeric, URL, email, phone, SKU, price, and stock facts, but does not establish prose entailment. It also confirmed the evidence relevance gate treated any non-configuration Knowledge result as relevant, even when no answer-plan aspect mapped to it; this could route an unsupported answer with unrelated evidence instead of the existing no-evidence path.
- The relevance gate now requires selected evidence to map to a current answer-plan aspect (or validated HELP CONTACTS evidence for a support request). Final grounding also rejects citations that are valid references but are not mapped to any requested aspect. If tool recovery finishes without any matching evidence for the requested aspects, the existing dynamic no-evidence response path is used instead of attempting citation repair over unrelated material.
- Tool result payloads now distinguish `UNAVAILABLE`, `NO_MATCH`, and `RESULTS`, carry retrieved-record completeness, and always state `authoritativeAbsenceVerified: false`; this reflects the current APIs, which expose no exhaustive-catalog absence proof. The answer instructions explicitly prohibit inferring nonexistence from a denied search, no-match, or incomplete catalog.
- Added regression coverage for irrelevant-but-valid citation rejection and non-authoritative no-match/unavailable states. Tests were not run per user restriction. General natural-language entailment (including all multilingual negation forms) remains unverified and is not claimed as solved; current fixes enforce aspect-to-evidence mapping and the absence-proof boundary without adding another model call or keyword classifier.
