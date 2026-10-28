# Carteio AI dashboard dark mode correction

## Scope

Frontend-only theme work on the shared dashboard shell and shared dashboard components. The light theme remains the base CSS theme; the premium navy palette is scoped under `.source-dashboard[data-mode="dark"]`. Landing page, authentication pages, APIs, and backend code were not changed for this task.

## Root causes addressed

- Dashboard color mode was stored as local state in `SourceDashboard`, separate from the app's root `ThemeProvider`.
- Dark colors had been added by changing shared light declarations and by stacking overlapping dark overrides. This made theme boundaries hard to reason about and risked changing the approved light appearance.
- Shared dashboard CSS contains light surface and status colors across many page components, so fixing only the shell left some controls, tables, badges, and overlays light in dark mode.
- Failure states in the shared compact badge component did not have a dark-only semantic color hook.

## Theme tokens

Added dark-scoped tokens for app, sidebar, header, card, elevated and input surfaces; primary/secondary/muted text; borders; primary and hover blue; selected navigation; focus; success, warning, danger; disabled controls; overlay; and shadows. The values follow the supplied navy/slate palette, including `#0B1220`, `#101A2B`, `#162237`, `#1B2B43`, `#293A52`, `#F1F5FC`, `#A8B8D0`, `#8294AF`, and `#4B83FF`.

The shared light declarations remain the base. Dark selectors are scoped to the dashboard root's `data-mode="dark"`; no site-wide dark selector was added.

## Shared components corrected

- Sidebar and workspace switcher, section labels, navigation active/hover/focus states, profile row and account menu.
- Sidebar and table scrollbar colors, retaining scroll behavior.
- Topbar, breadcrumbs, search, shortcut badge, theme control, help, notifications, and user identity.
- Cards, metrics, tables, filters, tabs, forms, search fields, toggles, progress tracks, charts, notices, empty states, and semantic badges.
- Command palette, mobile navigation, toasts, and focus indicators.
- Compact status badges gain dark-only failed and processing treatments. Status values and API data are unchanged.

## Route coverage

All 28 `PageId` routes render inside `SourceDashboard` and share the corrected shell and `source-dashboard.css` theme scope:

Overview; Products; Product Details; Sales & Orders; Order Details; AI Assistants; Train AI; Bot Behavior; AI Playground; Knowledge Base; Knowledge Source Details; Website Crawler; Crawl Details; Agent Builder; Integrations; Shopify Integration; Widget & Installation; Widget Appearance; Conversations; Human Handoff; Handoff Case; Handoff Rules; Analytics; Billing & Plans; Billing History; Workspace Settings; Team & Permissions; Product Sync Monitor.

Website Crawler shares the common dark KPI, card, source-row, table, progress, and status styles. No crawler API, calculations, or stored statuses were changed.

## Theme persistence and startup

`ThemeProvider` now owns `mode` and `setMode` alongside its existing palette state. Dashboard mode uses the existing `carteio-dashboard-theme` local-storage key and is initialized synchronously before the first dashboard render, avoiding a client-side light/dark flash when a preference is saved. With no saved mode, the dashboard keeps its existing light default. The dashboard toggle updates the provider immediately and its setting persists across route changes and refreshes. Existing system-theme behavior was not present and was not changed.

## Light-mode regression status

The dashboard's original light surface variables and shared light declarations were restored as the base. New theme rules are dashboard-dark scoped. The status badge change adds classes only; its light colors and tone mapping are unchanged.

No screenshot comparison or browser run was performed, so pixel-level light-mode equivalence has not been visually verified.

## Responsive and accessibility status

Existing responsive breakpoints and layout declarations were preserved. Dark scrollbar styling retains scrolling. Keyboard focus rings, form surfaces, muted text, and semantic status colors have dark-specific styles.

The requested viewport matrix was not exercised in a browser. Contrast ratios were not measured with an automated accessibility tool; token choices were selected for readable text and control boundaries against the stated palette.

## Verification

- Static inspection confirmed all 28 dashboard route IDs render under the shared dashboard root and stylesheet.
- Static inspection confirmed dark styling is scoped to `data-mode="dark"` and the light variables remain the base values.
- Builds, tests, browser automation, and screenshot comparisons were not run, per instruction.

## Remaining limitations

- Visual behavior at the requested viewport sizes and exact WCAG contrast ratios remain unverified without a browser/accessibility run.
- Some product/widget preview content intentionally reflects its own selected preview color or user-provided image rather than the dashboard surface theme.

## Files modified

- `frontend/src/app/providers/ThemeProvider.tsx`
- `frontend/src/dashboard-source/SourceDashboard.tsx`
- `frontend/src/dashboard-source/source-dashboard.css`
- `frontend/src/dashboard-source/pages.tsx`
- `frontend/src/dashboard-source/ui.tsx`
- `rors/carteio-complete-dark-mode-fix.md`
