# Carteio AI

Carteio AI is an enterprise-oriented, multi-tenant, multilingual, multi-industry AI SaaS platform combining conversational AI, business intelligence, website integrations, customer engagement, and secure agentic automation. It is intended to serve e-commerce, healthcare and clinics, service businesses, landing pages, corporate websites, and other industries through extensible connectors.

Carteio AI is more than an FAQ chatbot. Businesses configure assistants, provide authorized knowledge, connect supported business systems as those phases are delivered, inspect operational and customer-engagement data, and eventually authorize bounded workflows. The product must never fabricate business data, connection health, analytics, or action results.

This README is the project-level product and engineering reference. It distinguishes repository implementation from the approved product vision. A route, schema model, or draft API alone does not mean a feature is complete or production-ready.

## Table of contents

- [Architecture](#architecture)
- [Current repository status](#current-repository-status)
- [Product modules](#product-modules)
- [Industry dashboards](#industry-based-dashboards)
- [Website technologies and connector model](#website-technologies-and-connector-model)
- [Phase 09 completion checklist](#phase-09-completion-checklist)
- [Approved 30-phase roadmap](#approved-30-phase-roadmap)
- [Development setup](#development-setup)
- [Configuration and deployment](#configuration-and-deployment)
- [Permanent development rules](#permanent-development-rules)
- [Repository map and references](#repository-map-and-references)

## Architecture

### Current stack

| Area | Repository implementation |
|---|---|
| Frontend | React, TypeScript, Vite, React Router, Tailwind CSS, and workspace CSS. Vite uses port 3000 by default. |
| Backend | NestJS and TypeScript, with the API prefix `/api/v1`; local port 5000 by default. |
| Shared contracts | `packages/shared-types/` contains transport-oriented shared types. |
| Persistence | PostgreSQL, including Neon-compatible connection support, accessed through Prisma. Prisma and `@prisma/client` are pinned to 7.10.0 in the backend manifest. |
| AI | Carteio's custom NestJS orchestration and provider adapters. The repository does not use LangChain or LangGraph. |
| Providers | Gemini, Groq, and OpenAI adapters. Provider/model choice and credentials are server-managed. |
| Knowledge retrieval | Workspace-owned FAQ/Text processing, chunking, PostgreSQL lexical retrieval, optional configured embeddings/pgvector, hybrid ranking, source authorization, and citation/evidence checks. |
| Authentication and tenancy | Authenticated user sessions and organization/workspace membership are enforced by the backend. Assistant, Knowledge, Playground, and workspace APIs are tenant-scoped. |

The browser calls the same-origin `/api/v1` API. Vite proxies this path to NestJS during local development. The browser must not receive database credentials, AI provider keys, or connector secrets.

### AI request boundaries

The model interprets customer language and generates natural wording. Server code owns identity and tenant authorization, assistant access, input/output validation, provider routing policy, source eligibility, business scope and capabilities, evidence revalidation, citations, idempotency, and safe fallbacks. Knowledge is untrusted evidence, never executable instruction. Static policy documents cannot establish personalized live order, payment, appointment, or shipment status.

Provider configuration supports the existing MANUAL route and explicitly configured AUTO_FALLBACK behavior. A configured key or model is configuration evidence, not proof that an external provider is reachable. Playground provenance distinguishes provider-generated output from system-generated responses where the contract supplies it.

### Retrieval boundaries

The active Knowledge product supports manually authored FAQ and Text sources plus DNS-verified public website sources, bounded crawl jobs, page/chunk generations, Knowledge Base assignment, and assistant retrieval. Retrieval is scoped to the authorized workspace and assistant and applies source state, visibility, publication, version, deletion, website ownership, and widget-domain rules. Optional embeddings require configured infrastructure; lexical matching must not be described as vector search. Website ingestion is implemented in code but has not been runtime verified.

### Deployment architecture evidenced in the repository

- Local development uses the two application workspaces and Vite proxy. A local database is optional for limited modes; production configuration requires database URLs.
- `infrastructure/nginx/` contains a production routing template: static frontend routes fall back to the React entry point and `/api/v1/` is sent to a private NestJS upstream. This is a template, not evidence of a live production deployment.
- `.github/workflows/ci.yml` defines CI installation, Prisma generation, typecheck, lint, Jest/Vitest, and build steps for its configured events.
- `.github/workflows/prisma-migrate-uat.yml` defines a UAT workflow using a Neon direct URL and existing Vercel projects. The workflow is configured to validate migrations and apply pending migrations on its eligible UAT event. Deployment is gated by `UAT_DEPLOY_ENABLED`. Repository configuration does not prove that the external GitHub secrets, Neon branch, Vercel projects, or deployments are currently valid.
- Production hosting, domains, secrets, database state, and rollout history must be verified in their respective operator environments; no deployment is claimed by this README.

## Current repository status

### Status vocabulary

- **IMPLEMENTED_IN_CODE** — a meaningful backend/frontend path or reusable runtime implementation exists in the repository. This does not mean independently tested or production-proven.
- **PARTIAL** — some models, APIs, UI, or foundations exist, but important runtime capabilities or lifecycle requirements remain absent.
- **PENDING** — the phase's principal runtime capability is not implemented.
- **EXTERNALLY_BLOCKED** — implementation or verification depends on credentials, a customer-owned system, or infrastructure not present in the repository.
- **NOT_RUNTIME_VERIFIED** — source exists, but this audit did not prove the behavior against a running application or external service.

### Audited capability summary

| Capability | Current status | Evidence and boundary |
|---|---|---|
| React/Vite and NestJS application | IMPLEMENTED_IN_CODE | Frontend routes, Nest modules, package configuration, health endpoint, and shared transport contracts exist. |
| Authentication and workspace membership | IMPLEMENTED_IN_CODE; NOT_RUNTIME_VERIFIED here | Auth/session, OTP/Google identity paths, workspace onboarding/selection, membership roles, and authenticated workspace routes exist. External email/Google setup is environment-dependent. |
| Assistant management and Playground | IMPLEMENTED_IN_CODE; NOT_RUNTIME_VERIFIED | Assistant CRUD/configuration, activation, archive/restore, guarded deletion-unavailable behavior, business rules, provider status, Playground session/chat, training history, and UI routes are present. Assistant archive persistence requires the authored additive migration `20261013130000_phase_09_assistant_archive`; it has not been applied or verified against a database. |
| FAQ/Text Knowledge and RAG | IMPLEMENTED_IN_CODE; NOT_RUNTIME_VERIFIED here | Knowledge Base/source APIs, processing and indexing modules, lexical retrieval, optional semantic retrieval, source authorization, and UI exist. Optional semantic indexing requires configuration. |
| Multilingual intelligence, scope, context, grounding | IMPLEMENTED_IN_CODE; NOT_RUNTIME_VERIFIED for model quality | 09D interpretation/guard modules, 09E query planning/retrieval, 09F grounded answer planning, provider routing, and synthetic evaluation contracts are present. No empirical multilingual accuracy claim is made. |
| SaaS foundation schema | PARTIAL | The repository contains additive Phase 09 foundation models and `20261013120000_phase_09_saas_foundation`. The owner reports applying the migration in their environment; this repository audit cannot verify any database's migration state. |
| Integrations and commerce | PARTIAL | Shopify OAuth, provider sync, normalized tenant-scoped catalog/order storage, read contracts, additive business/assistant permissions, sync guards, and retrieval filtering exist. The owner reports a Shopify store connected and verified; permission migration and runtime enforcement still require manual verification. WooCommerce is implemented in code but is not runtime verified. |
| Conversations inbox | PARTIAL | Separate support conversation/message models and workspace APIs/UI exist. Playground conversations are not ingested into that inbox; customer-channel intake, reply transport, and complete handoff operations are absent. |
| Billing and usage | PARTIAL / EXTERNALLY_BLOCKED | Plan/subscription/usage schema and a usage page exist. No configured payment processor, paid subscription flow, entitlement enforcement, or complete usage-ledger metering is evidenced. |
| Platform administration | PARTIAL | Separate platform-operator authorization and aggregate-only read API/UI foundations exist. Operator provisioning and complete audited operations are absent. Workspace ownership does not imply platform-admin access. |
| Website knowledge | IMPLEMENTED_IN_CODE | Owner/Admin website registration, DNS TXT ownership verification, bounded robots-aware crawl jobs, page/chunk publication, incremental content hashes, explicit 404/410 removal, scheduled/manual retry, and Knowledge Base/RAG eligibility are wired. Runtime ingestion and widget retrieval are pending manual verification. |
| Executable AI business tools/workflows | PENDING | Workflow/approval persistence models are foundations only. No live tool registry or business-action executor is exposed. |

The generated Prisma Client and live database state are environment-dependent. A successful TypeScript typecheck is not proof of schema validity, current migrations, or runtime database compatibility. Do not infer that a user-reported migration has been applied to every UAT or production database.

## Product modules

The product vision is delivered phase by phase. The table identifies the intended product surface and does not imply that every module is currently operational.

| Module | Intended capability | Current repository position |
|---|---|---|
| Authentication and workspaces | Secure accounts, sessions, organization membership, workspace selection, and scoped settings. | Core auth/workspace routes and services exist. |
| AI Assistants | Create assistants, configure their business purpose, language, tone, instructions, Knowledge, provider route, and lifecycle. | CRUD/configuration and lifecycle APIs/UI exist; see Phase 09 gaps. |
| AI Training and Playground | Test an assistant in an owned session, inspect safe provenance and sources, configure behavior, and review relevant audit history. | Playground and Training Center exist. Do not expose hidden prompts, secrets, or private tenant data. |
| Knowledge Base | Manage FAQ/Text knowledge, process/index it, link sources or bases to assistants, and keep evidence authorized and traceable. | Active FAQ/Text path exists. File and active public-website ingestion are not available. |
| Website integrations | Connect supported site/store APIs, discover capabilities, authorize minimum scopes, synchronize data, and expose health/sync history. | Draft integration foundation exists; real platform connectors are future phases and externally dependent. |
| Conversations and human handoff | List and manage customer-channel conversations, assign staff, add internal notes, hand off from AI, and support authorized replies. | Partial inbox foundation; customer intake and transport are absent. |
| Chatbot widget and embedding | Deploy a lightweight public assistant widget with origin restrictions, preview, sessions, and safe configuration. | Future-phase work; no public widget is evidenced. |
| Team and RBAC | Manage members/invitations and enforce permissions for settings, customer records, exports, and sensitive operations. | Workspace roles/team pages exist; advanced role and invitation management remains future work. |
| Products and inventory | View synchronized products, variants, inventory, categories, and source integration. | Draft schema/read pages; no verified synchronized commerce records. |
| Orders and fulfillment | Inspect normalized orders, payments, fulfillment, and supported refund metadata. | Draft schema/read pages; no live connectors or actions. |
| Sales and revenue | Aggregate actual order data with explicit status, timezone, and currency semantics. | Read API/UI foundation; no synchronized records, FX conversion, or verified revenue claims. |
| Best-selling products | Rank products from authorized order line items over a selected range. | Depends on real commerce synchronization; not yet operational. |
| Customers and leads | Privacy-aware customer insights and consent-based lead capture. | Not implemented as a complete product capability. |
| Industry dashboards | Show only data supported by the business type and connected capabilities. | A basic workspace overview and dashboard capability logic exist; full industry dashboards are later phases. |
| AI agent tools and workflows | Execute allowlisted, schema-validated read/write operations with customer authorization, approvals, idempotency, and audit. | Workflow persistence foundations only; no executable tools. |
| Analytics and AI attribution | Report observed conversations, events, and properly attributed conversions with explicit provenance. | No full event/attribution pipeline; do not infer AI-caused revenue. |
| Subscriptions, billing, usage | Enforce configurable plans and meter observed usage through a real billing integration. | Partial persistence/UI; no payment gateway or complete entitlements/metering. |
| Platform Super Admin | Isolated platform operations, aggregate diagnostics, plan controls, and audited privileged changes. | Read-only aggregate foundation only; incomplete and not a substitute for workspace admin. |
| Security and auditing | Tenant isolation, validation, provider/source boundaries, audit events, safe diagnostics, and least privilege. | Several application-level controls exist. Security review and runtime verification remain ongoing. |
| Performance monitoring | Observe measured latency, queue/sync health, provider failures, and database behavior without logging secrets or full private transcripts. | Request/provider diagnostics foundations exist; platform-wide monitoring and measured SLOs are not established. |

## Industry-based dashboards

Dashboard contents depend on all of the following:

1. The organization's industry.
2. The business type selected and validated by an authorized user.
3. Capabilities actually verified for connected integrations.
4. Data that is authorized, synchronized, fresh enough, and available.

Missing data must be represented as unavailable, not zero. No dashboard may show fabricated metrics.

| Business type | Potential dashboard data, when connected and authorized |
|---|---|
| E-commerce | Products, variants, inventory, orders, payment/refund status, revenue, best sellers, customers, and instrumented AI-assisted conversion events. |
| Healthcare and clinics | Appointments, doctors, services, schedules, and patient inquiries, subject to explicit authorization and privacy controls. Sensitive health records must never be placed in unrestricted AI Knowledge or exposed to a general assistant. |
| Landing pages and corporate sites | Website activity only when consent-aware tracking exists, plus actual leads, inquiries, conversions, engagement events, and AI conversations. |
| Service businesses | Services, bookings, requests, customer/lead management, and verified operational insights. |
| Other industries | Capability-specific data supplied through documented connectors and approved domain models. |

Industry is a business classification. Website technology is an integration choice; the two are independent.

## Website technologies and connector model

The approved connector roadmap covers Shopify, WooCommerce, WordPress, custom MERN sites, Next.js, PHP sites, static HTML websites, and compatible generic REST APIs. Shopify and WooCommerce require platform-specific adapters. WordPress may supply public content without being a WooCommerce store. MERN, Next.js, and PHP systems can implement a shared versioned connector contract rather than requiring separate Carteio dashboard products.

A real connector must include an explicit authorization model, minimum scopes, tenant-scoped credential references, capability discovery, strict request/response schemas, bounded pagination, rate limits, idempotent sync, cursor/retry handling, signed webhooks where applicable, revocation, and sanitized health/error states. A model must never select arbitrary URLs or gain permissions through a connector response. Public website content ingestion and private store API access are separate trust boundaries.

Shopify is the only currently available live integration platform. The owner reports that OAuth connection and verification succeeded; repository inspection does not establish a successful product sync or AI product retrieval. WooCommerce and website ingestion remain unverified at runtime. Connection UI/model presence is not proof that a connector works.

## Phase 09 completion checklist

This checklist is limited to AI Assistants, AI Training, Knowledge, providers, and the existing intelligence engine. Commerce dashboards, billing, support operations, widgets, connectors, and executable agents are later phases.

| Phase 09 item | Status | Repository evidence / remaining condition |
|---|---|---|
| Assistant CRUD and lifecycle | DONE_IN_CODE; MIGRATION_REQUIRED; NOT_RUNTIME_VERIFIED | Create/list/get/update/activate/deactivate and workspace-scoped archive/restore are implemented. Archive deactivates active assistants, preserves links/history, and is audited. Restore never reactivates implicitly. Permanent deletion is refused because current relations cascade into retained records. The additive `archivedAt` migration is authored but unapplied. |
| Assistant configuration | DONE_IN_CODE, NOT_VERIFIED | Name, purpose, instructions, language, tone/style, fallback wording, business rules, and provider fallback policy persist through APIs. Provider/model selection remains server-managed. Runtime configuration behavior still needs UAT validation. |
| AI Training and Playground | DONE_IN_CODE, NOT_VERIFIED | Assistant selection, owned Playground sessions, bounded history, chat, training history/overview, idempotency, and safe metadata paths exist. Runtime conversations were not exercised for this README. |
| FAQ/Text Knowledge CRUD | DONE_IN_CODE, NOT_VERIFIED | FAQ/Text CRUD, batch/import paths, Knowledge Bases, archive/restore, processing, and search-related code exist. Website and document ingestion are unavailable. |
| Knowledge-to-assistant assignment | DONE_IN_CODE, NOT_VERIFIED | Direct source and Knowledge Base linking are organization-scoped; source eligibility is checked by the backend. |
| Provider configuration and truthful status | PARTIAL | Gemini/Groq/OpenAI routing and server-side keys exist. Configuration status distinguishes missing keys and ready-for-testing; it is not a live connectivity test. |
| Multilingual/context behavior | DONE_IN_CODE, NOT_RUNTIME_VERIFIED | Interpretation, social/dialogue handling, context, clarification, and bounded references are wired into the orchestration. No multilingual benchmark is claimed. |
| Grounded answer pipeline | DONE_IN_CODE, NOT_RUNTIME_VERIFIED | Authorized query planning, retrieval, evidence-aware generation planning, limitations, and response-safety checks exist. Semantic entailment is not universally proven. |
| Citation and source authorization | DONE_IN_CODE, NOT_RUNTIME_VERIFIED | Workspace/assistant eligibility, evidence revalidation, and citation identity checks are implemented. A valid citation identifier is not proof of entailment. |
| Assistant and Playground UI/UX | PARTIAL; NOT_RUNTIME_VERIFIED | Assistant editor/list now expose archived status, status filtering, confirmation-based archive/restore, and a permanent-deletion-unavailable explanation. Training Center, Playground, responsive shell, and source UI remain present. Accessibility and manual browser QA remain. |
| API/query performance | PARTIAL | Pagination, bounded context, selected fields, parallelized reads, query limits, retrieval bounds, and indexes exist. No representative load/latency measurements were run. |
| Tenant security | DONE_IN_CODE, NOT_RUNTIME_VERIFIED | Authenticated routes and organization-scoped assistant/Knowledge/session checks exist. Security regression suites remain deferred. |
| Deferred tests | PENDING_EXECUTION | Jest/Vitest/evaluation cases are authored in the repository; they have not been represented here as passed. Comprehensive execution is reserved for Phase 30 authorization. |

### Phase 09 closure assessment

Phase 09 implementation code is complete for the scoped assistant, Training/Playground, FAQ/Text Knowledge, provider and intelligence functionality. The assistant archive field requires the additive migration `20261013130000_phase_09_assistant_archive`, which is prepared but has not been applied. Permanent deletion remains intentionally unavailable until a retention strategy prevents cascades into retained conversation/workflow history. Provider connectivity and application behavior are not runtime-verified. The owner reports applying the earlier Phase 09 SaaS foundation migration; repository files do not verify UAT or production migration state. Final automated and manual QA is deferred to Phase 30. Do not treat implementation closure as production readiness or begin Phase 10 before the required database and acceptance checks are complete.

## Approved 30-phase roadmap

Statuses below are based on source/docs presence, not an assertion that code was executed successfully. **NOT_RUNTIME_VERIFIED** applies where external behavior or current database state cannot be established from the checkout.

### Phase 01 — Project Foundation

- **Objective and deliverables:** Establish the monorepo, one React/Vite app, one NestJS API, shared transport types, base routes, health response, and brand foundations.
- **Backend/data:** Nest bootstrap, health endpoint, package/workspace configuration; no business persistence required.
- **Frontend/integrations:** Public/auth/workspace route foundation and Vite proxy; no external integration required.
- **Security/performance/acceptance:** Same-origin API path, bounded server setup, one frontend and backend; accepted when both applications and health contract are usable.
- **Status:** IMPLEMENTED_IN_CODE; deployment/runtime state is NOT_RUNTIME_VERIFIED.

### Phase 02 — Infrastructure & Configuration

- **Objective and deliverables:** Validate environment configuration and establish reliable local/CI/deployment templates.
- **Backend/data:** Typed environment validation, request handling, structured safe logging, API errors, and security headers; database is not the focus.
- **Frontend/integrations:** Vite environment separation and API proxy; CI and Nginx/UAT workflow definitions are present.
- **Security/performance/acceptance:** Keep secrets server-side, require explicit production CORS/proxy configuration, and bound request size/time; accept when configuration fails safely and deployment templates are reviewed.
- **Status:** IMPLEMENTED_IN_CODE; external CI/deployment configuration is NOT_RUNTIME_VERIFIED.

### Phase 03 — Database Foundation

- **Objective and deliverables:** Define PostgreSQL/Neon persistence and Prisma access patterns.
- **Backend/data:** Prisma schema, migrations, database module, pooled application URL and direct migration URL.
- **Frontend/integrations:** Browser accesses data only through APIs; Neon credentials are operator supplied.
- **Security/performance/acceptance:** Tenant-aware relations, constraints, indexes, connection handling, and migration review; accept after schema/client validation and environment-specific migration status checks.
- **Status:** PARTIAL / NOT_RUNTIME_VERIFIED. Migration files exist; live database and migration history are not observable in this repository.

### Phase 04 — Authentication & Accounts

- **Objective and deliverables:** Secure account access, sessions, OTP/Google flows, workspace onboarding, and membership.
- **Backend/data:** Auth controllers/services, session persistence, OTP validation/rate limits, membership roles, and audit boundaries.
- **Frontend/integrations:** Login/signup/recovery and workspace-selection routes; email and Google require valid provider configuration.
- **Security/performance/acceptance:** Session ownership, throttling, validation, safe redirects, and privacy; accept after authorized auth regression and external identity/email checks.
- **Status:** IMPLEMENTED_IN_CODE; external delivery/runtime behavior is NOT_RUNTIME_VERIFIED.

### Phase 05 — Public Website Connection

- **Objective and deliverables:** Safely associate a business-owned website with a workspace and establish domain authorization.
- **Backend/data:** Website/domain records and retained verification/crawler foundations are present.
- **Frontend/integrations:** Website registration, ownership challenge/verification, details, sync settings, manual sync and processing status are available through authenticated Knowledge API routes; a dedicated dashboard setup flow is not implemented.
- **Security/performance/acceptance:** DNS TXT ownership, public-address validation and pinned requests, same-host redirects, TLS validation, robots rules, private-route/query filtering, content sanitization, bounded crawl budgets, tenant-scoped records, and active Knowledge Base/RAG permissions are enforced in code.
- **Status:** IMPLEMENTED_IN_CODE; website crawling, indexing and public retrieval require manual runtime verification.

### Phase 06 — Knowledge Processing

- **Objective and deliverables:** Author, process, version, and retrieve supported Knowledge.
- **Backend/data:** FAQ/Text sources, imports, Knowledge Bases, processing jobs, chunk generations, lexical indexing, optional embeddings, and citations.
- **Frontend/integrations:** Knowledge CRUD/search/status and assistant linking UI; manual FAQ/Text content remains supported. Website registration and sync use backend APIs; dedicated dashboard onboarding is pending.
- **Security/performance/acceptance:** Workspace filters, visibility/readiness eligibility, bounded chunks/queries, source revalidation; accept when updates revoke stale evidence and authorized retrieval behaves correctly.
- **Status:** IMPLEMENTED_IN_CODE for FAQ/Text; optional infrastructure and runtime behavior remain NOT_RUNTIME_VERIFIED.

### Phase 07 — AI Provider Engine

- **Objective and deliverables:** Route bounded requests to configured model providers with truthful errors and provenance.
- **Backend/data:** Gemini, Groq, and OpenAI adapters, provider/model validation, configuration reporting, and explicit MANUAL/AUTO_FALLBACK policy.
- **Frontend/integrations:** Provider status is surfaced in assistant/training views without exposing credentials; provider accounts/keys are external prerequisites.
- **Security/performance/acceptance:** Timeouts, cancellation, validated outputs, no silent manual-mode fallback; accept after authorized provider-specific tests and fallback checks.
- **Status:** IMPLEMENTED_IN_CODE; live provider connectivity is NOT_RUNTIME_VERIFIED.

### Phase 08 — Conversational AI Engine

- **Objective and deliverables:** Orchestrate interpretation, context, social dialogue, scope, retrieval, clarification, grounded generation, and safe response acceptance.
- **Backend/data:** Conversation contracts/orchestrator, session history, idempotency, multilingual semantics, source routing, evidence and citation controls.
- **Frontend/integrations:** Authenticated Playground provides the current interactive channel; no public widget is included in this phase.
- **Security/performance/acceptance:** Tenant/session isolation, bounded history/evidence, live/static separation, and provider provenance; accept after deferred regression and manual conversation QA.
- **Status:** IMPLEMENTED_IN_CODE; quality and runtime outcomes are NOT_RUNTIME_VERIFIED.

### Phase 09 — AI Assistants & Training

- **Objective and deliverables:** Manage assistants, test behavior, assign FAQ/Text Knowledge, and configure grounded response behavior.
- **Backend/data:** Assistant APIs, activation and archive/restore lifecycle, behavior/business rules, provider route constraints, Playground/session persistence, Knowledge linking and training history. A nullable `Chatbot.archivedAt` field is introduced by an authored additive migration; permanent deletion is server-refused to protect retained related records.
- **Frontend/integrations:** Assistant list/editor, Training Center, Playground, Knowledge Base, workspace settings; no website/store connector is delivered here.
- **Security/performance/acceptance:** Authenticated tenant ownership, READY/PUBLIC_REFERENCE source policy, provider policy, bounded requests and citations; details are in the Phase 09 checklist.
- **Status:** IMPLEMENTATION COMPLETE — FINAL QA DEFERRED TO PHASE 30. Runtime behavior is NOT_VERIFIED; apply and verify the new additive archive migration before deployment. Permanent deletion remains unavailable pending retention architecture.

### Phase 10 — Dynamic Multi-Industry Workspace Dashboard

- **Objective and deliverables:** Adapt overview modules to selected industry and verified capabilities.
- **Backend/data:** The existing authenticated `GET /workspaces/:slug/dashboard-summary` now returns the persisted business profile, a current-month Playground session count (explicitly not customer traffic), bounded connected-integration summaries, tenant-scoped product/order aggregates, and owner/admin-only paid-order sales totals grouped by source currency for a bounded trailing 30-day window. Archived assistants are excluded. Draft connections are never counted as connected. Statuses distinguish unavailable integration/commerce summaries, disconnected sources, connected-without-data, and available data.
- **Frontend/UI:** The workspace overview resolves E-commerce, Healthcare, Landing Page, Service Business, and General Business profiles from the configured business type. Workspace owners/admins can select those values in existing workspace settings. E-commerce shows actual synchronized product/order summaries, recognized source-status counts, currency-separated sales and recent orders; other industries show capability-aware setup states. The saved website URL is explicitly not represented as a verified connection, crawl, lead source, or tracking integration. Existing workspace AI/Knowledge overview remains available to all types.
- **Security/performance:** All aggregate queries use the membership-resolved organization ID; sales totals are hidden from non-admin members. Queries use aggregate/group-by operations and a five-row bounded recent integration/order selection rather than loading full datasets. No customer or patient records are returned. No caching, new environment variables, schema changes, or migrations were added.
- **Status:** IMPLEMENTED_IN_CODE; RUNTIME_NOT_VERIFIED. Commerce widgets require actual authorized connected sources and synchronized records; integration/synchronization implementation remains in Phases 15–19. Healthcare operations, lead records, website tracking, and service bookings remain unavailable until their assigned data capabilities exist. Final responsive/runtime and regression QA is DEFERRED_TO_PHASE_30.

### Phase 11 — AI Conversations Inbox

- **Objective and deliverables:** List, search, filter, and inspect customer-channel conversations.
- **Backend/data:** Existing `SupportConversation`/`SupportMessage` records remain separate from Playground. Phase 11 adds visitor-session hashing, customer/assistant message intake for trusted application callers, idempotency, list previews/counts, per-member read state, status audit events, server-side filtering, and paginated message history. The intake contract has no public unauthenticated route; no customer-facing transport exists yet, so real records remain absent until a later authorized channel connects.
- **Frontend/integrations:** Responsive owner/admin inbox supports search, assistant/status/channel/read/date filters, latest/oldest sorting, list pagination, message history pagination, safe text rendering, unread indicators, and status updates. Empty/loading/error states explain that Playground remains separate.
- **Security/performance/acceptance:** All inbox reads and writes resolve an active workspace membership and restrict conversation access to owners/admins; database lookups remain organization-scoped and message history/list sizes are bounded. Visitor tokens are random and stored as SHA-256 hashes; status changes are audited. Assistant archive preserves history. Support records still reference assistants with the Phase 09 cascade behavior, while permanent assistant deletion remains refused by the application. No new environment variables were needed. Migration `20261014120000_phase_11_conversations_inbox` is authored and unapplied; TypeScript checks pass, and runtime/regression QA is deferred to Phase 30.
- **Status:** IMPLEMENTED_IN_CODE; CUSTOMER_CHANNEL_NOT_CONNECTED; MIGRATION_REQUIRED; RUNTIME_NOT_VERIFIED; QA_DEFERRED_TO_PHASE_30.

### Phase 12 — AI-Powered Ticketing & Two-Way Customer Messaging

- **Objective and deliverables:** Create customer tickets from explicitly confirmed AI conversation drafts. Operational statuses are OPEN, ACTIVE, PENDING, and CLOSED; ticket priority and status are independent of delivery state.
- **Backend/data:** Playground and the trusted Phase 11 customer adapter now delegate semantic interpretation, Knowledge retrieval, safety, provider routing, and grounded response generation to the same shared execution method. Customer turns persist in canonical `SupportConversation`/`SupportMessage` records with CUSTOMER/AI identity, bounded history and idempotency. Model-produced `draftAction: CONFIRM` is advisory only; ticket creation requires the typed `CONFIRM_TICKET_DRAFT` action bound to a draft ID and version. Draft requests, corrections, cancellation, pending confirmation and customer-owned status lookup run through the customer AI turn. Drafts verify workspace, assistant, conversation, and hashed visitor session and expire. Tickets link to the canonical Phase 11 conversation; owner/admin replies append one `BUSINESS_TEAM` message to that same stream and are rejected for closed tickets. Internal notes remain separate. The PostgreSQL outbox worker claims records with leases, bounded retry/backoff, attempt history, and crash recovery.
- **Frontend/integrations:** Owner/admin Tickets route provides persisted status KPIs, search, filtering, pagination, ticket detail, internal notes, activity, status/priority controls, assignment, and an owner reply composer that displays canonical conversation history. Reply persistence is not delivery confirmation.
- **Security/performance/acceptance:** Tenant and assistant ownership, hashed visitor session, lock lease, unique per-turn CUSTOMER/AI idempotency keys, bounded context, cancellation and request deadlines are enforced. Inference does not hold a database transaction open. Business-team messages and internal notes are excluded from AI context. Ticket APIs remain workspace-owner/admin scoped; a model interpretation alone cannot confirm a draft. The worker remains controlled by `TICKET_OUTBOX_WORKER_ENABLED` and has no registered customer transport, so it records `UNSUPPORTED_CHANNEL` until a trusted adapter is registered. Migration `20261014150000_phase_12_ticket_draft_confirmation_version` adds draft versions, support conversation processing leases and AI provenance columns; it is authored and unapplied. Runtime behavior is not verified.
- **Status:** IMPLEMENTED_IN_CODE for shared Playground/customer AI execution, canonical customer message persistence, bounded ticket draft dialogue and typed ticket confirmation; customer transport/delivery is DEFERRED_TO_PHASE_13. Migration application is UNVERIFIED; RUNTIME_NOT_VERIFIED; QA DEFERRED_TO_PHASE_30.

### Phase 13 — Chatbot Widget & Deployment

- **Objective and deliverables:** A technology-independent asynchronous embed, Shadow DOM customer chat, owner/admin widget installation and origin checks for Shopify, WooCommerce/WordPress, MERN, Next.js, PHP and static sites. No connector-specific integration is included.
- **Backend/data:** `WidgetConfiguration` is persisted in Phase 13 migration `20261014170000_phase_13_widget`. Public bootstrap issues HMAC-signed, short-lived access credentials and opaque resume credentials; the access credential hash is stored in `WidgetSession`, which is bound to the origin, tenant, assistant, pseudonymous visitor and canonical conversation. The browser receives no workspace IDs, customer-selected conversation IDs or provider credentials. Allowed origins are an abuse control, not proof of identity. Per-endpoint failures emit sanitized stage and request-ID diagnostics.
- **Customer AI and tickets:** Anonymous widget messages use `WidgetService.message → SaasService.recordCustomerMessage → ConversationOrchestrator.processTrustedCustomerTurn → executeSharedAI`, retaining Phase 11/12 Knowledge, multilingual response, grounding, safety and provider routing. Customer email OTP and customer identity-verification APIs are not part of widget auth. AI collects a ticket draft only for an explicit ticket request; only the separate typed `CONFIRM_TICKET_DRAFT` action for that session-bound draft ID/version creates it. Ticket references can be checked only in the original signed widget session and conversation; references do not grant access by themselves.
- **Ticket lifetime and cleanup:** `Ticket.expiresAt` is fixed at persisted `createdAt + 72 hours`; messages, status changes, reopen and owner replies never extend it. Ticket reads and writes reject expired records before cleanup runs. The `WidgetRetentionWorker` is registered but disabled unless `WIDGET_RETENTION_WORKER_ENABLED=true`. It processes at most 20 locked ticket-linked conversations per batch, uses `FOR UPDATE SKIP LOCKED`, closes and deletes due tickets with drafts, notes, events, deliveries and delivery attempts, removes ticket-associated business/status/confirmation messages, and deletes the exact tenant/assistant-scoped conversation with its full message history when no unexpired ticket remains. With multiple tickets in one conversation, each ticket and its linked records expire independently; shared AI/customer history is retained for the remaining active ticket(s), and the entire shared conversation is deleted when the last ticket expires. This is the deliberate boundary needed to preserve active ticket sessions.
- **Owner replies:** Replies require an existing, non-CLOSED, non-expired ticket and are persisted as `BUSINESS_TEAM` in its canonical conversation. The widget receives them via bounded session polling and acknowledges actual receipt through the existing outbox path. Internal notes remain private. AI assistance continues while the widget session remains valid. An expired last-ticket session receives HTTP 410 and cannot resume old history; the widget clears its old local credential and transcript and starts a fresh conversation.
- **Frontend/deployment:** Dashboard → Widget / Installation saves enablement, assistant, approved domains and branding; provides a settings preview, authenticated Playground test chat, installation guidance and live script/API readiness checks. `frontend/public/widget.js` is dependency-free, async, Shadow DOM isolated, safely renders text and validated HTTPS source links, supports keyboard navigation, responsive safe-area layout, bounded/cursor history, reconnect, ticket status and expiry details. Storefront position, name, greeting, color, avatar and suggested questions come from public bootstrap configuration. Nginx retains `/api/v1/` ahead of SPA fallback and serves `/widget.js` from the frontend public root. Theme App Embed is not implemented; Shopify installation uses the documented theme-code snippet.
- **API contracts (under `/api/v1`):** Owner/admin installation: `GET /workspaces/:slug/widget?assistantId=:uuid`, `PATCH /workspaces/:slug/widget`. Public origin-checked session: `POST /widgets/bootstrap` `{ widgetId, resumeToken? }`; `POST /widgets/session/renew`; `GET /widgets/session/history?limit=&before=`; `GET /widgets/session/deliveries?after=`; `POST /widgets/session/messages` `{ content, idempotencyKey }`; `POST /widgets/session/tickets/:draftId/confirm` `{ action: "CONFIRM_TICKET_DRAFT", version }`; `POST /widgets/session/tickets/:draftId/cancel`; `POST /widgets/session/tickets/status` `{ reference }`; and `POST /widgets/session/deliveries/ack` `{ messageIds }`. Every customer request requires the signed bearer and is bound to origin, organization, assistant, visitor session and canonical conversation.
- **Configuration and deployment dependencies:** `WIDGET_RETENTION_WORKER_ENABLED=false` is present in backend `.env` and `.env.example`. Owner account email OTP settings and `AUTH_OTP_HASH_SECRET` remain for owner authentication only. No frontend variables changed. Apply migrations in order before enabling cleanup: Phase 11 conversations, Phase 12 ticketing/outbox/draft confirmation, Phase 13 widget configuration, and `20261014190000_phase_13_widget_retention`. The retention migration backfills existing tickets to `createdAt + 72 hours` and adds indexed expiry and opaque session credential storage. This implementation did not apply migrations or inspect database migration history. Review backup retention separately: deleting database rows cannot remove older retained database backups.
- **Status:** IMPLEMENTED_IN_CODE; migrations and runtime provider/deployment behavior are unverified. Do not enable the retention worker until migration application and deployment configuration are verified. Storefront installation, session creation, styling, positioning, chat, ticket actions and Playground regression verification remain pending manual verification and Phase 30.

### Phase 14 — Team & Workspace Management

- **Objective and deliverables:** Manage members, invites, roles, workspace profile, and access revocation.
- **Backend/data:** Membership/invitation states and server-enforced permission checks.
- **Frontend/integrations:** Team and settings pages with role-aware controls.
- **Security/performance/acceptance:** Least privilege, no frontend-only role enforcement, bounded member listing; accept after invitation, expiry, revocation and role regression checks.
- **Status:** DEFERRED — FUTURE SCOPE. Existing Owner/Admin authentication, membership checks, tenant isolation and ticket permissions remain in force; Phase 15 does not expand team management.

### Phase 15 — Universal Connector Framework

- **Objective and deliverables:** A versioned adapter registry defines authentication, configuration, capabilities, sync resources and webhook signature contracts. Adapters implement `connect`, `verify`, `disconnect`, `sync`, `handleWebhook` and capability discovery. Platform technology, business industry and actually verified capabilities are separate concepts.
- **Backend/data:** Tenant-scoped `ConnectorInstance`, AES-256-GCM `ConnectorCredential`, leased `ConnectorSyncJob`, and deduplicated encrypted `ConnectorWebhookEvent` records are added by migration `20261014200000_phase_15_connector_framework`. The Generic HTTPS health adapter remains health-only. The versioned provider-neutral business API adapters for MERN, PHP, Next.js and WordPress are implemented in Phase 16C. Static websites use verified Phase 16A crawling.
- **Credentials:** Credentials are encrypted with AES-256-GCM using a random 96-bit nonce, authentication tag, record-specific associated data and a versioned separately configured key. The server decrypts only for adapter operations. Missing/invalid encryption keys fail closed. The key must be supplied through `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`; generate a random 32-byte key and encode as 64 hex characters or base64. Never reuse owner/customer OTP or session signing secrets. `CONNECTOR_CREDENTIAL_PREVIOUS_KEYS` supports explicitly configured older key versions for rotation. Credential values are excluded from API responses and audit metadata.
- **Frontend/integrations:** Dashboard → Integrations reads the real registry and persisted tenant connector records. It supports Generic HTTPS health, Shopify, WooCommerce and the Phase 16C Business API setup, encrypted credentials, verification, disconnect, capability display, provider sync actions and bounded sync history. Static-site content uses Knowledge website registration/verification and crawl APIs. UI errors reflect API responses; no sample connection activity or success metrics are fabricated.
- **Security/performance/acceptance:** Owner/Admin-only configuration and operations use workspace authorization and tenant-scoped database predicates. Outbound requests require HTTPS, reject private/reserved/metadata DNS results, pin the validated public destination, bound response size and timeout, and revalidate redirects while stripping authorization on cross-origin redirects. Webhooks require a registered signature scheme, timestamp/replay window, bounded raw body, per-IP rate limit, tenant-bound opaque endpoint and deduplicated event ID; no unsigned endpoint is accepted. Sync/webhook workers use bounded batches, PostgreSQL `FOR UPDATE SKIP LOCKED`, lease tokens, bounded attempts and capped backoff. Sync jobs are rejected if no real adapter declares their resource. AI remains read-only; `CommerceReadContracts` are exported internally but are not called by `ConversationOrchestrator`.
- **API:** Workspace routes under `/api/v1/workspaces/:slug/connectors`: `GET catalog`, `GET capabilities`, `GET` list, `POST` create, `PATCH /:connectorInstanceId`, `POST /:id/credentials`, `/verify`, `/reconnect`, `/disconnect`, `/sync-jobs`, and `GET /:id/sync-jobs?before=&limit=`. Owner/Admin mutation routes use the existing session guard and workspace RBAC. The public receiver `POST /api/v1/connectors/webhooks/:webhookPublicId` is authenticated by the adapter's verified HMAC signature and timestamp, not by owner session; it accepts `x-connector-event-id`, `x-connector-event-type`, `x-connector-timestamp`, and `x-connector-signature` over `timestamp + "." + raw request bytes`.
- **Environment and deployment:** Backend `.env` and `.env.example` define `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`, `CONNECTOR_CREDENTIAL_KEY_VERSION`, `CONNECTOR_CREDENTIAL_PREVIOUS_KEYS`, `CONNECTOR_SYNC_WORKER_ENABLED`, `CONNECTOR_SYNC_POLL_MS`, `CONNECTOR_SYNC_BATCH_SIZE`, `CONNECTOR_SYNC_MAX_ATTEMPTS`, `CONNECTOR_MAX_CONFIG_BYTES`, `CONNECTOR_WEBHOOK_MAX_BYTES`, and `CONNECTOR_WEBHOOK_RATE_LIMIT_PER_MINUTE`. Frontend environment files require no connector secrets. Keep `CONNECTOR_SYNC_WORKER_ENABLED=false` until the migration is applied, encryption key is securely configured, and deployment/database configuration is verified. The migration is authored and unapplied; no database migration history was queried. Apply after prerequisite Phase 09 tenant/integration foundations and Phase 12 outbox/ticket migrations are reviewed and applied in order. HTTPS reverse-proxy routes must preserve `/api/v1/connectors/webhooks/` raw request bytes; only that route retains the bounded raw body for signature validation.
- **Status:** IMPLEMENTED_IN_CODE for registry, health and business API adapters, credential vault, tenant management, sync job persistence/worker, signed webhook intake/worker, and dashboard. Shopify is the only currently available live test platform. The migration is authored; database application state and worker configuration must be checked in each environment. Other-platform runtime acceptance is deferred until after Phase 30.

### Phase 16 — Shopify & WooCommerce Integrations

- **Objective and deliverables:** Connect authorized stores and synchronize supported catalog/order data.
- **Backend/data:** Registered `shopify_v1` and `woocommerce_v1` adapters use Shopify offline authorization-code tokens + Admin GraphQL and WooCommerce HTTPS `wc/v3` read operations. Provider outputs normalize into tenant-scoped `CommerceProduct`, `CommerceProductVariant`, `CommerceOrder`, and `CommerceOrderLine` records linked to `IntegrationConnection`; provider IDs, external update timestamps, currency, prices, availability, and provider status are retained separately. Unavailable inventory, currency, image, or payment details remain null instead of being inferred. Order customer/address data is not selected or persisted. Page cursors, high-watermark incremental checkpoints, idempotent upserts, retry/backoff, bounded nested pagination and PostgreSQL worker leases reuse Phase 15. Signed Shopify and WooCommerce webhooks deduplicate and enqueue incremental resource sync; Shopify uninstall revokes local credentials and connection state.
- **Shopify authorization:** Owner/Admin starts a new install at `POST /api/v1/workspaces/:slug/connectors/shopify/install`; the explicit connected-store permission upgrade is `POST /api/v1/workspaces/:slug/connectors/shopify/scope-upgrade`. Both reuse the tenant/user/connector/shop-bound one-time state, HMAC and timestamp validation, authorization-code exchange, encrypted expiring offline tokens and server-side refresh rotation. `SHOPIFY_SCOPES` remains the legacy install request list. The typed, empty-by-default upgrade allow-list in `backend/src/config/shopify-scope-upgrade.config.ts` is populated only with deliberately selected read-scope handles from the released Dev Dashboard version; it is displayed to the owner/admin and used only after explicit action. The callback preserves the stored connection when Shopify's verified snapshot retains prior grants; newly requested scopes can be declined and are not treated as granted. Shopify does not provide this standalone backend a runtime API for reading Dev Dashboard declarations. See [Shopify scope upgrade](docs/integrations/shopify-granted-scopes.md).
- **WooCommerce authorization:** Dashboard accepts a store HTTPS URL and consumer key/secret, verifies a real products request, and detects order capability with a real read request. Configure a read-only WooCommerce REST key in WooCommerce; the standard REST endpoints allow verifying read access, while the store owner must create the key with read-only permission. Credentials are encrypted with the Phase 15 vault; optional webhook secret is used only to authenticate provider events. Store currency is read from `settings/general` when the credential permits it, and otherwise remains unknown.
- **Frontend/integrations:** Dashboard → Integrations provides Shopify install, WooCommerce credential setup, verified capability display, reconnect/verify, disconnect, product/order full and incremental sync actions, last-successful-sync and job history. Provider webhooks use `POST /api/v1/connectors/webhooks/:webhookPublicId`; configure actual provider webhook subscriptions/topics to the displayed tenant endpoint. Shopify uses its app client secret for raw-body HMAC; WooCommerce uses the configured webhook secret and validates the store source.
- **AI commerce retrieval:** The shared conversation orchestrator now searches connected, tenant-scoped normalized product records on product, price, and availability intents. Bounded evidence includes descriptions, category, SKU, selected variants, price, inventory/status and source timestamps; citations are revalidated against the current product record and connection before response persistence/replay. Knowledge remains the source for policies, FAQs, pages and services. Order lookup remains unavailable to public customers because verified customer-to-order ownership is not implemented; workspace order reads remain Owner/Admin only.
- **Security/performance/acceptance:** Existing outbound policy blocks private/reserved destinations, DNS pins and bounds requests; connector queries remain tenant-scoped. Workspace product/order reads require authenticated workspace access, and order reads require Owner/Admin. Orders are read-only and omit customer PII. The internal customer-order contract is not exposed to the widget, which has no verified customer-to-order ownership mechanism; order-specific AI access remains disabled. Manual retry creates an idempotent tenant-scoped job. The owner reports Shopify OAuth connected and verified. Product sync and AI retrieval have not been runtime verified in this task. No WooCommerce runtime test is claimed.
- **Status:** Shopify OAuth/provider sync and normalized persistence are IMPLEMENTED_IN_CODE; product catalog retrieval is IMPLEMENTED_IN_CODE but not runtime verified by this implementation task. WooCommerce reuses the existing provider adapter and normalized records, with runtime verification deferred until after Phase 30. `20261015120000_phase_16_shopify_woocommerce` is authored; database application and worker configuration must be confirmed per environment. Shopify is the sole live testing platform.

### Phase 16A — Website Knowledge Ingestion

- **Objective and deliverables:** Restore verified website ingestion through existing Knowledge, crawler, page/chunk, worker, and retrieval architecture.
- **Backend/data:** Owner/Admin registration and DNS TXT verification; manual and scheduled crawl jobs; page extraction and sanitization; generation-based chunk publication; content-hash change tracking; explicit 404/410 page removal; retryable worker lifecycle; tenant-scoped sync history.
- **RAG wiring:** Website sources can be included in an active Knowledge Base assigned to an assistant. Public retrieval requires `PUBLIC_REFERENCE`, completed publication, current source verification, active assistant/Base links, verified assistant site origin, and source domain matching the assistant's verified site. Evidence is revalidated before use.
- **Security/performance/acceptance:** DNS public-address checks, pinned destination validation, TLS, same-host redirects, robots handling, private-route and sensitive-query exclusion, bounded pages/depth/bytes/time, sanitized text, tenant scoping and no authenticated crawling. No private commerce/order/customer connector data is indexed.
- **Status:** IMPLEMENTED_IN_CODE; not runtime verified. Existing Phase 08 schema/migrations provide required tables and columns; no new migration authored. Dedicated dashboard setup is not implemented. The current extraction indexes readable public page text; structured product-schema extraction is not implemented.

### Phase 17 — WordPress, MERN, Next.js, PHP & Static Website Integrations

- **Objective and deliverables:** Provide public-content ingestion and compatible custom API contracts across WordPress, MERN, Next.js, PHP, and static websites.
- **Backend/data:** Phase 16C supplies shared pull-based Business Data API v1 adapters for MERN, PHP, Next.js and WordPress. Public static pages reuse verified Phase 16A crawling, robots/sitemap discovery and bounded RAG indexing.
- **Frontend/integrations:** Connector dashboard can configure the supported Business API adapters, queue product/content sync, and inspect retryable sync history. The Phase 13 widget installation remains a script embed and works from WordPress, MERN, PHP, Next.js and static HTML shared layouts.
- **Security/performance/acceptance:** API credentials use the existing encrypted connector vault; all outbound API requests use HTTPS, public DNS validation, pinned IP, bounded bodies and timeout. Content is stored as internal-restricted Knowledge Text until an owner assigns/publishes it. No public order/customer data is ingested. Runtime verification for WordPress, MERN, Next.js, PHP, and static websites is deferred until after Phase 30; Shopify remains the only live test platform.
- **Status:** API contracts, platform adapters, WordPress plugin, worker ingestion and developer examples are IMPLEMENTED_IN_CODE. Static crawler behavior is implemented in Phase 16A. This phase is not runtime verified; provider-specific order APIs and signed event webhooks are not implemented.

### Phase 16C — Universal Website Connectors

- **API and adapters:** `business_api_v1` contract version `1.0` is exposed by registered `mern_business_api_v1`, `php_business_api_v1`, `nextjs_business_api_v1` and `wordpress_business_api_v1` connector definitions. The pull API supports bounded cursor pagination, incremental `updatedAfter`, product/variant snapshots, public content snapshots, high-watermark checkpoints and stable deletion IDs. The existing WooCommerce adapter remains registered and continues to normalize catalog/order data through Phase 16's commerce tables.
- **Normalization and AI:** Product records/variants are persisted through the existing commerce sync worker and structured CommerceProduct models. Content records become connector-specific Knowledge Text sources and are sent to the existing indexing worker. Content sources default to `INTERNAL_RESTRICTED`, do not auto-link to assistants, and only become public evidence after explicit Knowledge Base assignment and visibility configuration. The existing orchestrator retrieves products from commerce and pages/policies/FAQs/services from Knowledge. Orders remain unavailable to public AI until verified customer-to-order ownership is implemented.
- **WordPress and static sites:** `integrations/wordpress/carteio-business-data.php` provides authenticated published-page and, when WooCommerce is installed, published-product/variant endpoints. Static HTML requires no server connector: add a DNS-verified website source and use the existing robots-aware, sitemap-discovering crawler. These sources retain the existing website ownership/crawl gates.
- **Developer materials:** `docs/integrations/business-data-api-v1.md` defines routes, response shapes, pagination/deletion semantics, visibility and installation snippets for MERN, PHP, Next.js, WordPress and static sites. Widget instructions use the existing Dashboard → Widget / Installation script and approved-origin configuration.
- **Security and gaps:** Organization predicates and encrypted credentials are reused. Remote requests retain HTTPS, DNS/public-address validation, IP pinning, same-origin API paths, response caps and timeouts. API-fed content is sanitized and same-host source URLs are enforced; provider code must only expose published public content. `POST /orders/lookup` is reserved in the contract for provider-side verified ownership but is not called or implemented by this app. Universal API signed webhooks and full reconciliation of arbitrarily large tombstone backlogs are not implemented; use incremental pull sync.
- **Status:** PARTIAL — the provider-neutral product/content path, WordPress plugin and integration documentation are IMPLEMENTED_IN_CODE, but Phase 16C is not complete. Provider-side order lookup, universal API webhooks, robust tombstone backlog reconciliation and runtime acceptance remain outstanding. No new schema or migration was required. Other-platform runtime verification is deferred until after Phase 30.

### Phase 16D — Universal Permissions & Integration UX

- **Permission model:** `ConnectorDataPermission` stores workspace/connector category choices and `AssistantConnectorDataPermission` stores per-assistant choices. Effective access requires a connected connector, a verified provider capability/scope, workspace enablement, and assistant enablement. Owner/Admin-only APIs are `GET/PATCH /api/v1/workspaces/:slug/connectors/:connectorInstanceId/permissions`; every mutation writes a tenant-scoped audit event. Customer PII is hard denied. Existing connected product, price and category access is seeded by the additive migration to preserve the current product-answer path; inventory, orders, public pages and policy content remain off until enabled.
- **Enforcement:** Workspace sync permission is separate from workspace AI permission, with assistant AI permission as a further gate. Sync enqueue and worker persistence enforce sync permissions; Shopify product queries omit inventory/price fields when syncing those categories is disabled. Commerce read contracts, workspace product/order/sales endpoints, Knowledge retrieval, public widget evidence revalidation, replay and citations check current AI permissions. Disabling workspace AI immediately blocks retrieval; sync can continue only if separately enabled. When both AI access and sync are disabled for a category, product/order snapshots are deleted, price/inventory fields are cleared, and connector-fed page/policy chunks and source bodies are deleted. Disabled assistant access is immediately filtered without deleting data shared with other assistants. Shopify `app/scopes_update` webhook processing synchronizes granted scopes and clears revoked optional data. End-customer order lookup remains unavailable without verified order ownership.
- **Integration UI:** Dashboard → Integrations now shows connected/available adapters, existing guided setup and sync history, connection health, workspace and assistant permission toggles, actual verified provider scope status, and a working link to the existing Widget / Installation page. A toggle controls only Carteio AI access; it does not grant Shopify or other provider permissions.
- **Shopify OAuth compatibility:** Carteio is a standalone/API-only app and retains the authorization-code grant, callback URL, expiring offline token/refresh-token rotation, encrypted credentials, and HMAC/state/shop validation. `SHOPIFY_SCOPES` remains the requested-scope input for the legacy `/admin/oauth/authorize` compatibility path; it is never treated as actual granted access. The Permissions Dashboard reads actual grants from `currentAppInstallation.accessScopes`; a missing scope is labeled unknown because the backend cannot establish whether it was undeclared, not requested, or declined. Dev Dashboard app-version configuration does not by itself prove that this legacy request parameter can safely be omitted. Any transition must be validated on a development store and explicitly gated; see [Shopify installation and granted scopes](docs/integrations/shopify-granted-scopes.md).
- **Manual Shopify plan:** In the Shopify Dev Dashboard, open Apps → your app → Versions → Create version. Set `read_products` as required and `read_inventory` plus `read_orders` as optional. In the version's Webhooks configuration, subscribe to `app/scopes_update` with destination `https://<backend-host>/api/v1/connectors/webhooks/shopify/scopes-update`. Do not release the scope change until the app-side optional-scope request flow is implemented and staged against a development store; do not replace the existing client ID/secret or stored tokens. The endpoint validates Shopify HMAC, maps shop domain to one connector, synchronizes granted scopes, and blocks/purges revoked data. Shopify requires optional scopes to be declared and deployed before they can be requested dynamically; scopes declared as required cannot be requested dynamically. See [Shopify access-scope management](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes), [Shopify Dev Dashboard app versions](https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard), and [Shopify webhook subscriptions](https://shopify.dev/docs/apps/build/webhooks/subscribe).
- **Migration and status:** `20261015130000_phase_16d_connector_permissions` is authored and unapplied. Apply after reviewing the existing migration chain with `pnpm --filter backend exec prisma migrate deploy`; do not use `db push`. No new environment keys are required. Shopify remains the only live test platform; permission behavior and the new migration need manual runtime verification. Other-platform runtime testing remains deferred until after Phase 30. Phase 16 is not complete until the migration, Shopify app scope plan, and runtime checks are resolved.

### Phase 18 — Industry Data Models

- **Objective and deliverables:** Normalize supported commerce, service, healthcare, and website event data without losing source identity.
- **Backend/data:** Commerce product/order/line foundations exist; customer, appointment, lead, event, and domain-specific models remain incomplete.
- **Frontend/integrations:** Capability-aware field presentation and unavailable states.
- **Security/performance/acceptance:** Minimize sensitive data, tenant-scoped keys/indexes, currency/time semantics; accept after source mapping and privacy review.
- **Status:** PARTIAL; existing schema is not a complete cross-industry data model.

### Phase 19 — Real-Time & Scheduled Data Synchronization

- **Objective and deliverables:** Maintain fresh records through bounded jobs, webhooks, incremental sync and recovery.
- **Backend/data:** Sync-job persistence exists; commerce adapters, queueing, worker ownership, cursor recovery and metrics are not complete.
- **Frontend/integrations:** Progress, last successful sync, warnings, errors, pause/retry/revoke UI.
- **Security/performance/acceptance:** Idempotent upserts, bounded concurrency, backoff, tenant quotas and revocation; accept after duplicate, partial, timeout, and restart recovery tests.
- **Status:** PARTIAL schema foundation; no operational commerce synchronization is evidenced.

### Phase 20 — AI Tool Registry

- **Objective and deliverables:** Register server-owned tool schemas, risk, permissions, timeouts, retry, and audit policy.
- **Backend/data:** Allowlisted typed registry and validation; no model-generated arbitrary URL or self-granting permissions.
- **Frontend/integrations:** Owner-visible capability/permission settings only for implemented tools.
- **Security/performance/acceptance:** Strict tenant/resource scope and bounded execution; accept when every proposed tool is independently authorized by server rules.
- **Status:** PENDING.

### Phase 21 — Live Business Data Tools

- **Objective and deliverables:** Add authorized, customer-scoped read tools for product, inventory, order, fulfillment, or service data.
- **Backend/data:** Connector-backed read operations and authenticated customer/resource matching.
- **Frontend/integrations:** Clear source, freshness, permission and unavailable status.
- **Security/performance/acceptance:** Never retrieve private records by typed identifier alone; bounded API calls and truthful provenance; accept after ownership and revocation tests.
- **Status:** PENDING / EXTERNALLY_BLOCKED by absent verified connectors and customer authorization channel.

### Phase 22 — Agent Workflow Engine

- **Objective and deliverables:** Execute bounded multi-step workflows with explicit state, deadline, cancellation, retry, and audit.
- **Backend/data:** Workflow/step schema foundation exists; state machine, executor, resume and recovery APIs are absent.
- **Frontend/integrations:** Workflow status and step-result views, only after execution is real.
- **Security/performance/acceptance:** Step ceilings, strict schemas, idempotency and no unbounded loops; accept after crash/retry/cancel testing.
- **Status:** PARTIAL persistence only; no executable engine.

### Phase 23 — Approval & Action Security

- **Objective and deliverables:** Bind explicit user/staff approvals to exact arguments and an expiry before sensitive actions.
- **Backend/data:** Approval-record foundation exists; confirmation, reauthorization, expiry and commit path are absent.
- **Frontend/integrations:** Preview and approve/deny controls tied to a concrete operation.
- **Security/performance/acceptance:** Approval argument hash, identity, permission, expiry, idempotent commit and audit; ordinary acknowledgments never authorize actions.
- **Status:** PARTIAL persistence foundation; no live action approval flow.

### Phase 24 — Industry Agent Capabilities

- **Objective and deliverables:** Offer approved workflows for commerce, healthcare, and service domains.
- **Backend/data:** Domain-specific tool schemas, source authority, consent and action policy.
- **Frontend/integrations:** Industry-appropriate configuration and operation previews.
- **Security/performance/acceptance:** Sensitive health/financial/customer data restrictions, strong authorization, rate/step limits; accept after domain owner review and failure-path tests.
- **Status:** PENDING and dependent on connectors, tools, workflows, and approvals.

### Phase 25 — E-commerce Business Dashboard

- **Objective and deliverables:** Show actual product, order, inventory, revenue, refund, and best-seller views.
- **Backend/data:** Indexed server pagination, status-aware aggregates, currency/time-zone rules, and authorized exports.
- **Frontend/integrations:** Search, filter, details, charts, and unavailable states driven by synchronized data.
- **Security/performance/acceptance:** No fabricated zeros or mixed-currency totals; efficient database aggregates; accept after reconciliation against source-store data.
- **Status:** PARTIAL read UI/API foundation; real data requires Phase 16/19 connectors and sync.

### Phase 26 — Healthcare, Service & Landing Page Dashboards

- **Objective and deliverables:** Display verified appointment/service/lead/site-event metrics for supported businesses.
- **Backend/data:** Approved domain models, consented events, retention, and scoped aggregation.
- **Frontend/integrations:** Industry-specific dashboards and capability-aware empty states.
- **Security/performance/acceptance:** Health privacy and consent, no unrestricted patient Knowledge, bounded aggregates; accept after domain privacy review and data-source reconciliation.
- **Status:** PENDING; domain data and consent instrumentation are absent.

### Phase 27 — Analytics, Plans & SaaS Billing

- **Objective and deliverables:** Define real plans, enforce entitlements, meter usage, and support a verified payment lifecycle.
- **Backend/data:** Plan/subscription/usage foundation models exist; complete meters, entitlement checks, payment events, and provider webhooks are absent.
- **Frontend/integrations:** Usage and billing states; no success/payment claims without an actual configured gateway.
- **Security/performance/acceptance:** Idempotent metering, signed webhooks, bounded aggregates and access separation; accept after sandbox reconciliation.
- **Status:** PARTIAL / EXTERNALLY_BLOCKED pending a billing provider and approved plan configuration.

### Phase 28 — Super Admin & Platform Operations

- **Objective and deliverables:** Isolated platform operator view for aggregate health, accounts, plans, provider and connector operations.
- **Backend/data:** Separate PlatformOperator and audit foundations, guarded aggregate read path; provisioning, audit writes and privileged operations remain incomplete.
- **Frontend/integrations:** Separate operator-only routes and privacy-safe diagnostics.
- **Security/performance/acceptance:** Workspace OWNER is not platform SUPER_ADMIN; strong authentication, audited writes, no default raw tenant transcript access; accept after privilege-boundary tests.
- **Status:** PARTIAL read-only foundation; not a complete Super Admin product.

### Phase 29 — Performance, Security & Observability

- **Objective and deliverables:** Harden all APIs, queues, connectors, providers, tools, dashboards, and operational diagnostics.
- **Backend/data:** Existing validation, tenant scoping, structured logs, rate limits, and some indexes are foundations; end-to-end observability and scale validation remain.
- **Frontend/integrations:** Accessible responsive states, cancellation, efficient lists and safe connection failures.
- **Security/performance/acceptance:** No secrets or full private transcripts in logs, indexed queries, measured representative load; accept only with security review and actual benchmark evidence.
- **Status:** PARTIAL foundations; no platform-wide performance/security sign-off.

### Phase 30 — End-to-End Testing & Production Readiness

- **Objective and deliverables:** Run authorized unit, integration, security, live-provider/connector, migration, accessibility, and performance validation; close launch blockers.
- **Backend/data:** Validate schema/client/migration state, backups/recovery, data isolation, and deployment procedures.
- **Frontend/integrations:** Manual browser/device acceptance and realistic role/capability states.
- **Security/performance/acceptance:** No release claim without executed evidence, incident/rollback readiness, and approved external test systems.
- **Status:** PENDING. Development-phase tests are deferred; the repository CI workflow is configured to run test commands when triggered, but its presence is not a current passing result.

## Development setup

### Prerequisites

- Node.js `>=24.11.0 <25` (`.nvmrc` records the repository version).
- pnpm 9.15.0, as recorded by the root `packageManager` field.
- A PostgreSQL/Neon environment only for database-backed development paths. Use non-production credentials for local and UAT work.

### Install and run manually

After reviewing the scripts and configuring local environment files, developers can install and run the applications:

```sh
pnpm install
pnpm dev                 # frontend and backend
pnpm dev:frontend        # frontend only: http://localhost:3000
pnpm dev:backend         # backend only: http://localhost:5000
```

The backend development script invokes Prisma Client generation before Nest starts. If the local platform engine, schema, or generated client is unavailable, resolve that in the supported project environment before starting a database-backed runtime. Do not use `db push` or database reset as a workaround for migration state.

After the services are available, the API health route is `GET http://localhost:5000/api/v1/health`; through Vite it is `GET http://localhost:3000/api/v1/health`. Local NestJS binds to `127.0.0.1` by default. A production container may bind to `0.0.0.0` only behind its private network/proxy, with exact HTTPS CORS origins and a documented proxy-hop count.

Copy the relevant `.env.example` file to an ignored local `.env` only when needed. Never commit local credentials. `VITE_*` variables are public build-time values and must not contain secrets. Backend configuration and providers are private. Environment variable names are listed below; this README contains no values.

### Useful checks

```sh
pnpm --filter @carteio/backend typecheck
pnpm --filter @carteio/frontend typecheck
pnpm --filter @carteio/backend exec prisma validate
pnpm --filter @carteio/backend exec prisma generate
```

The root `pnpm typecheck` script first generates Prisma Client, then runs workspace typechecks. Typechecking and schema validation are different checks. During development phases, authors may add tests but must not run Jest, Vitest, evaluation, integration, live-provider, or load suites until the owner authorizes the Phase 30 QA milestone. The configured CI workflow includes test execution; developers must account for that before pushing changes if CI execution is not yet authorized.

## Configuration and deployment

### Environment variables

Configuration is validated by the backend. Names below are taken from repository configuration/examples; secret values must remain in local/deployment secret storage.

| Purpose | Variable names |
|---|---|
| Runtime/network | `NODE_ENV`, `PORT`, `HOST`, `API_PREFIX`, `CORS_ALLOWED_ORIGINS`, `TRUST_PROXY_HOPS`, `LOG_LEVEL` |
| Database | `DATABASE_URL` (application/pooler connection where configured), `DIRECT_URL` (direct Prisma migration connection) |
| Authentication | `AUTH_SESSION_DAYS`, `PUBLIC_APP_URL`, `AUTH_OTP_EXPIRES_MINUTES`, `AUTH_OTP_MAX_ATTEMPTS`, `AUTH_OTP_RESEND_COOLDOWN_SECONDS`, `AUTH_OTP_HASH_SECRET`, `GOOGLE_CLIENT_ID`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM` |
| AI providers | `AI_DEFAULT_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Playground limits | `PLAYGROUND_USER_REQUESTS_PER_MINUTE`, `PLAYGROUND_WORKSPACE_REQUESTS_PER_MINUTE` |
| Knowledge processing | `KNOWLEDGE_WORKER_ENABLED`, `KNOWLEDGE_SEMANTIC_ENABLED`, `KNOWLEDGE_EMBEDDING_PROVIDER`, `KNOWLEDGE_EMBEDDING_MODEL` |
| Optional isolated renderer | `KNOWLEDGE_BROWSER_RENDERING_ENABLED`, `KNOWLEDGE_RENDERER_IMAGE` |
| Frontend public configuration | `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID` |

The full current variable list and validation rules live in `backend/.env.example`, `frontend/.env.example`, `backend/src/config/env.validation.ts`, and `docs/architecture/ENVIRONMENT.md`. Do not paste `.env` contents into documentation or issue reports.

### Prisma and migration discipline

Prisma schema and migration files are reviewed together. `DIRECT_URL` must target the intended non-production environment for UAT operations; the application URL may use a pooler as configured. Schema validation and Client generation do not apply migrations. `migrate deploy` does. Never use `prisma db push`, `migrate reset`, or manual edits to Prisma migration state as a deployment shortcut. Back up the target database, verify its host/branch, inspect migration status, and follow the approved UAT/production release procedure before applying SQL.

The owner reported that the Phase 09 SaaS foundation migration was applied in their environment. No database state is asserted here. UAT and production must be checked independently using their approved credentials and deployment process.

### CI and UAT

The repository CI workflow uses Node 24 and pnpm 9.15.0, installs from the frozen lockfile, generates Prisma Client, typechecks, lints, runs tests, and builds. This is configuration evidence, not proof that a particular run passed.

The UAT workflow validates its direct Neon target and migration files, validates the Prisma schema, generates the client/typechecks, and applies pending migrations to the configured UAT database. UAT application deployment is gated separately by `UAT_DEPLOY_ENABLED` and configured Vercel project variables. Verify actual GitHub Environment secrets/variables and deployment state in the operator console; do not assume this workflow has run successfully.

The Nginx templates document an alternative production routing shape: serve the single frontend build and proxy `/api/v1/` to a private NestJS upstream. TLS, runtime infrastructure, backups, secret provisioning, and production release are operator responsibilities not proven by this checkout.

### External prerequisites

- Gemini, Groq, or OpenAI credentials and account/model access for live provider use.
- Neon/PostgreSQL database URLs and approved migrations for persistence in an environment.
- Google OAuth and email delivery configuration for the enabled authentication paths.
- A secret-manager/KMS design before storing connector credentials; current connection foundations intentionally store only opaque secret references and do not implement provider credential storage.
- Customer-owned, authorized websites/stores and API credentials before validating connectors.
- A selected billing provider and sandbox before accepting or reporting payments.
- Isolated worker infrastructure before enabling browser rendering or scaling background sync beyond the current bounded Knowledge processing design.

## Permanent development rules

These rules apply to future Codex implementation phases:

1. Use one comprehensive prompt per phase and implement only that assigned phase.
2. Preserve existing behavior, data compatibility, uncommitted work, and architecture; inspect before changing.
3. Reuse the custom NestJS AI architecture. Do not introduce LangChain, LangGraph, a duplicate chat engine, or unnecessary services.
4. Give every in-scope screen clear hierarchy, responsive layouts, accessible controls, and loading/empty/error/permission states without unrelated redesign.
5. Optimize APIs and database retrieval with bounded inputs/results, server pagination/filtering, appropriate indexes, cancellation, and measured claims.
6. Enforce authentication, tenant isolation, RBAC, schema validation, source permissions, evidence revalidation, and business-action authorization on the server.
7. Never fabricate products, orders, revenue, customers, connector health, provider availability, citations, payments, or action results.
8. Do not make unnecessary model calls. Keep deterministic code for authorization and contracts; use the configured model for natural language interpretation and wording.
9. Do not add dependencies or alter lockfiles without approval. Do not use destructive Git commands.
10. Do not apply unauthorized migrations, reset databases, or mutate production data. Keep secrets out of the browser, source control, logs, and documentation.
11. Tests may be authored during development, but do not execute Jest/Vitest/evaluation/integration/live-provider/load suites until the Phase 30 testing milestone is explicitly authorized. TypeScript typechecks and static source review are allowed.
12. Defer detailed response-accuracy tuning and semantic benchmarking until real authorized business datasets are available. Continue enforcing security-critical factual restrictions throughout.
13. State honestly what is implemented, externally blocked, schema-dependent, and not runtime-verified. TypeScript compilation alone is not product verification.

## Repository map and references

```text
frontend/                       React + Vite application, routes, UI, and authored tests
backend/                        NestJS API, AI/Knowledge modules, Prisma schema/migrations
packages/shared-types/          Shared HTTP transport contracts
infrastructure/nginx/           Nginx production-routing templates
infrastructure/renderer/        Isolated-renderer image/worker source; not a public crawler deployment
docs/                            Architecture, security, UAT, Phase 08/09 audits and handoffs
.github/workflows/               CI and gated UAT migration/deployment definitions
```

Useful references:

- [Architecture overview](docs/architecture/OVERVIEW.md)
- [Environment guidance](docs/architecture/ENVIRONMENT.md)
- [Database plan](docs/architecture/DATABASE_PLAN.md) and [database schema notes](docs/architecture/DATABASE_SCHEMA.md)
- [Authentication and account security](docs/architecture/AUTHENTICATION.md)
- [Knowledge and website-ingestion retirement notice](docs/phase-08-architecture.md)
- [Phase 09 product audit and migration handoff](docs/phase-09-product-audit-and-migration-plan.md)
- [Phase 09D.7 evaluation limitations](docs/phase-09d7-evaluation.md)
- [UAT migration workflow](.github/workflows/prisma-migrate-uat.yml)
- [Nginx routing templates](infrastructure/nginx/README.md)

---

**Phase 09 status:** IMPLEMENTATION COMPLETE — FINAL QA DEFERRED TO PHASE 30. Code presence and TypeScript checks do not establish runtime acceptance. The assistant archive migration still requires authorized deployment and environment-specific migration-state verification. Permanent deletion remains unavailable to protect retained records; provider connectivity and real model quality have not been verified. Do not begin Phase 10 until the relevant deployment and acceptance gates are satisfied.
