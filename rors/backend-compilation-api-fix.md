# Backend compilation and API connection fix

Date: 2026-10-18

## Root causes

1. `AuthenticatedRequest.requestId` is intentionally optional in the Express/Nest request contract, while `FlowService.run` requires a concrete request ID for downstream tracing. The flow controller forwarded the optional value without handling absence.
2. `AssistantService.playgroundChat` returns a union of response variants. AI-generated variants include provider/model metadata, while system-generated variants do not. `FlowService` accessed those fields directly on the union.
3. Vite proxied `/api/v1` to `http://localhost:5000`, while Nest's default development host is IPv4 loopback (`127.0.0.1`). On environments where `localhost` resolves to IPv6 first, that can refuse connections even when Nest listens on IPv4. Also, at the time of diagnosis neither local frontend nor backend server was listening; any proxy target necessarily refused connections.

## Changes

- `backend/src/modules/workspaces/flow.controller.ts`: pass `request.requestId` when present, otherwise generate a UUID. No assertion or non-null operator is used.
- `backend/src/modules/workspaces/flow.service.ts`: narrow the assistant response union using the `in` operator. Include provider/model metadata only when the returned variant contains it; preserve metadata values for AI-generated responses and omit it for system responses.
- `frontend/vite.config.ts`: target `http://127.0.0.1:5000`, matching Nest's default development bind address and configured backend port.
- `backend/src/modules/workspaces/flow.service.ts`: corrected duplicate condition/response trace entries found by the regression test. This changes trace bookkeeping only; branch execution and assistant output are unchanged.
- `backend/src/modules/workspaces/flow.service.spec.ts`: cover both absent metadata and provider/model metadata preservation; align graph validation assertion with the full validated graph.

## Verification

- Backend `tsc --noEmit --pretty false`: passed with **0 errors**.
- Direct Nest CLI production compile (`node node_modules/@nestjs/cli/bin/nest.js build`): passed. It was run directly because the package build script first runs Prisma generation.
- Flow service Jest spec: **14/14 passed**, including both response-union cases and ordered trace behavior.
- Freshly built Nest API started from `backend/dist/main.js` and `/api/v1/health` returned HTTP 200.
- Through Vite's proxy, unauthenticated `GET /api/v1/auth/me` returned the expected HTTP 401 `UNAUTHORIZED`; `POST /api/v1/auth/google` with an empty body and an allowed development origin returned the expected HTTP 400 `VALIDATION_ERROR`. These confirm the requests reach Nest and no longer fail with `ECONNREFUSED`. No cookie, Google credential, OTP, or account data was sent.
- The temporary `http://127.0.0.1:3002` origin correctly received HTTP 403 `CSRF_REJECTED` because it is not configured in the existing allowlist. The allowed `http://localhost:3000` development origin reached the endpoint and received the DTO validation response. Auth/CSRF policy was not weakened.
- `git diff --check`: passed.

## Environmental notes

- Prisma client generation was attempted but could not download Prisma's schema engine because DNS/network access to `binaries.prisma.sh` returned `EAI_AGAIN`. No dependencies were installed and no migrations were run. The direct Nest compile and local API startup succeeded with the existing client/runtime artifacts.
- A successful Google sign-in cannot be verified without a real authorized identity credential. Google login, email OTP, session behavior, and password authentication implementation were not changed. No DB migrations or data writes were performed by these checks.
