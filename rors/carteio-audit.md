# Carteio repository audit

Date: 2026-10-18

## Scope and safety

This is a source-tree audit only. No product source was edited, no environment file was opened, and no build, test, development server, migration, dependency installation, or cleanup was run. The working tree is already heavily modified: `git status --short` showed many modified tracked files and a large number of untracked frontend/backend modules, migrations, tests, docs, and assets. This report does not attribute those changes to a particular author or reset them. Treat them as user work and preserve them. `rors/` itself was untracked at audit time and already contained the reconstruction notes listed in its README.

## Stack and product structure

- Monorepo with React/Vite frontend (`frontend/`), NestJS backend (`backend/`), Prisma schema/migrations, shared packages, widget, integration and infrastructure folders.
- Root package scripts include dev, typecheck, lint, test, build, and format commands; none were invoked.
- Public/auth/workspace routes are centralized in `frontend/src/routes/AppRoutes.tsx`. Authentication is routed through the existing `AuthLayout`, `AuthPage`, `RequireAuth`, and `AuthProvider` paths.
- Workspace shell/navigation is in `frontend/src/layouts/DashboardLayout/DashboardLayout.tsx`. The workspace routes cover dashboard, team, builder, settings, integrations, products, orders, sales, conversations, tickets, widget, billing, assistants, training, knowledge, and assistant detail.
- Landing composition lives in `frontend/src/pages/landing/`, with shared public header/footer and product landing CSS. Its current design/content evidence and runtime verification limits are already recorded in `rors/implementation-status.md` and `rors/reconstruction-report.md`.

## Existing builder implementation

The builder route is `/workspace/:slug/builder`, rendered by `frontend/src/pages/flows/FlowBuilderPage.tsx` and styled in `flow-builder.css`. It uses a custom absolute-positioned canvas and SVG connection paths, with pointer-based node movement, node selection/configuration, explicit output-then-input connection, conditional True/False ports, node removal, zoom/fit, import/export, local recovery, saved flow selection, and a run panel. It is not using ReactFlow or a generic node-schema/registry package. The current editor's node kinds are `start`, `transform`, `assistant`, `condition`, `knowledge`, and `response`.

The authenticated API client is `frontend/src/services/api/flows.ts`. Backend routes are in `backend/src/modules/workspaces/flow.controller.ts`, with validation and execution in `flow.service.ts`, registered through the workspace module. The API provides workspace-scoped list/get/create/update/delete/run. Create/update/delete/run require manager access; reads are scoped by workspace membership. Saves use expected-version optimistic concurrency. The graph validator bounds nodes/edges and serialized size, validates node and edge IDs, rejects duplicate edges and cycles, and the runnable topology currently requires one start, assistant execution on every path, and response leaves. Branch merges and loops are explicitly unsupported.

The executor reuses existing assistant orchestration for provider selection, conversation persistence, RAG/safety, and cancellation propagation. Knowledge Search uses the existing permission-filtered preview but currently returns diagnostic retrieval evidence; it does not bind retrieved content into a downstream prompt. Execution timings and skipped-node IDs are request-scoped; durable run history and provider token streaming are not implemented. These limits are also documented in `rors/implementation-status.md` and `rors/flow-api.md`.

`FlowDefinition` was added to the Prisma schema and an additive migration exists under `backend/prisma/migrations/20261018100000_flow_definitions/`. The documentation says the migration has not been applied. Therefore source-level CRUD/run code is present, but server persistence is not available until the migration is separately approved and applied. The existing business `WorkflowExecution`/`WorkflowStep`/`WorkflowApproval` models describe business workflows and should not be conflated with visual agent graphs.

## Preserved systems and boundaries

The codebase contains active auth/session and OTP flows, assistant configuration/playground, provider orchestration, knowledge bases/indexing/retrieval, website crawling/sync, Shopify and connector adapters, widget, conversations/inbox, ticketing, and commerce services. The active backend auth module and its session, CSRF, OTP, password, and Google identity paths must remain intact; the task's UI redesign does not justify altering auth storage or session behavior. The existing knowledge and connector permission policies should remain the boundary for graph nodes. Existing workspace/business migrations and customer data must not be removed during UI replacement.

The exact preservation map is in `rors/carteio-architecture.md`. I did not inspect secrets, alter migrations, or perform cleanup. Destructive cleanup remains explicitly approval-gated by the user and must be preceded by a recoverable baseline.

## Safe high-value next implementation slice

**Recommendation: introduce an execution-context and typed node-output contract behind the existing version-1 runner, without expanding the public node catalog yet.** This is the architectural prerequisite identified by the reference notes for shared state, output bindings, streaming, durable checkpoints, and richer Agentflow-like execution. A bounded first increment can:

1. Define a versioned run context carrying input, flow-scoped state, typed outputs keyed by node ID, trace metadata, and cancellation signal.
2. Make the existing Chat Input, Message Template, Carteio Assistant, If / Else, Knowledge Search, and AI Response handlers consume/produce that contract while preserving current API response compatibility.
3. Add explicit branch-port identity to the internal edge representation or a migration-compatible normalization layer; today branch order is encoded by outgoing-edge order.
4. Keep execution request-scoped and acyclic in this increment; do not imply that loops, human checkpoints, generic tools, or token streaming work until their persistence and provider contracts are implemented.

This slice is high value because it improves the existing real execution path and creates a clean extension point instead of adding decorative node buttons. It can be implemented without changing auth or existing knowledge/provider services. Before writing implementation code, inspect current tests as source (do not run them under current constraints), preserve the current graph-v1 API, and decide whether any schema work is truly needed. If the implementation needs the existing `FlowDefinition` migration applied or a new migration, stop before database mutation and request approval; do not silently make deploy/runtime assumptions.

If immediate work should stay frontend-only, the lower-risk parallel slice is to replace canvas-local node-kind branching with a typed node catalog shared by node palette, inspector, validation copy, and serialization, while retaining the current graph/API behavior. This reduces editor drift without claiming a broader executor.

## Verification status

No runtime verification was performed as requested. Source-level evidence confirms the route, custom canvas, flow CRUD/run services, and pending migration described above. Current visual fidelity, responsive behavior, actual drag performance, Flowise runtime parity, and deployed migration state remain unverified. See the existing reconstruction notes for REA/provider limitations and official Flowise source/documentation references.
