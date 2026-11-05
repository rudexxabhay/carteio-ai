# Playground metadata capture toggle — 2026-11-03

## Scope and baseline

This is a limited correction to the existing Playground Inspector. The repository was already dirty before the edit; the initial `git status --short` inventory is preserved at `/tmp/carteio-ai-inspector-shopify-checkpoint/status-before.txt`. Initial HEAD: `3dbf9b43f6ad9ec50737e7fe060a9ac903f6ed90`. Source copies and SHA-256 values for the two edited files are in `/tmp/carteio-ai-inspector-shopify-checkpoint/`.

Affected caller/contract: `frontend/src/dashboard-source/pages.tsx` passes the optional `diagnosticCapture` boolean through the existing Playground streaming and fallback requests. Backend `playgroundDevelopmentCaptureEnabled()` continues to require the existing development diagnostics gates; this change does not broaden access or capture raw prompts/responses. The active Inspector remains owner/admin gated.

Pre-change assertion identity in `frontend/src/tests/playground-live-flow.test.tsx`: “opts an owner into metadata capture for exactly the next request”. It required the checkbox to clear after the first request, the second request flag to be false, and asserted the first request flag was true. Pre-change source cleared capture state at the start of every send. This encoded one-turn behavior is replaced with a persistent-until-disabled current-session assertion.

## Change

The existing checkbox is labeled `Capture Metadata`. While enabled, its value is passed to every subsequent message, including retries, until explicitly unchecked. Creating a new Playground session or changing workspace clears the in-memory value. No new Inspector, storage table, API route, environment variable, or migration was added.

## Verification

Authored/updated assertions check enabled capture on the first and second messages, disabled capture after explicitly turning the toggle off, and reset when starting a new chat. These are source assertions only: the test was **NOT RUN** as explicitly required. No command exit code, pass count, or runtime behavior is claimed. Builds, typechecks, other test suites, servers, migrations, and external calls were not run.

## Limits / remaining work

This change only fixes the accidental one-message reset in the current mounted Playground. Capture preference is not server-persisted and does not survive refresh/reopen. Detailed capture remains subject to the existing development-only backend gate. This work does not add durable per-attempt trace storage, historical trace retrieval, complete input/output JSON for every stage, trace pagination/retention, or a durable failure trace after request termination. It does not implement the Shopify API Test Playground or its live read backend. Those requested acceptance areas remain incomplete and unverified. Phase 00 remains BLOCKED; its historical verification evidence was not edited.
