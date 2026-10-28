# Carteio Central Knowledge Architecture

## 1. Original architecture

Carteio already stores workspace knowledge in `KnowledgeBase`, `KnowledgeBaseSource`, `KnowledgeSource`, `KnowledgePage`, and `KnowledgeChunk`. The existing knowledge worker crawls or indexes supported sources and publishes an active index generation. `KnowledgeBaseService` owns assistant-to-base and base-to-source relationships. `KnowledgeProcessingService.searchPreview()` runs lexical and optional semantic retrieval over the selected source IDs. The conversation orchestrator uses that retrieval path for both Playground and customer conversations, then assembles bounded evidence for the existing provider and grounding flow.

## 2. Original linking and eligibility problems

The effective-source resolver selected only bases explicitly linked through `AssistantKnowledgeBase` (plus legacy direct assistant-source links for internal preview). A ready source in a workspace's only Knowledge Base was therefore absent from a new or unlinked assistant's retrieval scope.

Separately, generic website retrieval filtered a website source against the assistant's verified widget website domain. That coupled the hostname from which public business knowledge was collected to the domain where the widget is installed. The same domain match also appeared in website readiness presentation. Widget origin and session authorization are distinct checks and remain required for public widget requests.

## 3. Confirmed root causes

- `KnowledgeBaseService.resolveEffectiveSources()` had no single-base workspace default; it depended on an explicit assistant-to-base relationship.
- `KnowledgeProcessingService.filterWebsiteSourcesForAssistant()` required the source URL host to match the assistant website host for generic public website sources. This could exclude the indexed `carteio.in` source even when the source and assistant belonged to the same organization and the source was public and ready.
- Website page diagnostics exposed widget-domain eligibility as if it were knowledge retrieval readiness.

The indexed source remains subject to source lifecycle, visibility, tenant, connector permission, and Shopify ownership checks.

## 4. Server-side effective Knowledge Base resolution

`KnowledgeBaseService.resolveEffectiveSources(organizationId, assistantId, options)` is now the shared source-set resolver used by retrieval and revalidation:

- It verifies the assistant belongs to the requested organization and is active.
- With exactly one active, non-archived Knowledge Base, it selects that base as the workspace default without writing or duplicating a relationship.
- Sources in the implicit default are eligible only when `PUBLIC_REFERENCE`.
- With multiple active bases, it includes only active bases explicitly linked to that assistant. It does not implicitly merge other bases.
- Existing explicit assistant-to-base links remain valid. Legacy direct assistant-source links remain available to the existing internal preview path.
- A source must be registered, `READY`, have a non-null active index generation, and be in the organization. Public retrieval additionally requires public visibility and a non-deleted source.
- Inactive assistants receive no effective knowledge.

No schema change or migration is used. A newly ready FAQ or website source is picked up on the next resolution request; it is not copied or reindexed because an assistant uses it.

## 5. Single-base and multi-base behavior

For one active base, active assistants can use its ready public sources without a manual assistant link. Restricted sources are not implicitly exposed. If an assistant already has an explicit relationship to that base, the relationship remains intact.

For multiple active bases, the resolver preserves explicit assistant assignments. There is no automatic merge or arbitrary “first base wins” selection. A source may still be explicitly included in multiple bases under the existing relationship model.

## 6. Source readiness and generations

The resolver uses existing source state and active index generation fields. Retrieval SQL continues to require source organization, current source version, the source's active generation, registered/ready state, public visibility for customer-facing evidence, and non-deleted state. The orchestrator revalidates public evidence before passing it to the response path. Incomplete or unpublished generations are not made active by this change.

Partial crawl history and freshness fields are retained. The reported `carteio.in` crawl had 7 pages and 8 chunks indexed, with 2 failed pages. This implementation does not rerun the crawl or mark that partial crawl complete.

## 7. Website source host, widget origin, and Shopify authorization

These checks now have separate purposes:

- **Generic public website source host:** identifies the website content being indexed. It does not need to equal the chatbot widget installation host for workspace-authorized Playground retrieval or for already-authorized customer requests.
- **Widget installation origin/session:** remains independently validated by the existing widget/session flow. The public visitor resolver still requires an active assistant website with a verified domain and a matching request origin. This change does not relax widget origin or session checks.
- **Shopify-discovered storefront:** remains subject to the existing source ownership verification gate (`VERIFIED` and `verifiedAt`) when it is identified as a Shopify storefront.
- **Shopify connector and private customer/order data:** existing connector scope freshness, business permission, assistant permission, tenant, and tool authorization checks remain in place. No private customer records are added to generic public knowledge.

The AI Playground uses the authenticated workspace and the shared public-safe source resolver; it no longer requires a source hostname to match the widget deployment domain.

## 8. Retrieval pipeline changes

The existing hybrid retrieval path is preserved. `searchPreview()` now obtains authorized source IDs from the shared resolver, then applies public audience, source-specific Shopify verification, and connector permission filters. Lexical and semantic queries continue to use tenant and current-generation constraints. `revalidatePublicEvidence()` resolves the same eligible source set before evidence can reach the model. No new RAG engine, provider, or indexing algorithm was added.

The assistant effective-knowledge endpoint uses the same resolver plus the same public website and connector gates and reports eligible base/source counts. It reports per-source semantic index status where present. A source being available for retrieval does not mean vector search is active: retrieval can remain lexical-only when semantic indexing/provider configuration is unavailable. Runtime retrieval responses continue to report the actual mode.

## 9. UI simplification

The Knowledge Base page now describes automatic access when the server reports that this is the workspace default base. Manual assistant links remain available as advanced relationships, primarily for multi-base workspaces; the page labels those as explicit links and separates knowledge availability from widget origin/session checks. Partial crawl warnings remain visible.

The Assistant management view now loads the server's effective-knowledge read model. It shows the effective base(s), eligible ready public source counts, retrieval availability, semantic-index readiness counts, and that widget origin/session checks are separate. It does not infer readiness from React state or a local assignment toggle.

## 10. Exact files changed

- `backend/src/modules/workspaces/knowledge-base.service.ts` — sole-active-base default resolution, explicit multi-base behavior, readiness/visibility filters, and semantic-index metadata.
- `backend/src/modules/workspaces/knowledge-processing.service.ts` — shared resolution in retrieval/revalidation and effective-knowledge read model; generic public website sources are no longer filtered by widget hostname; Shopify storefront and connector checks remain.
- `backend/src/modules/workspaces/knowledge-base.controller.ts` — authenticated effective-knowledge endpoint delegates to the read model.
- `frontend/src/services/api/knowledge-bases.ts` — effective-knowledge response contract.
- `frontend/src/pages/assistants/AssistantPages.tsx` — server-backed effective knowledge and retrieval/semantic status display.
- `frontend/src/pages/knowledge/KnowledgeBasePage.tsx` — workspace-default explanation and clearer separation of explicit links, knowledge readiness, and widget eligibility.
- `backend/test/knowledge-base.service.spec.ts` — deterministic tests for sole-base default, restricted/unindexed exclusions, and explicit multi-base assignment.
- `backend/test/knowledge-processing.spec.ts` — tests for source-ID authorization without website-host coupling, Shopify storefront verification, revalidation, and the effective-knowledge read model. The test database mock now defaults source lookups to an empty array.
- `frontend/src/tests/knowledge-base.test.tsx` — test metadata now distinguishes default versus explicit multi-base behavior; adds a user-flow test proving the default base needs no manual link and can be selected for retrieval preview.

## 11. Tests created and execution status

Tests were added or extended as listed above. They cover the resolver and retrieval authorization boundaries using deterministic database/provider mocks. No tests, builds, server, worker, crawl, database operation, or provider call were run as part of this change.

## 12. Security risks and mitigations

The primary risk is accidental implicit access to private or cross-tenant material. Implicit default access is limited to public-reference sources in one active base. Every query remains organization-scoped; multiple bases require explicit links; archived, unready, unindexed, and deleted sources are excluded from public retrieval. Connector permissions and Shopify verification remain separate required gates. Widget origin/session validation is unchanged.

## 13. Manual verification procedure

1. In a local workspace with exactly one active Knowledge Base, open an active assistant's Playground without creating an assistant-to-base link.
2. Confirm the effective-knowledge view reports the default base and its ready public sources.
3. Use the retrieval preview with a question whose answer is present in a ready FAQ or indexed website page. Confirm the source and current index generation appear in evidence.
4. Confirm an `INTERNAL_RESTRICTED` source is excluded from customer-facing/Playground retrieval.
5. Confirm the generic `carteio.in` source is eligible even if the widget installation host differs, while the actual widget still rejects an unapproved origin/session.
6. With two active Knowledge Bases, confirm only explicitly assigned bases appear in an assistant's effective knowledge.
7. Confirm a Shopify-discovered storefront still fails its source ownership gate until verified, and connector/private-record access still requires existing permissions.
8. Confirm the website source still reports 2 failed pages as a partial crawl and that no crawl or indexing job is created by assistant usage.

These steps require normal local runtime access and must be performed separately. This report does not claim the new behavior has been verified at runtime or that answer accuracy has been measured.

## 14. Remaining limitations

- No runtime retrieval or widget-origin test was run, so the changed behavior is source-reviewed but not runtime-confirmed.
- Semantic retrieval still depends on existing embedding configuration and compatible semantic indexes; lexical retrieval remains the supported fallback.
- Full semantic claim-to-evidence entailment is not provided by this architecture change; existing deterministic grounding checks remain partial.
- When multiple bases exist and no explicit link exists, no base is implicitly selected. The merchant must choose explicit access using the existing controls.
- A source can be marked ready while content quality or coverage is poor; crawler quality, ranking tuning, and real merchant benchmark results remain separate follow-up work.
