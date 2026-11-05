# Temporary development tool notices — 2026-11-03

## Baseline and scope

The working tree already contained changes in all Inspector and Shopify Test Playground source/style files. A selective checkpoint of the seven touched frontend files is at `/tmp/carteio-dev-only-badge-checkpoint/`. Existing Shopify panel UI coverage was `shopify-api-test-playground.test.tsx`'s two read-only operation cases; the active dashboard Inspector shell has no dedicated component test in the current frontend suite. No auth, API, DTO, data, provider or customer response logic changed.

## Change

Added a compact `Development only · temporary` notice to the active dashboard Inspector, the Playground chat Inspector and the Shopify API Test Playground. Hover help says the temporary test surface will be removed once stable. Shopify's existing `Read only` label remains visible beside the new notice. Added a regression assertion for the Shopify panel notice.

## Verification

- TypeScript syntax parse: all four affected TSX files parsed successfully (`pages.tsx`, `PlaygroundChat.tsx`, `ShopifyApiTestPlayground.tsx`, and its test).
- `git diff --check` for the seven touched frontend files — exit 0.
- Focused command from `frontend/`: `timeout 60s node --require ../scripts/phase00/offline.cjs node_modules/vitest/vitest.mjs run src/tests/shopify-api-test-playground.test.tsx --pool=threads --maxWorkers=1 --minWorkers=1 --reporter=verbose` — exit 124, no output/assertion report. Test status is **NOT VERIFIED**, not a pass.

The badges are informational only. Owner should visually verify all three surfaces in local development; UAT verification was not performed.
