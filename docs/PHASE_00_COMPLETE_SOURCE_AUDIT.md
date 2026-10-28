# Carteio AI 2.0 — Phase 00 Complete Source Audit

**Audit basis:** static inspection of the locally supplied `upstream-chattermate` tree only. No packages were installed, no tests/builds/services were run, and no live provider, Shopify, database, or hosted ChatterMate service was contacted. “Available” below means implementation is present in public source; it does not mean runtime behavior was verified.

> **Previous blocker history:** the earlier clone failed because this environment could not resolve `github.com`, and a network escalation request was rejected by policy. The source was subsequently placed in the approved workspace manually. No network retry was attempted. This audit concerns that local source tree, not a clone performed in this run.

## 1. Executive Summary

The public tree is a sizeable, Apache-2.0-licensed FastAPI/Vue customer-support platform. It contains usable code for one-time organization bootstrap, password login, role-based users, AI agents, provider configuration, website/PDF ingestion, pgvector retrieval, embeddable chat, conversation inbox, human handoff, and Shopify backend integration. Docker and worker definitions are included.

The unmodified public tree is **not a ready self-service multi-tenant commercial SaaS**. The enterprise Git submodules are absent. Signup routes and subscription UI/API are conditional on those modules, and public `/organizations` bootstrap rejects organization creation once any organization exists in the database. The community build is therefore suitable as a **single-operator/self-hosted product foundation**, but Carteio must develop customer onboarding and tenant provisioning, account verification/recovery, billing/quotas, production operations and security hardening before offering independent customer signup at `ai.carteio.in`.

**Assessment: CONDITIONAL GO as a self-hostable application foundation; NO-GO as an unmodified public self-service SaaS or for production launch before security/runtime validation.**

## 2. Clone Confirmation and Local Path

- Local source: `/mnt/c/Users/Karan Singh Gaharwar/desktop/ai carteio 2.0/upstream-chattermate`.
- The directory contains the ChatterMate application: `backend/app`, `frontend/src`, Dockerfiles/Compose files, migrations, docs, and a built widget bundle under `backend/assets`.
- Git metadata exists and resolves as a Git working tree. Branch: `main`. HEAD: `a2582a143c7a84024f2f0f5418b388dbf1cc9a15`. `git describe`: `v1.0.26-166-ga2582a1`; tags present from `v1.0.0` through `v1.0.26`.
- **Provenance qualification:** this is strongly consistent with a normal Git checkout: `.git`, history/refs and an `origin` matching the official GitHub URL are present. Since it was manually placed, the exact transfer method cannot be independently established; a ZIP that preserved `.git` cannot be ruled out.
- **Working-tree status:** a read-only `git status` invocation stalled in this mounted environment and was interrupted; clean/dirty status could not be verified. No source was intentionally changed during this audit.
- `origin` is configured as `https://github.com/chattermate/chattermate.chat.git` for fetch and push. No network operation was performed against it.

## 3. Source Commit SHA / Branch / Version

`main` at `a2582a143c7a84024f2f0f5418b388dbf1cc9a15`, dated `2026-10-15T15:50:23+05:30` in the commit metadata. Nearest tag: `v1.0.26` (166 commits after it). Do not treat the tag alone as the audited revision.

## 4. Repository Completeness

The public core is present, including backend and frontend source, SQLAlchemy/Alembic migrations, Docker configuration, tests as repository artifacts, README and Apache license. Tests were **not run**. `.gitmodules` declares two enterprise submodules at `backend/app/enterprise` and `frontend/src/modules/enterprise`; their Git tree entries are gitlinks, but both local directories are empty/unpopulated. No private repository was accessed.

The core generally treats enterprise imports as optional. `backend/app/main.py` logs community mode when the enterprise router is unavailable; `backend/app/api/users.py`, `organizations.py`, and `services/feature_gate.py` have optional import fallbacks. This permits a community process to omit those features. Some entire screens/flows are correspondingly absent, and several plan gates deliberately become unrestricted when the module is absent. Runtime bootability was not tested.

## 5. Public vs Private/Enterprise Modules

| Area | Classification | Evidence and effect |
|---|---|---|
| Core API, agents, retrieval, widget, inbox, teams/roles, integrations | **AVAILABLE IN PUBLIC CODE** | `backend/app/api`, `agents`, `knowledge`, `services`, `models`, `repositories`; `frontend/src/views`, `components`, `webclient` |
| First organization/admin setup | **AVAILABLE IN PUBLIC CODE**, single-install bootstrap | `api/organizations.py:create_organization` creates org, default roles and admin; refuses if any organization already exists |
| General `/signup`, onboarding marketing flow | **PRIVATE/ENTERPRISE** in this checkout | `frontend/src/router/index.ts` adds `/signup` only if enterprise module files exist; `LoginView.vue` only renders signup link when `hasEnterpriseModule` |
| Subscription, trials, billing setup, subscription guards | **PRIVATE/ENTERPRISE** | Frontend dynamic imports `modules/enterprise/views/*`, store and route guard; API plan/subscription repositories are imported from enterprise |
| Message/seat/source/feature quota enforcement | **PARTIAL / PRIVATE-DEPENDENT** | Shared helper code exists, but OSS fallbacks often allow unrestricted operation; metering helpers say no enterprise means unmetered/unblocked |
| Shopify backend | **AVAILABLE IN PUBLIC CODE** | `api/shopify.py`, `services/shopify*.py`, models/repositories, agent tools |
| Shopify embedded app setup and branded hosted flow | **PARTIAL / PRIVATE-DEPENDENT** | Shopify connect/session/bounce/pricing views are named in enterprise dynamic imports; Shopify backend endpoints remain public |
| ChatterMate-hosted LLM plan/model | **PRIVATE/HOSTED-SERVICE-DEPENDENT** | `CHATTERMATE` model type and hosted usage metering represent platform-provided model service; self-host requires own provider credentials for usable inference |
| Independent public SaaS signup and Carteio billing | **MISSING** from the public checkout | No populated enterprise modules; no public payment/subscription implementation |

## 6. Full Technology Stack

- **Backend:** Python 3.12 target (README), FastAPI/Starlette, Pydantic settings, SQLAlchemy, Alembic, psycopg/asyncpg, Socket.IO and WebSockets. Backend dependencies are listed in `backend/requirements.txt`.
- **Frontend:** Vue 3, TypeScript, Vite, Vue Router, Pinia, Axios, PrimeVue, Vue Flow, Socket.IO client; package metadata and scripts are in `frontend/package.json`.
- **AI:** Agno agents; provider libraries for OpenAI, Anthropic, Gemini/Vertex, Mistral, Ollama, Groq and compatible/custom endpoints; FastEmbed local embeddings.
- **Retrieval/ingestion:** PostgreSQL with pgvector, crawl4ai/httpx/BeautifulSoup, sitemap readers, PDF parsing/OCR, chunking and worker queues.
- **Infrastructure:** PostgreSQL/pgvector, Redis (rate limit and cross-process real-time support), API, Vue/Nginx frontend, knowledge processor, ticket investigator and CRM sync worker. Local filesystem or optional S3-compatible upload storage.
- **External integrations:** Shopify, SMTP, Firebase push, Slack/Jira, HubSpot/Pipedrive, Meta channels and optional MCP connectors. Each requires the relevant app/account credentials and callback/webhook setup.

## 7. Project Folder Structure

- `backend/app/api/` — FastAPI routers (users, organizations, agents, knowledge, chat, widget, Shopify, tickets, channels, etc.).
- `backend/app/agents/` — AI agent construction, chat orchestration, bounded conversation memory, guardrails and tool-facing logic.
- `backend/app/knowledge/` — crawling, URL safety, parsing, chunking, vector storage/search and editing.
- `backend/app/models/`, `repositories/`, `services/` — persistence entities, query/data access and business/integration services.
- `backend/app/workers/` — long-running ingestion, ticket investigation, CRM sync and chat lifecycle jobs.
- `backend/alembic/` — schema revisions.
- `frontend/src/router`, `views`, `components`, `services`, `stores` — dashboard routes/pages, UI and API clients.
- `frontend/src/webclient/` — widget runtime, builder and theme/surface code; `frontend/src/utils/widgetEmbed.ts` produces embed instructions.
- `docker-compose*.yml`, Dockerfiles, `frontend/nginx.conf` — local and image-based deployment templates.
- `e2e/`, backend/frontend test directories — test assets only; not executed in Phase 00.

## 8. Backend Architecture

`backend/app/main.py` builds the FastAPI application, installs startup/lifespan checks, initializes Socket.IO/CORS, imports models and registers routers. It separately starts a chat auto-closer. The optional enterprise router is registered only when importable. Routers call service/repository/model layers; SQLAlchemy sessions come from `app/database.py`, with Alembic migrations in `backend/alembic`.

The public API covers user auth/profile/teams (`api/users.py`), organization bootstrap/settings (`api/organizations.py`), agent CRUD/config (`api/agent.py`), AI/model setup (`api/ai_setup.py`), knowledge sources and queues (`api/knowledge.py`), chat history (`api/chat.py`), widget setup (`api/widget.py`), real-time visitor/agent events (`api/widget_chat.py`), and Shopify (`api/shopify.py`). Role and permission checks live in `core/auth.py`, `models/permission.py` and role/user APIs. Tenant IDs are frequently checked in routes and data repositories; static presence does not establish that every path is correctly isolated, so full tenant-isolation review and adversarial testing remain required.

## 9. Frontend Architecture

`frontend/src/router/index.ts` has a public `/login` and `/setup`, protected routes for `/ai-agents`, `/knowledge`, `/conversations`, `/human-agents`, `/analytics`, tickets, people and settings. The dashboard shell is `layouts/DashboardLayout.vue`. Agent setup and customization live in `views/AIAgentView.vue` and `components/agent/*`; knowledge management in `views/KnowledgeView.vue` and `components/knowledge/*`; inboxes in `ConversationsView.vue` / `HumanAgentView.vue`; settings include organization, AI config, integrations, tickets and widget apps.

The login, agent, organization, knowledge, Shopify and widget API adapters are under `frontend/src/services/`. Signup and billing pages are not in the community route set. A public Shopify backend does not imply that all enterprise embedded onboarding screens exist.

## 10. Database & Infrastructure

The application uses PostgreSQL and pgvector. SQLAlchemy models include organizations, users/roles/permissions, agents, AI configuration, customers, chat history/sessions, knowledge and queue entries, widget/customization, Shopify shops/configuration, tickets, CRM, channels and workflow data. `backend/alembic/versions` contains many migrations; apply only in a separately approved phase after backup/restore planning.

`docker-compose.yml` includes API, frontend, Postgres, Redis, `knowledge_processor`, `ticket_investigator`, and `crm_sync`; it is a **development** compose file (`DEBUG=True`, reload, source mounts, published DB/Redis/API ports and default Postgres credentials). `docker-compose.prod.yml` defines image-based frontend/API/workers and DB/Redis, but still needs controlled image versioning, TLS/reverse-proxy/network policy, secrets, backups, monitoring and deployment validation. `frontend/nginx.conf` proxies `/api/` and WebSocket upgrades; TLS termination is not provided there.

Email is configurable via SMTP, but public account verification/recovery is not provided by the community auth path. Firebase is used for push notifications. S3 storage is optional; local disk is also supported. Redis is used for rate limiting/token revocation and multi-process Socket.IO features; production topology should not assume it is optional when scaling across processes.

## 11. Signup/Login Code Review

- **Bootstrap:** `frontend/src/views/SetupView.vue` posts organization/admin data to `services/organization.ts:createOrganization`; backend `api/organizations.py:create_organization` creates the first organization, default roles and admin, hashes the password and issues tokens. The endpoint explicitly rejects creation once *any* org exists. It has no email verification in this public path.
- **Login:** `LoginView.vue` calls `services/auth.ts:authService.login`, which posts email/password to `POST /api/v1/users/login`. Backend verifies active user/password, creates a session and sets secure HTTP-only access/refresh cookies. It also returns token fields in response schemas; frontend currently uses returned user data and browser cookies.
- **Signup and recovery:** public `/signup` route is conditional on the enterprise module; login screen hides signup and forgot-password affordances when absent. `api/users.py:reset_user_password` explicitly describes admin-set password as the community replacement for an email OTP recovery flow. Enterprise OTP import is optional in `main.py`.
- **Assessment:** existing-user login is **AVAILABLE IN PUBLIC CODE**. Initial one-install bootstrap is **AVAILABLE IN PUBLIC CODE**. Independent customer registration, verification, self-service recovery and repeated tenant provisioning are **PRIVATE/ENTERPRISE or MISSING** from the public checkout. No runtime behavior was tested.

## 12. Full Customer SaaS Journey

“Public” means code is present; these statuses do not certify runtime success. Future public marketing site and `ai.carteio.in` are outside this source tree.

| Step | Status | Source evidence / limitation |
|---|---|---|
| 1. Customer opens Carteio website | **MISSING** | No Carteio website/domain in this upstream tree; planned external product surface |
| 2. Chooses Signup | **PRIVATE/ENTERPRISE** | `/signup` is added conditionally in `frontend/src/router/index.ts`; `LoginView.vue` hides link without enterprise |
| 3. Registers | **PARTIAL** | Public `/setup` bootstrap creates one org/admin via `POST /organizations`; general signup is enterprise |
| 4. Verifies email | **PRIVATE/ENTERPRISE / MISSING OSS** | OTP model import is optional; no community signup email-verification path found |
| 5. Logs in | **AVAILABLE IN PUBLIC CODE** | `LoginView.vue` → `authService.login` → `POST /users/login` |
| 6. Creates/joins an org | **PARTIAL** | `create_organization` supports initial org only and globally refuses any second org; no public join/invite acceptance flow found |
| 7. Opens dashboard | **AVAILABLE IN PUBLIC CODE** | Protected Vue routes and `DashboardLayout.vue`; permission-aware router guard |
| 8. Creates an agent | **AVAILABLE IN PUBLIC CODE** | Agent view/modal → agent service → authenticated `POST /agents`, requires `manage_agents` |
| 9. Enters website URL | **AVAILABLE IN PUBLIC CODE** | Knowledge UI/service → `POST /knowledge/add/urls`; requires `manage_knowledge` and org/agent ownership check |
| 10. Starts crawling/ingestion | **AVAILABLE IN PUBLIC CODE** | API enqueues `KnowledgeQueue`; `workers/knowledge_processor.py:process_queue_item` runs `KnowledgeManager.process_knowledge` |
| 11. Processing completes | **PARTIAL, runtime-dependent** | Queue status/progress endpoints/UI exist; worker must be deployed and able to fetch/parse/embed source |
| 12. Configures AI provider | **AVAILABLE IN PUBLIC CODE** | AI config API/settings store provider/model credentials; requires customer-owned credentials for self-hosted inference |
| 13. Tests chatbot | **AVAILABLE IN PUBLIC CODE** | AI agent view/preview and chat orchestration exist; external LLM credentials and runtime needed |
| 14. Customizes widget | **AVAILABLE IN PUBLIC CODE** | Agent customization/widget configuration components and backend models/routes |
| 15. Generates embed code | **AVAILABLE IN PUBLIC CODE** | `frontend/src/utils/widgetEmbed.ts`, widget builder and widget APIs |
| 16. Embeds on a website | **AVAILABLE IN PUBLIC CODE** | Widget JS/CSS bundle in `backend/assets`; runtime must use correct public backend/widget URLs and CORS |
| 17. Visitor sends question | **AVAILABLE IN PUBLIC CODE** | Widget Socket.IO namespace `/widget`, `widget_connect` and `handle_widget_chat` in `api/widget_chat.py` |
| 18. History appears in dashboard | **AVAILABLE IN PUBLIC CODE** | Chat/session models, chat repository/API and conversation inbox |
| 19. Human handoff | **AVAILABLE IN PUBLIC CODE** | Agent transfer/routing and Socket.IO inbox events in `agents/chat_agent.py`, `services/human_routing.py`, `api/widget_chat.py` |
| 20. Shopify connection | **PARTIAL** | Public backend session-token exchange, shop records, product/order tools and GDPR/uninstall webhooks; enterprise embedded onboarding components absent; own app credentials required |
| 21. Account/team/settings | **PARTIAL** | Public profile, users, roles, groups and org settings; customer self-signup/recovery and SaaS subscription controls incomplete |
| 22. Logout and return | **AVAILABLE IN PUBLIC CODE** | `authService.logout` posts `/users/logout`, clears local user state; login endpoint supports subsequent login |

**Conclusion:** a self-host operator can bootstrap one installation and use the public app’s core journey after configuring services. A new unrelated customer cannot independently signup and obtain a new tenant on a shared Carteio deployment without new provisioning/auth flows.

## 13. AI Brain & Knowledge Architecture

Public flow: widget connection authenticates widget/app identity and conversation token, finds/creates a session tied to customer/widget; `handle_widget_chat` validates session/message and routes to workflow/AI/human path; `ChatAgent.get_response` builds an Agno agent with configured provider, system instructions, history memory and enabled tools; knowledge search is backed by org-scoped `KnowledgeManager`/pgvector; response/citations/metadata are persisted through chat repositories and emitted to widget/inbox.

`knowledge/knowledge_base.py` constructs organization-filtered vector knowledge; `knowledge/chunking.py`, `embedder.py` and `optimized_pgvector.py` implement chunking, local FastEmbed embeddings and vector storage/search. `api/knowledge.py` accepts website/PDF/text sources and queue/status/edit endpoints. `enhanced_website_reader.py`, sitemap support and `knowledge/url_safety.py` implement crawling and URL fetch controls. `knowledge_processor.py` runs async work separately from the API.

`agents/history_memory.py` provides bounded multi-turn history: old tool results are stubbed, oldest turns dropped to a character budget, and overflow may retry without history. This is conversational transcript context, **not evidence of a durable long-term user-fact memory system**. The AI agent can use Shopify/MCP/workflow tools where configured. Provider selection and tool availability are configuration-dependent.

Guardrails exist (`utils/guardrails.py`, guardrail event model/config, agent wiring) and HTML/markdown sanitization utilities exist. The default inbound policy described in config is `template_only`, which catches template-token signals rather than proving broad prompt-injection resistance. Retrieval relevance, multilingual adaptation, hallucination rates, query rewriting, source-faithfulness and Noupe parity are **UNVERIFIED**. They need controlled evaluation with representative Carteio questions and adversarial test sets.

## 14. Shopify Integration

**Present in public backend, incomplete as a turnkey Carteio app.** `api/shopify.py` handles embedded session-token exchange (validates signed token and `.myshopify.com` destination before token exchange), shop/organization linking, agent configuration and webhook routes. `services/shopify.py` executes Admin GraphQL requests and includes product data methods; chat agent/tool code can use commerce data. `ShopifyShop` and agent-shop config models persist store/install/config state. `api/shopify.py` also includes app-uninstalled and Shopify customer/shop GDPR webhook handlers. Agent/shop organization ownership checks are present in several routes.

Material work/risk:

- `ShopifyShop.access_token` is a plain string column, and token exchange writes the received access token to the shop record. The source does not show it going through the common Fernet encryption helpers. Treat at-rest token protection as a release blocker until verified/fixed.
- Declared scopes include `read_products`, `read_orders`, `read_all_orders`, `read_customers`, theme reads/writes, and script-tag reads/writes (`api/shopify.py:SCOPES`). Review least privilege, Shopify review/approval, and customer-data obligations. Do not assume every shop is granted historical order access.
- Shopify OAuth/session token exchange requires Carteio’s own Shopify Partner/Dev Dashboard app, client ID/secret, configured API version, public HTTPS backend and registered redirect/webhook URLs. Embedded app UI/auth helper screens in enterprise module imports are absent; implement/validate onboarding for the chosen distribution model.
- Store mapping allows unlinked shops then authenticated linking; test race conditions and cross-tenant access against multiple orgs before shared service. Existing static guards are positive evidence, not a complete isolation proof.
- Product/variant/price/inventory methods and order lookup code exist, but real API behavior, API-version compatibility, scopes, webhook delivery/retries and install/uninstall lifecycle were not exercised. No live Shopify access was performed.

## 15. Subscription/Billing Availability

**PRIVATE/ENTERPRISE for usable SaaS billing.** `frontend/src/router/index.ts` only adds subscription/pricing/billing routes with the enterprise module; plan/subscription repositories/services are enterprise imports. `backend/app/services/feature_gate.py` and `usage_metering.py` are public seams, but they intentionally return unrestricted/unmetered behavior when enterprise is absent. `razorpay` in `requirements.txt` alone does not constitute a public billing flow. The requested public tree does not provide a verifiable Carteio payment lifecycle for plan selection, checkout, payment webhook, invoices, cancellations, trials, organization-level quotas or platform admin controls.

## 16. Chatbot Widget & Website Embedding

**AVAILABLE IN PUBLIC CODE.** `frontend/src/webclient/` contains widget composer, theme, socket client and builder; `utils/widgetEmbed.ts` produces snippets. Backend `api/widget.py` creates/serves widget config and HTML; `api/token.py` issues/verifies/revokes widget conversation tokens; `api/widget_chat.py` registers visitor and agent Socket.IO handlers. `backend/assets/widget.js` and `widget.css` are already present. Hosting must set `BACKEND_URL`, frontend/API/widget URLs, HTTPS, CORS and WebSocket proxying correctly. Visitor conversation/session behavior remains runtime-unverified.

## 17. Security and Known Vulnerabilities

Static review found security controls and deployment-sensitive defaults. This is not a penetration test or an external dependency-advisory scan.

**Positive controls present:** password hashing/validation, JWT/session lifecycle and revocation, secure/HTTP-only auth cookies, role/permission checks, agent/org ownership checks in several APIs, encrypted credential/message helpers (`core/encryption.py`), startup secret validation (`main.py`), URL/crawl SSRF helpers (`knowledge/url_safety.py`), outbound target policy (`core/outbound_policy.py`), upload type/size/magic-byte and filename checks (`core/file_validation.py`), sanitized HTML/Markdown helpers, Shopify session signature validation and webhook HMAC checks, public rate-limit utilities, and code-owned prompt guardrails.

**Release blockers / review items:**

1. `core/config.py` has placeholder JWT/conversation signing defaults and `OUTBOUND_URL_POLICY=any`, `MCP_STDIO_ENABLED=true`; startup has a production secret verifier, but every production setting must be explicitly set and validated. For a shared service use a restrictive outbound policy and disable arbitrary server-side stdio commands unless strongly sandboxed.
2. Shopify access tokens appear stored unencrypted as described above. Audit all OAuth/channel/CRM credentials for consistent encryption and key rotation.
3. Cookies use `SameSite=None` and `Secure`; set correct domain/TLS/CORS and add/verify CSRF protections for cookie-authenticated state-changing routes. Returning token fields in API response models also deserves review for browser exposure.
4. Public organization bootstrap is not safe for a multi-customer shared SaaS; it is globally first-org-only. Do not work around it by simply removing the check—design tenant provisioning and authorization consistently.
5. Crawler/AI/MCP/ticket-DB configurable outbound URLs are SSRF/RCE surfaces. The code has guards, but `any` and stdio-enabled defaults are inappropriate for untrusted tenants. Test DNS rebinding, redirects, private IPv6/link-local targets and tool authorization.
6. Review prompt injection, untrusted retrieved content, chat sanitization, upload persistence, authorization on every list/detail/export route, rate limits and tenant boundaries with an independent security test plan.
7. `docker-compose.yml` is development-only and publishes Postgres/Redis using defaults. Do not expose these services or use this file as a production deployment.
8. `requirements.txt` has several unpinned packages alongside pins; lock/scan the full dependency set and base images before release. The file itself references a Starlette GHSA and pins FastAPI/Starlette, but no advisory source was queried. Current advisory status and whether other dependencies are affected are **UNVERIFIED** because this phase prohibited network access.

No historical advisory is classified as an active vulnerability without evidence against the selected revision. No automatic dependency upgrade was performed.

## 18. License & Rebranding Considerations

Root `LICENSE` is Apache License 2.0; `NOTICE` identifies ChatterMate and copyright 2024–2026. This permits commercial use subject to Apache obligations. A future working copy must retain applicable copyright/license/NOTICE material, include the Apache license with redistributed source/binaries, mark modified files, and preserve third-party notices/licenses. Review bundled assets, `wordpress/chattermate-chat.zip`, fonts/icons and every dependency for their own terms before redistribution. No legal review was performed. Do not remove upstream identity notices in the preserved reference tree.

## 19. Requirements for Self-Hosting

Minimum functional stack: PostgreSQL 14+ with pgvector, API configured with production JWT/conversation/encryption secrets and database URL, Vue/Nginx frontend with public URLs, knowledge worker, and provider API key or supported local model endpoint. Redis is needed for the documented rate-limit/session-revocation and multi-process real-time behavior; Firebase is needed for push notifications; SMTP is needed for integrations and any future account email lifecycle. S3 is optional for durable shared upload storage. Website crawling requires outbound network access and crawler/browser dependencies. Shopify, Slack, Jira, CRM and messaging channels each need separately registered customer-owned credentials/webhooks.

The README’s `chattermate-deploy` CLI is an external npm package, not part of this repository. Manual Docker build/configuration is documented, but was not attempted. The production Compose file uses `latest` images and does not itself provide a complete hardened HTTPS ingress/backup/monitoring setup.

## 20. Deployment Readiness

- **Local development:** documented Docker Compose, Postgres, Redis, frontend/backend and workers. Compose requires local env files and the documented build setup. Not run.
- **UAT/staging:** separate DB and object storage, HTTPS ingress, non-default secret management, SMTP, isolated provider keys, real public widget/WebSocket URLs, Shopify dev app, backups/restore test, logs/metrics, health checks and synthetic tenant-boundary coverage required.
- **Production:** use pinned images built from a reviewed commit; private DB/Redis network; TLS reverse proxy; secret manager; encryption key backup/rotation; database and uploads backup/restore; centralized logs/errors/metrics/alerts; worker concurrency/retry/dead-letter operations; rate limits/abuse controls; accessible Shopify webhooks; incident and data-deletion processes. No production deployment is recommended yet.
- **Scaling/cost:** crawler/embedding/OCR workloads can be CPU/memory intensive; LLM and embedding provider costs are external. Split API and workers, queue by workload, monitor Postgres/pgvector and Redis, and load-test before sizing. Exact costs cannot be established from source alone.

## 21. Missing Features & Blockers

- Public independent signup, email verification, repeated organization creation/join/invites and self-service recovery: **MISSING or enterprise-dependent**.
- Multi-tenant SaaS provisioning and support/admin plane, tenant plan/quota enforcement, billing/payment webhooks/invoices/cancellation: **MISSING from public checkout**.
- Shopify app onboarding UX/identity and token encryption validation: **PARTIAL**.
- External advisory review, full tenant-isolation review, runtime flow tests and load/security validation: **UNVERIFIED**.
- Secure production deployment configuration, pinned release image pipeline, operational backups/monitoring/restore: **PARTIAL/MISSING**.
- AI answer quality and Noupe-equivalence benchmark: **UNVERIFIED**.

## 22. Exact Files Expected to Change for Rebranding

Only in a future separate Carteio working copy, likely locations to review/change include:

- Brand/name assets and browser metadata: `frontend/index.html`, `frontend/src/assets/*`, `frontend/public/*`, `frontend/src/layouts/*`, login/setup/views and styles.
- Widget branding/defaults: `frontend/src/webclient/*`, `frontend/src/components/agent/*`, `frontend/src/utils/widgetEmbed.ts`, backend widget templates/assets/config defaults.
- Product/API labels: `backend/app/core/application.py`, `backend/app/core/config.py`, `backend/app/main.py` OpenAPI metadata and README/docs.
- Email identity: `backend/app/core/config.py`, mail/channel templates and any enterprise-provided signup/recovery templates if separately licensed/available.
- Domain/callback configuration: `.env.example` and deployment manifests after choosing `ai.carteio.in`; `BACKEND_URL`, `FRONTEND_URL`, CORS, widget URL, Shopify app URLs/webhooks and OAuth redirects. Do not hardcode production addresses.
- Container/service/database labels: Docker Compose, Dockerfiles and database initialization only where operationally necessary.
- Shopify app name, client configuration, scopes, callback/webhook URLs: Shopify app registration plus app config.
- Subscription plan surfaces: new Carteio billing implementation; public subscription pages are absent.

This is a candidate map from tree structure, not a change list; no file was modified.

## 23. Carteio 2.0 Recommended Architecture

Use the upstream tree as immutable reference and make a separately named working copy with its Git history and license notices preserved. Keep public app core in a single deployable stack initially, but design explicit tenant provisioning, tenant-scoped queries, quotas, account lifecycle and operator control plane before exposing registration. Use an external managed PostgreSQL+pgvector and Redis or private VPC equivalents, separately deployed API/frontend/worker services, durable object storage, HTTPS ingress and a secrets manager. Bring-your-own provider keys can support initial AI inference; store them encrypted with a managed rotation/backup strategy. Integrate Shopify through a Carteio-owned app with least-privilege scopes and encrypted offline tokens. Keep billing/quota enforcement server-side and idempotent via signed payment webhooks.

## 24. Prioritized Development Phases

Each phase is gated; acceptance requires review and explicit human sign-off before moving to the next production-impacting stage.

1. **Phase 01 — Working Copy & Legal-Safe Rebranding.** Create isolated branch/copy, preserve notices, inventory third-party asset terms; make brand configuration centralized. **Accept:** no upstream reference changes; legal/branding inventory approved. **Regression risk:** missed hard-coded strings, widget asset identity. **Manual gate:** license review and brand approval.
2. **Phase 02 — Authentication, Organizations & Dashboard Validation.** Build public signup, email verification, invite/join lifecycle, password reset, org provisioning, rate limits and admin controls; remove global singleton only with full tenancy design. **Accept:** two independently provisioned tenants pass isolation tests; lifecycle emails, session revocation and roles verified. **Risk:** auth regressions/data leakage. **Gate:** security review of tenant model.
3. **Phase 03 — Website Knowledge and AI Brain Validation.** Validate crawler, SSRF defenses, queue retries, embeddings/retrieval, provider setup, citations and fallback; benchmark Carteio/Noupe question set. **Accept:** repeatable ingestion status and agreed retrieval/answer thresholds. **Risk:** crawler blocking, bad chunking, hallucinations/cost. **Gate:** product accuracy acceptance.
4. **Phase 04 — Shopify App & Commerce Integration.** Register Carteio app, minimize scopes, encrypt tokens, verify install/link/uninstall/GDPR lifecycle, product/order authorization and API compatibility. **Accept:** dev-store lifecycle and multi-tenant isolation evidence. **Risk:** revoked tokens, scope review, customer-data compliance. **Gate:** Shopify Partner/app-review and privacy approval.
5. **Phase 05 — Widget and Customer Conversation Experience.** Rebrand runtime, test embed/CORS/WebSockets, mobile UI, history, human takeover and data deletion. **Accept:** production-like external sites can install and complete conversations. **Risk:** cross-origin, CSP, socket reconnect. **Gate:** customer UX approval.
6. **Phase 06 — Plans, Usage Limits & SaaS Billing.** Implement plans, quotas, usage ledger, payment provider, signed idempotent webhooks, receipts/invoices, cancellation/refunds and admin support. **Accept:** sandbox payment lifecycle and usage enforcement reconcile. **Risk:** duplicate/missed billing events and free usage bypass. **Gate:** finance/legal approval; no live payment until explicit authorization.
7. **Phase 07 — Security, Reliability & Performance.** Independent threat model, code review, dependency/image scan, auth/CSRF/XSS/SSRF/tenant tests, rate limits, queue recovery, backups/restore and load testing. **Accept:** no open critical/high findings; restore objectives measured. **Risk:** breaking integrations and expensive workload behavior. **Gate:** security owner signs off.
8. **Phase 08 — Staging Deployment.** Deploy isolated staging with secret manager, TLS, monitoring, real callback URLs and synthetic/test tenants. **Accept:** deployment/rollback/restore and complete release checklist pass. **Risk:** config drift and inaccessible callbacks. **Gate:** UAT approval.
9. **Phase 09 — Production Readiness & Launch.** Pin approved artifacts, run final security/privacy and billing checks, support/escalation plan, staged rollout and rollback. **Accept:** explicit go/no-go and operational owner. **Risk:** customer data, billing, availability. **Gate:** business owner’s written launch approval.

## 25. Manual Setup Needed

Before runtime validation: install pinned dependencies only in an approved phase; provision isolated local/staging Postgres with pgvector and Redis; configure strong unique secrets including `ENCRYPTION_KEY`; set frontend/API/widget public URLs and CORS; configure SMTP and customer-owned AI provider; start API plus knowledge/ticket/CRM workers as needed; run migrations only after backup and schema review. Shopify validation additionally needs a Carteio Partner/Dev app, dev store, client credentials, least-privilege scopes, HTTPS callbacks and webhook subscriptions. This phase performed none of these actions.

## 26. Final Go / Conditional Go / No-Go Assessment

**CONDITIONAL GO** to use this public code as a self-hosted, single-organization AI support foundation after setup and runtime validation. It has substantial functional core code and deployment templates. **NO-GO** to claim that a new customer can sign up and independently create an org on an unmodified public build, or to launch it as Carteio’s shared commercial SaaS today: signup/billing depend on unavailable enterprise modules and community org creation is globally first-install-only. Security, token protection, multi-tenant authorization, external advisories and runtime reliability remain gates.

**Recommended next phase:** Phase 01 only after explicit approval. Its first deliverable should be a separate legal-safe working copy plus a source/notice inventory; implementation should not start in the preserved upstream tree.
