# Carteio dashboard PDF review and implementation tracker

Review date: 2026-10-20  
Reference: `Carteio AI — Velora Dashboard UI Kit & Screens.pdf` (root)  
Total: 19 pages, each 1440 × 1024 pt. All pages were rendered at 2160 × 1536 px (1.5×) and visually inspected in page order. The page PNGs are in `/tmp/carteio-dashboard-pdf/pages/` and were not added to the repository.

## Visual review and page-to-route tracker

Status is explicit: “reference inspected” means the source page was read; “implementation” and “comparison” are separate checks. A page is not complete solely because a route exists.

| PDF page | Screen and reference composition | React route / adapter | Implementation and integration status | Visual comparison / old UI cleanup |
|---:|---|---|---|---|
| 1 | Dashboard shell / sidebar and topbar frame; no populated content area | Shared `DashboardLayout` | Added workspace identity card, grouped V2 nav, and adjusted sidebar/topbar/content dimensions; role-gated entries retained | Shell screenshot captured only at 758 × 482 CSS px; no desktop comparison; broader old-shell cleanup pending |
| 2 | Dashboard overview; four KPI cards, sales/conversation trends, AI operations, products and sales snapshot | `/workspace/:slug` → `DashboardPage` | Replaced six KPI/assistant/audit composition with four KPI cards, trend/operations panels, authorized Shopify catalog, and sales snapshot. Uses existing summary, product, conversation and ticket APIs; unsupported trend, AI resolution, funnel and product ranking data are explicitly unavailable | REA screenshot used a temporary local fixture and 758 × 482 CSS viewport. No valid desktop side-by-side comparison; page is not marked visually complete |
| 3 | Products catalog; product imagery and catalog table | `/products` → `ProductsPage` | Live commerce list and image URLs; product-detail navigation added | Browser comparison pending; old page stylesheet cleanup pending |
| 4 | Product details and AI product knowledge | `/products/:externalId` → `ProductDetailPage` | Added list-API adapter using exact external product ID; no separate backend detail contract invented | Browser comparison pending; old product detail UI did not exist |
| 5 | Sales & Orders; commerce KPI/chart region and recent orders | `/sales` → `SalesPage`, `/orders` → `OrdersPage` | Existing authorized sales aggregate and order APIs preserved; recent order rows and detail navigation added. Revenue trend is clearly unavailable because the current sales contract has no time-series API | Browser comparison pending; combined reference composition needs visual tuning |
| 6 | Order details / customer-support context | `/orders/:externalId` → `OrderDetailPage` | Added exact external order lookup using existing paginated order API; customer PII remains restricted | Browser comparison pending; old order detail UI did not exist |
| 7 | AI Assistants management | `/assistants` | Existing assistant management and CRUD integration retained | Browser comparison pending; old presentation cleanup pending |
| 8 | Train AI command center | `/training` | Existing training center and supported actions retained | Browser comparison pending; check each displayed action and route |
| 9 | Bot Behavior | `/assistants/:assistantId` | Existing assistant editor is the supported behavior/config adapter | Browser comparison pending; direct Bot Behavior route/section mapping remains to verify |
| 10 | AI Playground, chat and evidence | `/training` (Playground tab) | Existing live Playground service retained; no static chat substituted | Browser comparison pending; deep-link behavior remains to verify |
| 11 | Knowledge Base | `/knowledge` | Existing source ingestion, indexing and management APIs retained | Browser comparison pending; old presentation cleanup pending |
| 12 | Knowledge source detail | `/knowledge/:baseId` currently maps to knowledge-base detail | Existing base-detail route exists; source-vs-base semantics need confirmation before claiming exact mapping | Browser comparison pending; reference/entity mapping unresolved |
| 13 | Website Crawler | `/crawler` | Added page from existing website-source/page APIs, with crawl action gated by verification and real loading/error/empty states | Browser comparison pending; old crawler was embedded in knowledge presentation |
| 14 | Website Crawl detail | `/crawler/:sourceId` | Added existing source detail, crawl and sync-policy APIs; unsupported path allow/deny rules are explicitly disabled | Browser comparison pending; old crawler presentation cleanup pending |
| 15 | Agent Builder | `/builder` | Existing real flow APIs and editor retained; no fake persisted drag/drop actions added | Browser comparison pending; builder persistence state should be verified in app |
| 16 | Integrations Hub | `/integrations` | Existing connector catalog, availability, permissions, sync and Shopify authorization retained | Browser comparison pending; provider card composition needs visual pass |
| 17 | Shopify Integration detail | `/integrations/shopify/:connectorId` | Added detail view backed by connector, permission and sync-history APIs; entry link added to Shopify connector card | Browser comparison pending; no Shopify success fabricated |
| 18 | Widget & Installation | `/widget` | Existing real widget configuration, generated public ID/snippet, installation guidance, diagnostics and Playground-backed chat retained | Browser comparison pending; installation vs appearance split needs review |
| 19 | Widget appearance & customization | `/widget/appearance` → shared `WidgetInstallationPage` in appearance mode | Existing saved appearance, live preview and real save behavior retained; appearance mode links back to installation | Browser comparison pending; shared page is filtered with CSS and needs visual review |

## PDF findings

- The PDF contains one 19-page desktop presentation at 1440 × 1024 pt. It does not include separate mobile-sized design frames. Responsive mobile work is therefore an adaptation of the supplied desktop system, not an exact mobile-frame match.
- Page 1 is an intentionally sparse shell page. Page 19 is the widget appearance/customization screen; the PDF does not show Settings, Team, Billing, Analytics, Conversations, or Human Handoff screens.
- The visual language is a pale blue-gray canvas, white panels, blue primary actions, light-blue accents, dark navy headings, thin cool-gray borders, rounded cards, compact sidebar navigation, and a Geist-like sans-serif. The reference palette includes approximately `#286BFF`, `#F6F9FE`, `#FFFFFF`, `#EBF2FF`, `#152039`, `#708098`, `#E2E9F4`, and success green `#0CA778`. These are visual estimates; individual exact token extraction was not possible from a source design-token table.
- Reference metrics, product names/images and chart values are sample presentation data. They must never be represented as current merchant data.
- The pages beyond the supplied PDF (Conversations, Handoff, Analytics, Billing, Settings, Team) have existing app routes/services in this repo, but no matching visual page is present in this reference PDF. Their exact design needs a separate approved design reference; do not claim a PDF match.

## Functional baseline and protected behavior

The pre-task audit and recoverable checkpoint are documented in `rors/dashboard-figma-replacement-audit-2026-10-19.md`. The working tree already contained extensive unrelated user work before these additions; this task has not reset or cleaned it. The verified checkpoint artifacts are outside the repository under `/tmp` (patch SHA-256 `339e9fe4faa019b1bb85b5b3b9fa51f5f31cd7ce554dbb6763fe022f407e3b44`; archive SHA-256 `6ac8b520e724ea26902767e8d67ef5b29dc068bccf414b8c38505aa8b26ddffb`).

Existing API services and behaviors remain the integration source for overview, Shopify products/orders/sales, assistants, training/Playground, knowledge ingestion, website crawling, flow builder, connectors, widget, conversations, tickets, billing, workspace settings and team. Protected backend/authentication/database files were not intentionally edited for this UI task. Existing user changes to backend and other project files predate this task and remain untouched.

## Verification limits and remaining work

- The user authorized installing a local PDF renderer. PyMuPDF was installed under `/tmp/carteio_pdf_tools`, not into project dependencies, and all pages were rendered and visually inspected.
- A browser screenshot was captured via REA against a temporary local-only visual fixture, with no NestJS, database, or external connection. The connected Chrome viewport remained 758 × 482 CSS px, even though 1440 × 1024 was requested; this is not a valid desktop comparison. The fresh REA Chrome launch failed with a non-retryable provider execution/cleanup error.
- The configured backend environment points to remote Neon. The backend was not started and no remote database was contacted. A safe local API plus non-production account is needed to continue authenticated browser QA.
- Latest `npm run typecheck` passed and latest `npm run build` passed (Vite 6.4.4, 2,088 modules, 125 seconds). This is build timing only; no browser performance metrics were collected.
- Full frontend tests failed: 11 failed files, 10 passed; 29 failed tests, 2 errors, 102 total. A focused workspace-switching test passed (1/1); focused widget-installation tests failed (2/2). Thus route/action behavior, console review of authenticated routes, and the required responsive viewport matrix remain unverified.
- UI changes in this task added commerce detail adapters, crawler pages, Shopify detail, route/navigation wiring, and replaced the old overview styles. Old presentation components for the other routes have **not** been broadly deleted because their replacements and integrations are not verified. Existing sources contain unrelated user changes; those remain untouched.
- Current API gaps observed in the UI mapping: historical sales/conversation trends, AI-resolution rate, sales funnel counts, sales-ranked products, crawl URL allow/deny configuration, and a distinct source-detail contract/route mapping. No new backend action or fake success was added for these gaps.
- Widget installation and appearance now have separate routes backed by the same widget configuration state and save action. Appearance mode filters installation-only panels while preserving the one source of truth for widget settings.

## Current implementation status

The PDF has been inspected from page 1 through page 19, and this tracker records every page. The implementation is in progress, not complete. Pages marked above as “pending” require a matching desktop browser capture, visual comparison, and/or additional route/presentation work before they can be called finished. No backend, Prisma, migration, authentication API, deployment or package dependency changes were made as part of the dashboard UI additions described here. The old overview-only styles were removed; other superseded presentation files remain pending verification. No actual dashboard runtime performance measurements are available yet.
