# Carteio dashboard PDF replacement — progress

> **Superseded authority notice (2026-10-20):** The user has since designated the local React project `carteio-ai-dashboard/` as the primary dashboard implementation source and explicitly said no build, tests, or dev server may be run without approval. Treat this document's PDF-specific visual decisions as historical context only; use [`dashboard-source-merge-audit-2026-10-20.md`](dashboard-source-merge-audit-2026-10-20.md) for the active task and current implementation status. The current source-merge pass has not been runtime-verified.

## Reference used

- `Carteio AI — Velora Dashboard UI Kit & Screens.pdf` (19 screens), supplied by the user.
- The implementation deliberately does not use the Figma URL or local `.fig` archive after the user requested the PDF-only route.

## Implemented visual system

- Reworked the desktop shell around the PDF's white grouped navigation, soft blue canvas, breadcrumb, centered search treatment, notifications, and account area.
- Added the PDF navigation groups while preserving existing route and role checks.
- Applied the blue/soft-blue token treatment to API-backed overview, commerce, customer-support, billing, training, integrations, and widget surfaces.
- Added the Playground deep-link (`/training?tab=playground`) to the existing real training tab rather than adding a fake page.
- Preserved widget save, test-chat, embed, connector verification/sync, assistant training, and existing backend contracts.

## Verification

- `npm run typecheck` — passed after the page additions.
- `npm run build` — passed after the page additions (Vite 6.4.4; 2,089 modules; 69 seconds).
- After the latest widget fallback and workspace-menu edits, `npm run typecheck` passed and `npm run build` passed again (Vite 6.4.4; 2,089 modules; 75 seconds).
- Full `npm test` — failed: 11 test files failed, 10 passed; 29 failed tests, 2 errors, 102 total tests. Failures include stale expectation/copy mismatches in widget, connector, business-data visibility, training, ticket and workspace-onboarding tests, plus landing test environment issues. Landing UI was explicitly out of scope and was not changed as part of the dashboard replacement.
- Follow-up focused run: workspace-switching test passed (1/1). Widget-installation tests failed (2/2); the assertions use legacy labels and also exposed unstable test cleanup/duplicate heading output. A saved-color null guard was added, but the widget screen is not test-verified.
- The workspace selector is now available in the account popover when multiple authorized workspaces exist, styled to the PDF palette; its existing switch action clears tenant state through the current workspace logic.
- Browser check: Vite and Chrome were started with the user's later verification approval. At 1440 × 1024, the protected route displayed “We could not check your account session. Try again.” because the Nest API on `127.0.0.1:5000` is not running. The dashboard therefore could not be captured in an authenticated state or compared with the PDF. The local backend `.env` points to a remote Neon database; the backend was not started and no database was contacted.
- Console showed Vite connection and React Router future-flag notices on the unauthenticated screen. No authenticated page actions or responsive viewport matrix could be checked.

## Follow-up visual QA

- Run the app locally, sign in with a non-production test account, and compare each protected route against the PDF at desktop and mobile widths.
- Verify the nav labels/role visibility against the product's intended permission policy; the visual replacement retains the current application permissions.

## Sequential PDF review update — 2026-10-20

- Installed PyMuPDF only into `/tmp/carteio_pdf_tools` after the user explicitly authorized PDF tooling. Rendered all 19 pages at 2160 × 1536 px and inspected each in order. The per-page inventory is in `rors/dashboard-pdf-page-inventory-2026-10-20.md`.
- Page 1 is a shell-only frame. Pages 2–19 map through overview, commerce, AI training, knowledge, crawler, agent builder, integrations, Shopify, installation and widget appearance. The PDF has no separate mobile frames and does not include conversation/handoff, billing, analytics, settings or team designs.
- Added real-data product and order detail views backed by existing paginated commerce APIs, a verified-source crawler and crawl-detail view backed by existing knowledge APIs, and a Shopify detail view backed by connector permissions/sync APIs. Added routes and navigation links for these pages.
- Expanded Sales & Orders with authorized recent orders and links. The current API supplies paid-order aggregates but no time-series revenue data; the trend panel reports that gap rather than fabricating chart values.
- Added `/widget/appearance` as an appearance mode of the existing configuration page, sharing the same save state and preview rather than introducing duplicate widget configuration state.
- Fixed the crawl-detail URL filter to pass its value through the existing source-scoped list API. Removed static fake product thumbnail decorations when the real Shopify image URL is unavailable.
- No backend, authentication, database, migration, deployment or package.json changes were made as part of these latest frontend additions. Existing unrelated working-tree changes remain untouched.

## Current status and limits

The page inventory is complete, but implementation is not signed off as complete. A browser screenshot was captured only with a temporary visual-QA fixture; it is not a real authenticated session and it used a 758 × 482 CSS viewport, so there is no valid desktop side-by-side comparison. The integration-test failures and lack of a safe local API/test account also prevent verifying actions against real services. Do not claim exact/pixel-perfect fidelity. Superseded CSS for the overview has been removed after replacement; broader legacy dashboard presentation cleanup remains deferred until each screen's replacement is verified.

## User feedback and overview correction — 2026-10-20

- The user reported that the existing implementation did not resemble the PDF. Confirmed: the old overview had six KPI cards plus assistant/audit panels, which did not match PDF page 2's four KPIs, trend/AI-operations row, product gallery and sales snapshot.
- Replaced the old overview presentation with the page-2 hierarchy. Commerce, sales summary, product catalog, conversation totals, ticket queue, integration state and knowledge status are requested through existing frontend APIs. Unsupported resolution-rate, historical trends and storefront funnel metrics show unavailable states. Product titles/prices/images remain sourced from the authorized product API; no sample merchants or numbers are in the shipping dashboard code.
- Added the PDF workspace identity card, sidebar grouping/labels, and adjusted shell/content dimensions, topbar, typography and active-nav styling. Removed the superseded overview-only `dashboard.css` and `dashboard-polish.css`; retained the shared `dashboard-capabilities.ts` utility because workspace settings/tests still import it.
- Figma MCP `get_design_context` was attempted for node `10:2` and rejected by the Starter plan call limit. REA opened the local `.fig` as a ZIP archive; its thumbnail overview was inspected, and the full-resolution local PDF remains the high-resolution reference. Ghidra was not applicable to this React project or Figma archive; REA browser tooling was used instead.
- A temporary local-only fixture API plus temporary Vite config rendered the protected dashboard without contacting NestJS, PostgreSQL or Neon. Screenshot capture succeeded through REA, but the attached Chrome viewport was 758 × 482 CSS px although a 1440 × 1024 viewport was requested; this is a responsive/mobile rendering and cannot be compared as a desktop match. REA's owned Chrome launch failed with a non-retryable execution/cleanup error. Temporary Vite/API processes and config were stopped/removed after capture.
- Latest `npm run typecheck` passed. Latest `npm run build` passed (2,088 modules; 2m 5s). The earlier full frontend test suite remains failing as detailed above. Exact design fidelity is still unverified; do not mark the dashboard complete.
