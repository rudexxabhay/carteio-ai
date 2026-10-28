# Carteio AI Dark Mode CSS Regression Fix

## Root causes

- The active dashboard page is `frontend/src/dashboard-source/pages.tsx`'s `Crawler` component. Its `.crawl-row` rule in `source-dashboard.css` hardcoded `background: white`. The dark palette changed `--ink` to pale primary text but did not provide a dark row surface, producing the white-row/light-text conflict.
- `connectors-page.css` had a later “PDF integration hub treatment” block with unscoped light colors and several `!important` declarations. It forced Shopify/connector panels and controls to white even while the source dashboard was in dark mode.
- Theme state is already applied by the existing `ThemeProvider` through `data-mode` on `.source-dashboard`; the failure was missing component rules and unscoped light-only polish, not missing theme state.

## Changes made

- Added scoped dark rules to the active `.crawl-row`: elevated surface, primary and secondary text tokens, divider, hover surface, visible keyboard focus, muted/active chevron, and dark progress track with the existing blue fill.
- Added dark surface and semantic text/status styling for Shopify permission panels, scope and operation rows, connector cards, schedules, modal surfaces, labels, controls, status pills, and loading states.
- Scoped the connector stylesheet’s PDF/light polish selectors to `.source-dashboard:not([data-mode="dark"])`. Their light-mode values are retained; they no longer override dark mode.
- Kept existing routes, data, statuses, ordering, progress calculations, handlers, dimensions, and breakpoints unchanged.

## Affected components and route coverage

The shared dark theme in `source-dashboard.css` is scoped to the existing `.source-dashboard[data-mode="dark"]` shell, which renders all 28 active `PageId` routes: Overview; Products and Product Details; Sales & Orders and Order Details; AI Assistants; Train AI; Bot Behavior; AI Playground; Knowledge Base and Knowledge Source Details; Website Crawler and Crawl Details; Agent Builder; Integrations; Shopify Integration and Sync Monitor; Widget Installation and Appearance; Conversations; Human Handoff and Handoff Case; Handoff Rules; Analytics; Billing and Billing History; Settings; Team & Permissions.

This patch directly corrected the crawler source rows and nested Shopify/connector surfaces. Shared dark rules continue to cover common cards, tables, forms, navigation, progress elements, charts, chat surfaces, menus, and overlays across the route inventory.

## Light mode and responsive behavior

- Light-mode crawler row values are unchanged.
- Connector polish values are unchanged within the dashboard light theme; the selectors now explicitly apply only when `data-mode` is not dark.
- No geometry or breakpoint declarations were changed.
- Responsive behavior was not visually tested.

## Verification

- Static source inspection confirmed the active crawler component uses `.crawl-row` and identified its hardcoded white background as the exact row rule.
- Static inspection confirmed dark selectors use the established `.source-dashboard[data-mode="dark"]` theme state and semantic variables.
- No browser session/computed-style inspection tool was available in this session. No screenshot comparison, contrast measurement, build, or tests were run. Therefore light-mode pixel equivalence and rendered contrast remain unverified.

## Files changed

- `frontend/src/dashboard-source/source-dashboard.css`
- `frontend/src/pages/saas/connectors-page.css`

