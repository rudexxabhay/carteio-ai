# Dashboard source merge — corrective audit

Updated: 2026-10-20

## Finding and root cause

The prior merge treated the standalone dashboard as a design reference and adapted its shell/primitives, rather than transplanting its page implementation. `frontend/src/layouts/DashboardLayout/DashboardLayout.tsx` mounts the protected production shell, but `frontend/src/routes/AppRoutes.tsx` sends page paths to existing components in `frontend/src/pages/**`. `carteio-ai-dashboard/src/pages.tsx` is not imported by production. This left the page bodies as the prior app's components, some with source-inspired styles, and did not satisfy the requested screen-by-screen source transplant.

The supplied source is also explicitly a demo: `src/App.tsx` uses `window.location.hash`, hardcodes “Carteio workspace” and “Workspace admin”, and labels itself as standalone/not connected. `src/data.ts` contains sample products, orders, sources, conversations, handoffs, integrations and counts. `src/pages.tsx` includes sample metrics, illustrative charts, sample labels, and click handlers that call `notify(...)` with preview/demo-only messages. Mounting it wholesale would expose fake business data and fake operations. The actual integration work must preserve source markup/styles while replacing demo records and wiring existing authorized services; unsupported operations need honest states in the source layout.

The prior merge therefore failed in two connected ways: it stopped after shell/shared styling and selected page presentation changes, and the screenshots described by the owner match the standalone demo's own hash navigation and sample labels rather than proving that the protected Carteio app is rendering live-integrated pages. The exact browser session behind those screenshots is unavailable, so that attribution is a strong source match, not a direct observation of that session.

## Application entry and port 3000

- Production frontend entry: `frontend/src/main.tsx` → `frontend/src/app/App.tsx` → `BrowserRouter` → `frontend/src/routes/AppRoutes.tsx`.
- Production dashboard protection: `RequireAuth` wraps `/workspace/:slug/*`; `DashboardLayout` loads/authorizes the selected workspace and supplies its context to route pages.
- Standalone source entry: `carteio-ai-dashboard/src/main.tsx` → standalone `App.tsx` hash router. It is a separate Vite application and must not replace production bootstrap.
- At audit time, read-only process/listener inspection found no process or listener bound to port 3000 in this workspace environment. Consequently, it is not possible to identify which application was served there at the time of the screenshots. Do not claim port 3000 is currently serving either app.

## Source inventory

| File | Contents | Production disposition |
|---|---|---|
| `carteio-ai-dashboard/package.json` | Standalone React 18/Vite app; React and lucide-react dependencies | Read; do not use its bootstrap or install packages |
| `src/main.tsx` | Standalone `createRoot` | Must remain unused in production |
| `src/App.tsx` | Demo hash router, shell, hardcoded profile/workspace, demo labels | Shell was adapted in production; standalone router/actions are not production-safe |
| `src/data.ts` | 28 page IDs, nav definitions, sample records and labels | Navigation map is reference; sample business data must not enter production |
| `src/ui.tsx` | Source UI primitives, product art, chart and table primitives | A subset was adapted in `dashboard-v2-ui.tsx`; this is not a complete copy |
| `src/pages.tsx` | 28 source page compositions in one switch component | Not currently mounted; embeds sample content and fake notifications/actions |
| `src/styles.css` | Source design tokens, shell, screen and responsive CSS | Scoped/adapted into `dashboard-v2.css`; page CSS parity has not been established |
| `README.md` | Declares this a close reconstruction, not pixel-verified Figma export; warns against production use without integration | Read |
| `CODEX_MERGE_INSTRUCTIONS.md` | Keep production routing/services; connect real data; remove old presentation after transfer | Read |
| `DESIGN_TO_ROUTE_MAP.md` | 28 route IDs and integration notes | Read |

No standalone font or asset files were found under the source folder; its visible product art is component-generated. The README says Geist typography is intended but does not establish that a local font asset is bundled.

## Source route → production route and status

“Old UI removed” means the previous per-page production presentation has actually been deleted/replaced. “Real data” means the corresponding screen is backed by the existing authorized app service, not source demo state. No screen is marked complete by this audit. Existing production pages often do have functional services; that alone does not prove source parity or old UI removal.

| Screen | New source component | Existing production route / service | Old UI removed | Real data connected | Visually checked | Status |
|---|---|---|---|---|---|---|
| Overview | `Overview` | `/:slug` — dashboard summary, products, conversations, tickets, activity/orders where supported | No | Partial live data | No | INCOMPLETE |
| Products | Source Product Catalog composition (`SourceProductsPage`) | `/:slug/products` — Shopify products, connectors and sync queue | Yes — old `ProductsPage` renderer removed | Yes; AI-index filters unavailable and disabled | No | IMPLEMENTED; visual verification pending |
| Product Details | Source Product Details composition (`SourceProductDetailPage`) | `/:slug/products/:externalId` — authorized Shopify product response | Yes — old `ProductDetailPage` renderer removed | Yes; AI-index state honestly unavailable | No | IMPLEMENTED; visual verification pending |
| Sales & Orders | Source `Sales` composition (`SourceSalesPage`) | `/:slug/sales` — `getSales`, `getOrders` | Yes — old `SalesPage` renderer removed | Yes; unsupported trends/conversion/status breakdown unavailable | No | IMPLEMENTED; visual verification pending |
| Order Details | Source `OrderDetail` composition (`SourceOrderDetailPage`) | `/:slug/orders/:externalId` — `getOrders` | Yes — old order detail module/CSS removed | Yes for API-supplied fields; customer identity unavailable | No | IMPLEMENTED; visual verification pending |
| AI Assistants | Source `Assistants` composition (`SourceAssistantsPage`) | `/:slug/assistants` — list API; detail/editor route remains old | Yes for list; no for assistant detail/editor | List data is live; chat counts unavailable | No | INCOMPLETE — Bot Behavior/editor route remains old |
| Train AI | `Train` | `/:slug/training` — training config/history | No | Yes, existing page | No | INCOMPLETE |
| Bot Behavior | `Behavior` | Assistant editor/config under `/:slug/assistants/:assistantId` | No | Yes, existing page | No | INCOMPLETE |
| Playground | `Playground` | `/:slug/training?tab=playground` — real Playground chat/config APIs | No | Yes, existing page | No | INCOMPLETE |
| Knowledge Base | Source `Knowledge` composition (`SourceKnowledgePage`) | `/:slug/knowledge` — `listKnowledge` | Old route renderer replaced; underlying old module retained for other exports/actions | Yes; live source rows and status | No | IMPLEMENTED; visual verification pending |
| Knowledge Source Details | Source `SourceDetail` composition (`SourceKnowledgeDetailPage`) | `/:slug/knowledge/:baseId` — `listKnowledge`, `getKnowledgeProcessing`, `reindexKnowledge` | Old route renderer replaced; legacy detail implementation remains in module but is no longer mounted | Yes; actual content/status where API returns it; unavailable state otherwise | No | IMPLEMENTED; visual verification pending |
| Website Crawler | `Crawler` | `/:slug/crawler` — crawler/source APIs | No | Yes, existing page | No | INCOMPLETE |
| Website Crawl Details | `CrawlDetail` | `/:slug/crawler/:sourceId` — crawl/source APIs | No | Yes, existing page | No | INCOMPLETE |
| Agent Builder | `Builder` | `/:slug/builder` — persisted flow APIs | No | Yes, existing page | No | INCOMPLETE |
| Integrations Hub | Source `Integrations` composition (`SourceIntegrationsPage`) | `/:slug/integrations` — `getConnectorCatalog`, `getConnectors` | Old route renderer replaced; obsolete module retained for non-route compatibility | Yes; connector catalog and connection state | No | IMPLEMENTED; visual verification pending |
| Shopify Details | Source `Shopify` composition adapted in `ShopifyIntegrationDetailPage` | `/:slug/integrations/shopify/:connectorId` — connector state, permission/scope snapshot, sync history and sync queue | Old page-specific visual renderer/CSS replaced | Yes; authorized connector/permission/sync APIs; no fake connected status | No | IMPLEMENTED; visual verification pending |
| Widget Installation | Source `Install` composition (`SourceWidgetPage`) | `/:slug/widget` — assistant list, `getWidgetConfig`, widget hosting config | Old route renderer replaced; old module retained but not mounted | Yes; real public ID/domains/status; no snippet without valid live config | No | IMPLEMENTED; visual verification pending |
| Widget Appearance | Source `Appearance` composition (`SourceWidgetPage`) | `/:slug/widget/appearance` — `getWidgetConfig`, `saveWidgetConfig` | Old route renderer replaced; old module retained but not mounted | Yes; real config state and persistence; preview reflects current form values | No | IMPLEMENTED; visual verification pending |
| Conversations | Source `Conversations` composition (`SourceConversationsPage`) | `/:slug/conversations` — inbox/list/detail/state/read/note APIs | Yes — old renderer removed | Yes for supported history/state/read/notes; reply API unavailable | No | IMPLEMENTED; visual verification pending |
| Human Handoff | Source `Handoff` composition (`SourceTicketsPage`) | `/:slug/tickets` — ticket list/filter/summary APIs | Yes — old renderer removed | Yes | No | IMPLEMENTED; visual verification pending |
| Handoff Case Details | Source `CaseDetail` composition (`SourceTicketsPage`) | `/:slug/tickets/:ticketId` — ticket detail/assignment/status/reply/note APIs | Yes — old renderer removed | Yes, supported fields/actions | No | IMPLEMENTED; visual verification pending |
| Routing / Escalation Rules | Source `HandoffRules` unavailable state (`SourceEscalationRulesPage`) | `/:slug/escalation-rules` — no supported administration API | No prior production page; route added | No; controls disabled with API gap explanation | No | INCOMPLETE — API gap, route active |
| Analytics | Source `Analytics` layout (`SourceAnalyticsPage`) | `/:slug/analytics` — no historical analytics endpoint | Yes — previous InfoPage fallback replaced | No; exact unavailable states | No | INCOMPLETE — API gap, source layout route active |
| Billing | Source `Billing` composition (`SourceBillingPage`) | `/:slug/billing` — `getBillingUsage` | Yes — old `BillingUsagePage` renderer removed | Yes for subscription/usage only | No | IMPLEMENTED; visual verification pending |
| Plans / Usage | Source `Billing` usage/plan sections (`SourceBillingPage`) | `/:slug/billing` — `getBillingUsage` | Yes — old billing renderer removed | Partial; plan catalog/mutation unavailable | No | INCOMPLETE — plan API gap |
| Invoices | Source `Invoices` layout (`SourceInvoicesPage`) | `/:slug/invoices` — no invoice service | No prior production page; route added | No; unavailable state, no fabricated rows | No | INCOMPLETE — API gap, source layout route active |
| Team & Permissions | Source `Team` composition (`SourceWorkspaceTeamPage`) | `/:slug/team` — `listWorkspaceMembers` | Old route renderer replaced; legacy file retained for compatibility | Yes; member list and role; invites/role mutation unavailable | No | IMPLEMENTED; visual verification pending |
| Settings | Source `SettingsPage` composition (`SourceWorkspaceSettingsPage`) | `/:slug/settings` — `getWorkspace`, `updateWorkspace` | Old route renderer replaced; legacy file retained for compatibility | Yes; workspace name/site/business type | No | IMPLEMENTED; visual verification pending |
| Shopify Sync Monitor (additional source screen) | `Sync` | No complete sync/index monitor route/API; connector sync status is partial | No | Partial | No | INCOMPLETE — API gap |

Source nested/detail screens are selectable only through the standalone `Pages` switch and hash changes; the production router does not currently expose all source concepts as matching direct routes. Production routing remains React Router and protected; do not introduce the demo hash router.

## Production files and merge evidence

The current production layout imports `dashboard-v2.css` and uses `dashboard-v2-ui.tsx`; these demonstrate a partial shell/primitives adaptation. `AppRoutes.tsx` still routes to production page modules including `DashboardPage.tsx`, `SaasPages.tsx`, `AssistantPages.tsx`, `TrainingCenterPage.tsx`, `KnowledgeBasePage.tsx`, `CrawlerPages.tsx`, `FlowBuilderPage.tsx`, `WidgetInstallationPage.tsx`, `ConnectorsPage.tsx`, `WorkspaceSettingsPage.tsx`, and `WorkspaceTeamPage.tsx`. The source `pages.tsx` is not imported from `frontend/src`.

Phase 2 has begun. Production routes lazy-load source-composition pages for Products, Product Details, Sales, Orders, Order Details, AI Assistants, Conversations, Human Handoff, Case Details, Escalation Rules, Analytics, Billing/Usage, Invoices, Knowledge Base/source detail, Integrations, Team, and Settings under the existing authenticated `DashboardLayout` and BrowserRouter. Implemented pages use existing workspace-scoped APIs, with unsupported metrics/data/actions shown as unavailable. Old Products, Product Details, Sales, Orders, Order Details, Billing, and Assistant list renderers were removed; `product-catalog-pdf.css` and `pdf-detail-pages.css` were deleted. The knowledge, integrations, team, and settings routes now mount source-composition components. Some conversation/ticket filtering and message paging controls and assistant status filters still need parity work. No visual comparison has been performed.

The source routes listed above are now mapped to live route elements. Several legacy page modules remain in the tree even when their components are no longer active; cleanup is incomplete. Earlier removal of `dashboard-layout-polish.css` and obsolete selectors in shared workspace CSS is not evidence that every old page presentation has been deleted. Existing APIs/services and permission checks must be transferred before other page components can safely be deleted.

The prior audit referenced `/tmp/carteio-pre-dashboard-ui-frontend-checkpoint.tar.gz` and `/tmp/carteio-pre-dashboard-ui-replacement.patch`, but those files were absent when checked in this execution environment. A new snapshot was created after this Phase 2 slice at `/tmp/carteio-dashboard-phase2-checkpoint-20261020.tar.gz` (SHA-256 `fe2fad34d6261bc4b75262f731485b118770d07b97575748703bde5c78fe8803`). It contains the current frontend source paths used in this slice; it is not a pre-change recovery point for files already removed. No repository reset/clean operation was used.

## Data, actions, and unsupported capabilities

The standalone source contains mock products, orders, revenue/chart series, assistants, conversations, sources, handoffs, billing history, workspace/member identities, connected Shopify status, and local-only form toggles. It also includes preview/demo notifications in action handlers. These cannot be used as production fallbacks. Existing production services include dashboard, commerce, assistant, training/Playground, knowledge, crawler, flow, connectors, widget, conversation/ticket, billing, workspace and membership API modules; route components currently consume those independently.

Audited API gaps from the existing frontend contract: historical analytics/time series and resolution metrics; invoice/payment history and plan mutation; handoff routing-rule administration; product AI-index visibility fields and complete Shopify sync/index consistency history. Show unavailable/empty states in the source composition for these capabilities; do not fabricate endpoint success.

## Verification and limitations

- Read-only code inspection confirmed production bootstrap/router and source page/data inventory.
- Read-only process/listener inspection found no port 3000 listener in this environment; historical screenshot server identity remains unverified.
- No screenshot or browser comparison was performed. No visual parity claim is made.
- No builds, tests, dev server, browser session, package install, database operation, migration or deployment was run, following the execution restrictions.
- `git diff --check` passed for tracked changes; read-only searches confirmed no production import of standalone `pages.tsx` and no source demo labels in the migrated source pages. Trailing whitespace search was clean. No compile/typecheck was run.
- The existing pre-change archive claimed by the earlier audit was not available in this environment; the Phase 2 archive was created after the current edits.
- No backend file was changed by this corrective audit. Existing unrelated backend modifications in the shared worktree predate/are outside this audit and were preserved.
- Overall dashboard replacement remains **INCOMPLETE**. This report records the root cause and actionable route inventory; it is not evidence of completed migration.

## Widget domain lock implementation (2026-10-20)

The Widget & Installation screen now accepts one hostname for the selected assistant widget and saves it through the existing `saveWidgetConfig` API. The existing backend generates/returns that assistant widget's unique public ID; the copied snippet contains that public ID, not a secret. The UI rejects schemes, paths, ports, wildcards, and multiple hostnames, and will not enable the widget without a valid hostname.

The public runtime first requests widget configuration from the existing public endpoint. The backend compares the request `Origin` hostname to the single saved hostname using exact equality. `example.com` does not authorize `shop.example.com`. If the endpoint rejects an unauthorized origin (`403`) or a disabled/unknown widget (`404`), the runtime removes its invisible host and renders no widget. Existing sessions also recheck origin authorization on protected requests. The authorized user still needs to install the generated script on the approved site and save the setup.

| Area | Change | Status |
|---|---|---|
| Widget setup | One hostname field; validate and save exactly one domain for selected assistant | Implemented; runtime unverified |
| Public ID and snippet | Reuse API-generated unique assistant widget ID; copy current public script tag | Implemented; runtime unverified |
| Domain enforcement | Backend exact-host match; no implicit subdomain access; rejects API updates with multiple domains | Implemented; backend files changed only for this requested origin policy |
| Unauthorized host | Fail closed and remove widget host for any configuration-fetch failure; this also covers CORS-hidden `403` responses | Implemented; browser verification pending |
| Installation proof | Script URL responding is not treated as proof the merchant site has installed it | Existing UI behavior retained |

Security boundary: the embed script and widget ID are public and can be copied. The actual access gate is server-side Origin validation for configuration/bootstrap and every protected widget operation; frontend hiding alone is not treated as security. Browser `Origin` is not cryptographic proof against a custom non-browser client that forges headers, so the public widget ID must never be treated as a secret. Fail-closed behavior also means transient configuration/network failures hide the widget until the page is reloaded. No build, automated tests, or browser runtime check was run for this change.

## Phase 2 implementation update

**Important fidelity limit:** the new route components added during this phase reproduce compositions using the source design classes and existing V2 primitives; they are not verbatim copies of each corresponding JSX function from `carteio-ai-dashboard/src/pages.tsx`. Therefore “IMPLEMENTED” below means the production route now renders the new API-backed composition, not that exact-source parity has been proven. The strict direct-source transplant and visual comparison requested by the owner remain incomplete. Do not treat this report as acceptance evidence.

| Source screen | Production route | Old presentation removed | Existing service/actions | Demo data handling | Status |
|---|---|---|---|---|---|
| Products | `/:slug/products` → `SourceProductsPage` | Yes; old `ProductsPage` body and `product-catalog-pdf.css` removed | `getProducts`, `getConnectors`, `queueConnectorSync` | Live products/images; API pagination/search; unsupported index filters disabled | Implemented; visual check pending |
| AI Assistants | `/:slug/assistants` → `SourceAssistantsPage` | Old list renderer removed; detail editor remains for management | `listAssistants`, `getWorkspaceDashboardSummary`; create/detail use existing assistant flows | Real names/descriptions/status/knowledge counts; chat counts unavailable | INCOMPLETE — Bot Behavior/editor route still old; visual check pending |
| Product Details | `/:slug/products/:externalId` → `SourceProductDetailPage` | Yes; old `ProductDetailPage` body removed | `getProducts`; source links to real Playground route | Live authorized product/variant fields; no mock answer; indexing marked unavailable | Implemented; visual check pending |
| Sales & Orders | `/:slug/sales` → `SourceSalesPage` | Yes; old `SalesPage` body removed | `getSales`, `getOrders` | Verified aggregates and records; trend/conversion/status counts unavailable | Implemented; visual check pending |
| Orders | `/:slug/orders` → `SourceOrdersPage` | Yes; old `OrdersPage` body removed | `getOrders` | Real order records; customer details marked unavailable; API pagination/search | Implemented; visual check pending |
| Order Details | `/:slug/orders/:externalId` → `SourceOrderDetailPage` | Yes; old detail component and `pdf-detail-pages.css` removed | `getOrders` | Real order/line item fields; customer data explicitly unavailable | Implemented; visual check pending |
| Conversations | `/:slug/conversations` → `SourceConversationsPage` | Yes; old renderer removed | `getConversations`, `getConversation`, `updateConversation`, `markConversationRead`, `addConversationNote` | Live history; no simulated replies; unsupported customer reply marked unavailable; some prior filter options not yet transferred | INCOMPLETE — functional filters/pagination remain |
| Handoff / Case Details | `/:slug/tickets`, `/:slug/tickets/:ticketId` → `SourceTicketsPage` | Yes; old renderer removed | `getTickets`, `getTicket`, `assignTicket`, `updateTicket`, `replyToTicket`, `addTicketNote` | Live ticket data; real action errors and delivery states; some prior filters/message paging not yet transferred | INCOMPLETE — functional parity remains |
| Escalation Rules | `/:slug/escalation-rules` → `SourceEscalationRulesPage` | New route; no old page | None | Disabled controls and explicit API gap | INCOMPLETE — API gap |
| Analytics | `/:slug/analytics` → `SourceAnalyticsPage` | Previous InfoPage fallback replaced | No historical analytics service | Unavailable metrics/trends, no fabricated values | INCOMPLETE — API gap |
| Billing & Plans/Usage | `/:slug/billing` → `SourceBillingPage` | Old billing renderer removed | `getBillingUsage` | Live subscription/usage; plan catalog/change unavailable | Partial; plan API gap, visual check pending |
| Invoices | `/:slug/invoices` → `SourceInvoicesPage` | New route; no old page | No invoice API | Unavailable state, no mock invoice rows | INCOMPLETE — API gap |
| Knowledge Base / Source Details | `/:slug/knowledge`, `/:slug/knowledge/:baseId` → `SourceKnowledgePage`, `SourceKnowledgeDetailPage` | Routes now point to source compositions; legacy module remains | `listKnowledge`, `getKnowledgeProcessing`, `reindexKnowledge` | Live source rows and processing metadata; no fake records | Implemented; visual check pending |
| Integrations Hub | `/:slug/integrations` → `SourceIntegrationsPage` | Route now points to source composition; legacy page module remains | `getConnectorCatalog`, `getConnectors` | Real catalog/connection data; catalog error shown without fallback | Implemented; visual check pending |
| Team & Settings | `/:slug/team`, `/:slug/settings` → `SourceWorkspaceTeamPage`, `SourceWorkspaceSettingsPage` | Routes now point to source compositions; legacy page modules remain | `listWorkspaceMembers`, `getWorkspace`, `updateWorkspace` | Real member/workspace values; invitation and role-change APIs unavailable | Implemented; visual check pending |
| Widget Installation / Appearance | `/:slug/widget`, `/:slug/widget/appearance` → `SourceWidgetPage` | Routes now point to source composition; old widget renderer is not mounted | `listAssistants`, `getWidgetConfig`, `saveWidgetConfig`, configured hosting origins | Real public ID and saved configuration only; no fake snippet or verification state | Implemented; visual check pending |
| Shopify Integration Detail | `/:slug/integrations/shopify/:connectorId` → `ShopifyIntegrationDetailPage` using source composition classes | Old detail CSS removed and source class composition mounted | `getConnectors`, `getConnectorPermissions`, `getConnectorSyncHistory`, `queueConnectorSync` | Live connector/scope/sync data; no fabricated connected state | Implemented; visual check pending |

Remaining routes including Train AI, Bot Behavior/editor, Playground, Agent Builder, Shopify detail, and Overview still require source composition transplant. Existing protected routing stays in place. No backend, landing or auth file was changed in this implementation slice. No runtime/browser verification was performed.

## Phase 3 continuation — dynamic data and supported actions (2026-10-20)

This update records the current frontend state after continuing API integration. It supersedes older rows above that still label these screens as static. No build, test, browser session, development server, migration, deployment, or package install was run. All status below is based on code inspection only and remains runtime-unverified.

Additional frontend work in this pass:

- Removed the unused production dashboard demo arrays for products, orders, sources, conversations, handoffs, and integrations from `frontend/src/dashboard-source/data.ts`. Replaced detail-route topbar titles that previously showed sample product/order/case/source names with generic labels.
- Removed unused demo-only presentation helpers and the `DESIGN · SAMPLE DATA` page-heading marker so the active component library cannot render the old label or placeholder product art.
- Correctly pass the selected assistant query parameter into Bot Behavior, and pass workspace context to the Agent Builder flow list.
- Added the existing assistant create endpoint to the assistant create route and connected activate/deactivate actions for workspace owners/admins.
- Connected Agent Builder draft creation, saved node editing, graph persistence, and flow testing to the existing flow APIs; delete/publish actions remain unavailable in the current screen.
- Changed global search text to accurately indicate page navigation only; notifications now show an unavailable message without a fabricated unread dot; Help opens the existing `/help` route. The current command palette searches dashboard page labels only.
- Removed the hidden reference/demo banner markup from the active production shell.

### Current module status

| Module/Screen | Existing API | Real Data | Actions Connected | Workspace Scoped | Demo Removed | Status |
|---|---|---|---|---|---|---|
| Overview | dashboard summary, products, conversations, tickets, connectors | Yes where returned; AI resolution and trends unavailable | Related page links | Yes | Yes | PARTIAL; runtime unverified |
| Products | product list, connector, sync job | Yes | Search, sync, details | Yes | Yes | PARTIAL; index status unavailable |
| Product Details | product list/detail adapter | Yes | Back, Playground navigation | Yes | Yes | PARTIAL; index metadata/API detail gaps |
| Sales & Orders | sales summary, order list | Yes | Refresh and order detail navigation | Yes | Yes | PARTIAL; export, conversion, time-series unavailable |
| Order Details | authorized order list/detail adapter | Yes | Back to sales | Yes | Yes | PARTIAL; fields depend on API response |
| AI Assistants | assistant list/create/status/archive/restore | Yes | Search/status filters/create/activate/deactivate/archive/restore/manage | Yes | Yes | PARTIAL; knowledge/chat counts unavailable |
| Train AI | assistant list/training overview | Yes | Assistant selection, setup navigation | Yes | Yes | PARTIAL; publish operation unavailable |
| Bot Behavior | assistant list/get/update | Yes | Load/save supported config | Yes | Yes | PARTIAL; escalation/provider preference controls unsupported |
| Playground | assistant list/chat | Yes | Real chat/new session/assistant select | Yes | Yes | PARTIAL; live runtime not exercised |
| Knowledge Base | source list/processing | Yes | Search/refresh/detail/reindex | Yes | Yes | PARTIAL; document upload/add FAQ/text not exposed on this screen |
| Knowledge Source Details | source list/processing/reindex/archive/restore | Yes | Re-index, archive/restore, Playground navigation | Yes | Yes | PARTIAL; source-specific API lookup is limited |
| Website Crawler | website source/page/create/crawl | Yes | Add/crawl/refresh/details | Yes | Yes | PARTIAL; returned page list is paginated |
| Crawl Details | source details/pages/sync settings | Yes | Crawl, schedule, pause, filter | Yes | Yes | PARTIAL; runtime unverified |
| Agent Builder | assistants/flow list/create/update/run/delete | Yes | Select assistant/flow, create draft, edit selected node, save graph, run test, delete with confirmation | Yes | Yes | PARTIAL; publishing API unavailable; runtime unverified |
| Integrations Hub | connector catalog/list/Shopify OAuth | Yes | Search, refresh, Shopify connect/details | Yes | Yes | PARTIAL; non-Shopify connection actions depend on catalog support |
| Shopify Details | connector/permissions/sync history | Yes | Verify, disconnect, permission refresh, product sync | Yes | Yes | PARTIAL; runtime unverified |
| Widget Installation | widget configuration | Yes | Copy actual public snippet, appearance navigation | Yes | Yes | PARTIAL; live installation verification API unavailable |
| Widget Appearance | widget get/save | Yes | Save supported appearance fields and live form preview | Yes | Yes | PARTIAL; theme/branding settings unsupported |
| Conversations | inbox/detail/read/note | Yes | Search, select, mark read, internal note | Yes | Yes | PARTIAL; customer reply API unavailable |
| Human Handoff | ticket list | Yes | Search/status/priority filters, pagination, details | Yes | Yes | PARTIAL; assignment is in detail view only |
| Handoff Case Details | ticket detail/assignment/update/reply/note | Yes | Assign, update status/priority, reply, note | Yes | Yes | PARTIAL; live API outcomes unverified |
| Escalation Rules | None found in frontend API layer | No rule records | No; controls are unavailable | N/A | Yes | BLOCKED by missing frontend API capability |
| Analytics | workspace summary, sales, ticket/conversation totals | Partial | Navigation/refresh where present | Yes | Yes | PARTIAL; time-series/resolution/latency/topic APIs missing |
| Billing | billing usage | Yes for returned usage/subscription | Read-only | Yes | Yes | PARTIAL; plans/pricing/change operations unavailable |
| Plans & Usage | billing usage only | Partial | No plan mutation | Yes | Yes | PARTIAL; plan catalog/entitlement details missing |
| Invoices | None found in frontend API layer | No invoice records | Back navigation only | N/A | Yes | BLOCKED by missing invoice list/download APIs |
| Team & Permissions | workspace member list | Yes for returned name/role/date | Refresh | Yes | Yes | PARTIAL; email, invitations, role mutations unavailable |
| Settings | workspace get/update | Yes | Save workspace name/site/business type | Yes | Yes | PARTIAL; personal profile and preferences APIs unavailable |

### Interaction inventory summary

| Page | Action | Existing service | Implemented | Verified |
|---|---|---|---|---|
| Global shell | Page search shortcut/palette | Local route inventory only | Page navigation search works; resource search unavailable | No runtime check |
| Global shell | Notifications | No frontend notification service found | Truthful unavailable notice; no fake unread count | No runtime check |
| Global shell | Help | Existing `/help` route | Opens help route | No runtime check |
| Global shell | Sign out | Existing AuthProvider logout | Existing logout callback retained | No runtime check |
| Workspace selector | Switch authorized workspace | Existing workspace provider and route | Existing switch retained; keyed page subtree resets workspace state | No runtime check |
| Assistants | Create | `createAssistant` | API request and error handling | No runtime check |
| Assistants | Activate/deactivate | `setAssistantActive` | Role-gated API mutation and refetch | No runtime check |
| Assistants | Archive | `archiveAssistant` | Manager-gated API mutation with browser confirmation and refetch | No runtime check |
| Assistants | Restore archived assistant | `restoreAssistant` | Manager-gated API mutation and refetch | No runtime check |
| Agent Builder | Create flow draft | `createFlow` | Creates a real workspace flow with a runnable start → assistant → response graph | No runtime check |
| Agent Builder | Edit/save selected node | `updateFlow` | Persists graph using the returned flow version | No runtime check |
| Agent Builder | Run test message | `runFlow` | Displays the API response; request failures remain visible | No runtime check |
| Agent Builder | Delete flow | `deleteFlow` | Manager-gated API delete after confirmation | No runtime check |
| Knowledge Source Details | Archive/restore | `archiveKnowledge`, `restoreKnowledge` | Archive requires confirmation; both report API errors and refresh/navigate on success | No runtime check |
| Bot Behavior | Save | `updateAssistant` | Supported fields persist through API | No runtime check |
| Playground | Send/new session | `sendPlaygroundMessage` | Real chat endpoint; no local demo reply | No runtime check |
| Shopify | Sync/verify/disconnect/permissions | Connector APIs | API operations and errors wired | No runtime check |
| Crawler | Add/crawl/settings | Knowledge/crawler APIs | API operations and errors wired | No runtime check |
| Widget | Copy/save | Widget APIs + Clipboard API | Actual public ID and supported persisted settings | No runtime check |
| Conversations | Read/note | Conversation APIs | API operations wired; customer reply unavailable | No runtime check |
| Handoff case | Assign/update/reply/note | Ticket APIs | API operations wired | No runtime check |
| Workspace settings | Save workspace | `updateWorkspace` | API save and provider state update | No runtime check |

The implementation does not yet meet the request's full-completion condition. Agent Builder publishing, resource-wide global search, notifications, profile editing, document/FAQ ingestion from the Knowledge Base screen, invoice APIs, escalation-rule APIs, historical analytics, and additional team-management APIs remain unavailable or unfinished. Visual parity, refresh behavior, multi-user isolation scenarios, and live API outcomes were not runtime-verified. No backend files were edited in this continuation; the shared working tree already has unrelated backend modifications, which were left untouched.

## Phase 2 — static source frontend mounted (2026-10-20)

The owner changed the order of work: complete the provided static frontend first, connect business APIs in a later phase. This update supersedes the earlier “replacement not started” conclusion for the active production routes. It does **not** claim API-connected functionality or visual browser verification.

The actual protected Carteio frontend now renders the copied React reference pages from `frontend/src/dashboard-source/pages.tsx` through `SourceDashboard.tsx`; the production hash demo bootstrap is not mounted. `AppRoutes.tsx` routes `/workspace/:slug/*` to the existing workspace access gate, and `DashboardLayout.tsx` now keeps that gate, session logout and authorized workspace switching while displaying the source shell. Navigation uses BrowserRouter workspace paths, so refresh and browser history remain part of the existing router. `styles.css` is copied unchanged; `source-dashboard.css` is selector-scoped from the source CSS with declarations, values and breakpoints retained. Geist is loaded from the same font source as the reference. Landing/auth routes and backend files were not changed by this implementation.

| Screen | Source component | Production workspace path | Old renderer active? | API data | Status |
|---|---|---|---|---|---|
| Overview | `Overview` | `/` | No | Workspace dashboard summary + products/conversations/tickets/connectors | PARTIAL; missing trend/resolution APIs; visual check pending |
| Products | `Products` | `/products` | No | Workspace product and connector APIs; real sync job action | PARTIAL; index filter unavailable; visual check pending |
| Product Details | `ProductDetail` | `/products/:externalId` | No | Workspace product API | PARTIAL; AI indexing metadata unavailable; visual check pending |
| Sales & Orders | `Sales` | `/sales` | No | Workspace sales summary + orders API | PARTIAL; time series/conversion/export unavailable; visual check pending |
| Order Details | `OrderDetail` | `/orders/:externalId` | No | Workspace orders API | PARTIAL; customer/tracking fields unavailable if omitted by API; visual check pending |
| AI Assistants | `Assistants` | `/assistants` | No | Workspace assistant API and actual status filters | PARTIAL; chat/knowledge counts unavailable; visual check pending |
| Train AI | `Train` | `/training` | No | Static source sample | Mounted; visual check pending |
| Bot Behavior | `Behavior` | `/training/behavior` | No | Static source sample | Mounted; visual check pending |
| Playground | `Playground` | `/training/playground` | No | Existing assistant chat API + active assistant list | PARTIAL; real endpoint integrated, runtime unverified |
| Knowledge Base | `Knowledge` | `/knowledge` | No | Workspace knowledge source API | PARTIAL; new source/upload flow not fully bound |
| Knowledge Source Details | `SourceDetail` | `/knowledge/:sourceId` | No | Workspace source + processing + reindex APIs | PARTIAL; command palette placeholder has no source ID |
| Website Crawler | `Crawler` | `/crawler` | No | Static source sample | Mounted; visual check pending |
| Crawl Details | `CrawlDetail` | `/crawler/source-preview` | No | Static source sample | Mounted; visual check pending |
| Agent Builder | `Builder` | `/builder` | No | Static source sample | Mounted; backend hookup pending by scope |
| Integrations Hub | `Integrations` | `/integrations` | No | Static source sample | Mounted; visual check pending |
| Shopify Details | `Shopify` | `/integrations/shopify` | No | Static source sample | Mounted; visual check pending |
| Widget Installation | `Install` | `/widget` | No | Static source sample | Mounted; visual check pending |
| Widget Appearance | `Appearance` | `/widget/appearance` | No | Static source state | Mounted; persistence hookup pending by scope |
| Conversations | `Conversations` | `/conversations` | No | Static source sample | Mounted; API hookup pending by scope |
| Human Handoff | `Handoff` | `/tickets` | No | Static source sample | Mounted; API hookup pending by scope |
| Handoff Case Details | `CaseDetail` | `/tickets/source-preview` | No | Static source sample | Mounted; API hookup pending by scope |
| Escalation Rules | `HandoffRules` | `/escalation-rules` | No | Static source sample | Mounted; API hookup pending by scope |
| Analytics | `Analytics` | `/analytics` | No | Static source sample | Mounted; API hookup pending by scope |
| Billing | `Billing` | `/billing` | No | Static source sample | Mounted; API hookup pending by scope |
| Invoices | `Invoices` | `/invoices` | No | Static source sample | Mounted; API hookup pending by scope |
| Workspace Settings | `SettingsPage` | `/settings` | No | Static source sample | Mounted; persistence hookup pending by scope |
| Team & Permissions | `Team` | `/team` | No | Static source sample | Mounted; API hookup pending by scope |
| Shopify Sync Monitor | `Sync` | `/integrations/shopify/sync` | No | Static source sample | Mounted; API hookup pending by scope |

All 28 `PageId`s from the supplied React source are covered by the route adapter. Existing page/API modules were left on disk to avoid removing shared functionality and test imports; they are no longer imported by production `AppRoutes`. The source's demo records and demo actions remain intentionally static in this phase, and must not be represented as live business data. No build, tests, dev server, or visual browser comparison was run. A targeted `git diff --check` for the route, shell, index and report changes passed. A local static comparison confirmed the copied `data.ts`, `pages.tsx`, `ui.tsx` and `styles.css` match their provided source files byte-for-byte, and that declarations/values in the scoped stylesheet match the source stylesheet. The recoverable pre-edit frontend archive is `/tmp/carteio-frontend-before-static-source-transplant-20261020.tar.gz`.

## Dashboard legacy cleanup follow-up (2026-10-20)

Removed the disconnected production Overview page (`pages/dashboard/DashboardPage.tsx` and `dashboard-pdf.css`) and the obsolete V2 dashboard shell stylesheet (`layouts/DashboardLayout/dashboard-v2.css`), including its sidebar and loading skeleton rules. Removed the old dashboard skeleton selectors from global styles. The workspace authorization wait now uses the shared plain `RouteLoading` status, and the disconnected training screen's animated overview skeleton was replaced with a simple status message. The active platform-admin page's header/loading presentation was moved onto its own SaaS styles so it no longer depends on the deleted dashboard shell CSS.

The production workspace routes still resolve only to the supplied static source dashboard. Some unmounted API-backed page modules and `dashboard-v2-ui.tsx` remain on disk because the existing tests and later API-integration work reference their data/action logic; they are not selected by production dashboard routing. Shared workspace/member loading styles remain because those serve workspace administration outside the replaced dashboard shell. No backend, auth route, or landing page was modified in this cleanup.

## Frontend startup optimization (2026-10-20)

- `DashboardLayout.tsx` now lazy-loads the source dashboard module so dashboard code is not part of public/auth route startup.
- Preloading begins as soon as the protected workspace route mounts, in parallel with the existing authorized `getWorkspace(slug)` check. This avoids waiting for authorization to finish before starting the dashboard code and CSS requests.
- The static source screens are selected within one `Pages` module. Once the module has loaded, switching among those screens does not request another page chunk or show a per-screen loader.
- The initial workspace `RouteLoading` remains while access is verified, and the Suspense fallback remains for the uncommon case where module loading finishes after authorization. Neither path bypasses or weakens workspace checks.
- No API fetches or data cache were added. Real data integration remains the next phase as requested.
- Static code inspection confirms the lazy import/preload and protected workspace check are present; targeted `git diff --check` passed. No build, tests, server, browser session, or performance benchmark was run, so runtime behavior and measured load-time improvement are unverified.

## Phase 3 dynamic integration checkpoint (2026-10-20)

This is an implementation checkpoint, not a claim that the whole dashboard is dynamic.

### Shared authenticated identity and workspace

- The sidebar workspace card and breadcrumb now use the active `Workspace` object returned by the existing authorized workspace lookup. The workspace logo is derived from its name; its business type is displayed when present, otherwise its actual membership role is shown. The switch menu is populated only from `WorkspaceProvider`'s authenticated `/workspaces` response and marks the active workspace.
- The profile name/email and initials in the sidebar/topbar now come from the existing `/auth/me` session context. The role shown in the topbar comes from the active workspace membership. The existing auth model exposes no avatar/profile-update API, so only session-provided name/email and initials are available here.
- `WorkspaceProvider` now associates loaded workspace lists with the authenticated user ID and hides them while a different user's list is loading. Overview requests are scoped by the active workspace slug, aborted on route/workspace change, and old results are suppressed until the new slug's response arrives.
- Protected `getWorkspace` authorization remains in place. No backend files, routes, schemas, or contracts were changed.

### Overview API bindings

- Reused `GET /workspaces/:slug/dashboard-summary`, `GET /workspaces/:slug/products`, `GET /workspaces/:slug/conversations`, `GET /workspaces/:slug/tickets?status=OPEN`, and the existing workspace connectors list through frontend services.
- The Overview now displays authorized net sales/currency totals, synced order count, conversation count, open ticket count, product records/images, active assistant count, knowledge indexing counts, Shopify state/last successful sync from the connector list, and computed readiness ratios when their respective APIs return them.
- API failures, unavailable summary fields, zero products, missing prices, missing sync timestamps, and unsupported metrics are represented as unavailable/empty values in the source page structure. Sample revenue, order/conversation counts, Shopify-connected status, fake handoff counts, illustrative product thumbnails, fake funnel percentages, and the Overview demo notice were removed from the active Overview rendering.
- The current API exposes summary totals but no dashboard time-series or AI-resolution metric. Overview therefore reports those as unavailable instead of drawing sample chart bars or inventing a resolution percentage. “Top-selling” was changed to a truthful catalog-products section because no popularity/ranking endpoint was found.
- The protected workspace loading state now reads “Preparing your workspace…” rather than the old generic dashboard loading label. The global public/auth route fallback remains unchanged.

### Screen coverage checkpoint

| Module/Screen | Existing API/service identified | Real data bound in this checkpoint | Workspace scoped | Status |
|---|---|---|---|---|
| Overview | dashboard summary, saas products/conversations/tickets | Yes, supported summary/count/product data | Yes; slug-keyed requests, abort, stale result suppression | PARTIAL — time series and AI resolution unavailable; runtime unverified |
| Products | `saas.ts`: `getProducts`; `connectors.ts`: `getConnectors`, `queueConnectorSync` | Yes; search, pagination, authorized product fields, connector state, sync job state | Yes; workspace slug per request; role-gated sync action | PARTIAL — AI index filter is unavailable; runtime unverified |
| Product Details | `saas.ts`: `getProducts` | Yes; external ID, image, description, variants, price, inventory, status | Yes; workspace slug plus exact external-ID match | PARTIAL — AI index fields unavailable; runtime unverified |
| Sales & Orders | `saas.ts`: `getSales`, `getOrders` | Yes; currency totals and recent authorized order records | Yes; workspace slug per request | PARTIAL — historical chart, conversion and export unavailable; runtime unverified |
| Order Details | `saas.ts`: `getOrders` | Yes; authorized order summary and returned line items | Yes; workspace slug plus exact external-ID match | PARTIAL — customer and tracking fields unavailable; runtime unverified |
| AI Assistants | `assistants.ts`: `listAssistants`; existing create/detail routes retained | Yes; current workspace assistant names/descriptions/status, with server-side status filters and local text search | Yes; slug scoped and role-gated create navigation | PARTIAL — chat/knowledge counts unavailable from the list API; runtime unverified |
| Train AI | `assistants.ts`: training overview/history | No | Existing APIs are slug scoped | NOT STARTED |
| Bot Behavior | assistant configuration/rule APIs in `assistants.ts` | No | Existing APIs are slug scoped | NOT STARTED |
| Playground | `assistants.ts`: `listAssistants`, `sendPlaygroundMessage` | Yes; real selected active assistant responses and returned source references; local demo messages removed | Yes; workspace slug and assistant ID are sent to existing endpoint | PARTIAL — runtime/API behavior unverified |
| Knowledge Base | `knowledge.ts`: `listKnowledge` | Yes; real source names/types/counts/status/timestamps and local search | Yes; slug scoped; API errors and empty state represented | PARTIAL — upload and source creation require linking to a concrete source flow; runtime unverified |
| Knowledge Source Details | `knowledge.ts`: `listKnowledge`, `getKnowledgeProcessing`, `reindexKnowledge` | Yes; actual source record, processing/index status, content if returned, and reindex job status | Yes; route ID is looked up in current workspace response | PARTIAL — detail menu placeholder does not identify a record; runtime unverified |
| Website Crawler | `knowledge.ts` crawler/source APIs | No | Existing APIs are slug scoped | NOT STARTED |
| Crawl Details | `knowledge.ts` website page/source APIs | No | Existing APIs are slug scoped | NOT STARTED |
| Agent Builder | `flows.ts` | No | Existing APIs are slug/assistant scoped | NOT STARTED |
| Integrations Hub | `connectors.ts`, `saas.ts` integrations | No | Existing APIs are slug scoped | NOT STARTED |
| Shopify Details | `connectors.ts`, `knowledge.ts` discovery APIs | No | Existing APIs are slug scoped | NOT STARTED |
| Widget Installation | `widget.ts` | No | Existing APIs are slug scoped | NOT STARTED |
| Widget Appearance | `widget.ts` | No | Existing APIs are slug/assistant scoped | NOT STARTED |
| Conversations | `saas.ts` conversation list/detail/mutations | No | Existing APIs are slug scoped | NOT STARTED |
| Human Handoff | `saas.ts` ticket list/mutations | No | Existing APIs are slug scoped | NOT STARTED |
| Handoff Case Details | `saas.ts` ticket detail/assignment/reply/note | No | Existing APIs are slug scoped | NOT STARTED |
| Escalation Rules | No workspace routing-rule service found in the active frontend API inventory | No | Not applicable | BLOCKED — no existing API identified |
| Analytics | dashboard summary and commerce aggregates only | Overview summary fields only | Yes | NOT STARTED — time-series/resolution endpoint unavailable |
| Billing / Plans & Usage | `saas.ts`: `getBillingUsage` | No | Existing APIs are slug scoped | NOT STARTED |
| Invoices | No invoice history/download API found in the active frontend API inventory | No | Not applicable | BLOCKED — no existing API identified |
| Settings | `workspaces.ts`: get/update workspace; `/auth/me` user read | Header identity only | Existing workspace API is slug scoped | NOT STARTED — profile mutation API not identified |
| Team & Permissions | `workspaces.ts`: `listWorkspaceMembers` | No | Existing APIs are slug scoped | NOT STARTED — existing service is read-only |
| Shopify Sync Monitor | `connectors.ts`: sync history/status; `saas.ts`: products | No | Existing APIs are slug scoped | NOT STARTED |

## Remaining supported actions follow-up (2026-10-20)

- Removed the always-visible sidebar sign-out action. Clicking the actual signed-in profile now opens a small account menu with **Account settings** and **Sign out**. Sign out still calls the existing authenticated logout flow and navigates to `/login` only after that flow resolves; failures remain visible in the existing toast. Escape closes the menu. No identity or auth behavior was changed.
- Added Knowledge Base creation forms for FAQ and text records using the already-existing `createFaqSource` and `createTextSource` frontend services. The form validates required fields, disables duplicate submission, reports API errors in the page's existing error notice, and refreshes the source list after successful API creation. Website ingestion continues through the existing crawler route. No sample record or optimistic success state is used.
- Added source-to-assistant knowledge linking on Knowledge Source Details using `listAssistants`, `getAssistantKnowledge`, `attachKnowledge`, and `detachKnowledge`. Only the current workspace's assistant list is queried; attach/detach actions require owner/admin membership in the UI and report backend errors without optimistic state.
- These additions are verified by source inspection and `git diff --check` only. No build, test, server, browser, backend call, or visual regression check was run under the existing execution restrictions.
- Previously recorded unsupported or incomplete capabilities remain incomplete: profile mutation/avatar, notification feed, global resource search, invoice history/download, plan changes, escalation-rule persistence, team invitations/role mutations, analytics time series, widget installation verification, and flow publishing have no corresponding existing frontend API identified. Existing APIs that do support other modules remain connected as described in the Phase 3 checkpoint; this follow-up does not represent those gaps as complete.

| Page | Action | Existing service | Implementation | Verification |
|---|---|---|---|---|
| Shared sidebar | Open profile menu | Existing authenticated session context | Account settings and sign out appear only after profile click; Escape closes menu | Static source inspection; runtime unverified |
| Shared sidebar | Sign out | Existing AuthProvider logout callback | Calls existing logout flow; route changes to login on success; failure toast on rejection | Static source inspection; runtime unverified |
| Knowledge Base | Add FAQ | `knowledge.ts:createFaqSource` | Required question/answer form; API call; refreshes authorized workspace list | Static source inspection; API/runtime unverified |
| Knowledge Base | Add text source | `knowledge.ts:createTextSource` | Required title/content form; API call; refreshes authorized workspace list | Static source inspection; API/runtime unverified |
| Knowledge Source Details | Attach/detach assistant knowledge | `assistants.ts:listAssistants`; `knowledge.ts:getAssistantKnowledge`, `attachKnowledge`, `detachKnowledge` | Lists current-workspace assistants and updates source membership through authorized APIs | Static source inspection; API/runtime unverified |

## User-prioritized follow-up (2026-10-20)

The user deferred notifications, billing, team invitations, analytics, escalation rules, Agent Builder, and global resource search. Those are intentionally out of scope for this follow-up.

- Widget installation now uses the existing validated `VITE_WIDGET_HOSTING_ORIGIN` and optional `VITE_WIDGET_API_ORIGIN` configuration helpers. It emits the previously working `data-widget-id` snippet and withholds it if the host/API origin is invalid. The public script host is checked for a JavaScript response; this is not represented as proof that a merchant site has installed the widget.
- Knowledge Base now supports actual `.xlsx` FAQ import to an active workspace Knowledge Base: the user selects a destination, uploads a workbook, sees the backend validation preview (valid/invalid/duplicate rows), chooses duplicate handling, and confirms the backend import. If no active base exists, an owner/admin can create one through the existing `createKnowledgeBase` service. The result uses returned created/skipped/failed counts. CSV is not accepted in this UI because the user asked specifically for Excel.
- Website crawler was already connected to the existing source registration, crawl job, page listing, refresh, schedule and pause APIs in the Phase 3 implementation. No crawler backend changes were made in this pass.
- Static inspection only; no build, test, server, browser, live API request, or visual comparison was run. Widget script availability and all API responses therefore remain runtime-unverified.

## Shopify reconnect and availability follow-up (2026-10-20)

- Integrations Hub now presents Shopify as the only available connector. Additional connectors are represented as “Coming soon”; catalog entries can no longer incorrectly appear connected/available in this screen.
- Fixed the reconnect blocker: disconnect leaves the connector record in the workspace list, so the previous UI treated any record as connected and hid the OAuth form. The Hub and Shopify details now offer reconnection for disconnected connector records and invoke the existing `beginShopifyInstall` OAuth service with the stored or entered `*.myshopify.com` domain.
- Shopify authorization is validated against the existing install contract in the frontend; owner/admin access is required on the details screen, and backend authorization remains authoritative. OAuth errors remain visible; no success is shown until the browser returns from Shopify and the connector API reports its real state.
- Overview, Integrations, Products, Shopify Details and Sync Monitor now share normalized connector-state labels and state-aware status colors. Product sync actions are disabled unless Shopify is in a real active state.
- Existing `getConnectors`, `beginShopifyInstall`, connector permission, verification, disconnect and sync services are reused. No backend code was changed in this follow-up.
- Verification: code inspection only. Builds, tests, servers, browser navigation and live Shopify OAuth were not run, so reconnect success and presentation remain runtime-unverified.

| Screen | Existing source component | Existing API/service | Change | Status |
|---|---|---|---|---|
| Integrations Hub | `Integrations` | `getConnectors`, `beginShopifyInstall` | Shopify only is available; other integrations show Coming soon; disconnected stores get OAuth reconnect form | Implemented in source; runtime unverified |
| Shopify Details | `Shopify` | `getConnectors`, `beginShopifyInstall`, permissions, sync, disconnect, verify | Disconnected connector can reauthorize through Shopify OAuth; stale permissions/history are not loaded while disconnected | Implemented in source; runtime unverified |
| Product Catalog | `Products` | `getConnectors`, `queueConnectorSync` | Sync disabled while disconnected; connector status normalized; connect link remains available | Implemented in source; runtime unverified |
| Shopify Sync Monitor | `Sync` | `getConnectors`, `queueConnectorSync` | Sync requires a connected/connected-with-warnings/syncing connector and owner/admin | Implemented in source; runtime unverified |
| Overview | `Overview` | `useOverviewData` connector list | Uses shared normalized connector state label and state-aware badge tone | Implemented in source; runtime unverified |

## Flow endpoint error follow-up (2026-10-20)

- The log reports repeated `GET /workspaces/:slug/flows` HTTP 500 responses. The active dashboard's Agent Builder previously selected an assistant and automatically called `listFlows`, which generated this repeated request pattern.
- Agent Builder is deferred per the user's instruction. Its active source screen now shows an explicit unavailable state and makes no flow API request. Flow API imports/actions were removed from that screen, so navigating to it no longer causes the repeated 500s.
- The provided log does not expose the backend exception or database error: `AllExceptionsFilter` intentionally logs only “Unhandled request error” and returns a generic 500. Therefore the backend root cause cannot be established from this excerpt alone. The service query depends on the `FlowDefinition` table; a missing/unapplied migration is one possibility, but is not verified.
- No backend code, database, migration or server was changed. Direct calls to `/flows` may still return 500 until the server-side exception is diagnosed. The 304 connector/assistant responses in the excerpt are cache revalidation responses, not failures; worker `claimedCount: 0` is a successful idle poll.
- Verification is static source inspection only; the app was not refreshed and no API request, build, test, migration or browser check was performed.

## Widget & Installation crash and setup flow (2026-10-20)

- Static inspection found a render-time crash: the Widget & Installation page rendered the Lucide `Check` icon but did not import it. Added the missing import, which also fixes other current source-dashboard save actions that render the same icon.
- Restored the website setup flow in the active dashboard route using existing APIs: load workspace assistants, select an assistant, load or initialize its widget configuration, edit approved hostnames, enable/disable the widget, save through `saveWidgetConfig`, generate the real public-ID snippet, copy it, and show platform-specific install steps for Shopify, WordPress, React/Next.js, and static/custom sites.
- A missing widget config is handled as an unconfigured state; a missing assistant, invalid hosting/API origin, API failure, and unavailable script host are shown honestly. The UI does not claim storefront verification based only on a saved configuration or script response.
- Verification is static inspection only; browser navigation, runtime crash reproduction, save/API behavior, and installation were not tested.

| Page | Action | Existing service | Implementation | Status |
|---|---|---|---|---|
| Widget & Installation | Generate/copy installation snippet | `config/index.ts`: `getWidgetHostingOrigin`, `getWidgetApiOrigin`, `isWidgetApiOriginConfigurationValid`; `widget.ts:getWidgetConfig` | Uses configured origins and `data-widget-id`; copy is disabled if config is invalid or public ID is absent | Static source inspection; runtime unverified |
| Widget & Installation | Check public widget script | Existing configured widget hosting origin | Fetches `/widget.js` and reports script response/content type; does not claim merchant installation | Static source inspection; runtime unverified |
| Knowledge Base | Upload Excel FAQ workbook | `knowledge-bases.ts:listKnowledgeBases`, `previewKnowledgeBaseFaqImport`, `importKnowledgeBaseFaqs` | Workspace-scoped destination, `.xlsx` validation preview, duplicate policy and actual import result | Static source inspection; API/runtime unverified |
| Website Crawler | Register/crawl website and manage crawl state | `knowledge.ts:createWebsiteSource`, `crawlWebsiteSource`, `listWebsitePages`, `getWebsiteSourceDetails`, `updateWebsiteSyncSettings` | Existing API-backed add/crawl/details/schedule/pause flows remain active | Static source inspection; API/runtime unverified |

### Overview interaction inventory

| Page | Button/action | Existing service or behavior | Result | Implemented | Verified |
|---|---|---|---|---|---|
| Overview | View analytics | Existing React Router navigation | Opens Analytics route | Yes | Static route inspection only |
| Overview | Sales chart View analytics | Existing React Router navigation | Opens Analytics route | Yes | Static route inspection only |
| Overview | Open handoff cases | Existing React Router navigation; count from ticket list API | Opens Handoff route | Yes | Static route inspection only |
| Overview | Knowledge sources | Existing React Router navigation; summary counts | Opens Knowledge Base | Yes | Static route inspection only |
| Overview | Active assistants | Existing React Router navigation; summary count | Opens AI Assistants | Yes | Static route inspection only |
| Overview | Shopify integration | Existing React Router navigation; authorized summary status | Opens Integrations | Yes | Static route inspection only |
| Overview | Product card / View all | Existing React Router navigation; `getProducts` data | Opens Product Catalog | Yes | Static route inspection only |
| Overview | Date range control | Source currently renders a non-interactive label; no time-series API exists | Unavailable; no fake filtering | No | Not applicable |
| Products | Search | `getProducts(slug, page, search)` | Reloads authorized matching catalog rows | Yes | Static route inspection only |
| Products | Previous / Next page | `getProducts(slug, page, search)` | Loads adjacent API page | Yes | Static route inspection only |
| Products | Indexed / Not indexed filters | No product index-status API | Disabled with an explicit unavailable explanation | Yes | Static code inspection only |
| Products | Sync products | `getConnectors`, `queueConnectorSync` | Queues a real full product sync and reports returned job state | Yes; owner/admin gated | Static route inspection only |
| Products | Product row | Existing BrowserRouter navigation | Opens the selected product by Shopify external ID | Yes | Static route inspection only |
| Sales & Orders | Refresh orders | `getSales`, `getOrders` | Refetches real sales/order data | Yes | Static route inspection only |
| Sales & Orders | Export | No export API found | Disabled and labeled unavailable | Yes | Static code inspection only |
| Sales & Orders | Order row | Existing BrowserRouter navigation | Opens selected order by external ID | Yes | Static route inspection only |
| Order Details | Retry | `getOrders` | Retries selected authorized order lookup | Yes | Static route inspection only |
| AI Assistants | Search and status filters | `listAssistants` | Filters API-backed workspace assistant list | Yes | Static code inspection only |
| AI Assistants | Refresh | `listAssistants` | Reloads active workspace assistant records | Yes | Static code inspection only |
| AI Assistants | Create assistant | Existing `/assistants/new` flow | Route points into current protected workspace route; source dashboard does not yet render a create form | PARTIAL | Not verified |
| AI Assistants | Manage assistant | Existing assistant detail route | Current source route adapter does not yet provide a source-native detail/editor screen | PARTIAL | Not verified |
| Playground | Assistant selector | `listAssistants(status=ACTIVE)` | Selects an active assistant from current workspace | Yes | Static code inspection only |
| Playground | Send message | `sendPlaygroundMessage` | Requests a real assistant answer and displays returned source references | Yes | Static code inspection only |
| Playground | New session | Local session state | Clears local transcript/session ID; next send starts a fresh backend session | Yes | Static code inspection only |
| Knowledge Base | Search | `listKnowledge` result | Filters current workspace source records locally | Yes | Static code inspection only |
| Knowledge Base | Refresh | `listKnowledge` | Refetches source records | Yes | Static code inspection only |
| Knowledge Base | Source row | BrowserRouter knowledge detail route | Opens selected workspace source ID | Yes | Static code inspection only |
| Knowledge Source Details | Re-index | `reindexKnowledge` | Queues real re-index request and reports returned status/error | Yes | Static code inspection only |
| Knowledge Source Details | Retry | knowledge list + processing APIs | Refetches selected source and processing metadata | Yes | Static code inspection only |

### Verification and remaining work

- Static `git diff --check` passed for tracked changed paths and a trailing-whitespace scan was clean for the new Overview hook.
- No build, tests, browser, server, or performance checks were run under the existing execution restrictions; no runtime, visual, multi-user, or API response claims are made.
- This checkpoint does not satisfy the requested full-dashboard dynamic integration. Overview, Products, Product Details, Sales & Orders, Order Details, AI Assistants listing, Playground responses, Knowledge Base listing, and Knowledge Source Details now use existing data services. Train AI, Bot Behavior, Website Crawler, Crawl Details, Agent Builder, Integrations, Shopify Details, Widget screens, Conversations, Handoff screens, Analytics, Billing/Invoices, Team, Settings, and Sync Monitor remain static or partially static. Shared controls (global search, notifications, help, profile editing, and workspace settings mutation) still need implementation or an honest unavailable state. No runtime/API/browser verification was performed; the workspace-switch subtree is keyed by slug and request effects abort on cleanup to avoid carrying local data across workspace changes.
