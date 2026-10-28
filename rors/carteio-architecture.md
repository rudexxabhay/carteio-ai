# Carteio architecture and preservation map

Date: 2026-10-18

## Existing application

Carteio is a React 18/Vite frontend and NestJS backend monorepo with Prisma persistence. The frontend uses React Router and `lucide-react`. The workspace route tree is in `frontend/src/routes/AppRoutes.tsx`; the shared workspace shell and navigation are in `frontend/src/layouts/DashboardLayout/DashboardLayout.tsx`.

The repository already contained extensive modified and untracked work before this task. Those changes cover workspace/business UI, auth, AI, knowledge, crawlers, connectors, Shopify, conversations, widgets and database migrations. They are user work and were preserved. No cleanup or backup copy was made because no deletion was performed.

## Reusable systems

- Authentication and opaque session behavior: `backend/src/modules/auth/`, `frontend/src/pages/auth/AuthPages.tsx`, `frontend/src/app/providers/AuthProvider.tsx`.
- Assistant configuration and playground: `backend/src/modules/workspaces/assistant.service.ts`, `frontend/src/services/api/assistants.ts`, `frontend/src/pages/assistants/AssistantPages.tsx`, and `frontend/src/pages/training/PlaygroundDialog.tsx`.
- Provider orchestration: `backend/src/modules/workspaces/conversation-provider.service.ts` and `conversation-orchestrator.service.ts`.
- RAG and knowledge processing: `knowledge-processing.service.ts`, `knowledge-indexing.ts`, `knowledge-context-builder.ts`, and `knowledge-base.service.ts` under `backend/src/modules/workspaces/`.
- Website crawling and sync: `website-crawler.ts`, `website-sync.ts`, and related verification/renderer services in the same module.
- Shopify and connector authorization: `backend/src/modules/workspaces/connectors/` and associated workspace services.
- Existing workspace-scoped API clients: `frontend/src/services/api/`.

More specific preservation boundaries identified during the audit:

- Keep `backend/src/modules/auth/**`, CSRF/session middleware, password/email OTP flows, Google identity validation, cookie settings, and auth schemas/migrations unchanged. Only auth screen presentation is replaceable.
- Keep `backend/prisma/schema.prisma`, every migration, and persisted workspace, assistant, knowledge, connector, widget, inbox, ticket, commerce, and business workflow records. Never repurpose the business approval `WorkflowExecution`/`WorkflowStep` models as graph storage.
- Keep provider/orchestration, RAG/indexing/retrieval, knowledge storage, website crawler/sync/renderer, Shopify OAuth/scope and connector permission services, widget runtime, conversation and ticketing services as linked functional units.
- Candidate UI replacements include landing sections, workspace shell/dashboard, assistant/training/knowledge pages, and SaaS presentation pages. Their authenticated API contracts and deep links still need equivalents before any removal.
- Placeholder information routes can be replaced by real product pages or redirected, after reviewing their inbound links. No dependency was proven unused.

## Builder gap

The audited code has no generic visual graph editor, node registry, graph persistence API, or general AI workflow runtime. Prisma `WorkflowExecution`, `WorkflowStep`, and `WorkflowApproval` represent business action workflows and are not a visual agent graph schema. The frontend package has no graph canvas dependency. Adding persistent graph execution safely requires a deliberate schema/API design and migration, which this task forbids running without approval.

The current work adds a separate `FlowDefinition` model with a workspace and assistant relation, graph JSON, and version field; matching migration SQL; and authenticated flow CRUD/run APIs with graph validation. The initial runner supports a linear input → assistant → response graph; its assistant step delegates provider, retrieval, and safety behavior to the existing conversation pipeline. This is source-only until the migration is approved and applied. It does not reuse or alter the business workflow approval tables.

## Current verification boundary

No builds, servers, tests, migrations, dependency installs, or deployments have been run. The public Flowise application was not accessible for authenticated inspection. A feature-by-feature parity claim would be unsupported by current evidence.
