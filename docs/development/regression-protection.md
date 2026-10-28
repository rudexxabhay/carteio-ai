# Regression protection and safe phase gates

This procedure applies to the approved Phase 00–11 roadmap. The authoritative observed results are in [phase-00-verification.md](phase-00-verification.md), not historical green UI indicators or earlier implementation summaries.

## Preconditions and safe commands

The final observed baseline contains 687 passed/116 failed backend assertions, 158 passed/85 failed frontend assertions, 7 passing local HTTP integration assertions and 3 passing guard assertions. This records current behavior and test debt; no failed case may be treated as a pass. See the latest assertion ledgers for exact identities.

Use the Node 24 runtime and the already installed dependencies for the checkout's OS. The observed checkout is a Windows-mounted path with absolute pnpm symlinks containing `Desktop`; do not replace dependencies or rewrite these links as part of Phase 00. A slow or blocked runner is a verification dependency, not a passing test. The initial broad frontend attempts timed out; file-scoped batches later produced completed reports for all 32 files. If a full run hits its time bound, run the remaining files in bounded batches with separate JSON reports; retain every original failure and do not overwrite it with a filtered pending result.

Inspect `package.json`, both package scripts, `backend/jest.config.js`, `backend/test/jest-e2e.json`, `frontend/vite.config.ts`, `frontend/src/tests/setup.ts`, and relevant specs before running. Root `pnpm test`, root `pnpm typecheck`, backend `dev` and backend `build` trigger Prisma generation. Do not use them under the Phase 00 restrictions. No dependency install, generation, migration, application build, server, crawler, Shopify sync, live DB or paid provider call is authorized by these commands.

From `backend`, run the safe unit suite (the normal Jest config discovers `.spec.ts`, not `.e2e-spec.ts`):

```sh
node node_modules/jest/bin/jest.js --config jest.phase00.config.cjs --runInBand --json --outputFile=/tmp/carteio-phase00-backend.json
```

From `frontend`, run the component/API-client suite with the guard preloaded in the runner and its workers:

```sh
node --require ../scripts/phase00/offline.cjs node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1 --minWorkers=1 --reporter=verbose --reporter=json --outputFile.json=/tmp/carteio-phase00-frontend.json
```

Verify the guard itself from the repository root:

```sh
node --test --test-isolation=none scripts/phase00/offline.test.cjs
```

`--test-isolation=none` is required here because the socket guard also blocks the default Node test reporter's child-process communication. It ensures the three individual assertions are actually reported. A file-level exit code without assertion counts is insufficient evidence.

The test-only guard refuses unmocked fetch, HTTP/HTTPS, TLS and socket connections, including paid APIs and live database drivers. Tests must install deterministic fixtures. The frontend uses the threads pool to avoid child-process socket communication under this guard; the first default-pool run timed out without a final report. The guard does not load environment files or modify application configuration. A mocked outbound call proves request construction and response handling only. Never treat it as a real provider/Shopify/database PASS. Worker lifecycle tests instantiate mocks; they do not start the application's background worker entry points.

For a focused change, append `--runTestsByPath` and exact Jest spec paths, or exact frontend spec paths after `vitest run`. Keep the network guard active. On Linux, an outer `timeout` may bound the command; record exit 124 as BLOCKED, never as test success. On Windows, use the same Node commands and an equivalent runner timeout. Do not automatically install missing native packages.

HTTP e2e tests in `test/health.e2e-spec.ts` create a Nest test application with the database disabled and use Supertest. They were inspected and explicitly attempted as a local, database-disabled HTTP integration harness (E1 in the verification record). They do not start a development server, instantiate live business services or use the guarded unit config, which intentionally blocks all sockets. Database-backed integration, browser deployment smoke checks, Shopify synchronization and actual paid model questions need separately authorized test environments.

## Protection targets

| Existing behavior | Meaningful regression boundary | Specs to retain |
|---|---|---|
| OpenRouter/Gemini | Endpoint/model/request payload, structured/tool protocol, response parsing, safe errors and cancellation | `backend/test/conversation-provider.spec.ts` |
| Shopify product operations | Same-tenant active assistant, scopes and workspace/assistant permissions, real normalized fixture records, field masking, price constraints and stale/version checks | `backend/src/modules/workspaces/connectors/commerce-read-contracts.service.spec.ts`, `platform-commerce.adapters.spec.ts`, `shopify-granted-scope-discovery.service.spec.ts` |
| Product tool -> cited answer | Validated model tool request, actual returned fixture attributes/variants, provider evidence, citation/grounding, follow-up context; anonymous order request denied | `backend/test/assistant.playground.spec.ts`, `backend/src/modules/workspaces/conversation-orchestrator.customer.spec.ts` |
| Knowledge/source access | Public visibility, active source/generation, collection/direct/default policy, tenant/assistant scope, lexical and optional semantic behavior | `backend/test/knowledge-processing.spec.ts`, `knowledge-base.service.spec.ts`, `knowledge.service.spec.ts`, `backend/src/modules/workspaces/knowledge-public-website.spec.ts` |
| Knowledge 404 | Actual browser API functions resolve to Nest method/path metadata with AuthSessionGuard; website sync/status and base/effective-knowledge endpoints | `backend/test/phase00-api-contracts.spec.ts`, `knowledge-controller.routes.spec.ts`, frontend `knowledge-api-routes.test.ts` |
| Bot Behavior | Full persistence/reload; saved settings and validated contacts in outbound provider messages, not just a successful save | `backend/test/assistant.service.spec.ts`, `assistant.playground.spec.ts`, frontend `phase00-active-behavior.test.tsx`; legacy training tests remain distinct |
| Conversation memory/persistence | Assistant/session/user/channel binding, history revalidation, idempotency, locking and persistence-boundary invalidation | `backend/test/assistant.playground.spec.ts`, `conversation-context.spec.ts`, customer orchestrator spec |
| Grounding | Correct sourced numbers/currencies/references accepted, unsupported claims/unknown citations/private live claims rejected | `backend/test/grounded-answer-plan.spec.ts`, `response-safety.spec.ts`, product/citation cases in Playground |
| Workspace owner/tenant isolation | Backend lowercase owner/currentUserRole survives actual browser client; another user's tenant read fails; frontend clears old account data | `backend/test/phase00-api-contracts.spec.ts`, `workspace.service.spec.ts`, frontend `phase00-workspace-isolation.test.tsx`, `auth-bootstrap.test.tsx` (legacy switching test remains recorded separately) |
| Agent Builder | Validated graph save/load with stable handles and tenant scope; existing runtime node, condition and trace assertions | `backend/test/phase00-flow-storage.spec.ts`, `backend/src/modules/workspaces/flow.service.spec.ts`, frontend `chatflow-builder.test.tsx` |
| Widget | Exact origin and assistant binding, signed/expiring session, unauthorized-origin and token rejection, persisted appearance | `backend/src/modules/workspaces/widget.service.spec.ts`, widget controller/source/retention specs, frontend `widget-runtime.test.ts`, `widget-installation.test.tsx` |

The new contract tests run the real frontend client modules after an in-memory TypeScript test transform and compare emitted method/path pairs with real Nest decorator metadata. Only the HTTP transport is substituted. They do not claim HTTP route mounting or DTO validation at a running server. The graph round-trip test uses a deterministic SQL-boundary store: it checks serialized node/edge configuration and cross-tenant get rejection; deployed SQL constraints remain a separate verification dependency.

Some frontend specs exercise legacy components no longer selected by AppRoutes. Retain them, but use the active `dashboard-source` tests for release decisions. Coverage existence and test PASS are separate columns in the capability inventory.

## Non-destructive checkpoint and rollback

Before Phase 00 edits, the branch was `uat`, HEAD `3928901f24aad1f82919c10b901dd03b32b0535b`, with 88 tracked changed/deleted entries and 368 untracked files. A mode-0700 local checkpoint exists at `/tmp/carteio-phase00-20261024T072637Z`:

- `git-status-before.txt` / `.z`: exact initial status, including deleted paths.
- `tracked-before.patch`: HEAD-to-working-tree tracked patch excluding private environment files.
- `source-before.tar.gz`: 523 source/config/test/doc files, including untracked source work.
- `source-sha256-before.json`: checksums for those files.
- `metadata.json`: timestamp, commit and exclusions.

Private environment files, credential directories, dependencies, symlinks and binary design assets are deliberately excluded. This is a source checkpoint, not a backup of secrets or all workstation files. `/tmp` is ephemeral; preserve the checkpoint in approved private storage before environment teardown. Do not commit it or raw private environment files.

Rollback does not start with `git reset`, `clean`, `checkout`, `restore`, `stash` or a branch switch. Extract the archive into a separate review directory; compare only phase-owned files with the checkpoint and the phase's file manifest. Reapply selected original hunks manually after checking for concurrent edits. For newly added Phase 00 files, review and remove only those files if a rollback is requested. Never remove other untracked files. Validate the resulting diff and rerun the affected guarded suites. No rollback was performed in this phase, and no commit or push was created.

## Required process for every future phase

Before changing code, record branch/HEAD/dirty state and checkpoint, affected modules and active routes, current working behavior, exact protection tests and their current pass/fail/blocked counts, API/DTO/security boundaries, and known carried defects.

After each meaningful change, run focused tests, related regressions and affected browser/backend contract checks. Verify tenant, role, visibility and origin boundaries. Compare assertion identities and results against the recorded baseline, not just total counts. Distinguish new failures, existing failures, unavailable infrastructure and deliberately untested external behavior. Retain exact commands, exit codes and sanitized reports.

If a regression appears, stop unrelated development, identify the introducing change, repair it within the current approved phase, and rerun the relevant tests. Do not disable, skip, broaden mocks to hide real boundary failures, delete, weaken assertions, or change production behavior just to make tests green. Test syntax/fixture/metadata defects may be repaired transparently while retaining the behavioral assertion; preserve the original failure evidence and rerun.

At the phase gate, record VERIFIED_PASS, BLOCKED or FAILED with every unmet criterion. Unrelated pre-existing defects can have a future target phase, but missing mandatory baseline evidence stays BLOCKED. A production behavior change requires the user-approved phase scope; Phase 00 does not authorize it. Later phase entry requires explicit approval after review of this baseline and its carried defects.


## Permanent change rule (Phase 00 continuation)

Before every change, record the current baseline and identify working capabilities, affected API/service boundaries, existing regression tests, authorization and tenant rules. After every change, run affected and related suites, check backend/frontend contract compatibility and security scope, compare assertion identities with the recorded baseline, and resolve new regressions before continuing. Keep historical evidence immutable; record commands, exit codes, counts and sanitized results in the existing evidence directory. Do not disable or weaken valid assertions, remove working features, change provider settings, or add merchant-specific hardcoded chatbot behavior.
