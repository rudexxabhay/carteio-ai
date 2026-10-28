# Shopify storefront website discovery — Phase 16G

## Runtime flow

1. Shopify verification reads `shop.primaryDomain.url` from the authenticated Admin GraphQL response and stores its HTTPS origin in the existing integration connection `siteUrl`. The authenticated `.myshopify.com` identity remains the provider identity; malformed/non-HTTPS primary domains are not used as crawl origins.
2. An owner/admin explicitly selects **Discover storefront** in Integrations. Carteio registers a normal `WEBSITE` knowledge source through the existing KnowledgeService. Registration does not enqueue work.
3. The merchant publishes the existing `_carteio-verify.<host>` TXT challenge and completes DNS verification. Shopify connection status alone does not grant website crawl authorization.
4. An owner/admin explicitly selects **Refresh public knowledge**. Existing knowledge job leases, crawler, indexing generation and retrieval pipeline perform the work.

The crawler combines the root URL, bounded sitemap index/XML entries, same-host navigation links, canonical URLs and up to 200 URLs from currently authorized and synchronized Shopify online-store pages. Sitemap, page, depth, byte, redirect and time bounds are inherited from the existing Phase 16A crawler. Relevant business/policy paths are prioritized. Shopify `/products` and `/collections` paths are excluded only when the matching connected Shopify instance is present, to avoid copying the connector's typed catalog into website knowledge.

The crawl remains restricted to the exact verified host and configured path prefix. It rejects unsafe/private DNS answers, pins the resolved public address for each request, rejects cross-host redirects and links, checks robots rules, rate-limits by host, bounds response sizes, and omits account, checkout, admin, order, payment and authentication paths. A crawl rechecks source verification and worker lease between requests and before publication.

## Ingestion and retrieval

Pages retain their canonical URL, title, category, language, extraction method, content hash, fetched time and indexed time. Structured FAQ JSON-LD question/answer pairs are included when present. Scripts, styling, navigation, hidden content, forms and common tracking/boilerplate elements are excluded by the existing extractor. Content is indexed as untrusted, attributed public website evidence and remains subject to normal knowledge-base/assistant authorization.

Shopify Admin policy records remain separate connector knowledge and are never overwritten by crawled pages. Retrieval labels a `SHOPIFY_LEGAL_POLICIES` record synchronized within 24 hours as `SHOPIFY_API_POLICY`, an older record as `SHOPIFY_API_POLICY_STALE`, and a crawled page as `PUBLIC_WEBSITE`. Evidence carries the provider sync time or page fetched time. The answer contract treats a fresh API policy as authoritative and discloses material disagreement with storefront copy using separate citations. A stale API record is not presented as current; the verified public page can support an answer with its own source and fetch time identified.

The dashboard reports provider storefront URL, ownership status, crawl stage/status, discovered URL count, indexed page count, robots-skipped and unsupported counts, failures, last successful refresh and error code. Shopify online-store page seed URLs are used only when the provider grant snapshot is fresh, the read operation capability is verified, and workspace sync permission is enabled.

## Limits and manual activation

- The existing crawler completes each bounded source crawl in one durable job; a worker retry restarts discovery rather than resuming at a per-URL cursor. Existing lease recovery, generation publication and safe retention of unobserved pages remain in effect.
- Sitemap traversal is bounded (10 sitemap documents, depth 2, bounded URL count), and each crawl is bounded by the registered source page/depth limits. Truncated discovery is reflected in run counts/warnings; absence from a partial crawl does not delete a previously stored page. Only observed 404/410 responses mark a page removed.
- A Shopify `myshopify.com` domain may not allow the merchant to publish a DNS TXT record. In that case, the existing website ownership requirement blocks crawling until the merchant uses a controllable custom domain. Shopify connection status is intentionally not treated as a substitute proof.
- Refresh remains a manual action. Existing scheduled website policies can be configured after verification, but newly discovered sources default to the existing `MANUAL` policy.
- Crawled sources must still be assigned to an active Knowledge Base linked to the intended assistant before public assistant retrieval can use them.
- This source change requires the additive migration in `backend/prisma/migrations/20261017150000_phase_16g_shopify_website_discovery/migration.sql`, followed by Prisma client generation and migration application by an operator. Neither was run here.

## Acceptance order

1. Apply the migration and generate the Prisma client in a controlled local environment.
2. Run the focused backend crawler, website sync, discovery service, knowledge processing, and frontend connector tests.
3. Reverify a connected Shopify store and confirm the returned primary storefront domain is correct.
4. Explicitly discover the storefront; verify the source remains unverified and no crawl starts.
5. Publish and verify the DNS TXT proof. Confirm unsafe/private DNS fails closed.
6. Explicitly refresh. Confirm robots, sitemap, canonical URL, internal-link, Shopify page-seed, size, page/depth and redirect bounds in the real crawl run.
7. Review page counts/categories/source URLs, assign the website source to an authorized Knowledge Base, and test assistant citations and permission removal.
8. Confirm current Shopify API policy evidence is labeled authoritative and conflicts with crawled pages are attributed separately.
