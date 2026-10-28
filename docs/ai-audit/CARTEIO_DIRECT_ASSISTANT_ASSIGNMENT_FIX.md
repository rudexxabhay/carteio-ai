# Carteio Direct Assistant Assignment Fix

## Summary

The Knowledge Base detail page exposed assistant assignment inside the Assistants tab. The Overview page's Connect assistants button only navigated to that tab, so assignment depended on the tab state and URL routing that had been unreliable. After a POST, the page displayed success before the refreshed GET confirmed the relationship. The frontend also typed the POST response as only `{ linked: boolean }`, although the server returns the assistant and Knowledge Base IDs as well.

The existing backend assignment API is present and organization scoped. No backend or database change was needed.

## New user path

Open a Knowledge Base and use the **Connected AI Assistants** panel directly in Overview. Search the active assistants returned for the current workspace, select one, and click **Connect**. The page sends the existing POST request, checks the returned IDs and `linked` flag, fetches the assistant list again, and reports success only if the chosen assistant is present in that server response. Disconnect follows the same confirmation and refreshed-list check.

The panel is also reused by the legacy Assistants tab; both surfaces use the same backend relationships. It does not crawl or reindex sources.

## Findings and security

- `GET /workspaces/:slug/knowledge-bases/:baseId/assistants` returns assistants linked to the base and active, same-organization assistants not already linked.
- `POST /workspaces/:slug/knowledge-bases/:baseId/assistants/:assistantId` validates manager access, active Knowledge Base status, and assistant ownership/status before writing the unique relationship in a transaction.
- `DELETE` validates the same workspace and assistant ownership before removing only the relationship.
- Requests use the existing API client, including same-origin session credentials. No browser-supplied organization ID or request body is used for assignment.
- The panel separately displays Knowledge Base connection state and website widget eligibility. Website eligibility uses the existing authorized website-page status response, including each page's readiness and domain-eligible assistants. It reports blocked or unknown conditions rather than treating a relationship as widget readiness.
- The linked `carteio.in` source is displayed from the existing Knowledge Base source response. Latest crawl failure counts remain visible as a partial-crawl warning.

## Files changed

- `frontend/src/pages/knowledge/KnowledgeBasePage.tsx` — Added the inline Overview panel, searchable assistant selection, server-confirmed connect/disconnect refresh, visible loading/empty/error states, and separate website/widget eligibility readout. Removed the header action that only navigated to the old tab.
- `frontend/src/services/api/knowledge-bases.ts` — Corrected the TypeScript response contracts for the existing link and unlink endpoints.
- `frontend/src/tests/knowledge-base.test.tsx` — Added component-level mocked API coverage for inline assignment, persistence readback, duplicate-submit prevention, permission error display, empty/error states, disconnect, source visibility, and retained partial-crawl warnings.

## Tests

Tests were added but not run, as requested. No builds or external services were run.

## Manual verification

1. Open the existing Carteio Knowledge Base and confirm the **Connected AI Assistants** panel appears in Overview without using a URL tab parameter.
2. Confirm `carteio.in` appears as an existing source and the latest run still shows its two failed pages.
3. Search for and select an existing active assistant; click **Connect** once.
4. Confirm success appears only after the linked assistant is shown in the refreshed list.
5. Refresh the page and confirm the assistant remains connected.
6. Confirm widget eligibility and any domain/source restrictions are shown separately from connection status.
7. Disconnect the assistant and confirm only the Knowledge Base relationship is removed.
8. Verify an empty assistant list and a permission/API failure display useful states.

Runtime success has not been verified.
