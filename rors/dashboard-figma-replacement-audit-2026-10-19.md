# Carteio AI dashboard replacement: audit and baseline

Date: 2026-10-19

## Status

This is the pre-implementation audit and checkpoint for the requested Figma V2 dashboard replacement. No application source, route, business API, stylesheet, backend, migration, auth, public landing page, or login UI was changed in this audit. No old UI files were deleted. The Figma MCP `get_design_context` request for file `pErdDnD6lLX9JM0DNotzV9`, node `16:2`, was rejected because the connected Figma Starter plan has exhausted its MCP tool call limit. The local `.fig` archive is readable as a ZIP container, but its `canvas.fig` is an opaque Figma `fig-kiwij` compressed binary; it exposes no readable page/frame hierarchy or design token data. The bundled thumbnail shows many screens but cannot establish exact frame names, layer structure, styles, or which screens belong to the V2 page. No supplemental HTML specs were found in the repository root or `rors/`.

Because exact V2 layout and component information is a stated requirement, this audit does not treat the thumbnail or the linked Integrations frame as sufficient authority for implementation. The connector limitation is the blocker to a faithful screen-by-screen replacement and visual comparison.

## Recoverable checkpoint

The working tree had 280 changed/untracked status entries before this report was added. Many are extensive existing backend, migration, frontend, test, and documentation changes. They were preserved as user work; no reset, clean, stash, restore, or broad cleanup was performed.

- Full tracked working diff: `/tmp/carteio-pre-dashboard-ui-replacement.patch`
- Frontend source, package manifest, and `rors/` checkpoint archive: `/tmp/carteio-pre-dashboard-ui-frontend-checkpoint.tar.gz`
- Checkpoint SHA-256: `6ac8b520e724ea26902767e8d67ef5b29dc068bccf414b8c38505aa8b26ddffb`
- Diff SHA-256: `339e9fe4faa019b1bb85b5b3b9fa51f5f31cd7ce554dbb6763fe022f407e3b44`
- The tar archive was listed successfully (184 files); both checkpoint artifacts were verified with SHA-256.

The checkpoint represents the tree at the start of this dashboard audit, before this report was added. No backend file was edited by this task.

## Existing dashboard source tree and screen mapping

| Current screen / behavior | Existing route and implementation | Existing API / behavior to preserve | Intended Figma destination / adapter |
|---|---|---|---|
| Overview | `/workspace/:slug`, `pages/dashboard/DashboardPage.tsx` | `services/api/dashboard.ts`; workspace dashboard summary returns independently statused sections for assistants, knowledge, activity, commerce, sales, integrations and playground | V2 Dashboard Home; retain real values and per-section loading/error/empty states |
| Products and orders | `/products`, `/orders`, `pages/saas/SaasPages.tsx` | `services/api/saas.ts`: paginated products/orders; backend commerce and connector services | Commerce catalog, product detail, sales/order views; product detail route is not currently defined |
| Sales | `/sales`, `pages/saas/SaasPages.tsx` | `getSales`; dashboard/service status models distinguish unavailable, permission required, no data and errors | Sales & Orders and analytics; do not infer data outside authorized API contracts |
| Assistants and behavior | `/assistants`, `/assistants/:assistantId`, `pages/assistants/AssistantPages.tsx` | `services/api/assistants.ts`; create/edit/activate/deactivate/archive/restore, model/provider status, rules and training history | AI Assistants and Bot Behavior; preserve manager checks and existing assistant contract |
| Training and Playground | `/training`, `pages/training/TrainingCenterPage.tsx`, `PlaygroundDialog.tsx`, `PlaygroundChat.tsx` | assistant training overview/history and playground chat/session endpoints | Train AI command center and Playground; keep real model replies, sessions and evidence behavior |
| Knowledge and source detail | `/knowledge`, `/knowledge/:baseId`, `pages/knowledge/KnowledgeBasePage.tsx` | `services/api/knowledge.ts`, `knowledge-bases.ts`; ingestion, source detail, website sync, reindex, retrieval preview and archive flows | Knowledge Base, source details, crawler and crawl detail; preserve ingestion, indexing and crawler safeguards |
| Agent Builder | `/builder`, `pages/flows/FlowBuilderPage.tsx` | `services/api/flows.ts`; workspace-scoped CRUD/run, expected-version saves and validation | Agent Builder; retain current real graph behavior and clearly preserve pending persistence-migration limitation documented in `rors/carteio-audit.md` |
| Integrations | `/integrations`, `pages/saas/ConnectorsPage.tsx` | `services/api/connectors.ts` and `saas.ts`; connector catalog, capability status, connection, OAuth, scope upgrade, verification, sync and revoke | Integrations Hub with Shopify nested inside; provider availability must come from the backend catalog |
| Widget installation | `/widget`, `pages/saas/WidgetInstallationPage.tsx` | `services/api/widget.ts`; widget configuration and supported install operations | Widget & Installation and Appearance; use public config only, preserve current supported methods |
| Conversations | `/conversations`, `pages/saas/SaasPages.tsx` | inbox list/detail, state changes, read markers, notes | Conversations and detail; retain authorized workspace scope |
| Human support tickets | `/tickets`, `pages/saas/SaasPages.tsx` | ticket list/detail, update, assignment, notes and idempotent reply functions in `services/api/saas.ts` | Human Handoff queue, case detail and rules only where the existing API supports the action |
| Billing | `/billing`, `pages/saas/SaasPages.tsx` | `getBillingUsage`; current billing/payment service and support must be checked before adding controls | Billing & Plans/history; avoid fabricated prices, transactions or unsupported payment actions |
| Team and settings | `/team`, `/settings`, workspace pages | workspace member/settings services and existing owner/admin guards | Team & Permissions and Settings; retain membership, permission and workspace boundaries |
| Login, protected routing, public site | `/login`, `/signup`, public routes and `RequireAuth` | existing auth/session, workspace provider, public UI | Explicitly out of scope; do not change |

## Navigation baseline

`routes/AppRoutes.tsx` currently lazy-loads the existing route screens. `DashboardLayout.tsx` owns workspace fetch/authorization context, workspace switching, logout, responsive drawer/focus behavior, and role-conditional navigation. The current sidebar groups Commerce, AI Platform, Connect, and Workspace; it is not organized according to the requested V2 groups. Existing paths include overview, team, builder, settings, integrations, products, orders, sales, conversations, tickets, widget, billing, assistants, training, knowledge, knowledge detail, and assistant detail. Several requested dedicated detail pages (product/order/conversation/case, crawler job, widget appearance, invoices, behavior/playground as direct routes, handoff rules) are not currently separate route entries. Their precise availability in V2 could not be established from the inaccessible file context.

## Presentation-layer audit

Dashboard presentation is spread across `layouts/DashboardLayout/DashboardLayout.tsx` and `dashboard-layout-polish.css`, `pages/dashboard/DashboardPage.tsx`, `dashboard.css`, and `dashboard-polish.css`, plus route-specific CSS and components under `pages/saas/`, `pages/training/`, `pages/knowledge/`, `pages/flows/`, and `pages/assistants/`. Some of these modules contain active API calls, state transitions, role checks, confirmation flows, or graph interactions; they are not safe to classify as disposable presentation-only files based on filenames. No files were removed. A verified replacement plus dependency/reference audit is needed before retiring old CSS or components.

## Baseline verification

- Frontend TypeScript check: `frontend/node_modules/.bin/tsc --noEmit` completed with exit code 0.
- `pnpm --dir frontend typecheck` could not start because pnpm attempted to create its managed tool directory under `/home/rudexabhay/.local/share/pnpm/`, outside the writable roots. Running the already-installed TypeScript binary directly succeeded; no install was attempted.
- No application tests, production build, browser session, responsive viewport checks, or visual comparison were run because no implementation change was made and the design-context source is unavailable.
- Actual performance measurements are not available from this audit.

## Remaining work / exact design-source gap

The V2 page's complete frame inventory, screen-to-frame mapping, component hierarchy, exact colors, typography, spacing, responsive references, and frame screenshots remain unverified. No Figma asset export was requested or used. Consequently, implementation fidelity, supplied mobile layouts, static asset slots, and visual comparison results cannot honestly be reported yet. The connected Figma account must have MCP design-context access available (or the V2 page/frames must be supplied in an inspectable export) before the requested source-authoritative implementation can proceed. This is a tooling/design-source access gap, not a missing backend API claim.

No backend behavior was changed. This report identifies existing APIs only from the working source tree; it does not certify runtime availability, production authorization scopes, deployed migrations, or browser behavior.
