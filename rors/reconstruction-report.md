# CARTEIO AI — Flowise-inspired reconstruction report

Date: 2026-10-18

## Objective and current status

The product goal is a CARTEIO-branded AI platform with a polished public landing page, authenticated workspace, visual workflow design and execution, assistant testing, publishing, and integration management. The implementation is an independent Carteio codebase. This report makes no claim of exact Flowise parity: the hosted app could not be inspected, and Carteio's current flow executor supports a deliberately smaller feature set.

The repository already contains substantial ongoing Carteio work and a first functional workflow-builder slice. It is a React/Vite + NestJS/Prisma application, not a blank scaffold. Those existing edits are preserved. Worktree status at inspection showed numerous modified tracked files and untracked implementation files, migrations, tests, and documentation. No files were reverted or removed.

## Reference findings

### Public website

**Observed through the public page reader:** the homepage has a header for Features, Case Studies, Pricing, Community, Webinars, Docs, and Get Started; a visual-agent hero; customer logos; feature sections; case studies; pricing; community material; webinars; and a footer. The current page also announces Flowise's sunset. Its date and product details are recorded in [the reference investigation](flowise-reference.md).

### Product capabilities

**Documented, not live-app verified:** official Flowise materials describe Assistant, Chatflow, and Agentflow builders; agent/tool and retrieval workflows; human review; execution traces and analytics; API, SDK, CLI, and embedded chat; and cloud or self-hosted deployment. Agentflow V2 documentation additionally describes per-run shared state, branching, loops, streaming, human checkpoints, tools, and subflows. Official links are listed below and in [the reference investigation](flowise-reference.md).

### Runtime access limits

The public website and selected Flowise browser target were reachable. REA independently captured the public page's DOM/accessibility tree and desktop screenshot; a controlled mobile-width scenario also completed. The hosted Flowise application was not inspected. A separate scenario attempt in this session failed before its first recorded step, while the focused capture in [live-flowise-audit.md](live-flowise-audit.md) succeeded. No credentials, storage values, unrelated tabs, or account data were accessed.

Therefore the target's current dashboard layout, exact node catalog, editor interactions, API traffic, animation timing, and runtime performance remain **unverified**. The public homepage's dark hero composition is browser-observed; the product capability list above is **documented**, not runtime-observed.

## Carteio implementation map

| Product area | Carteio implementation | Status and boundary |
| --- | --- | --- |
| Public landing page | `frontend/src/pages/landing/LandingPage.tsx` and `product-landing.css` | Carteio-branded page with product features, workflow overview, responsive canvas illustration, integration summary, and signup links. It uses no Flowise logos or supplied Flowise artwork. |
| Application navigation | `frontend/src/routes/AppRoutes.tsx`, `frontend/src/layouts/DashboardLayout/DashboardLayout.tsx` | Workspace pages include dashboard, builder, assistants, knowledge, training, integrations, commerce, inbox, widget, billing, team, and settings. |
| Flow editor | `frontend/src/pages/flows/FlowBuilderPage.tsx` | Drag-positioned node canvas, connections and branches, node editing, import/export, zoom/fit, local recovery, saved-flow selection, and a run/test panel. |
| Flow API and runner | `backend/src/modules/workspaces/flow.controller.ts`, `flow.service.ts`, frontend `services/api/flows.ts` | Authenticated workspace flow CRUD, version-aware saves, graph validation, cancellable run endpoint, server-side execution, node timing and trace results. |
| Flow persistence | Prisma `FlowDefinition` model and additive migration under `backend/prisma/migrations/20261018100000_flow_definitions/` | Migration file exists; it has not been applied. Workspace persistence depends on deployment applying it. |
| Assistant execution | Existing `AssistantService.playgroundChat` and conversation orchestration | Flow assistant nodes call the actual configured Carteio assistant/provider path, preserving existing safety, conversation, and retrieval behavior. |
| Knowledge and crawler | Existing knowledge bases, indexing, retrieval, and website-crawler modules | Preserved. The flow's Knowledge Search step returns a permission-checked retrieval trace; it does not bind retrieved text into a later model prompt. |
| Auth and sessions | Existing NestJS auth module and frontend auth pages/provider | Preserved. Password/email OTP, sessions, rate limits, verification/reset, and Google auth logic are not replaced by the product redesign. |
| Commerce and support | Existing connector/Shopify, widget, conversation, ticket, and commerce modules | Preserved and reachable through existing workspace routes. |

## Current flow execution contract

The supported node types are Chat Input, Message Template, Carteio Assistant, If / Else, Knowledge Search, and AI Response. A run traverses the saved graph on the backend, invokes real assistant or knowledge services, records per-node status/timing for the run response, reports selected/skipped branch nodes, and can be cancelled through the request abort signal. Saved flows use optimistic version checks. Browser-local recovery is used if server persistence fails.

The current executor only accepts acyclic paths where each branch ends at an AI Response and has an assistant. Cycles, branch joins, loops, shared flow-state bindings, human approval/resume, subflows, arbitrary LLM nodes, generic tool nodes, HTTP request nodes, token streaming, durable execution history, and standalone retrieval-output bindings are not implemented. This is narrower than the documented Flowise Agentflow V2 model. We do not advertise those unsupported actions as working.

## Verification and safety

### Changes made in this pass

- Rebuilt the public landing page into a full multi-section experience with original CARTEIO AI visuals, responsive layouts, capability cards, use cases, resource links, and product-accurate copy. In this continuation, adjusted the opening viewport toward the observed dark, centered hero, gradient headline accent, pill CTAs, compact dark header, and wide workflow preview.
- Updated shared public navigation/footer and feature-route anchors to match the rebuilt page.
- Added REA live-site findings, official GitHub source findings, a Carteio architecture audit, this report, and the `rors/` documentation index.
- Continued with focused subagents covering builder interactions, server-side flow execution, dashboard/auth presentation, and landing validation. Their work is documented in [builder UI progress](builder-ui-progress.md), [flow engine progress](flow-engine-progress.md), [dashboard/auth progress](dashboard-auth-progress.md), and [landing validation](landing-validation.md).
- Preserved the pre-existing application, migrations, authentication, and user data. No cleanup was attempted.
- Captured CARTEIO locally with REA at desktop size. This pass adjusted the hero to a centered two-line heading after comparing the local screenshot with the observed Flowise reference. The capture verifies the current opening viewport, not full visual parity.
- Added lazy loading at the route boundary so the landing page no longer downloads the workflow editor, knowledge-management screens, or other workspace features as part of the initial JavaScript entry. The production build reduced the entry bundle from 641.24 KB to 213.64 KB minified (169.36 KB to 67.58 KB gzip); route chunks load on navigation. This is a bundle-size measurement, not a measured browser speedup.
- Started the approved local Vite server and ran an approved frontend TypeScript check, production build, and Vitest suite. Results are recorded in [runtime validation](runtime-validation-2026-10-18.md).
- A Linux/Windows native-module mismatch was found in ignored `node_modules`; matching Rollup and esbuild Linux packages were unpacked into the local ignored dependency tree only. No project manifests or lockfiles were edited for that repair.
- No database migration, deployment, or destructive cleanup was performed. The migration file remains unapplied. No user data or environment secrets were accessed.
- No backup was necessary because no destructive cleanup was performed. A recoverable backup is required before any later cleanup; the user's requested approval is also required before deleting obsolete code or assets.
- The worktree was already dirty. This pass edited the landing page, its landing stylesheet, shared public header/footer links, the public layout wrapper, the `/features` anchor redirect, and `rors/` documentation; it did not revert or delete prior work.

### Runtime validation boundary

Local visual inspection is now available through the authorized development server and REA. Full visual-difference measurement, authenticated Flowise app comparison, broad runtime performance comparison, and complete feature parity remain unverified. No destructive cleanup was performed; approval is still required before obsolete code or assets are deleted, with a recoverable baseline created first.

## Sources

- [Flowise homepage](https://flowiseai.com/)
- [Sunset announcement](https://flowiseai.com/sunset)
- [Official docs introduction](https://docs.flowiseai.com/)
- [Official integrations overview](https://docs.flowiseai.com/integrations)
- [Agentflow V2](https://docs.flowiseai.com/using-flowise/agentflowv2)
- [Prediction API](https://docs.flowiseai.com/api-reference/prediction)
- [Streaming](https://docs.flowiseai.com/using-flowise/streaming)
- [Embedded chat](https://docs.flowiseai.com/using-flowise/embed)
- [Analytics](https://docs.flowiseai.com/using-flowise/analytics)

