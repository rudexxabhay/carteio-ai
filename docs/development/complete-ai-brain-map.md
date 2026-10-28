# Carteio AI brain map

**Inspection date:** 2026-10-26  
**Scope:** static repository inspection only. No tests, builds, providers, Shopify endpoints, crawls, or database writes were run.

## Executive architecture summary

The primary conversational engine is `ConversationOrchestrator` in `backend/src/modules/workspaces/conversation-orchestrator.service.ts`. Authenticated Playground and anonymous widget traffic converge on its separate entry methods and share the customer-turn interpretation, retrieval/tool, generation, verification, and persistence pipeline. Widget identity is resolved server-side from the widget configuration and signed session; Playground identity is resolved from the authenticated user’s workspace membership and assistant record. Both feed organization-scoped assistant configuration into provider assembly. The existing Agent Builder has a separate saved-graph executor in `FlowService`; it calls Playground chat for supported assistant nodes and is not implicitly activated for public widget conversations.

The inventory below focuses on active production execution dependencies and the directly relevant contracts, UI/API clients, persistence, tests, and dormant alternatives found by import/call-site inspection. “Active” means a reachable import or runtime call was found from the inspected app/module roots, not that every branch was exercised at runtime. Files are grouped by primary role; a file can participate in several graph stages. The tables reference 119 distinct existing paths (95 production/config/application files, 21 tests, and 3 schema/generated files); section counts overlap where one file serves multiple roles.

## Actual customer-message call graph

### Authenticated Playground

`frontend/src/main.tsx` → `frontend/src/app/App.tsx` → `frontend/src/routes/AppRoutes.tsx` → `RequireAuth` and `DashboardLayout` → active `dashboard-source/SourceDashboard.tsx` → `dashboard-source/pages.tsx` Playground → `services/api/assistants.ts` → `services/api/client.ts` → `POST /workspaces/:slug/assistants/:assistantId/playground/chat` (or `/stream`) → `AuthSessionGuard` → `AssistantController.playgroundChat()` → `AssistantService.playgroundChat()` → `WorkspaceService.requireAccess()` and an organization-scoped assistant query → `ConversationOrchestrator.playgroundChat()`.

The orchestrator creates or resolves an owner-scoped Playground session, rate-limits and persists the turn, assembles bounded chronological history, loads assistant configuration and organization identity, obtains authorized capability/source context, interprets the request, validates it, chooses social/contextual/business scope, retrieves knowledge or calls permitted product tools where applicable, assembles provider messages, calls the selected configured provider, validates grounded claims/citations, persists the result and emits diagnostics. The streaming route streams stage/trace events and heartbeats; it is not provider token streaming.

### Anonymous public widget

`frontend/public/widget.js` fetches public configuration and bootstraps a session → `WidgetController` → `WidgetService.publicConfiguration()` / `bootstrap()` resolves public widget ID, allowed origin, active assistant and organization from stored configuration → signed session and server-side session row bind organization, assistant, conversation and origin → widget message endpoint → `WidgetController` → `WidgetService.message()` validates session/origin/assistant again → `SaasService.recordCustomerMessage()` persists/deduplicates the customer turn → `ConversationOrchestrator.processTrustedCustomerTurn()` runs the shared trusted customer-turn engine → assistant message is persisted and returned through `WidgetService` to `widget.js` for rendering. The browser does not provide authoritative organization or assistant IDs. History, polling and ticket actions remain session and tenant scoped.

### Conditional branches

- **Social/conversational:** interpretation plus `social-conversation.ts` safe classification can select the conversational path; the response still comes from provider generation. It does not require irrelevant knowledge citations.
- **Merchant knowledge:** authorized source resolution → lexical and optionally configured semantic retrieval → candidate ranking/deduplication → selected evidence → provider generation → factual/citation validation.
- **Shopify/product:** server-side tool registration is conditional on integration, scope snapshot, capability and assistant/workspace permissions; tool execution enters organization-scoped commerce services and returns attributed product evidence. Shopify sync/API access alone does not register an AI tool.
- **Out of scope / unclear / missing evidence:** semantic scope and source-route decisions constrain evidence/tool access; provider generation receives protected instructions and authorized workspace context. Clarification and safety paths are distinct.
- **Provider or verification failure:** bounded provider/error handling and verification/recovery paths run; failed factual claims are not accepted as grounded answers. Some terminal safety/error messages remain deterministic.
- **Agent Builder:** authenticated Flow API loads/saves/runs a persisted graph. `FlowService.run()` validates and traverses it, records real node/edge traces, and assistant nodes delegate to Playground chat. No widget publication/activation path was found.

## Prompt and provider request construction

`assistant-behavior-context.ts` exports `buildProtectedPlatformInstruction()`, `buildAuthorizedWorkspaceContext()` and `buildAssistantBehaviorInstruction()`. The protected instruction is shared; authorized workspace identity is resolved from the selected assistant’s organization record, and saved behavior is subordinate configuration rather than evidence. `ConversationOrchestrator.callSelectedProvider()` adds the protected layer for customer-facing generation and assembles assistant behavior, context, history, selected evidence and tools for each applicable request. `ConversationProviderService.complete()` selects the configured provider path. The OpenRouter-compatible adapter forwards messages; Gemini maps system content to its system-instruction field and the remaining turns/tools to its request format. Agent Builder node instructions are included only when the node executes and remain subordinate to platform/security rules. Provider payloads were inspected in source only; no live request was made.

## Retrieval, tools, grounding and delivery

Knowledge source authorization and active-generation checks precede retrieval. `KnowledgeProcessingService` performs lexical search and conditionally semantic search when the configured embedding path and indexed vectors are available, then merges/ranks candidates and constructs source-attributed evidence. `KnowledgeIndexing` owns chunk/vector creation; website crawler/renderer/sync own page acquisition and publication. Missing semantic configuration is represented as unavailable rather than proof of a semantic match.

Shopify integration has two different surfaces: connector OAuth/sync/provider API access and the assistant’s explicitly registered tools. The orchestrator registers product search and business-knowledge search under verified capability/permission state. `CommerceReadContractsService` contains product-detail and authorized-order read operations, but those helpers are not independently registered as general-purpose LLM tools in the inspected orchestrator path. Private order access remains identity/authorization gated. Ticketing is a separate support workflow.

Grounding is claim/evidence based: answer planning and grounded-response validation inspect merchant-specific claims, references, allowed evidence and current-generation/source constraints. Citation recovery is conditional and provider errors are classified separately. The final response and diagnostics are persisted/emitted through the conversation, assistant, widget and Playground paths.

## Source-file inventory

Production source is listed first, then tests, schemas/contracts and inactive alternatives. Paths are repository-relative. “Direct response” identifies code that can affect the answer or its delivery; “indirect” identifies authorization, evidence, configuration or UI/API dependencies.

### A. Main orchestrator and execution engine (5 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `backend/src/modules/workspaces/conversation-orchestrator.service.ts` | Production | `ConversationOrchestrator`, `playgroundChat`, `processTrustedCustomerTurn`, stages, tool loop, prompt/provider/verification/persistence | AssistantService, SaasService → context, intent, scope, knowledge, connector, provider, grounding services | Central end-to-end; direct | ACTIVE |
| `backend/src/modules/workspaces/conversation.contracts.ts` | Contract | Assistant/session/history/provider/evidence/trace types | Orchestrator and provider → shared TS contracts | All stages; indirect | ACTIVE |
| `backend/src/modules/workspaces/assistant.service.ts` | Production | Assistant CRUD/config, authorized Playground delegation | AssistantController/FlowService → WorkspaceService, orchestrator | Entry/config; direct | ACTIVE |
| `backend/src/modules/workspaces/assistant.controller.ts` | Production | Authenticated chat and stream routes, request abort/trace handling | HTTP → AuthSessionGuard, AssistantService | Entry/delivery; direct | ACTIVE |
| `backend/src/modules/workspaces/assistant.dto.ts`, `playground.dto.ts` | DTO | Validated assistant and Playground request/response contracts | Controllers → class validation | Entry; indirect | ACTIVE |

### B. Intent, reasoning and business scope (12 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `backend/src/modules/workspaces/conversation-intent.ts` | Production | Interpretation schema parsing, normalization and validation | Orchestrator → contracts/semantic helpers | Intent; indirect/decision | ACTIVE |
| `backend/src/modules/workspaces/multilingual-semantics.ts` | Production | Multilingual semantic interpretation helpers and normalized semantic values | Intent/scope/retrieval planning | Reasoning; indirect | ACTIVE |
| `backend/src/modules/workspaces/business-scope-guard.ts` | Production | `decideBusinessScope`, validated business/scope outcome | Orchestrator → interpretation/context | Scope decision; indirect | ACTIVE |
| `backend/src/modules/workspaces/business-source-router.ts` | Production | `planBusinessRequest`, `decideBusinessSourceRoute`, live-connector readiness and safety refusal | Orchestrator → scope/connector capability | Source/tool route; indirect | ACTIVE |
| `backend/src/modules/workspaces/social-conversation.ts` | Production | `classifyDeterministicSocialMessage`, social decision/language validation | Orchestrator → semantic metadata | Route only; response generated by LLM | ACTIVE |
| `backend/src/modules/workspaces/clarification-guard.ts` | Production | Determines when required context warrants clarification | Orchestrator | Clarification route; indirect | ACTIVE |
| `backend/src/modules/workspaces/scope-splitting.ts` | Production | Separates mixed-scope request components | Orchestrator | Routing/evidence bounds; indirect | ACTIVE |
| `backend/src/modules/workspaces/conversation-context.ts` | Production | Recent turn/context normalization and contextual follow-up support | Orchestrator | Memory/retrieval; indirect | ACTIVE |
| `backend/src/modules/workspaces/retrieval-query-plan.ts` | Production | Query rewrite/plan for retrieval | Orchestrator → intent/context | Retrieval; indirect | ACTIVE |
| `backend/src/modules/workspaces/intelligence-foundation.ts` | Production | Shared intelligence configuration/normalization utilities | Reasoning helpers | Reasoning; indirect | ACTIVE |
| `backend/src/modules/workspaces/grounded-answer-plan.ts` | Production | Answer/evidence plan and claim-oriented response constraints | Orchestrator → evidence/intent | Generation plan; indirect | ACTIVE |
| `backend/src/modules/workspaces/response-safety.ts` | Production | Safety checks and response eligibility support | Orchestrator/validation | Verification; indirect | ACTIVE |

### C. Prompts, Bot Behavior and instructions (3 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `backend/src/modules/workspaces/assistant-behavior-context.ts` | Production | Protected platform instruction, authorized workspace context, saved behavior instruction builders | Orchestrator → selected assistant/org/config | Prompt; direct | ACTIVE |
| `backend/src/modules/workspaces/assistant-contact-evidence.ts` | Production | Converts owner-configured support contacts to sourced business evidence | Orchestrator → authorized assistant config | Evidence; direct factual effect | ACTIVE |
| `backend/src/modules/workspaces/assistant.service.ts` | Production | Persists/loads assistant Bot Behavior/provider configuration | Controller → DB/workspace authorization | Prompt config; indirect | ACTIVE |

### D. Conversation memory and persistence (7 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `backend/src/modules/workspaces/saas.service.ts` | Production | Customer turn idempotency, conversation/session persistence, delegates trusted turns | WidgetController/WidgetService → DB, orchestrator | Memory; direct | ACTIVE |
| `backend/src/modules/workspaces/saas.controller.ts`, `saas.dto.ts` | Production/DTO | Public customer conversation/ticket HTTP contracts | Widget/web → SaasService | Entry/delivery; indirect | ACTIVE |
| `backend/src/modules/workspaces/training-history.dto.ts` | DTO | Playground history/session data contracts | Assistant APIs | Memory; indirect | ACTIVE |
| `backend/src/modules/workspaces/ticketing.service.ts` | Production | Authorized support ticket dialogue/state | Widget/SaaS → DB, delivery service | Conditional support response; direct | ACTIVE |
| `backend/src/modules/workspaces/support-delivery.service.ts` | Production | Support notification/delivery behavior | Ticket/outbox workflows | External delivery, not normal chat | ACTIVE |
| `backend/src/modules/workspaces/ticket-outbox-worker.service.ts` | Worker | Leased asynchronous ticket delivery | Worker module → delivery/DB | Conditional support; indirect | ACTIVE |
| `backend/src/infrastructure/database/prisma.service.ts`, `database.module.ts` | Infra | Prisma client lifecycle and DI | Services/modules → generated Prisma client | Persistence; indirect | ACTIVE |

### E. Knowledge, RAG and embeddings (16 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `backend/src/modules/workspaces/knowledge-processing.service.ts` | Production | Authorized source resolution, preview/search, lexical/semantic candidates and evidence selection | Orchestrator/controllers → Prisma, embedding/search helpers | Retrieval; direct | ACTIVE |
| `backend/src/modules/workspaces/knowledge-indexing.ts` | Production | Chunk normalization and optional embedding/index lifecycle | Knowledge services/workers → configured embedding adapter | Indexing; indirect | ACTIVE |
| `backend/src/modules/workspaces/knowledge-context-builder.ts` | Production | Bounded source-attributed evidence context construction | Orchestrator → search results | Prompt evidence; direct | ACTIVE |
| `backend/src/modules/workspaces/knowledge-retrieval-policy.ts` | Production | Source visibility/eligibility/readiness policy | Resolver/search | Authorization; indirect | ACTIVE |
| `backend/src/modules/workspaces/knowledge.service.ts`, `knowledge.controller.ts`, `knowledge.dto.ts` | Production/API/DTO | Knowledge source CRUD/import/index APIs | Dashboard → workspace/auth, processing | Data input; indirect | ACTIVE |
| `backend/src/modules/workspaces/knowledge-base.service.ts`, `knowledge-base.controller.ts`, `knowledge-base.dto.ts` | Production/API/DTO | Knowledge Base assignment and access APIs | Dashboard → source resolver/DB | Eligibility; indirect | ACTIVE |
| `backend/src/modules/workspaces/assistant-knowledge.controller.ts` | Production API | Assistant-specific source/access configuration routes | Dashboard → authorization/knowledge | Access config; indirect | ACTIVE |
| `backend/src/modules/workspaces/faq-import.ts` | Production | FAQ row mapping/validation | Knowledge service | Data ingestion; indirect | ACTIVE |
| `backend/src/modules/workspaces/private-knowledge-storage.ts` | Production | Private knowledge storage boundary | Knowledge processing | Data security; indirect | ACTIVE |
| `backend/src/modules/workspaces/website-crawler.ts` | Production | Website URL crawl and extraction orchestration | Website sync/worker → renderer/safe HTTP | Ingestion; indirect | ACTIVE |
| `backend/src/modules/workspaces/website-renderer.ts` | Production | HTML rendering/content extraction | Crawler | Ingestion; indirect | ACTIVE |
| `backend/src/modules/workspaces/website-sync.ts` | Production | Crawl generation lifecycle/publication | Worker/controller → crawler/DB/indexing | Active index; indirect | ACTIVE |
| `backend/src/modules/workspaces/website-verification.service.ts` | Production | Website/source validation | Knowledge endpoints/sync | Ingestion eligibility; indirect | ACTIVE |
| `backend/src/modules/workspaces/knowledge-worker.module.ts` | Production module | Worker provider registration | `knowledge-worker.main.ts` → crawler/sync/outbox workers | Background ingestion; indirect | ACTIVE worker runtime |
| `backend/src/knowledge-worker.main.ts` | Production entry | Separate knowledge worker bootstrap | Process entry → worker module | Crawl/index execution; indirect | ACTIVE when worker deployed |
| `backend/src/modules/workspaces/knowledge.service.ts` | Production | Also handles source lifecycle/readiness | Controller → processing/indexing | Retrieval readiness; indirect | ACTIVE |
| `backend/src/modules/workspaces/website-sync.ts` | Production | Also maintains active generations/stale content state | Worker → Prisma | Retrieval freshness; indirect | ACTIVE |
| `backend/src/modules/workspaces/knowledge-processing.service.ts` | Production | Semantic retrieval is conditional on embedding config/vectors | Orchestrator → DB/vector query | Retrieval; direct | ACTIVE |
| `backend/src/modules/workspaces/knowledge.dto.ts`, `knowledge-base.dto.ts` | DTO | Validated knowledge source/query contracts | Controllers | Data boundary; indirect | ACTIVE |

### F. Shopify, business tools and connectors (16 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `backend/src/modules/workspaces/connectors/connector.contracts.ts` | Contract | Connector/provider/sync/permission types | Registry/services/adapters | Integration boundary; indirect | ACTIVE |
| `backend/src/modules/workspaces/connectors/connector.registry.ts` | Production | Adapter discovery and registration | ConnectorService/module | Integration; indirect | ACTIVE |
| `backend/src/modules/workspaces/connectors/connector.service.ts` | Production | OAuth/configuration/permissions/sync coordination | Controllers/workers → registry/DB | Tool readiness/data; indirect | ACTIVE |
| `backend/src/modules/workspaces/connectors/shopify-oauth.controller.ts`, `shopify-oauth.service.ts` | Production API/service | Shopify OAuth and tenant-bound integration setup | Dashboard → ConnectorService/DB | Integration; indirect | ACTIVE |
| `backend/src/modules/workspaces/connectors/shopify-granted-scope-discovery.service.ts` | Production | Granted scope snapshot/discovery and mismatch state | OAuth/sync/tool readiness | Authorization; indirect | ACTIVE |
| `backend/src/modules/workspaces/connectors/shopify.adapter.ts` | Production | Shopify provider API and sync mapping | Registry/worker → safe HTTP | Shopify API/data sync; indirect to chat | ACTIVE |
| `backend/src/modules/workspaces/connectors/commerce-read-contracts.service.ts` | Production | Tenant-scoped commerce read operations incl catalog/detail/authorized order | Orchestrator/connector layer → DB/provider contracts | Tool/data evidence; direct when called | ACTIVE helper |
| `backend/src/modules/workspaces/connectors/connector-sync-worker.service.ts` | Worker | Scheduled/leased connector sync | Worker module → ConnectorService | Data freshness; indirect | ACTIVE when worker deployed |
| `backend/src/modules/workspaces/connectors/connector-credential-vault.ts` | Production | Credential protection/decryption boundary | Connector/adapter | Security; indirect | ACTIVE |
| `backend/src/modules/workspaces/connectors/safe-outbound-http.service.ts` | Production | Validated outbound HTTP protections | Shopify/crawler/provider adapters | Network safety; indirect | ACTIVE |
| `backend/src/modules/workspaces/connectors/generic-rest-connector.adapter.ts` | Production | Generic REST connector provider | Connector registry | Optional integration; indirect | ACTIVE if configured |
| `backend/src/modules/workspaces/connectors/universal-business-api.adapter.ts` | Production | Generic/universal business API operations | Connector registry/service | Optional integration; indirect | ACTIVE if configured |
| `backend/src/modules/workspaces/connectors/connector-sync-debug.ts` | Production diagnostic | Redacted sync diagnostics | Sync service/API | Diagnostics only | ACTIVE |
| `backend/src/modules/workspaces/shopify-website-discovery.service.ts` | Production | Shopify website discovery helper | Shopify sync/knowledge flow | Ingestion; indirect | ACTIVE |
| `backend/src/config/shopify-scope-inventory.config.ts`, `shopify-scope-upgrade.config.ts` | Config | Scope inventory/upgrade declarations | OAuth/scope services | Permission config; indirect | ACTIVE |
| `backend/src/modules/workspaces/conversation-orchestrator.service.ts` | Production | Registers conditional `search_store_products` and `search_business_knowledge` tools | Provider tool loop → commerce/knowledge services | Tool execution/evidence; direct | ACTIVE |

**Tool/API distinction:** Shopify provider API operations and sync may exist without being exposed to the LLM. In the inspected orchestrator, product search and knowledge search are registered conditional tools. `getProductDetails()` and `getAuthorizedOrder()` helpers are not independently registered general-purpose LLM tools there; order access requires an authorized principal. No claim is made that every connector API operation is AI-usable.

### G. Provider adapters and LLM requests (3 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `backend/src/modules/workspaces/conversation-provider.service.ts` | Production | Provider selection/complete call and response normalization | Orchestrator → OpenRouter/Gemini adapters | Generation; direct | ACTIVE |
| `backend/src/modules/workspaces/gemini-model-diagnostic.ts` | Production diagnostic | Config/model compatibility diagnostics | Provider setup/Inspector | Diagnostic only | ACTIVE |
| `backend/src/modules/workspaces/conversation-orchestrator.service.ts` | Production | Provider message/tool payload assembly and call boundary | Assistant/SaaS → provider service | Generation; direct | ACTIVE |

### H. Grounding, citations and recovery (4 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `backend/src/modules/workspaces/grounded-response-validation.ts` | Production | Claim/reference/evidence validation | Orchestrator → selected evidence/answer plan | Verification; direct | ACTIVE |
| `backend/src/modules/workspaces/grounded-answer-plan.ts` | Production | Grounded answer requirements/context shape | Orchestrator → interpretation/evidence | Generation/verification; indirect | ACTIVE |
| `backend/src/modules/workspaces/assistant-contact-evidence.ts` | Production | Source-attributed configured contact evidence | Orchestrator → authorized assistant | Evidence; direct | ACTIVE |
| `backend/src/modules/workspaces/conversation-orchestrator.service.ts` | Production | Citation validation, bounded recovery, terminal persistence/error mapping | Provider/grounding → conversation store | Verification/delivery; direct | ACTIVE |

### I. Authorization, security and tenant isolation (14 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `backend/src/modules/auth/auth-session.guard.ts` | Production guard | Authenticated user/session validation | Assistant/workspace controllers | Auth boundary; indirect | ACTIVE |
| `backend/src/modules/workspaces/workspace.service.ts` | Production | Workspace membership/role/assistant ownership checks | Controllers/services → Prisma | Tenant authorization; indirect | ACTIVE |
| `backend/src/modules/workspaces/workspace.controller.ts`, `workspace.dto.ts` | API/DTO | Workspace and membership routes/contracts | Dashboard → WorkspaceService | Identity/config; indirect | ACTIVE |
| `backend/src/modules/workspaces/widget.service.ts` | Production | Public assistant resolution, origin/session bootstrap, message/session scope | WidgetController → DB, SaaS | Public authorization; direct | ACTIVE |
| `backend/src/modules/workspaces/widget.controller.ts`, `widget.dto.ts` | API/DTO | Public config/bootstrap/message routes and validation | Widget JS → WidgetService | Entry/delivery; direct | ACTIVE |
| `backend/src/modules/workspaces/widget-origin.ts` | Production | Origin parsing/allow-list validation | WidgetService | Security; indirect | ACTIVE |
| `backend/src/modules/workspaces/saas.service.ts` | Production | Session-bound organization/assistant/customer conversation authorization | Widget → DB/orchestrator | Tenant boundary; indirect | ACTIVE |
| `backend/src/common/middleware/csrf-origin.middleware.ts` | Middleware | CSRF/origin handling for application requests | App bootstrap | Security; indirect | ACTIVE |
| `backend/src/common/middleware/request-id.middleware.ts`, `structured-logging.middleware.ts` | Middleware | Request IDs and structured redacted logging | App bootstrap | Diagnostics; indirect | ACTIVE |
| `backend/src/common/middleware/body-parser-error.middleware.ts` | Middleware | Request-body error handling | App bootstrap | API boundary; indirect | ACTIVE |
| `backend/src/infrastructure/database/database-error.ts` | Infra | Database error normalization | Services/filter | Failure handling; indirect | ACTIVE |
| `backend/src/infrastructure/database/prisma.service.ts`, `database.module.ts` | Infra | Tenant data access client/DI | Modules/services | Persistence; indirect | ACTIVE |
| `backend/src/app.module.ts`, `backend/src/main.ts` | Production bootstrap | Module graph and server middleware setup | Process entry | Runtime wiring; indirect | ACTIVE |

### J. Agent Builder and flow execution (5 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `frontend/src/dashboard-source/ChatflowBuilder.tsx` | Production UI | Active graph editor/save/run/trace view | SourceDashboard → flows API | Flow config/delivery; indirect | ACTIVE |
| `frontend/src/services/api/flows.ts` | API client | Flow CRUD/run endpoint contracts | ChatflowBuilder → API client | Flow entry; indirect | ACTIVE |
| `backend/src/modules/workspaces/flow.controller.ts`, `flow.dto.ts` | API/DTO | Authenticated flow endpoints and graph DTO validation | ChatflowBuilder → FlowService | Entry/security; indirect | ACTIVE |
| `backend/src/modules/workspaces/flow.service.ts` | Production | Graph validation, persisted graph traversal, state and execution traces | FlowController → AssistantService, KnowledgeProcessing | Conditional answer path; direct for flow | ACTIVE |
| `backend/prisma/migrations/20261018100000_flow_definitions/migration.sql` | Migration | FlowDefinition persistence table | FlowService/Prisma | Persistence; indirect | ACTIVE schema history |

**Boundaries:** no implicit default flow execution or public-widget flow publication/activation path was found. Knowledge-node outputs are recorded as knowledge runs/counts; inspected runtime does not pass selected chunks as evidence into a later assistant node. Treat advanced node/runtime and publication capabilities as unsupported unless separately implemented.

### K. Playground, public widget, streaming and frontend API (13 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `frontend/src/main.tsx`, `frontend/src/app/App.tsx` | Frontend bootstrap | React application setup/routing | Browser → providers/routes | UI entry; indirect | ACTIVE |
| `frontend/src/routes/AppRoutes.tsx`, `RequireAuth.tsx` | Frontend routing | Authenticated/public route guards | App → auth/layout | UI authorization; indirect | ACTIVE |
| `frontend/src/app/providers/AuthProvider.tsx`, `WorkspaceProvider.tsx` | Frontend state | User/session and selected workspace state | Routes/dashboard → APIs | UI context; indirect | ACTIVE |
| `frontend/src/layouts/DashboardLayout/DashboardLayout.tsx` | Frontend layout | Authenticated dashboard shell | AppRoutes → dashboard | UI; indirect | ACTIVE |
| `frontend/src/dashboard-source/SourceDashboard.tsx`, `pages.tsx` | Frontend | Active dashboard/Playground page composition | Layout → API clients/components | Playground; direct UI | ACTIVE |
| `frontend/src/services/api/assistants.ts` | API client | Playground/assistant methods | Playground → client | Entry/delivery; indirect | ACTIVE |
| `frontend/src/services/api/client.ts` | API infrastructure | Authenticated HTTP, errors, request configuration | API clients → backend | Transport; indirect | ACTIVE |
| `frontend/public/widget.js` | Production standalone JS | Public config/bootstrap/message/history rendering | Browser embed → Widget API | Widget entry/delivery; direct | ACTIVE |
| `frontend/src/services/api/widget.ts` | API client | Widget/dashboard configuration requests | Dashboard → client | Config; indirect | ACTIVE |
| `frontend/src/dashboard-source/playground-provenance.ts` | Frontend | Evidence/citation rendering adapter | Playground UI | Delivery; indirect | ACTIVE |
| `backend/src/modules/workspaces/playground.dto.ts`, `conversation.contracts.ts` | Contract | SSE/request/trace data shape | Controller/frontend/orchestrator | Streaming contracts; indirect | ACTIVE |
| `backend/src/modules/workspaces/assistant.controller.ts` | Production API | JSON/SSE response transport | Frontend → AssistantService | Delivery; direct | ACTIVE |

### L. Logging, Inspector and diagnostics (5 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `backend/src/modules/workspaces/conversation-diagnostics.ts` | Production diagnostics | Redacted conversation stage/trace metadata | Orchestrator | Inspector; indirect | ACTIVE |
| `backend/src/modules/workspaces/playground-diagnostics.ts` | Production diagnostics | Playground diagnostic summary/response shape | Controller/orchestrator | Inspector; indirect | ACTIVE |
| `backend/src/modules/workspaces/connectors/connector-sync-debug.ts` | Production diagnostics | Redacted connector sync status | Connector/dashboard | Integration Inspector; indirect | ACTIVE |
| `backend/src/common/middleware/structured-logging.middleware.ts` | Middleware | Request structured logging | App bootstrap | Diagnostics; indirect | ACTIVE |
| `backend/src/modules/workspaces/widget.controller.ts` | Production API | Widget diagnostics/response wrapper where configured | Widget service | Inspector/delivery; indirect | ACTIVE |

### M. Database schemas, generated contracts and shared configuration (5 listed paths)

| File | Type | Responsibility / key symbols | Main caller → dependencies | Stage / response effect | Status |
|---|---|---|---|---|---|
| `backend/prisma/schema.prisma` | Schema | Organization/membership, assistant, conversation/message, connector/permission, knowledge source/chunk, widget/session, flow models | PrismaService/services | Persistence/security; indirect | ACTIVE |
| `backend/src/generated/prisma/client.ts` | Generated contract | Prisma generated client consumed by PrismaService | PrismaService | Persistence; indirect | ACTIVE generated output |
| `backend/prisma/migrations/20261018100000_flow_definitions/migration.sql` | Migration | Flow graph persistence schema | FlowService | Flow persistence; indirect | ACTIVE schema history |
| `backend/src/config/shopify-scope-inventory.config.ts`, `shopify-scope-upgrade.config.ts` | Config | Scope/capability declarations | Connector/OAuth services | Shopify tool readiness; indirect | ACTIVE |
| `backend/src/modules/workspaces/intelligence-evaluation.ts`, `intelligence-evaluation-datasets.ts` | Evaluation support | Offline evaluation datasets/metrics | Evaluation tooling | Not production response path | ACTIVE support code; not runtime |

### N. Relevant regression tests (selected active tests)

Tests do not participate in production execution. These test files exercise the listed seams; they were discovered by test path/import and describe coverage, not a claim that they passed in this audit.

| File | Type | Covered boundary |
|---|---|---|
| `backend/src/modules/workspaces/conversation-orchestrator.customer.spec.ts` | Test | Customer-turn persistence, idempotency and orchestration |
| `backend/src/modules/workspaces/assistant.controller.playground.spec.ts` | Test | Authenticated Playground route/stream boundary |
| `backend/src/modules/workspaces/conversation-diagnostics.spec.ts`, `playground-diagnostics.spec.ts` | Test | Diagnostics and trace redaction/contracts |
| `backend/src/modules/workspaces/assistant-contact-evidence.spec.ts` | Test | Dynamic workspace context and contact evidence |
| `backend/src/modules/workspaces/business-scope-guard.spec.ts` | Test | Scope decisions |
| `backend/src/modules/workspaces/conversation-diagnostics.spec.ts` | Test | Interpretation parsing/recovery |
| `backend/src/modules/workspaces/knowledge-indexing.spec.ts`, `knowledge-context-builder.spec.ts` | Test | Chunk indexing/evidence context |
| `backend/src/modules/workspaces/knowledge-public-website.spec.ts`, `website-crawler.spec.ts`, `website-sync.spec.ts` | Test | Website ingestion/publication |
| `backend/src/modules/workspaces/knowledge-processing.shopify-scopes.spec.ts` | Test | Knowledge/Shopify scope handling |
| `backend/src/modules/workspaces/connectors/commerce-read-contracts.service.spec.ts`, `connector.registry.spec.ts`, `connector.service.spec.ts` | Test | Commerce contracts and connector wiring |
| `backend/src/modules/workspaces/connectors/shopify-oauth.service.spec.ts`, `shopify-granted-scope-discovery.service.spec.ts` | Test | OAuth and scope snapshot contracts |
| `backend/src/modules/workspaces/connectors/connector-sync-worker.service.spec.ts`, `safe-outbound-http.service.spec.ts` | Test | Sync and outbound safety |
| `backend/src/modules/workspaces/flow.service.spec.ts` | Test | Saved graph validation, execution and trace |
| `backend/src/modules/workspaces/widget.service.spec.ts`, `widget-source-indicator.spec.ts` | Test | Public widget identity/session/source response |
| `backend/src/modules/workspaces/saas.service.spec.ts`, `ticketing.service.spec.ts`, `ticket-outbox-worker.service.spec.ts` | Test | Conversation/session and support workflow |
| `frontend/src/tests/playground-chat.test.tsx`, `playground-live-flow.test.tsx`, `playground-provenance.test.ts` | Test | Playground interaction, streaming and evidence display |
| `frontend/src/tests/chatflow-builder.test.tsx` | Test | Active graph editor/API integration |
| `frontend/src/tests/widget-runtime.test.ts`, `widget-installation.test.tsx` | Test | Public widget and install surface |
| `frontend/src/tests/knowledge-access.test.ts`, `knowledge-api-routes.test.ts`, `knowledge-base.test.tsx`, `knowledge-bases.test.tsx` | Test | Knowledge API and access UI |
| `frontend/src/tests/shopify-permissions-panel.test.tsx`, `shopify-dashboard-regression.test.tsx`, `connectors-page.test.tsx` | Test | Connector UI/permission presentation |
| `frontend/src/tests/auth-bootstrap.test.tsx`, `auth-redirect.test.ts`, `workspace-switching.test.tsx`, `workspace-isolation.test.ts` | Test | Auth/workspace selection/isolation |
| `frontend/src/tests/conversations-inbox.test.tsx`, `assistant-pages.test.tsx`, `api-client.test.ts` | Test | Conversation and assistant dashboard contracts |

## Hardcoded behavior inventory

### Deterministic safety / decision logic (not customer-facing templates)

- `business-scope-guard.ts:decideBusinessScope()` and `business-source-router.ts:decideBusinessSourceRoute()` make validated scope/authorization decisions; they do not generate ordinary customer replies.
- `social-conversation.ts:classifyDeterministicSocialMessage()` validates a bounded safe-social category/language and may influence routing; answer wording is generated by the provider. Its fixed-category/regex safeguards are deterministic classifier logic, not a reply library.
- Grounding, citation/reference validation, tool argument checks, and widget/workspace authorization are deterministic enforcement and intentionally remain so.

### Customer-facing fixed wording that remains

- `business-source-router.ts:personalStatusSafetyRefusal()` returns a fixed multilingual refusal after the model produces an unsupported personal-status claim. This is a narrow safety outcome, not normal conversational generation.
- `conversation-orchestrator.service.ts` contains terminal evidence/citation rejection notices and saved-assistant-fallback/no-answer and ticket-operation emergency strings on invalid/empty/failure paths. These are failure/emergency paths, not the normal successful-generation route.
- `assistant-behavior-context.ts` includes merchant-configured greeting/fallback/escalation values in lower-priority behavior configuration; those are owner-supplied settings, not platform merchant constants.
- `widget.service.ts` contains widget UI appearance/welcome defaults; these are embed presentation defaults, not assistant business answers.

No production merchant support email, phone, store domain, product or workspace ID was identified in the inspected AI execution paths. The `assistant-contact-evidence.spec.ts` North Shop/South Shop details are test fixtures, not production imports. Platform branding elsewhere is not treated as merchant identity. This was a source search, not a runtime binary/secret audit.

## Active versus legacy / unused

- **Active:** authenticated Playground path in `dashboard-source` and AssistantController; standalone `frontend/public/widget.js` public path; `ConversationOrchestrator`; Knowledge/connector/provider/security services; `ChatflowBuilder.tsx` and `FlowService` persisted graph path.
- **Separate worker runtime:** `backend/src/knowledge-worker.main.ts` and `knowledge-worker.module.ts` run crawl/index/worker duties, not HTTP chat.
- **Legacy/dormant UI candidates:** `frontend/src/pages/flows/FlowBuilderPage.tsx`, `frontend/src/pages/training/TrainingCenterPage.tsx`, `PlaygroundDialog.tsx`, `PlaygroundChat.tsx`, and old knowledge/assistant/SaaS page modules have no import from the active `AppRoutes`/`SourceDashboard` route chain observed in this audit. `PlaygroundChat` is referenced by the dormant `PlaygroundDialog`; treat them as dormant UI, not the active Playground entry. No source file was deleted or changed.
- **Not an activated capability:** Flow graph execution exists for the authenticated run API; no code reference was found that automatically selects/publishes a flow for widget turns. Existing commerce read helpers do not imply corresponding model tools are exposed.

## Coverage and completeness reconciliation

Method: (1) enumerate tracked and untracked app-owned source using `rg --files` in backend/frontend entry and feature roots, excluding `node_modules`, build output and generated dependency packages; (2) trace static imports from `backend/src/app.module.ts`, `backend/src/modules/workspaces/workspace.module.ts`, and `frontend/src/main.tsx`, including relative TS/JS imports; (3) inspect dynamic/runtime call sites for `WidgetService`, `SaasService`, worker bootstrap and FlowService; (4) inspect standalone `frontend/public/widget.js`, which is not part of the TypeScript import graph; (5) reconcile relevant tests, Prisma models, migrations, DTOs, guards and adapters against these paths. This distinguishes active imports from route-dormant files and process-specific worker entrypoints.

The inventory is a functional map of discovered customer-message dependencies, not a count of every UI/style file in the transitive app import closure. Style-only files and generic unrelated dashboard modules are excluded. Generated application-owned Prisma client is included because runtime services import it. Static imports cannot prove runtime branch execution; plugin/config-based or reflection-based dynamic wiring can remain undiscovered.

## Unresolved references and verification limits

- Provider selection, semantic embedding availability, Shopify granted-scope state, database rows, actual saved assistant settings and widget origins depend on runtime configuration/data and were not queried.
- No supplied trace IDs were loaded from a diagnostics store; this document does not assert trace-specific behavior beyond source paths.
- The exact environment-dependent API route/feature exposure may vary by deployment configuration.
- No tests, builds, type checks, external provider calls, Shopify calls, live crawls, or database mutations were run; runtime correctness is not claimed.
- This map should be refreshed when entry points, dependency injection, provider adapters, or public-widget routing change.
