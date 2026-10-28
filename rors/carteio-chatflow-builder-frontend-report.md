# Carteio AI Chatflow Builder frontend report

## A. Existing implementation

The active dashboard route is the `builder` page in `frontend/src/dashboard-source/SourceDashboard.tsx`, rendered through the page switch in `frontend/src/dashboard-source/pages.tsx`. That route previously showed a paused-feature placeholder. A separate, older `FlowBuilderPage` existed under `frontend/src/pages/flows/`; it depends on `useWorkspaceRoute` and is not used by the active source-dashboard route.

The existing Flow API client is `frontend/src/services/api/flows.ts`. It supports listing, creating, updating (optimistic version), deleting and running flows. Its graph supports only `start`, `transform`, `assistant`, `condition`, `knowledge` and `response` nodes. No publish endpoint or persisted flow description/runtime settings are available. `listAssistants` provides assistant selection.

## B. Active route/component architecture

The existing global dashboard shell and navigation remain in place. The active builder route now renders `ChatflowBuilder` inside the existing page content region. The component receives the current workspace slug, name and role from the dashboard page props; it does not add another application sidebar or header.

## C. Implemented workspace structure

Added a compact builder toolbar, independently scrolling Node Palette, interactive center canvas and Live Bot Test drawer. The chat drawer starts closed. The node inspector opens when a canvas node is selected and remains independent of chat state. CSS is scoped under `.chatflow-builder` and uses the dashboard's `data-mode="dark"` ancestor for dark mode.

The screenshot file named in the request was not available in the workspace during implementation, so exact pixel matching against the bitmap could not be checked. The implementation follows the requested three-region composition and written visual details.

## D. Files created/modified

- `frontend/src/dashboard-source/ChatflowBuilder.tsx` — builder state, API integration, node editor and chat drawer.
- `frontend/src/dashboard-source/chatflow-builder.css` — scoped light/dark styling and responsive rules.
- `frontend/src/dashboard-source/pages.tsx` — active builder route now mounts the new component.
- `frontend/src/tests/chatflow-builder.test.tsx` — focused frontend regression tests, added but not executed.

No backend files were changed as part of this builder task.

## E. Node palette and graph editing

The palette contains Start, Message, AI Assistant, Knowledge Search, Shopify Product Search, Condition, API, Human Handoff and End. The initial unsaved example shows a message step, product-intent True branch and knowledge-search False branch, ending in distinct response paths. Unsupported Shopify Product Search, API and Human Handoff items are disabled and labeled Preview; they cannot enter the persisted graph. Start is limited to one per graph.

Supported operations include click-to-add and drag/drop add, pointer node movement, node selection/configuration, connect/disconnect (including ordered True/False condition branches), delete, duplicate, undo/redo, keyboard undo/redo/delete/escape, zoom, fit and canvas panning. The initial unsaved demonstration graph includes a visitor-message step and two condition branches; it is not written to the database until Save. Edges are rendered from live node positions in a transformed SVG canvas. Draft edits are retained in workspace/assistant-scoped local storage and unsaved changes trigger the browser's before-unload warning. Multi-select is not implemented in this lightweight canvas.

## F. Live Bot Test behavior

The drawer is closed initially and opens/closes from the floating lower-right launcher or its own header. Conversation messages remain while the drawer is closed and reopened; changing assistant selection clears the conversation to avoid mixing assistant sessions. Messages are sent only through the existing `runFlow` endpoint for a saved, unchanged flow. Replies and failures display the actual API result; a failed run leaves the graph rendered. The panel identifies itself as a flow test and does not claim online presence.

## G. Save, draft and publish integration

New flows use `createFlow`; existing flows use `updateFlow` with the current version. Save states reflect loading, dirty, saving, failed and clean states. Failed saves retain the edited graph and show the returned error in a dismissible, timed notification with retry. Local recovery is best effort. The Publish action is absent from the toolbar because the current API has no publish lifecycle. The Flow API also has no persisted description or saved-flow assistant reassignment, so the settings panel reports those limits instead of implying persistence.

## H. Responsive and performance implementation

The builder route fills the dashboard content region below the existing global header, with route-scoped zero-padding and bounded flex/overflow sizing; other dashboard pages retain their existing page spacing. The palette search is a compact 40px control with clear and no-match actions. At tablet/laptop widths, the palette and inspector narrow and chat overlays the canvas; at mobile widths the chat becomes a full-screen sheet and the palette remains compact. Canvas size is preserved while opening chat. Transitions are short and reduced-motion preferences are honored. Node/chat state is contained within the builder component; no new dependency or animation loop was added.

Responsive CSS breakpoints are present, but browser rendering was not available for viewport-by-viewport verification.

## I. Backend/API limitations

- No publish endpoint or published/draft lifecycle exists in the current Flow API.
- Shopify Product Search, API and Human Handoff nodes are not supported by the current persisted graph contract and are marked Preview only.
- Flow descriptions and saved-flow assistant reassignment are not supported by the current update contract.
- The runner must be used with a saved flow; unsaved edits cannot be tested.

## J. Verification and regression tests

Added 29 focused tests for builder rendering, intended toolbar actions, palette inventory/filter/empty state, unsupported-node handling, click/drag add, selection, movement, connection removal, deletion, undo/redo, zoom/fit, graph serialization, create/update save behavior, save failure retention/retry, floating chat launcher default/open/close/preservation, run success/failure, loading errors and responsive structure.

Tests, builds and servers were not run, as requested. No browser/computed-style session was available, so light/dark rendering, actual viewport behavior, screenshot comparison and runtime interaction remain unverified.

## K. Manual browser verification

Open a workspace dashboard, choose **Train AI → Agent Builder**, and confirm the workspace fills the area under the global topbar. Search for a node, add/connect one, and save; force a save error to verify the retry notification retains the edit. Use the floating chat launcher to open/close Live Bot Test and confirm conversation history and graph state persist. Inspect at 375px, 768px and 1440px widths. Confirm unsupported palette entries remain non-interactive and Publish is absent from the toolbar.

## Final classification

**FRONTEND_PARTIAL** — core builder source and tests are present; multi-select and browser/screenshot verification remain outstanding. Tests and runtime checks were intentionally not performed. This is not `RUNTIME_VERIFIED`.
