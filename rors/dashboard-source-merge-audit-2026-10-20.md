# Carteio dashboard source merge audit — 2026-10-20

## Authority and checkpoint

- Primary implementation source: `carteio-ai-dashboard/` (local React + TypeScript UI reference).
- Supplementary source notes: `README.md`, `CODEX_MERGE_INSTRUCTIONS.md`, `DESIGN_TO_ROUTE_MAP.md`, and `references/CARTEIO_SAAS_DASHBOARD_V2_HANDOFF.md` in that directory.
- Original Figma URL is supplementary. The supplied source README says it is a close coded reconstruction, not a verified pixel-exact Figma export; no pixel-perfect claim is made here.
- Recoverable pre-change snapshot: `/tmp` patch SHA-256 `339e9fe4faa019b1bb85b5b3b9fa51f5f31cd7ce554dbb6763fe022f407e3b44`; archive SHA-256 `6ac8b520e724ea26902767e8d67ef5b29dc068bccf414b8c38505aa8b26ddffb`.
- Existing Git working tree contains extensive unrelated changes. No reset, clean, or history rewrite was used. Nothing under `backend/` was edited for this task.

## Supplied source inventory

| Source | Purpose | Merge disposition |
|---|---|---|
| `src/main.tsx` | Standalone Vite entry | Not used; current app bootstrap stays authoritative |
| `src/App.tsx` | Demo hash router and shell | Shell composition adapted into current protected dashboard layout; fake workspace/account actions removed |
| `src/data.ts` | V2 navigation, titles, sample entities | Navigation labels/groups are the visual map only; sample records are excluded from production |
| `src/ui.tsx` | Shared visual primitives and illustrative product art | Reusable UI primitives copied and adapted for live data; demo `ProductArt`, `Sample`, placeholder chart data, and local-only toggles are omitted from the integrated copy |
| `src/pages.tsx` | 28 demo screen implementations | Not mounted wholesale: it contains sample business data, static assistants/conversations/orders/billing, and fake save/sync operations |
| `src/styles.css` | V2 token, shell, page, and responsive styles | Scoped copy integrated into the dashboard route boundary to avoid landing/auth CSS leakage |
| `index.html`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vite.config.ts` | Standalone app metadata and tooling | Inspected; no standalone entry point or dependencies are used in the Carteio app |
| `references/carteio_saas_dashboard_v2_supplement.html` | Static supplementary screen concepts | Reference only; not imported or mounted |
| `references/CARTEIO_SAAS_DASHBOARD_V2_HANDOFF.md` | Supplemental screen notes | Used to identify screens beyond the main V2 set |
| `README.md`, `CODEX_MERGE_INSTRUCTIONS.md`, `DESIGN_TO_ROUTE_MAP.md` | Source intent and constraints | Read and used as merge requirements |

## Existing frontend functionality map

| Existing screen / route | Existing real behavior/API | New V2 location | Adapter status |
|---|---|---|---|
| Overview `/workspace/:slug` | `getWorkspaceDashboardSummary`, `getProducts`, `getConversations`, `getTickets`; API-specific loading/error states | Overview | Existing live screen retained; no standalone demo metric arrays |
| Products and detail | `getProducts`, `getConnectors`, `queueConnectorSync`; authorized product image URLs, product paging, exact external ID detail lookup | Products / Product Details | Existing live routes retained; indexing visibility remains unavailable where API has no field |
| Sales, orders and detail | `getSales`, `getOrders`, order detail API and connector scope status | Sales & Orders / Order Details | Existing live routes retained; no sample totals |
| Assistants | Assistant list/create/edit/archive/restore and provider configuration APIs | AI Assistants / Bot Behavior | Existing live screens retained; behavior uses assistant configuration, not source demo toggles |
| Train AI / Playground | Training config and actual model/RAG Playground services | Train AI / Playground | Existing functional screen and query-tab routing retained |
| Knowledge Base / details | Knowledge and knowledge-base ingestion, indexing, retrieval, and source APIs | Knowledge Base / Source Details | Existing functional routes retained |
| Website crawler / details | Existing crawler, source, and crawl-job operations | Website Crawler / Crawl Details | Existing functional routes retained |
| Agent Builder | Flow list/detail/save/validate/test/publish APIs | Agent Builder | Existing persisted flow builder retained |
| Integrations / Shopify details | Connector list, OAuth, scope, connection and sync API | Integrations / Shopify Integration | Existing connector hub and detail retained; Shopify remains in Integrations |
| Widget / appearance | Public widget config, allowed domains, installation and customization API | Widget Installation / Appearance | Existing widget screens retained; private credentials are not exposed |
| Conversations | Paginated inbox, filters, details and state updates | Conversations | Existing live inbox retained |
| Tickets / handoff | Ticket list/details, assignment, status, priority, replies, notes and event history | Human Handoff / case detail | Existing ticket operations retained; no fabricated routing rules |
| Analytics | No verified historical analytics endpoint in current frontend contract | Analytics | Existing honest unavailable state |
| Billing | `getBillingUsage` only; no invoice/payment method/plan-change API | Billing / Invoices | Current usage/status view retained; invoices remain an API gap |
| Settings and Team | Workspace get/update and membership list/role actions with current permission checks | Settings / Team | Existing real pages retained |
| Shopify sync monitor | Connector sync status/history where available; no complete product-index monitor endpoint | Sync | Do not expose a demo-only route; current connector detail shows supported sync state |

## Source route inventory vs production route availability

The source route map has 28 IDs. Production paths cover Overview, Products, Product Details, Sales & Orders, Order Details, Assistants, Train AI, Playground (as the `training?tab=playground` view), Knowledge Base/source detail, Website Crawler/crawl detail, Agent Builder, Integrations/Shopify, Widget/Appearance, Conversations, Human Handoff/ticket detail, Analytics, Billing, Settings and Team. Handoff case detail now has a direct `/tickets/:ticketId` path using the existing ticket API; selecting a case updates browser history, and Back returns to the queue.

The source's Handoff Rules, Invoices, and Shopify Sync Monitor concepts do not have an equivalent complete authorized operation in the current frontend API surface. They must remain explicitly unsupported/API-gap states rather than being represented by the source's demo arrays or buttons.

## Old dashboard implementation audit

The active protected layout is `frontend/src/layouts/DashboardLayout/DashboardLayout.tsx`. Existing business screens are distributed across `pages/dashboard`, `pages/saas`, `pages/assistants`, `pages/training`, `pages/knowledge`, `pages/flows`, and `pages/workspaces`, with API clients in `services/api`. Many route-specific components contain functional request/state handling and cannot be deleted wholesale. Presentation removal is staged only after each corresponding live component has been replaced. Public and authentication layouts are outside this dashboard scope.

## Verification limits

Per the current owner instruction, no package installation, development server, production build, tests, browser session, migration, or deployment was run during this source-merge pass. The frontend `tsc --noEmit -p frontend/tsconfig.json` static typecheck passed after the latest loading, fallback, live-data and error-state changes (exit 0), and `git diff --check` passed (exit 0). PostCSS parsed the cleaned workspace stylesheet, and source searches found no active references to the removed old shell selectors or unsupported product filters. Visual/runtime status is therefore unverified. The source itself documents that exact Figma pixel parity is not established by its author.

## Implementation progress (static review only)

- Added `frontend/src/layouts/DashboardLayout/dashboard-v2.css`, a dashboard-scoped copy of the supplied source stylesheet. Scope containment prevents the source reset and tokens from styling the public landing or login/signup routes.
- Added `frontend/src/layouts/DashboardLayout/dashboard-v2-ui.tsx` from the supplied source primitives. Its integrated `PageHeader` accepts an optional status label, and local-only demo data/actions were omitted from the copied primitive set.
- Replaced the protected workspace shell markup with the source's fixed 242px rail, 74px topbar, grouped V2 navigation, breadcrumb, mobile drawer and mobile bottom bar classes. Existing workspace lookup, role-gated navigation, workspace switching, Google auth transition, and logout behavior remain in the shell.
- Overview now uses the source `PageHeader` and `Card` primitives while keeping the existing live API states and explicitly unavailable trend/funnel values.
- Overview now renders recent conversation records, Shopify orders and workspace activity already exposed by current APIs. Removed the hardcoded 22% order bar and placeholder visitors, product views and add-to-cart rows.
- Product catalog toolbar now shows the authorized API product count and supported search only. Removed AI-indexing filter controls because the product contract exposes neither those states nor filtering.
- Conversation detail and status-update failures now show the API error instead of clearing the selection into a misleading loading/blank state.
- Replaced the protected dashboard's generic full-screen workspace spinner/error with source-styled shell skeleton and a recoverable, categorized network/timeout/access/not-found/invalid-response panel. The `/dashboard` workspace-entry route now uses the same loading presentation; protected workspace content stays hidden until the API confirms access.
- Dashboard lazy-page loading now uses a compact in-shell skeleton instead of the legacy generic `Loading…` fallback. Frontend API network/timeout errors now include clear connection guidance.
- Commerce, sales, orders, conversations, handoff and billing shared page loads now use responsive V2 skeleton surfaces instead of the old generic spinner banner. Loading remains tied to real request state and adds no timer/delay.
- Restored `frontend/src/styles/workspaces.css` from the SHA-verified pre-change checkpoint after finding the prior shell-selector cleanup had left anonymous CSS declaration blocks. Re-ran cleanup with a CSS AST parser, removing dead shell/account/workspace-overview selectors while retaining shared workspace forms, membership and assistant styles. PostCSS parses the resulting stylesheet successfully.
- Shared `SaasPages`, assistant list/editor, training center, knowledge list/detail, crawler, Shopify integration detail, integration hub, widget, workspace settings, and team headers now use the source `PageHeader`; existing commerce/conversation/ticket/billing/assistant/training/knowledge/crawler/connector/widget/workspace service operations remain in their current modules. Ticket case selection is URL-backed so it survives refresh and browser history.
- Scoped V2 token overrides keep existing page controls on the source blue palette, and source-style card surfaces are applied to existing backend-backed panel classes. Landing/auth page style selectors remain outside the wrapper.
- Removed `dashboard-layout-polish.css` because it only styled the replaced old shell.
- Removed obsolete `.saas-*` shell/sidebar/header/navigation/account/workspace-switcher rules from `frontend/src/styles/workspaces.css`; retained the remaining workspace page and form rules still used by live settings/team screens. A frontend source search found no references to the removed shell selectors.
- Not yet complete: most module bodies still use existing presentation markup/classes; source screen compositions have not yet been transferred through every module. Old module presentation files are intentionally retained until their actual data-backed counterparts are migrated. No route has been declared visually verified. The full dashboard replacement is not complete and this audit does not claim it is production-ready.
- API gaps from the source screen inventory: no supported historical analytics/time series, billing invoices/payment methods/plan mutations, handoff routing-rule management, or complete Shopify sync-monitor view. These are not represented with demo results.
- The supplied Geist font file is absent from the local project. The source stack uses the system/Inter fallback until an approved local font asset is provided; no external font request or package installation was introduced.
