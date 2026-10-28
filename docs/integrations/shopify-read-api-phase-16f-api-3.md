# Shopify read API integrations — Phase 16F-API-3

## Implemented in Carteio

Shopify API calls use the existing `ShopifyConnectorAdapter`, encrypted connector token lifecycle, configured `SHOPIFY_API_VERSION` (default `2026-10`), connector sync worker and knowledge source pipeline. They run only in an explicitly queued connector sync after the category is enabled. Scope verification probes are read-only and execute only for grants returned by Shopify's authenticated `currentAppInstallation.accessScopes` discovery. A probe records a provider capability only after a successful API response.

| Carteio data category | Admin GraphQL read | Required actual scope | Stored data |
| --- | --- | --- | --- |
| `SHOPIFY_LOCATIONS` | `locations` | `read_locations` | Name, active/fulfillment flags, formatted address |
| `SHOPIFY_SHIPPING` | `deliveryProfiles` | `read_shipping` | Profiles, associated location groups, zones and delivery method descriptions/status |
| `SHOPIFY_LEGAL_POLICIES` | `shop.shopPolicies` | `read_legal_policies` | Policy name/type/URL/body and update time; bounded response handling |
| `SHOPIFY_ONLINE_STORE_PAGES` | `pages` | `read_online_store_pages` **or** `read_content` | Page title/handle/body and update time; HTML active script/style removed before indexing |
| `SHOPIFY_MARKETS` | `markets` | `read_markets` | Market name/handle/status and supported currency settings |
| `SHOPIFY_DISCOUNTS` | `discountNodes` | `read_discounts` | Discount typename/title/summary/status for implemented discount types |
| `SHOPIFY_METAOBJECT_DEFINITIONS` | `metaobjectDefinitions` | `read_metaobject_definitions` | Definition name/type/description and field schema |
| `SHOPIFY_METAOBJECTS` | `metaobjectDefinitions` followed by typed `metaobjects` | `read_metaobjects` **and** `read_metaobject_definitions` | Entries only for current `PUBLIC_READ` definitions with supported, non-sensitive scalar fields |

Existing product sync continues to include product type, Shopify taxonomy and collection membership, so product collections need no additional permission or separate sync category. It requires the existing `read_products` grant.

Top-level connections use Shopify `pageInfo` cursors with bounded batches. Product images are fetched in ordered cursor pages (`images(first:100, after:$after)`) with a 1,000-image per-product ceiling, ID deduplication, and explicit completeness validation before persistence. Shopify response/throttle errors flow through the existing worker retry policy; a cursor loop or bound exhaustion fails the sync and degrades the connector rather than claiming a complete snapshot.

Delivery profiles use top-level cursors (`first:50`). Shopify returns `profileLocationGroups` as a list, while each group's locations, zones, and each zone's methods are nested connections. Carteio requests their documented maximum bounded page size of 250 and inspects every nested `pageInfo`; any remaining page fails with `CONNECTOR_NESTED_PAGINATION_INCOMPLETE`, and the worker does not persist that page. Shopify's nested fields do not provide a selector for independently applying each list item's distinct cursor, so a profile exceeding 250 nested locations/zones/methods cannot be exhaustively paginated by this query shape. Such stores remain blocked for a complete shipping snapshot instead of being reported ready.

Metaobject definitions are classified locally. Only definitions currently marked `access.storefront = PUBLIC_READ`, with a bounded list of supported scalar fields and no sensitive field keys, are eligible for entry reads. Entry queries use Shopify's required `type` argument and paginate `metaobjects` by cursor. Every page rechecks the definition's public access. Returned fields must match the current definition schema, sensitive keys are dropped, script/style markup is removed, and entries are stored as `PUBLIC_REFERENCE` only for the explicit `SHOPIFY_METAOBJECTS` category. Private/unknown definitions remain inaccessible to AI; definition schemas themselves are stored as internal restricted data. Both metaobject scopes and a successful entry capability probe are required. Legal policies use the non-connection `shopPolicies` field. The worker rechecks live grants, capabilities, and sync permission before persistence; retrieval rechecks tenant, current grant freshness, capability, workspace and assistant permissions.

## Deliberately unsupported

`read_metaobjects` is executable only as the bounded, public-safe operation described above, and requires `read_metaobject_definitions` too. It does not enable generic private metaobject reads, arbitrary type queries, references, files, or unknown field types. Definitions that fail current schema/access checks are skipped; a selected type that loses public access during sync fails closed. Shopify approval and a live provider probe are still required before a store is considered ready.

Provider verification is not a live claim about the connected store. The operation is query-ready only after a successful probe, data-ready only after sync, and AI-eligible only after fresh grants and merchant workspace/assistant permissions. No new scope is requested automatically, no write operation is introduced, and no AI permission is changed by this implementation.

## Database and configuration

No Prisma change, migration, or new environment variable is required. Existing connector permissions, Shopify grant snapshots, connector capabilities, and categorized knowledge sources are reused. The legacy OAuth request list remains untouched. Each new category defaults disabled under the existing permission model. Existing products, widget/chat, ticketing, and non-Shopify providers are outside this change.

## Merchant action before use

1. In the Shopify Dev Dashboard, verify the active released app version declares each desired read scope and release an updated version if it does not. Carteio does not read that declaration dynamically.
2. An authorized merchant initiates the existing explicit Shopify scope-upgrade flow for selected scopes only; Shopify approval/reauthorization is required where the store has not granted them.
3. Refresh the connection's permissions in Carteio. Confirm Shopify's actual grant snapshot and successful read-only provider verification.
4. Enable only the desired workspace sync/AI category, explicitly run that category's connector sync, and select assistant access after reviewing the data classification.

The first manual next action is to verify the selected scopes against the released app-version declaration and choose a limited read-only set for the existing gated merchant-approved upgrade. Do not infer grant or readiness from the inventory or this source implementation.

## Official Shopify API references

- [Access scopes](https://shopify.dev/docs/api/usage/access-scopes)
- [Locations query](https://shopify.dev/docs/api/admin-graphql/latest/queries/locations) and [Location object](https://shopify.dev/docs/api/admin-graphql/latest/objects/location)
- [Delivery profiles query](https://shopify.dev/docs/api/admin-graphql/latest/queries/deliveryProfiles)
- [Shop policy object](https://shopify.dev/docs/api/admin-graphql/latest/objects/shoppolicy)
- [Pages query](https://shopify.dev/docs/api/admin-graphql/latest/queries/pages) and [Page object](https://shopify.dev/docs/api/admin-graphql/latest/objects/page)
- [Markets query](https://shopify.dev/docs/api/admin-graphql/latest/queries/markets)
- [Discount nodes query](https://shopify.dev/docs/api/admin-graphql/latest/queries/discountNodes)
- [Metaobject definitions query](https://shopify.dev/docs/api/admin-graphql/latest/queries/metaobjectDefinitions)
- [Metaobjects query](https://shopify.dev/docs/api/admin-graphql/latest/queries/metaobjects)

The `latest` reference pages were consulted on 2026-10-16; adapter requests remain versioned at `2026-10` by its configured version.
