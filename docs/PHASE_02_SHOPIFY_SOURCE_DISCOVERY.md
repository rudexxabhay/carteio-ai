# Phase 02 — Shopify App Complete Source Discovery

**Investigation date:** 2026-10-17  
**Source revision audited:** `a2582a143c7a84024f2f0f5418b388dbf1cc9a15` (`main`)  
**Repositories:** `upstream-chattermate` and `carteio-app`  
**Method:** read-only source and Git inspection. No network calls, Shopify API calls, installations, builds, tests, or runtime actions were performed.

## Executive finding

The public checkout is **not the complete Shopify application shown in the installed app experience**. It includes a meaningful Shopify backend integration (session token exchange, shop records/linking, agent config endpoints, Admin GraphQL product/order tools, and webhook handlers) plus common widget code. It does not contain the Shopify embedded-app screens for agent management, nor a Shopify CLI app package or theme app extension. The exact `/shopify/agent-management` route is wired to an enterprise Vue component; with the public enterprise submodule absent, it is not part of the route table and the screenshot’s agent-management UI cannot be built from this public checkout alone.

The reported Shopify Admin app install and interface establish that some deployed app exists, but do not establish which revision or private components it runs. The README links to a ChatterMate App Store listing; that listing/package is external to these local trees. No Shopify listing, hosted service, app credentials, or enterprise code was accessed in this investigation.

**Carteio recommendation:** reuse selected public backend patterns and the general widget/agent tool integration only after security work. Build/register a Carteio-owned Shopify app package, embedded UI, theme extension, onboarding lifecycle and compliant privacy handling independently. Do not reuse ChatterMate app identity, credentials or hosted infrastructure.

## 1. Revision and repository integrity

Both local repositories resolve to commit `a2582a143c7a84024f2f0f5418b388dbf1cc9a15` on `main`. Both working trees were clean at inspection. The working copy and upstream therefore represent the same audited source revision for the inspected Shopify behavior.

The `.gitmodules` file declares two separate enterprise repositories:

- `backend/app/enterprise` → `chattermate/enterprise_backend.git`
- `frontend/src/modules/enterprise` → `chattermate/enterprise_frontend.git`

The local public checkout contains neither submodule’s files. No submodules were initialized. Their contents were not accessed.

## 2. Source search results and public boundaries

Repository-wide filename inspection found public Shopify code under `backend/app/` and `frontend/src/`, Shopify migrations, tests, and one organization-level E2E spec. It found no `shopify.app.toml`, `shopify.extension.toml`, Shopify CLI configuration, `extensions/` package, `.liquid` file, or theme block/app embed source in either checkout at this revision. In particular, the documented `shopify/chattermate-chat/` package/path is **absent**.

Important public files:

- `backend/app/api/shopify.py` — Shopify endpoints and webhook handlers.
- `backend/app/services/shopify_session.py` — embedded session-token extraction/validation and shop lookup.
- `backend/app/services/shopify_helper_service.py` — webhook HMAC, legacy OAuth query HMAC, and OAuth code exchange helpers.
- `backend/app/services/shopify_urls.py` — shop-specific Admin API/OAuth URL construction and API version.
- `backend/app/services/shopify.py` — Admin GraphQL requests and product/order service methods.
- `backend/app/tools/shopify_toolkit.py` — agent-callable product search/recommendation and order tools.
- `backend/app/tools/shopify_order_access.py` — input validation and exact email/order matching helpers.
- `backend/app/models/shopify/{shopify_shop,agent_shopify_config}.py` and `backend/app/repositories/{shopify_shop_repository,agent_shopify_config_repository}.py` — persistence/configuration.
- `frontend/src/services/shopify.ts` — dashboard Shopify API client.
- `frontend/src/composables/useEnterpriseFeatures.ts` and `frontend/src/router/index.ts` — public/enterprise gating and route mapping.
- `frontend/index.html`, `frontend/src/services/api.ts`, and `frontend/package.json` — App Bridge shell setup/dependency references.
- `frontend/src/webclient/WidgetBuilder.vue`, `frontend/src/composables/useWidgetSocket.ts`, `backend/app/api/widget.py`, and `backend/app/api/widget_chat.py` — shared widget surfaces and Shopify-aware conversation payload paths.
- `backend/tests/api/test_shopify_api.py`, `backend/tests/api/test_shopify_gdpr_webhooks.py`, `backend/tests/services/test_shopify_session.py`, and Shopify tool/service/repository tests — tests present in source, not run here.

The relevant app-install migrations are `backend/alembic/versions/1493b8279a2f_added_shopify_models.py`, `7af9828611e7_add_oauth_state_fields_to_shopify_shops.py`, and `9a01e6b653b2_add_agent_shopify_config_with_shop_.py`.

### Distinguishing the components

| Component | What the public checkout contains | Assessment |
|---|---|---|
| ChatterMate SaaS dashboard | Vue dashboard and integration settings (`frontend/src/views/settings/IntegrationsSettings.vue`) | Public dashboard surface for connecting/status; not the embedded merchant app shown in the screenshot. |
| Shopify embedded application | `shopify.app.toml`/CLI package absent. App Bridge packages and conditional loader exist, but actual embedded routes/components are enterprise module imports. | **PARTIAL / ENTERPRISE DEPENDENCY** |
| Shopify theme extension | No extension package, Liquid block, app embed, or Shopify extension manifest found. | **MISSING** |
| Chatbot widget | Shared widget builder/client, API routes, socket conversation handling, and built widget assets are public. | **AVAILABLE as a generic widget; Shopify-specific automatic installation is missing.** |
| Shopify backend APIs | Session exchange, shop/org/agent config APIs, GraphQL service and webhooks are public. | **PARTIAL**; the installation surface/config package and secure token storage are blockers. |
| AI Agent and Shopify tool calling | Shopify toolkit registers product/order functions and is conditionally attached to `ChatAgent`; per-agent shop/org checks exist. | **PARTIAL**; runtime, scopes, model/tool selection and customer authorization need validation. |

## 3. Screenshot-to-code mapping

No screenshot file was supplied, so this maps the described labels/features to the local source rather than claiming pixel-level identity.

| Described UI | Evidence in the public revision | Finding |
|---|---|---|
| AI agent connection status / connected agent management | `/shopify/agent-management` maps to `moduleImports.shopifyAgentManagement`, which names `src/modules/enterprise/views/ShopifyAgentManagementView.vue` (`frontend/src/router/index.ts:297-300`, `frontend/src/composables/useEnterpriseFeatures.ts:86-95`). That file is absent locally. Public backend has `/connected-agents`, `/agent-config/{agent_id}` and `/agent-config/{agent_id}` POST (`backend/app/api/shopify.py:640-810`). | UI **PRIVATE/ENTERPRISE**; API primitives public. |
| Shopify widget ID | `ShopifyAuthService.get_shop_success_data()` computes a widget ID from the first enabled agent config and its widget (`backend/app/services/shopify_auth_service.py`, method near line 42). Public widget APIs can serve a widget by ID. | Backend helper **PARTIAL**; embedded onboarding screen and automated installation are enterprise/absent. |
| “Setup Widget in Shopify” / theme editor integration | No Liquid block, theme app extension, Shopify CLI app configuration, or local extension package. Backend scopes include theme and script-tag access (`backend/app/api/shopify.py:59`) but scopes alone do not implement a theme editor extension. | **MISSING locally.** |
| Product search/recommendations | `ShopifyTools` registers `list_products`, `get_product`, `search_products`, `search_orders`, `get_order_status`, and `recommend_products` (`backend/app/tools/shopify_toolkit.py:150-168`). Widget frontend has structured Shopify product rendering (`frontend/src/webclient/WidgetBuilder.vue`, `frontend/src/composables/useWidgetSocket.ts`). | **PARTIAL to AVAILABLE in code**; live API behavior not validated. |
| Order tracking / Shopify-powered support | `get_order_status()` and `search_orders()` use Admin GraphQL, require customer email and, for status, order number, then check matching email/order (`backend/app/tools/shopify_toolkit.py:599-675,752-800`; `shopify_order_access.py:57-93`). | **PARTIAL**; email/order number is not Shopify customer-session authentication. |

## 4. Embedded frontend and `/shopify/agent-management`

`frontend/src/composables/useEnterpriseFeatures.ts:28-34` detects enterprise files using a Vite glob. Its module map names the embedded Shopify bounce/connect/auth-complete/agent-selection/agent-management/inbox/pricing views and App Bridge helpers (`:77-110`). `frontend/src/router/index.ts:230-315` only adds those Shopify routes when an enterprise module exists. The exact management route uses `loadEnterpriseComponent(moduleImports.shopifyAgentManagement)` (`:297-300`). `loadEnterpriseComponent()` returns the “Feature not available in open source version” component if the enterprise module is absent (`:219-227`). If the module as a whole is absent, the route list falls back to `baseRoutes` (`:230-315`), so `/shopify/agent-management` is not actually registered in the public build and will reach the catch-all route.

The public frontend still references the embedded application shell:

- `frontend/index.html:44-62` emits a Shopify API key meta tag and conditionally loads Shopify App Bridge and Polaris from Shopify’s CDN when `shop` or `host` is present.
- `frontend/package.json:40-41` includes `@shopify/app-bridge` and `@shopify/app-bridge-utils`.
- `frontend/src/services/api.ts:20-47` loads App Bridge/session-token helpers dynamically from the enterprise module. With no enterprise module, the public code does not initialize those helpers.
- `frontend/src/router/routePermissions.ts:72-82` and `frontend/src/router/index.ts:337-341` bypass the ordinary dashboard role guard for `/shopify/*` because those paths are expected to use Shopify session tokens. This makes proper API-side session validation essential.

This is an integration shell and route contract, not the screenshot’s available UI implementation.

## 5. Installation, authentication and store-link journey

| Journey step | Public code evidence | Status / limits |
|---|---|---|
| Merchant installs app and approves permissions | README links to the external Shopify App Store listing (`README.md:11,49,554`). No Shopify app manifest or distributable Shopify CLI package exists locally. | **PARTIAL / UNVERIFIED**: the hosted listing/install package is outside this repository; the local repo alone cannot create that install experience. |
| Shopify authenticates embedded app | `POST /exchange-token` reads a Shopify session token, validates it, exchanges it for an offline access token, then persists a shop (`backend/app/api/shopify.py:78-167`). `ShopifySessionService.validate_session_token()` verifies HS256 signature and audience and checks `exp`/`nbf` (`backend/app/services/shopify_session.py:54-97`). | **PARTIAL**: backend exchange exists; public App Bridge token acquisition UI is enterprise-loaded. Runtime/config not verified. |
| OAuth authorization-code flow | `ShopifyHelperService.exchange_oauth_code_for_token()` exists (`backend/app/services/shopify_helper_service.py:89-138`) and `validate_shop_request()` checks query HMAC (`:166-208`), but no `/auth` or OAuth callback route is declared in `backend/app/api/shopify.py` at this revision. The public frontend `connectToShopify()` points to `/shopify/auth` (`frontend/src/services/shopify.ts:45-63`), while the backend route list has no matching handler. | **MISSING/INCOMPLETE** as a self-contained legacy OAuth flow; do not treat the unused helpers as a complete callback. |
| Store becomes linked to org | `/link-organization` requires JWT user with `manage_organization` and rejects a shop owned by a different org (`backend/app/api/shopify.py:176-270`); `/link-shop/{shop_id}` also links (`:414-455`). The session exchange initially creates an unlinked shop. | **PARTIAL**; cross-tenant ownership checks exist, but first install-to-customer/org onboarding is in enterprise UI. Race/claim behavior needs multi-tenant tests. |
| Agent selection/linking | Public endpoints list connected agents, read/write config, and enforce the agent belongs to the resolved org (`backend/app/api/shopify.py:62-76,640-810`). `AgentShopifyConfig` associates agent, shop and enabled state. | API **AVAILABLE**; embedded selection/management UI **ENTERPRISE**. |
| Widget ID generated/displayed | Helper resolves a widget for the first enabled agent (`ShopifyAuthService.get_shop_success_data`). Widget model/endpoint and embed assets exist. | **PARTIAL**; no evidence of theme editor block setup. |
| Widget placed in storefront | Generic widget API/client and JS/CSS artifacts exist (`backend/app/api/widget.py`, `backend/assets/widget.js`, `backend/assets/widget.css`). No local theme app extension, Liquid block or app embed. | Generic snippet/manual embed **AVAILABLE**; Shopify-native automatic setup **MISSING**. |
| Visitor asks product question | Agent attaches `ShopifyTools` when integration config is enabled (`backend/app/agents/chat_agent.py:53,544-549`; toolkit methods above), with org/shop checks in `_get_shop_for_agent()` (`shopify_toolkit.py:181-218`). Shopify response/product payloads are passed through `widget_chat.py`. | **PARTIAL**; requires working token, scopes, configured provider and live validation. |
| Order lookup | Tool requires supplied customer email and order number, exact-matches returned email/order, returns tracking/status fields (`shopify_toolkit.py:752-815`, `shopify_order_access.py:57-93`). | **PARTIAL**; no independent proof of customer identity or logged-in Shopify customer context. |
| Uninstall and cleanup | Signed uninstall webhook deletes shop configs/shop (`backend/app/api/shopify.py:869-964`); customer/shop privacy webhook routes exist (`:966-1233`). | **PARTIAL**; GDPR customer export/redaction are logging/TODO only; see security findings. |

`ShopifyService` builds Admin API URLs with a hard-coded API version `2025-10` (`backend/app/services/shopify_urls.py:24-42`); `core/config.py` also exposes a `SHOPIFY_API_VERSION` setting (`:92-94`), so version source consistency needs review. No live compatibility verification was performed.

## 6. Product, variant and order implementation

`ShopifyService.get_products()` issues an Admin GraphQL query for active/in-stock products and selects description, handle, product type, vendor, total inventory, price range, images, tags and updated timestamps (`backend/app/services/shopify.py:170-229`). `ShopifyTools` provides list/get/search/recommend behavior, and its product cache key is scoped by organization and conversation session (`backend/app/tools/shopify_toolkit.py:150-218`). The tool output is formatted for the widget’s product cards. The presence of tool methods is not proof of accurate recommendations or current live data; no Shopify call or evaluation was made. Variant-level selection/availability and inventory precision must be confirmed for Carteio’s intended use case.

Order tools search Shopify Admin GraphQL orders and recheck results by exact email and order number to mitigate Shopify’s fuzzy search (`shopify_toolkit.py:644-675`). The order summary can contain names, totals, fulfillment/payment status, item lines, shipping address and tracking data (`:677-750` and `:752-815`). This is sensitive personal information. Requiring an email plus order number is a useful matching control, but those values may be known or guessed; do not describe it as strong customer authentication. Store access, query scopes, response minimization, rate limiting, audit trails, and abuse resistance need review before offering order lookups.

## 7. Webhooks and data lifecycle

`ShopifyHelperService.verify_shopify_webhook()` validates `X-Shopify-Hmac-Sha256` using the configured app secret and `hmac.compare_digest()` (`backend/app/services/shopify_helper_service.py:141-163`). The visible uninstall, customer data request, customer redact and shop redact handlers call it (`backend/app/api/shopify.py:869-1233`). This is a positive primitive, not proof that subscriptions are configured or webhook behavior is operational.

Observed lifecycle gaps:

- `/webhooks/customers/data_request` validates HMAC and parses the request, but explicitly TODOs data collection and only logs/acknowledges it (`shopify.py:966-1045`).
- `/webhooks/customers/redact` explicitly TODOs deletion/anonymization and returns an acknowledgement without deleting customer chat/PII data (`:1047-1133`).
- `/webhooks/shop/redact` deletes shop config and the shop record but explicitly leaves shop-linked chats, customer data, product cache and analytics as TODO (`:1135-1223`).
- The uninstall handler deletes shop/config data (`:869-964`); on unhandled exception it returns a JSON failure object instead of raising/returning a retryable non-2xx status (`:954-964`). Retry/idempotency semantics need deliberate review.
- No Shopify TOML/topic declarations exist in the repository to show which webhooks would actually be subscribed or which callback URLs Shopify receives.

## 8. Security findings and blockers

### Critical blocker: Shopify access token is stored as plaintext

`backend/app/models/shopify/shopify_shop.py:25-44` defines `access_token = Column(String, nullable=True)`. The session exchange writes the received bearer token into that field (`backend/app/api/shopify.py:140-155`); the repository writes it directly (`backend/app/repositories/shopify_shop_repository.py:64-115`); `ShopifyService` and `ShopifyTools` then read it directly into `X-Shopify-Access-Token` (`backend/app/services/shopify.py:52-71`, `backend/app/tools/shopify_toolkit.py:649-657`). The common encryption implementation exists at `backend/app/core/encryption.py`, but this Shopify model/repository path does not use it. A migration/backfill and secure key lifecycle are required before connecting a Carteio store. The response schema omits `access_token` from `ShopifyShopInDB`, which reduces accidental API serialization exposure, but does not protect database backups, SQL access, logs or compromise of the database.

### Session token verification

`ShopifySessionService` uses HS256 with app secret and client ID audience, and expiration/not-before checks (`shopify_session.py:54-97`). `exchange_session_token()` validates before sending the secret-bearing token exchange request and checks a `.myshopify.com` suffix (`api/shopify.py:98-119`). However, `validate_session_token()` first decodes an `unverified` variable that is not used, and the shown code does not explicitly validate the expected `iss`/`dest`/`sub` claim relationships or shop-domain canonical form beyond the suffix. The query-string `id_token` fallback (`shopify_session.py:38-50`) risks tokens in URLs/logging/referrers and should be reviewed. Treat the implementation as **partial pending claim/audience/issuer and request-boundary tests**, not as a verified production-grade auth design.

### OAuth, webhooks, scopes and tenant boundaries

- OAuth state columns exist (`ShopifyShop.oauth_state`, `oauth_state_expiry`; model lines 35-37), but the public checkout has no complete start/callback routes consuming them. The older request HMAC helper is not a substitute for a current install flow.
- Webhook HMAC is implemented, but no local manifest confirms subscribed topics, callback URLs, HTTPS delivery, replay handling or operational retries.
- `SCOPES` includes `read_products, read_themes, write_themes, write_script_tags, read_script_tags, read_orders, read_all_orders, read_customers` (`api/shopify.py:59`). This is broad for an initial widget app. Justify every scope and use least privilege. Historical order access and customer data scopes may need Shopify approval; source declaration does not mean permission is granted.
- Several API paths scope to org and `_require_shopify_agent_in_org`; shop-specific endpoints also compare organization IDs. `require_shopify_session()` resolves session shop to a local installed record (`services/shopify_session.py:113-165`). These controls are useful but not a full isolation proof; test concurrent linking, unlinked shop claims, duplicate installs, revoked tokens, and multiple shops per org.
- `get_shops()` applies organization filtering, while shop ownership must continue to be checked on every identifier-based read/write. API tests are present but were not executed.
- Order email/order-number validation limits query syntax and exact-checks ownership (`shopify_order_access.py:42-93`); it still does not prove the requester controls that email account.
- The API and frontend contain app-specific Shopify identity. `IntegrationsSettings.vue:337-347` has a hard-coded ChatterMate Shopify install URL/client ID; `frontend/index.html:44` embeds `VITE_SHOPIFY_API_KEY`. This identity must not be carried into Carteio.
- No dependency advisory database or live Shopify requirements were queried due to the no-network instruction. Therefore, no claim is made that this revision is clear of historical or current Shopify security advisories. External advisory review remains **UNVERIFIED**. Static code risks above are local evidence, not CVE assertions.

**Do not connect a Carteio test store until token encryption, install/auth claim validation, least-privilege scopes, organization/shop isolation and complete privacy webhooks are addressed and reviewed.**

## 9. Public code vs hosted/enterprise boundaries

- **Public open-source core:** backend shop/session/config API code, data models, Admin GraphQL service, agent tools, widget rendering/client, and webhook handler code.
- **External service/configuration:** Shopify Partner/Dev Dashboard app registration, Shopify App Store listing, public HTTPS host, app client credentials, callback URLs and Shopify’s App Bridge/Polaris CDN. Public docs advertise these but do not package the external Shopify application here.
- **Private/enterprise dependency:** embedded Shopify account connection, session-token bounce, auth-complete, agent selection/management, inbox and pricing Vue views; App Bridge initialization/token helper modules; subscription-related enterprise surfaces. Exact imports are declared in `frontend/src/composables/useEnterpriseFeatures.ts:86-95`; their source tree is absent.
- **Missing from this revision:** Shopify CLI manifest, theme extension/app embed, Liquid source, automatic theme-editor configuration, full public OAuth start/callback route, and complete data export/redaction execution.
- **Unverified:** the installed app’s deployed source/revision, live install, scopes actually approved, theme setup behavior, API version compatibility, webhooks, real product/variant/order response quality, and live session security.

`README.md` claims the App Store listing provides Shopify integration (`:11,49,554`), but this is documentation about an externally hosted/distributed product, not evidence that the full installable app package is in the local public checkout.

## 10. Carteio requirement feasibility

| Carteio requirement | Status | Reusable public code / work required |
|---|---|---|
| Carteio app identity | **MISSING** | Register a new Carteio Partner/Dev Dashboard app, own client ID/secret, listing, URLs and privacy configuration. Replace app-specific literals only in an approved implementation phase. |
| Shopify-managed installation and permission approval | **PARTIAL** | Backend token exchange primitive exists. Build an installable Shopify app package, app manifest, distribution setup, scopes and callback configuration. |
| Secure embedded authentication | **PARTIAL** | Session validation and API session dependency can inform design; public App Bridge utility component is enterprise-only. Implement own supported App Bridge integration and harden claim/request validation. |
| Store-to-organization connection | **PARTIAL** | Shop model, link endpoints and ownership checks exist. Complete onboarding and race-safe tenant binding; test multiple shops/orgs. |
| Embedded agent selection/management | **ENTERPRISE** | Backend config APIs exist; frontend screens are enterprise module imports and absent. Build Carteio embedded UX. |
| Widget ID display/generation | **PARTIAL** | Agent/widget models and ID lookup helper exist. Build embedded management/confirmation flow and define deterministic widget selection. |
| Automatic theme app embed | **MISSING** | No Shopify theme extension/manifest/Liquid. Build extension/app embed and Theme Editor setup UX; do not rely on broad theme/script scopes alone. |
| Product search/recommendations | **PARTIAL** | Shopify Admin GraphQL service and tool functions exist; validate variants/inventory/prices, API version, least scopes, grounding and storefront output. |
| Order tracking | **PARTIAL** | Lookup and tracking code exists with email+order matching. Add adequate customer verification, minimize exposed PII and verify access scopes/Shopify customer-data requirements. |
| Secure webhook registration and processing | **PARTIAL** | HMAC helper and route implementations exist. Add app config subscriptions, idempotent/retry-safe processing, monitoring, and complete uninstall/privacy lifecycle. |
| Encrypted token storage | **MISSING / RELEASE BLOCKER** | Current Shopify token model is plaintext. Apply encryption-at-rest, key rotation/backup and a safe migration/backfill before handling store credentials. |
| Store-specific AI conversations | **PARTIAL** | Agent-shop config binds a shop to an agent; toolkit checks agent/org/shop and widget channel labels Shopify conversations. Prove all conversation, cache and analytics partitioning across stores and prevent cross-store context leakage. |
| Shopify billing | **ENTERPRISE/PARTIAL** | Private pricing UI route is mapped; a cancellation GraphQL mutation appears in shop deletion. No usable public merchant subscription lifecycle/billing implementation is established. |

## 11. How to build Carteio’s own Shopify app

Keep `upstream-chattermate` immutable and do future work only in the separately authorized working tree. Build an independent Shopify app package owned by Carteio. Do not copy original client identifiers, secrets, fixed install URLs, listing identity, callback hosts, webhook URLs or hosted dependencies.

Required configuration to establish in Carteio’s Shopify Partner/Dev Dashboard (manual setup, no changes made):

1. Create Carteio’s own app record and configure distribution model (development-store testing first; decide public listing later).
2. Set Carteio-controlled application URL, OAuth/redirect URLs, and public HTTPS webhook URLs for each required topic.
3. Configure only the scopes needed for initial product and agent functionality. Defer order/customer scopes until authorization and privacy design is approved. Do not request theme write/script-tag scopes if the theme app extension can implement the widget.
4. Add a Shopify CLI `shopify.app.toml` and theme app extension package in the working copy; define extension block/Liquid schema, app embed activation, asset loading, and development configuration. No such files are present in the audited upstream revision.
5. Store app secret and per-shop offline tokens in a secret manager/encrypted column, with key rotation, access logging and redaction from all API responses/logs.
6. Implement supported Shopify embedded session handling; verify signature, issuer/audience, canonical shop, expiry and destination; bind every request to a locally installed shop and its organization.
7. Implement webhook HMAC, topic-specific idempotency, retries, uninstall token revocation/deletion, and full customer/shop data request/redact processing.
8. Build embedded account linking, agent selection, widget status/ID, theme embed setup status, uninstall/reconnect and support/error states.
9. Validate catalog search/product variants and order use only in a Shopify development store after security gates; check current Shopify API version and required approvals manually.

## 12. Recommended implementation sequence

1. **Legal and boundary review:** retain Apache-2.0 headers, `LICENSE`, `NOTICE`, attribution and third-party notices in derived work. Confirm the licensing status/terms of any enterprise functionality independently; absent submodule code is not available to copy.
2. **Threat model and token remediation:** encrypt existing/future tokens, define a migration and rollback plan, review secrets, logs and response schemas. No store connection before acceptance.
3. **Carteio Shopify app registration:** create Carteio-owned dev app identity, choose test distribution, configure HTTPS callbacks and minimum scopes; keep secret values out of source control.
4. **Embedded app foundation:** implement the missing Shopify CLI config, App Bridge session acquisition and secure backend authentication; finish store/org linking and agent-selection UI.
5. **Theme extension and widget setup:** build a theme app extension/app embed, activate it in a development theme, verify widget ID/config refresh and storefront CSP/CORS/WebSocket behavior.
6. **Catalog and conversation validation:** test product/variant/price/inventory answers with deterministic expected data and prove store/session isolation.
7. **Order support and privacy controls:** only after selecting a strong customer verification model; minimize data in prompts/transcripts and complete data export/redaction/uninstall processing.
8. **Shopify lifecycle and release gate:** signed webhook integration, retries/idempotency, scopes review, API version verification, security tests, App Store/policy review and support/incident runbooks.

## 13. Limitations of this investigation

This is a static inspection of the selected local revision. Shopify Admin, the App Store, hosted ChatterMate services and private enterprise repositories were not accessed. No app installation, token exchange, webhook delivery, GraphQL call, build, or test was performed. The screenshot was described but not attached. Consequently, this report identifies what is and is not present in local source; it does not validate runtime behavior or the deployed Shopify app.

The previous Phase 00 and Phase 01 reports were reviewed. They had already identified the missing embedded onboarding surfaces, plain-text Shopify token column, broad scopes, public backend primitives and absent runtime verification. This report expands those findings with exact frontend route/module and package evidence.
