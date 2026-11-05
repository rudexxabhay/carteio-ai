# Raw model output and validation diagnostics — 2026-11-03

## Scope and source baseline

Implemented globally at the shared `ConversationOrchestrator.callSelectedProvider` → `ConversationProviderService` adapter boundary. Source inspection found one shared chat-completions adapter boundary (`OpenRouterProviderAdapter`); all current orchestration purposes, compatibility retries, intent repairs, tool follow-ups and citation recovery use the shared invocation wrapper. Existing conversation-scoped Playground capture and protected diagnostic retrieval remain authoritative. Widget provider calls use the same orchestration path, with a new durable owner/admin-managed preference on the existing `SupportConversation` row.

Before edits, read `lastwork.md`, `docs/development/phase-register.md`, and `docs/development/phase-00-verification.md`. A focused pre-edit copy of the primary implementation files is at `/tmp/carteio-raw-llm-checkpoint/`. `timeout 3s git status --short --untracked-files=no` exited 124 without output; the complete pre-existing dirty inventory therefore could not be established. Existing modifications were preserved by editing only the scoped source/test/docs files listed below. Phase 00 historical evidence and status remain unchanged/BLOCKED.

## Implementation

- Provider output hook runs after successful provider envelope decoding and before provider safety/shape checks, orchestration parsing, validation or repair. It captures sanitized returned text (or explicit empty/tool-call/no-content status), actual provider/model, request/trace/call correlation, purpose, stage, duration, finish reason, HTTP status, usage and bounded sent-request representation. System prompt bodies are explicitly omitted; request history omissions, redaction and caps are labeled. Provider/transport failures before output are separately recorded without capturing provider HTTP bodies.
- Each call is stored separately, bounded to 20 calls/300 KB per model-call set, 8 KB returned content per call, 8 sanitized request messages with per-message caps, validation sections bounded to 4 KB each, and legacy protected material to 12 records × 8 KB. Omitted call count and output/request truncation are explicit. Durable trace payload remains subject to the existing 500 KB cap and configured 1–24 hour retention window.
- Sanitization occurs before truncation and redacts authorization/credential patterns, credential-bearing URLs, emails, phone numbers, addresses and customer/order identity fields in JSON representations. Records are labeled as sanitized representations, never byte-for-byte raw.
- Interpretation validation preserves strict acceptance and adds precise JSON path/code/expected/received type/value diagnostics; `questionSpan` substring failures include `INVALID_SPAN`. Optional semantic metadata failures are labeled as nonblocking and retain their path/detail. Parsed JSON, original model content, repair calls, effective interpretation and final response validation decisions are kept separately.
- Playground protected model output/validation events are emitted over the authenticated Playground SSE callback only when capture is authorized and enabled. The Widget channel never emits protected data to public responses or SSE. Widget trace data and capture settings remain available only via owner/admin routes scoped to organization, assistant, conversation and channel.
- The existing upper LLM & Tools Inspector and lower terminal display protected call data; terminal gets the real authorized SSE output/validation events immediately and persisted records hydrate after completion. Copy/export now keeps redacted protected records from authorized diagnostic pages; existing pagination and explicit size-limit completeness markers remain.
- Widget Capture Metadata is persisted on `SupportConversation`. Migration `20261103190000_widget_diagnostic_capture_consent` was authored, not executed. `backend/VERCEL.md` documents the authorized UAT capture window and production-off policy.

## Files changed

Backend: `backend/src/modules/workspaces/conversation-provider.service.ts`, `conversation-orchestrator.service.ts`, `conversation-intent.ts`, `playground-diagnostics.ts`, `assistant.controller.ts`, `assistant.service.ts`, `backend/prisma/schema.prisma`, and the new migration above.

Frontend: `frontend/src/dashboard-source/pages.tsx`, `playground-dev-console.css`, `frontend/src/services/api/assistants.ts`, `frontend/src/pages/training/playground-copy.ts`.

Tests: `backend/test/conversation-provider.spec.ts`, `backend/test/conversation-intent.recovery.spec.ts`, `backend/src/modules/workspaces/playground-protected-debug.spec.ts`, `conversation-orchestrator.widget-diagnostics.spec.ts`, and `frontend/src/tests/playground-live-flow.test.tsx`.

Documentation: `backend/VERCEL.md`, this evidence record, and `lastwork.md`.

## Verification and limits

Authored regression assertions cover provider callback timing, exact validator path/value, redaction/bounds/missing content, local/UAT gating, separate original/repair calls, bounded validation enrichment, retention expiry, Playground-only protected SSE, Widget consent scoping, terminal hydration/display and Inspector validation rendering. No tests, builds, typechecks, migrations, installs or background processes were run, as explicitly instructed. `git diff --check` was started but did not return within the command session and was interrupted (exit 130); no result is claimed. Browser, backend/database, migration application, protected endpoint authorization under runtime, UAT and provider behavior remain unverified.

UAT values for an explicitly approved capture window: `APP_ENV=uat`, `PLAYGROUND_DIAGNOSTICS_ENABLED=true`, `PLAYGROUND_RAW_DEBUG_ENABLED=true`, `PLAYGROUND_TRACE_RETENTION_HOURS=24`. Capture still requires authenticated owner/admin access and the conversation-scoped toggle; turn the raw flag off after the window. Public production keeps `PLAYGROUND_RAW_DEBUG_ENABLED=false`.

Final status: **IMPLEMENTED_NOT_VERIFIED**. Phase 00 remains **BLOCKED**.
