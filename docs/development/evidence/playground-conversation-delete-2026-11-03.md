# Playground conversation deletion — 2026-11-03

## Scope and preserved baseline

Implemented permanent deletion for a single authenticated user's Playground conversation. Before edits, inspected `lastwork.md`, the Phase 00 register/current verification, `regression-protection.md`, the active dashboard Playground, browser API functions, assistant controller/service/orchestrator, Prisma relationships, and existing Playground regression specs. Existing dirty work was left in place. `git status --short` did not return within the bounded 30-second inspection window, so a complete pre-edit dirty-file inventory could not be confirmed; no unrelated file was intentionally changed.

The assertion baseline was source-only, not executed in this task. Existing backend `assistant.playground.spec.ts` identities include supplied-session fail-closed/no-recreation, foreign user/assistant/organization/channel denial, owner/admin access, history, idempotency, and session lease tests. Existing active frontend coverage is `playground-live-flow.test.tsx`, which covers saved conversation restore and metadata capture. Existing assertions were preserved. New assertions are authored below and NOT RUN.

## Implementation

- Added `DELETE /workspaces/:slug/assistants/:assistantId/playground/sessions/:sessionId` to the existing `AuthSessionGuard`-protected controller with UUID validation.
- The orchestrator requires OWNER/ADMIN workspace access and an assistant scoped to that organization. In one transaction it selects the conversation by exact `(id, organizationId, assistantId, userId, channel=PLAYGROUND)` ownership, deletes only its Playground diagnostic traces and messages, and deletes the conversation row. Composite foreign keys also cascade owned children. Widget conversations and shared rate-limit rows are excluded.
- Replaced the native selector with a compact custom dropdown, keyboard up/down/Enter/Escape handling, title/date display, paginated “Load more conversations”, and an individual trash button that does not select its row. A cancel-first confirmation shows actual pending and failure states. The selector updates only after server confirmation.
- Deleting an active or currently opening conversation aborts stream/export work, invalidates stale UI callbacks, and resets messages, capture, trace, selection and Inspector state into a new unsaved chat. Deleting an older conversation filters only that selector entry. Existing supplied-session handling fails closed when the requested conversation no longer exists, preventing late requests from recreating its ID.
- The frontend API client invalidates coalesced GETs by path prefix after server-confirmed deletion. Only the matching Playground conversation history/traces and this assistant's session-list reads are cleared; UI generation guards ignore stale results without cancelling other conversations or Widget reads. The shared path-invalidation helper is narrowly scoped and existing session-wide invalidation behavior is unchanged.
- No schema migration is required. PostgreSQL removes the active rows; freed pages may be reused by PostgreSQL and no VACUUM/compaction is performed.

## Regression coverage authored (not executed)

- Backend `assistant.playground.spec.ts`: owner/admin check; exact tenant/assistant/user/channel predicates; scoped trace/message cleanup; denied lookup does not touch children. Controller and `phase00-api-contracts.spec.ts` cover DELETE method/path and AuthSessionGuard route binding.
- Frontend `playground-live-flow.test.tsx`: confirmation/cancel; active conversation reset after server-confirmed deletion; failed delete preserves active history and keeps the dialog open; deleting a loaded row decrements the next-page offset without changing the selected active chat. `api-client.test.ts` covers path-scoped pending-read invalidation while preserving other conversation and Widget reads. `phase00-api-contracts.spec.ts` now pairs the browser DELETE helper with the protected Nest route.

## Verification and limits

No tests, typechecks, builds, migrations, database operations, servers, or deployments were run. New assertions and browser behavior are therefore NOT VERIFIED. No migration was authored. Phase 00 historical evidence and BLOCKED status are unchanged. PostgreSQL runtime transaction behavior and browser accessibility/mobile behavior remain for local/UAT verification.
