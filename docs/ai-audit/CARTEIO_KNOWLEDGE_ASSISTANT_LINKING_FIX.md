# Carteio Knowledge Base and Assistant Linking Fix

## Summary

The assignment APIs and most of the assignment UI already existed. The workflow was difficult to discover: website sources were omitted from the Unassigned Sources type filter, and assistant links were only available inside the Knowledge Base detail tabs or Assistant detail screen. The stored website diagnostics also called only widget-eligible assistants “assigned,” which could show “None assigned” for an existing Knowledge Base relationship when the assistant did not meet the verified-domain rules.

The changes make the existing controls easier to reach, report actual relationships separately from widget domain eligibility, and correct a readiness label that could say AI READY while source processing was not READY. No new assignment model, route, table, or crawl flow was introduced.

## Existing functionality found

- `KnowledgeBaseController` already exposes tenant-authenticated endpoints for listing and adding/removing sources from a Knowledge Base, listing and linking/unlinking assistants, and managing Knowledge Bases from an assistant.
- `KnowledgeBaseService.addSources` uses the existing organization-scoped source and base relationships and `createMany(..., skipDuplicates: true)`. It adds a relationship; it does not crawl the website.
- Assistant linking checks workspace manager access and scopes both the base and assistant to the current organization. Existing database uniqueness protects duplicate links.
- The Knowledge Base detail page already had an Assistant connections tab. The Assistant management screen already had linked Knowledge Bases controls.
- Website retrieval continues to use the existing effective-source and visibility filters. This change does not relax retrieval authorization.

## Changes implemented

- Added a **Manage assignments** action to each active Knowledge Base card. It opens the existing assistant connections tab directly.
- Added prominent **Add existing source** and **Connect assistants** actions to the Knowledge Base detail header. The existing-source picker reuses sources and does not enqueue a crawl. The Add Knowledge drawer now says explicitly that existing website sources can be reused.
- Added **Website** to the Unassigned Sources type filter so indexed website sources can be found and added to a Knowledge Base through the existing bulk assignment path.
- The existing assistant selector now lists only active assistants. The server independently rejects a newly requested link to an inactive assistant. Existing links to inactive assistants remain visible and can still be removed.
- Added success feedback for source membership and assistant link/unlink actions. Unlink continues to require confirmation.
- The website diagnostics preserve the existing `assignedAssistants` field behavior and add `linkedAssistants` for actual direct or active Knowledge Base relationships. `domainEligibleAssistants` reports assistants that meet the active assistant, active website, verified website and source-domain matching checks. This makes the relationship distinction additive for existing API consumers.
- `searchReady` continues to require a current indexed generation with chunks, `processingStatus === READY`, `PUBLIC_REFERENCE` visibility, and at least one domain-matched assistant. Availability now reports `BLOCKED_ASSISTANT_ELIGIBILITY` when linked assistants do not meet the widget domain requirements, rather than incorrectly claiming no assignment. It also reports `INDEX_PENDING` when processing is not READY.

## Readiness and partial crawl behavior

An assignment alone does not make a source AI_READY. The existing website status logic verifies current-generation indexed chunks, source readiness, public-reference visibility, and assistant website domain eligibility. Customer retrieval still applies its own server-side tenant and source eligibility checks.

The reported crawl had 7 pages and 8 chunks indexed, but 2 URLs failed and the crawl was incomplete. The existing freshness calculation uses `lastSuccessfulSyncAt`, which is only advanced for a complete crawl. Therefore `UNAVAILABLE` freshness is expected until a complete successful crawl exists; it was not changed to imply freshness. The latest-run failed-page count and partial crawl error remain visible. No historical failure metadata was cleared.

Actual assignment state for the reported source was not read from the database in this code-only change. The updated readback will distinguish “Linked assistants” from “Domain matched” on the next page load, making it possible to tell whether the remaining block is a missing link or assistant website eligibility.

## Security and compatibility

- No API contract was removed. The diagnostics response adds optional `linkedAssistants` and `domainEligibleAssistants` fields; the existing `assignedAssistants` field retains its prior eligibility behavior.
- Existing controller authentication, organization checks, owner/admin write permissions, unique relationship constraints, and retrieval filters remain in place.
- Assistant IDs from the browser are still verified against the current organization and active status by the server before linking.
- No source data is copied, re-crawled, or made public by linking. Visibility remains `PUBLIC_REFERENCE` only when explicitly set through the existing source rules.
- No schema, migration, dependency, database write, crawler, or AI Brain changes were made.

## Files changed

- `backend/src/modules/workspaces/knowledge-base.service.ts` — active assistant list and server-side active-assistant link validation.
- `backend/src/modules/workspaces/knowledge-processing.service.ts` — actual link versus domain eligibility readback and readiness status.
- `backend/test/knowledge-base.service.spec.ts` — active-assistant link validation coverage.
- `backend/test/website-pages-visibility.spec.ts` — linked-but-ineligible and pending-processing readiness coverage.
- `frontend/src/pages/knowledge/KnowledgeBasePage.tsx` — direct assignment/source actions, website source filter, and save feedback.
- `frontend/src/pages/knowledge/BusinessDataVisibility.tsx` — separate linked/domain-matched reporting.
- `frontend/src/pages/knowledge/knowledge-bases.css` — responsive wrapping for the expanded detail actions.
- `frontend/src/services/api/knowledge.ts` — diagnostics response types.
- `frontend/src/tests/knowledge-base.test.tsx` — direct assistant-link flow coverage.
- `frontend/src/tests/knowledge-bases.test.tsx` — discoverability and website source filter coverage.
- `frontend/src/tests/business-data-visibility.test.tsx` — distinct link and domain eligibility display coverage.

## Tests

Deterministic tests were added or extended for active assistant enforcement, existing link display versus widget eligibility, processing-pending readiness, direct assignment navigation, website-source discovery, and explanatory UI output. Tests were not run, per the task instructions.

Existing service coverage also verifies organization-scoped source assignment, duplicate-safe relationship creation, unlinking, and effective retrieval from assigned bases. No database or runtime test was performed here.

## Manual verification

1. Open **Knowledge Base** and select **Manage assignments** on the intended active base.
2. In **Assistant connections**, choose the intended active assistant and select **Link assistant**. Confirm the success message and linked assistant row.
3. Open the website source in **Stored business data**. Verify it lists the linked assistant even if the assistant is not yet widget eligible.
4. Check the page status. `AI READY` requires current indexed chunks, READY source state, public-reference visibility and matching assistant domain eligibility.
5. If the source is linked but not domain matched, activate the assistant and ensure its website is active, verified, and matches the website source domain. Do not bypass those checks.
6. Keep the partial crawl warning visible for the 2 failed URLs. Freshness becomes available only after a complete successful crawl; no crawl was started by these code changes.
7. Use the existing Knowledge Base search preview with the selected assistant to confirm the expected indexed website excerpts are retrievable.

Runtime assignment, retrieval, and customer-widget behavior remain unverified until these manual steps and the added tests are run separately.
