# Phase 09 Product Master Audit and Approval Plan

Audit date: 2026-10-13. This document records the repository state inspected for the Phase 09 product master request. It does not claim that unimplemented modules are complete.

## Implementation continuation (2026-10-13)

Following the owner's explicit approval to author additive Prisma changes, the first persistent SaaS foundation is now present in source. The migration file is authored but **not applied**. No database was accessed or changed.

Implemented in this continuation:

- Additive workspace timezone/locale fields; settings API and UI now edit these values.
- An organization-scoped integration connection lifecycle and commerce sync-job schema. The authenticated manager API only creates DRAFT records, lists them, and revokes them. It stores no credentials, does not call platform APIs, and never marks an unverified connection CONNECTED.
- Tenant-filtered, server-paginated read APIs and responsive Products, Orders, Sales, and Integrations pages. Commerce values are empty/unavailable until actual synchronized records and a connected integration exist. Sales stay partitioned by source currency.
- Separate support conversation/message persistence and workspace-authorized inbox APIs/UI for listing, status, active-member assignment, and internal notes. The current Playground remains excluded; no widget/customer-channel ingestion populates this inbox yet.
- Plan/subscription and usage schema. Billing & Usage reads only actual persisted Playground message/session counts and provider-reported tokens. No payment processor or entitlement gate is configured.
- A separate PlatformOperator principal, aggregate-only audited-data boundary, and a server-guarded aggregate overview API/UI route. No public or workspace API can self-assign operator status; initial operator provisioning requires a controlled deployment/database procedure.
- Bounded workflow execution/step/approval persistence contracts. No tools are enabled and no workflow execution endpoint is exposed until integration credentials and tool authorization infrastructure exist.
- Deferred Jest unit cases for draft-only connection behavior, HTTPS validation, tenant scoping, zero-connection sales availability, and inbox access boundaries.

The backend typecheck initially reported only absent generated Prisma delegate types. The local Prisma CLI cannot complete validation/generation in this environment (it waits on the unavailable platform engine); no generated client was hand-edited. The platform admin API uses parameterized SQL to remain typecheckable. Workspace integration/commerce/inbox APIs use the generated delegates and require `prisma generate` after migration deployment. Final validation state is recorded in the handoff below.

## Capability matrix

| Capability | State | Repository evidence / boundary |
|---|---|---|
| NestJS, React/Vite, TypeScript, Prisma/PostgreSQL | EXISTING_AND_FUNCTIONAL | Workspace manifests and application modules use this stack. No LangChain/LangGraph is present or proposed. |
| Authentication, sessions, workspaces, OWNER/ADMIN/MEMBER roles | EXISTING_AND_FUNCTIONAL | Auth modules, `OrganizationMembership`, workspace controllers/services. No platform-admin role exists. |
| Assistant configuration, provider routing, Playground | EXISTING_AND_FUNCTIONAL | Assistant CRUD/configuration, conversation provider/orchestrator, bounded Playground persistence and idempotency. |
| 09D intelligence, 09E retrieval, 09F grounded answer plan | EXISTING_AND_FUNCTIONAL | Runtime modules and prior regression/evaluation coverage are present. Entailment is explicitly not verified. |
| FAQ/Text Knowledge ingestion and indexing | EXISTING_AND_FUNCTIONAL | Workspace-owned sources, Knowledge Bases, processing jobs, chunks, lexical search and optional embeddings. |
| Public website Knowledge ingestion | EXISTING_BUT_INCOMPLETE | Website/crawler/verification/index models and code remain, but create/verify/sync endpoints return 410, the worker cancels crawler jobs, and active lists/search exclude WEBSITE. `docs/phase-08-architecture.md` records this retirement. Re-enabling safely requires restoring the full lifecycle and retrieval path. |
| Website domain verification and crawler hardening | EXISTING_BUT_INCOMPLETE | Retained DNS verification and constrained HTTP crawler code exists; active routes do not expose it. Browser rendering is explicitly disabled absent an isolated gVisor deployment. |
| Generic `Integration` persistence | EXISTING_BUT_INCOMPLETE | Current model stores organization, optional website, provider type, and generic record status only. It has no credentials, scopes, capabilities, sync cursors, health state, or connection lifecycle. |
| Shopify/WooCommerce/WordPress commerce connectors | NEW_IMPLEMENTATION_REQUIRED | No platform adapters, OAuth/API key lifecycle, webhook handlers, normalized catalog/orders, or commerce sync jobs were found. No customer stores or credentials are available for verification. |
| Products/orders/sales summaries | PARTIALLY_IMPLEMENTED | Additive canonical product/order tables and tenant-scoped read APIs/UI exist. No connector sync adapter or real synchronized records exist, so pages honestly show disconnected/no-data state. Customer analytics and order detail/exports are not implemented. |
| Customer conversation inbox, assignments, handoff, notes | PARTIALLY_IMPLEMENTED | Separate support models and authenticated inbox list/detail/status/assignee/internal-note paths exist. No public widget/channel ingestion, customer reply transport, handoff event feed, or unread tracking exists. Playground sessions remain excluded. |
| Leads and consent-aware visitor attribution | MIGRATION_APPROVAL_REQUIRED | No lead, widget event, consent, or order attribution records exist. |
| Tool registry and durable workflow/approval engine | MIGRATION_APPROVAL_REQUIRED | No connector tool registry, workflow state, approval request, or customer authentication association exists. Live business connectors are not registered in the source router. |
| Billing, plans, entitlements, usage ledger | PARTIALLY_IMPLEMENTED | Plan/subscription/usage ledger schema and actual message/token usage UI exist. No payment processor, plan administration, entitlement enforcement, or ledger meter writer exists. |
| Platform Super Admin | PARTIALLY_IMPLEMENTED | Separate operator record, server-side guard, and aggregate-only overview API/UI exist. No provisioning flow, strong-auth step-up, privileged mutation UI, provider operations, or platform audit writes exist. |
| Workspace locale/timezone and extended settings | PARTIALLY_IMPLEMENTED | Workspace timezone/locale now persist and are editable. Logo, retention, AI defaults, security domains, and notification delivery are absent. |
| Existing workspace dashboard, Team, Settings, Assistants, Training, Knowledge UI | EXISTING_AND_FUNCTIONAL | Authenticated routes and API-backed pages exist. Dashboard summaries use actual assistant, Knowledge, and audit data. Current navigation does not include commerce, inbox, integrations, billing, or AI impact modules. |
| Payment processing, live commerce reads/actions | BLOCKED_BY_EXTERNAL_ACCESS | No approved payment gateway, merchant app credentials, connector signing keys, or authorized customer stores are configured. No live calls were made. |

## Authored migration and remaining architecture proposal

The approved additive schema file is `backend/prisma/schema.prisma`; the author-only SQL is `backend/prisma/migrations/20261013120000_phase_09_saas_foundation/migration.sql`. Neither migration application nor database mutation was performed. Schema validation and Prisma client generation could not complete because the local CLI is blocked waiting for an unavailable schema engine; therefore run the normal schema validation and generated-client step in a supported Linux deployment/dev environment before applying this migration.

The product scope needs multiple backward-compatible migration bundles. These are proposals, not applied schema changes:

1. **Integration control plane (foundation authored):** `IntegrationConnection` and `CommerceSyncJob` now record organization-scoped platform, lifecycle state, scope metadata, opaque secret reference, cursor, counts, and sanitized failure code. Platform capability discovery, retries, ownership verification, webhook processing, and real sync workers remain unimplemented.
2. **Credential boundary:** persist only a secret-manager reference and encryption/key version. Do not persist plaintext OAuth/API credentials. Deployment must first provide an approved KMS/envelope-encryption or secret-manager facility and rotation policy. That facility is currently absent from the inspected application configuration.
3. **Commerce records (partial):** canonical product/variant/order/order-line models preserve provider references, raw statuses, and currencies; indexes and composite tenant/connection FKs are included. Refund event history, customers, inventory movement, imports, and sync upserts are not implemented.
4. **Support inbox (partial):** separate conversations/messages from Playground sessions, with channel/session hash, status, assistant, active-member assignment, handoff flag, provenance, and internal-note records. Public intake, reply transport, event history, unread state, retention cleanup, and member-role granularity are not implemented.
5. **Consent and attribution:** consent state, immutable widget/business events, deduplication keys, attribution window/version, and source provenance. Do not infer unique humans or AI-caused sales from conversation proximity.
6. **Agent workflows (data foundation only):** execution, step, and approval records bind approval to an argument hash and expiration; there is no registry, action capability, authenticated customer context, executor, approval state transition API, or tool. No action can run.
7. **Billing (partial):** plan/subscription and idempotent usage ledger records exist. The usage page reads actual Playground counters/tokens rather than the new ledger. Provider event verification, entitlement policy/enforcement, plan administration, and billing gateway are absent.
8. **Platform administration/settings (partial):** platform principal, audit model, guarded aggregate endpoint, and organization locale/timezone exist. No operator provisioning UX or privileged write audit path exists. Workspace roles do not imply platform access.

The integration and commerce bundle should land before products/orders dashboards, customer-linked live tools, and AI-attributed sales. The conversation bundle is prerequisite to customer inbox/handoff. Billing and platform-admin bundles should be separate from workspace roles and merchant credentials. Each migration must be additive, include tenant-scoped foreign keys/unique constraints, and preserve existing data/defaults. Migration authoring/application requires explicit approval under the request's database policy.

## External and operational prerequisites

- Shopify: approved app installation/OAuth model, app credentials held by the deployed secret manager, reviewed scopes, redirect/webhook URLs, and a consenting test store.
- WooCommerce: consenting test store, minimum-scope REST credentials, webhook secret, and HTTPS callback deployment.
- WordPress/custom API: verified domain and a documented, allowlisted read contract. Public-page crawling remains separate from authenticated store access.
- Credential safety: deployable secret-manager/KMS facility, encryption key rotation/backup policy, and incident revocation procedure.
- Durable work: the repository has a PostgreSQL-backed Knowledge processing worker gated by configuration, but no general commerce queue or independent worker service. Scale/concurrency and job recovery design need staging load data before claiming production readiness.
- Billing: select an actual provider and merchant account, configure signed webhook delivery, and define approved plan prices/entitlements.
- Customer data: provide synthetic fixtures for authoring and a separately authorized real test tenant/store for manual validation. No real customer transcript or store data is needed in source fixtures.

## Validation boundary

Backend and frontend TypeScript typechecks were run after adding these modules and passed. The Prisma schema could not be validated and the generated client could not be refreshed: the local Prisma CLI did not return and was stopped after a bounded wait because this environment lacks an available Linux schema engine. No migration was applied. No Jest/Vitest, evaluation, integration, live-provider, live-business API, browser, build, dev-server, or database command was run. The schema/client generation and migration review remain required before these new DB-backed routes can be deployed.

## Deferred final QA handoff

After approved migrations, implementation, and customer-owned test connections are available, the deferred QA pass should cover:

1. **Static/type checks:** backend and frontend typechecks, then lint and dependency/license review as separately authorized; schema generation and migration-diff review before any apply operation.
2. **Tenant/RBAC regression:** workspace/assistant ownership, least-privilege roles, cross-tenant commerce and conversation queries, exports, platform-admin separation, and denied sensitive operations.
3. **Connector contract tests:** signed OAuth state/webhooks, token reference isolation, scope negotiation, replay/idempotency, cursor recovery, rate limits, retries, partial sync, revoke/disconnect, and provider error mapping.
4. **Website security tests:** public-domain verification, DNS rebinding/private-IP rejection, redirects, IPv4/IPv6 special ranges, body/time/page/depth limits, robots/path policy, content injection, and absence of browser execution unless the isolated renderer is deployed.
5. **Commerce correctness:** product/variant upserts, currency boundaries, provider raw status preservation, pagination, refund/partial-refund accounting, gross/net formulas, timezone cutoffs, duplicate webhook handling, and tenant-scoped aggregation.
6. **Conversation/inbox:** current-session ownership, customer identity proof, assignment/handoff state transitions, internal-note visibility, message provenance, retention, pagination, idempotency, and no raw conversation exposure to platform operators by default.
7. **Tool/workflow security:** schema rejection, customer ownership, per-tool permissions, exact-argument approval binding, expiration, double-submit, idempotent retry, cancellation, deadlines, and no arbitrary URL execution.
8. **Billing:** signed provider webhooks, idempotent subscription state, entitlement enforcement, usage reconciliation, failed/duplicate payment events, and no success UI without provider confirmation.
9. **Frontend acceptance:** role-aware navigation, 320–1920px layouts, keyboard/screen-reader operation, loading/empty/error/disconnected states, request cancellation, server pagination/filter consistency, and no fixture metrics in production routes.
10. **Authorized external validation:** only with a consenting Shopify/WooCommerce test store, approved WordPress/custom API, configured secret manager, and chosen billing sandbox. Run no real customer-data export or destructive business action in the test pass.
