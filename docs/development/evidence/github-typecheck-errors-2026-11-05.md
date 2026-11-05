# GitHub backend typecheck errors — 2026-11-05

## Scope and baseline

Owner-reported CI command was `pnpm --filter @carteio/backend typecheck` (`tsc --noEmit --pretty false`), exit 2. It reported two distinct diagnostics:

- `conversation-orchestrator.service.ts(1781,386)`: TS2448 and TS2454 because `unknownCitationRefs` was used before its `const` declaration.
- `playground-diagnostics.spec.ts(11,21)`: TS2345 because `TOOL_EXECUTION` was missing from `ConversationLifecycleStage`.

Before editing, `git status --short` showed 20 existing modified paths, including both reported files, contracts, tests, and documentation. Those edits were retained. Selective source checkpoint copied the three edited source files to `/tmp/carteio-github-typecheck-checkpoint/` before this correction. Existing branch/HEAD are not restated because this bounded fix did not require branch operations.

Affected behavior/contracts: the shared orchestrator emits allowlisted unknown-citation references in Playground diagnostics; `TOOL_EXECUTION` is already an observable lifecycle event in diagnostics and is asserted by the existing diagnostics spec. No authorization, tenant, provider, API DTO, retrieval, or customer answer behavior was changed.

Assertion baseline: the owner-provided CI diagnostics above are the pre-change typecheck baseline. The focused test baseline was not separately run before editing because the exact source compile failures were identified from CI; pre-existing dirty test changes remain part of this checkout.

## Correction

Moved the existing citation-reference helper declarations above the initial verification diagnostic call. Added the already emitted `TOOL_EXECUTION` value to `ConversationLifecycleStage`. No assertion was removed or weakened.

## Post-change checks

1. `cd backend && node node_modules/typescript/bin/tsc --noEmit --pretty false` — exit 2. The two owner-reported TypeScript failures are gone. Four remaining TS errors at `conversation-orchestrator.service.ts:2001,2010,2017,2024` report that generated Prisma `SupportConversation` types lack `diagnosticCaptureEnabled`. The field exists in `backend/prisma/schema.prisma` and migrations, indicating the checked-in/installed generated client is stale for this dirty checkout. Prisma generation was not run (restricted operation).
2. `cd backend && node --require ../scripts/phase00/offline.cjs node_modules/jest/bin/jest.js --config jest.phase00.config.cjs --runInBand --runTestsByPath src/modules/workspaces/playground-diagnostics.spec.ts src/modules/workspaces/conversation-orchestrator.service.spec.ts --json --outputFile=/tmp/carteio-github-typecheck-focused.json` — exit 1. The named orchestrator spec does not exist (actual focused specs are `conversation-orchestrator.customer.spec.ts`, `conversation-orchestrator.playground-failure.spec.ts`, and `conversation-orchestrator.widget-diagnostics.spec.ts`). Diagnostics suite: 28 passed, 2 failed. Existing dirty assertions failed on `protectedCaptureStatus` (`SERVER_DISABLED` vs `NOT_REQUESTED_OR_DISABLED`) and allowlisted commerce `reason` absent. These failures are unrelated to the declaration-order/type-union correction and are not represented as passes.
3. `git diff --check` — exit 2; it reports CRLF line endings as trailing whitespace across many already-modified files. The bounded check of the two changed source files likewise reports existing whole-file CRLF lines in `conversation.contracts.ts` (270 output lines); no bulk line-ending normalization was applied because it would rewrite the pre-existing dirty file. The new evidence/ledger text was appended without touching historical Phase 00 results.

No external services, database, migrations, generation, dependency operations, deployment, or provider calls were used. Phase 00 historical evidence and BLOCKED status remain unchanged. GitHub rerun is still required to confirm hosted CI; offline local evidence does not establish it.
