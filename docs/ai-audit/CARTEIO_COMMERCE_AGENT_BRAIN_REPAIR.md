# Carteio Commerce Agent Brain Repair

## Summary

The application already contains a secured Shopify catalog reader and a shared AI orchestration path. The Testing chat does reach that shared path. Two source-level routing defects could prevent catalog data from helping: a generic `capability` classification could short-circuit before the product search even when semantic interpretation also identified a product request, and the social-turn guard rejected negative-polarity acknowledgments. The latter could route a short decline back through the unresolved business question and repeat its missing-evidence response.

I corrected those decision points and added focused regression tests. The tests were not run. No database or runtime state was inspected, so this does not establish that Carteio's Shopify connection is active or that product rows exist.

## Existing Shopify architecture

### Connection, sync, and stored data

- Shopify OAuth and verified scope/capability handling live in `backend/src/modules/workspaces/connectors/shopify-oauth.service.ts`, `shopify-granted-scope-discovery.service.ts`, and the connector services. The code vaults credentials and checks the granted scopes and verified capabilities before enabling reads.
- `ShopifyConnectorAdapter.sync()` in `backend/src/modules/workspaces/connectors/shopify.adapter.ts` uses Shopify Admin GraphQL for products. Its product query includes product title, description, handle, type/vendor/category, images, collections, variants/options/SKUs, prices, inventory-related fields, status, and timestamps, subject to available scopes.
- `ConnectorSyncWorkerService` in `backend/src/modules/workspaces/connectors/connector-sync-worker.service.ts` persists synchronized records. The `CommerceProduct` and `CommerceProductVariant` models in `backend/prisma/schema.prisma` store normalized catalog values, connection/workspace ownership, and sync timestamps.
- Per-turn catalog search reads this synchronized local snapshot. It does not call Shopify live. `CommerceReadContracts` in `backend/src/modules/workspaces/connectors/commerce-read-contracts.service.ts` performs bounded catalog search and revalidation. Shopify scope freshness, connection state, workspace/assistant permissions, and organization ownership are checked before product data is exposed. Price, inventory, and category fields remain permission-filtered. Snapshot age is represented; stale snapshot values must not be described as live.

### APIs and product-search interfaces already present

The integration includes Shopify OAuth and Admin GraphQL operations for synchronization, capability verification, and supported read resources such as products, orders, and selected store content/policies. The AI-facing product read interface is `CommerceReadContracts.searchCatalog(organizationId, assistantId, queries, limit, browseAll)`, with `canSearchProducts()`, `getProductDetails()`, and `revalidateProducts()`.

The orchestrator also exposes a bounded `search_store_products` model tool when the configured provider/model supports tool calls and the server confirms catalog eligibility. Tool arguments are validated, each call rechecks authorization, and the number and duration of tool steps are bounded. Product results are passed back to the same response-generation path as evidence.

## Testing chat execution path

`frontend/src/pages/training/PlaygroundChat.tsx` calls `sendPlaygroundMessage()` in `frontend/src/services/api/assistants.ts`. That API client posts to `POST /:assistantId/playground/chat`, handled by `AssistantController.playgroundChat()` and forwarded through `AssistantService.playgroundChat()` to `ConversationOrchestrator.playgroundChat()` and `executeSharedAI()` in `backend/src/modules/workspaces/conversation-orchestrator.service.ts`.

The public widget has separate session/origin checks in its own path, then calls the same shared AI execution method. Therefore the Testing chat does not bypass RAG or use a separate product pipeline. For business requests, the shared orchestrator interprets the request, resolves allowed knowledge, searches the authorized knowledge and catalog sources, builds bounded evidence, invokes the selected provider, revalidates evidence, validates the response, and persists response origin/provider/source metadata.

## Confirmed routing defects and changes

### Product discovery could be short-circuited

The orchestrator previously returned from its `parsed.intent === 'capability'` branch before calculating `productIntent`. This meant a request classified as a general assistant-capability question could skip catalog retrieval even if its validated semantic intents also contained `PRODUCT_INQUIRY`, `PRICING_INQUIRY`, or `AVAILABILITY_INQUIRY`.

The product intent is now derived before that branch. The capability response is used only when the semantic interpretation does not also identify a substantive product request. The interpretation instruction now distinguishes “what can this AI do?” from a merchant question about products/services, in any language, without adding phrase maps or merchant-specific rules.

When product discovery is broad and no product entity was identified, the orchestrator now invokes the existing catalog browse mode with a maximum of five returned products. When a product entity is present, it keeps the narrower match mode and two-result bound. The catalog query remains tenant/assistant/connection/scope authorized inside `CommerceReadContracts`; the change does not grant access or call Shopify live.

### Negative acknowledgment could re-enter business routing

`decideSocialResponse()` previously accepted only affirmative or not-applicable polarity for a social intent. A standalone acknowledgment classified as `ACKNOWLEDGMENT` with `NEGATED` polarity was rejected and sent to normal business routing. With prior missing-evidence history, that could lead back to an irrelevant product/policy fallback.

The guard now accepts negative polarity only when there is exactly one intent, it is `ACKNOWLEDGMENT`, the overall social classification is `ACKNOWLEDGMENT`, interpretation is certain, there is no clarification pending, and there are no entities. Mixed social/business intents, unknown/ambiguous classifications, and negative polarity for other categories remain outside the social shortcut. The prompt describes this semantic distinction and explicitly states that “no” never authorizes an action.

## Diagnostics

The existing metadata-only events remain in use. `commerce_request_decision` records the entry point, legacy and semantic product classification, whether the capability branch was skipped, whether the commerce reader is configured, and the routing decision. `playground_shopify_product_evidence` records whether a catalog search was attempted, whether it used bounded match or bounded discovery, result/stale counts, and a safe outcome category. No customer message, query text, product record, prompt, or credential is logged by these additions.

Existing `conversation_agent_turn`, `playground_llm_context_assembled`, and response persistence metadata distinguish tool calls, evidence supplied to the model, and provider versus system fallback origin. A provider/model label in the UI is not proof that a response was grounded; the source/citation and answer-origin fields are the relevant evidence.

## Runtime data status and remaining uncertainty

Source code proves that a catalog reader is wired into the shared AI path, but cannot prove that the current development database contains synchronized products or that Carteio's connector grants are active and fresh. No database query, Shopify call, or live conversation was made for this repair.

The reported turn's exact runtime classification and resulting branch are also not available in source. The new safe decision event can establish whether a future request was routed as product search or capability-only. Catalog diagnostic events then show whether the search returned results. A future approved trace should correlate the same request ID across `commerce_request_decision`, `playground_shopify_product_evidence`, `conversation_retrieval_candidates`, `playground_llm_context_assembled`, `conversation_agent_turn`, and `conversation_grounding_validation`.

Before a real catalog-backed conversation, an authorized operator should verify read-only that: (1) the intended organization has a connected Shopify connector; (2) its granted-scope verification is current and includes the required catalog capability; (3) workspace and assistant product permissions are enabled; and (4) at least one non-deleted `CommerceProduct` row exists for that organization/connection. Only aggregate counts and safe status metadata are needed. This database verification requires separate approval; do not print connection details or product/customer records. A product row count of zero or a blocked permission is a data/setup issue, not evidence that the model can search products.

## Security and freshness boundaries preserved

- Organization and assistant checks remain server-side in `CommerceReadContracts`.
- Only connected, eligible commerce connections with current Shopify grant/capability checks are included.
- Existing workspace and assistant permission checks still control catalog fields.
- Product snapshots remain snapshots. Stale prices or availability are not represented as live Shopify values.
- Private order/customer access is not added or broadened. Existing operator ownership checks and private-record restrictions remain in force.
- Widget origin/session authorization remains independent and unchanged.
- Knowledge retrieval, active source authorization, citation revalidation, and grounded-response validation remain unchanged.
- No schema, crawler, index, or relationship changes were made.

## Files changed

- `backend/src/modules/workspaces/conversation-orchestrator.service.ts` — capability/product distinction, bounded broad catalog discovery, and safe routing/search metadata.
- `backend/src/modules/workspaces/social-conversation.ts` — narrowly accepts validated standalone negative acknowledgments.
- `backend/test/assistant.playground.spec.ts` — regression for product discovery despite a legacy capability label and negative acknowledgment after missing evidence.
- `backend/test/social-conversation.spec.ts` — guard coverage for negative acknowledgment and rejection of mixed/unknown classifications.
- `docs/ai-audit/CARTEIO_COMMERCE_AGENT_BRAIN_REPAIR.md` — this report.

## Tests added; not executed

The new fixtures cover the actual shared Playground orchestrator with mocked provider and commerce boundaries. The product case asserts that a semantic product request is searched in bounded catalog-discovery mode, that returned catalog evidence reaches the model context, and that the final response retains the catalog source. The social tests assert that a validated negative acknowledgment avoids business retrieval and that mixed or unknown requests do not receive the social shortcut.

No tests, builds, provider calls, servers, workers, database operations, synchronization, or crawling were run.

## Manual runtime verification

After a separate approval for runtime verification:

1. Confirm the intended Shopify connection, fresh granted scopes, workspace/assistant product permissions, and non-zero synchronized product count using an authorized read-only procedure.
2. Send a broad product-discovery question in Testing chat. Record its request ID.
3. Confirm `commerce_request_decision` reports product search, `playground_shopify_product_evidence` reports an attempted bounded catalog search and a nonzero evidence count, and `playground_llm_context_assembled` reports commerce product evidence.
4. Confirm the final answer cites the returned catalog item and its `answerOrigin`/provider metadata; inspect freshness wording before relying on prices or stock.
5. In a separate turn, send a standalone negative acknowledgment after a prior failed lookup. Confirm routing is social and no knowledge/catalog lookup occurs for that turn.
6. Repeat through the authorized public widget only after its normal origin and session checks pass. Do not use the Playground as a substitute for widget authorization testing.

Until those checks succeed against the real synchronized catalog, Shopify products are implemented as an available authorized capability but are not verified usable for the current Carteio runtime.

## Latency and cost

No additional model call was introduced. The existing interpretation call is reused. Product-intent turns already use the local synchronized catalog reader in parallel with Knowledge search; broad discovery is bounded to five returned items from the existing candidate query. This may add local database work for broad catalog discovery, but it does not add a Shopify network request or a paid provider call. Native model tool calls retain their existing bounded steps and timeout.
