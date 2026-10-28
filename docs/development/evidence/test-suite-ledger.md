# Latest observed suite ledger

Latest actual assertion results, deduplicated across completed runs. This is not one green full-suite execution. Earlier failures, timeouts and partial reports remain in their individual artifacts. No live merchant database/provider verification was performed.

| File | Latest observed run(s) | Passed | Failed | Pending | Status |
|---|---|---:|---:|---:|---|
| `backend/src/config/shopify-scope-inventory.config.spec.ts` | B2 | 3 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/assistant-contact-evidence.spec.ts` | B2 | 3 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/assistant.controller.playground.spec.ts` | B2 | 3 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/connectors/commerce-read-contracts.service.spec.ts` | B2, H1 | 15 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/connectors/connector-credential-vault.spec.ts` | B2 | 2 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/connectors/connector-sync-debug.spec.ts` | B2 | 3 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/connectors/connector-sync-worker.service.spec.ts` | B2, H2 | 13 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/connectors/connector.registry.spec.ts` | B2 | 2 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/connectors/connector.service.spec.ts` | B2 | 14 | 5 | 0 | RUNTIME_FAIL |
| `backend/src/modules/workspaces/connectors/generic-rest-connector.adapter.spec.ts` | B2 | 1 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/connectors/platform-commerce.adapters.spec.ts` | B2 | 29 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/connectors/safe-outbound-http.service.spec.ts` | B2 | 12 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/connectors/shopify-granted-scope-discovery.service.spec.ts` | B2 | 7 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/connectors/shopify-oauth.service.spec.ts` | B2 | 4 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/conversation-diagnostics.spec.ts` | B2 | 15 | 4 | 0 | RUNTIME_FAIL |
| `backend/src/modules/workspaces/conversation-orchestrator.customer.spec.ts` | B2 | 4 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/flow.service.spec.ts` | B2 | 15 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/knowledge-context-builder.spec.ts` | B2 | 3 | 1 | 0 | RUNTIME_FAIL |
| `backend/src/modules/workspaces/knowledge-indexing.spec.ts` | B2 | 4 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/knowledge-processing.shopify-scopes.spec.ts` | B2 | 4 | 1 | 0 | RUNTIME_FAIL |
| `backend/src/modules/workspaces/knowledge-public-website.spec.ts` | B2 | 1 | 1 | 0 | RUNTIME_FAIL |
| `backend/src/modules/workspaces/platform-admin.spec.ts` | B2 | 2 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/playground-diagnostics.spec.ts` | B2, H1 | 19 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/saas.service.spec.ts` | B2 | 11 | 4 | 0 | RUNTIME_FAIL |
| `backend/src/modules/workspaces/shopify-website-discovery.service.spec.ts` | B2 | 1 | 2 | 0 | RUNTIME_FAIL |
| `backend/src/modules/workspaces/ticket-outbox-worker.service.spec.ts` | B2 | 1 | 2 | 0 | RUNTIME_FAIL |
| `backend/src/modules/workspaces/ticketing.service.spec.ts` | B2 | 13 | 1 | 0 | RUNTIME_FAIL |
| `backend/src/modules/workspaces/website-crawler.spec.ts` | B2 | 13 | 1 | 0 | RUNTIME_FAIL |
| `backend/src/modules/workspaces/website-sync.spec.ts` | B2 | 5 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/widget-retention-worker.service.spec.ts` | B2 | 3 | 1 | 0 | RUNTIME_FAIL |
| `backend/src/modules/workspaces/widget-source-indicator.spec.ts` | B2 | 5 | 0 | 0 | RUNTIME_PASS |
| `backend/src/modules/workspaces/widget.service.spec.ts` | B2 | 13 | 3 | 0 | RUNTIME_FAIL |
| `backend/test/all-exceptions.filter.spec.ts` | B2 | 5 | 1 | 0 | RUNTIME_FAIL |
| `backend/test/assistant.playground.spec.ts` | B2, H1, P1 | 76 | 54 | 0 | RUNTIME_FAIL |
| `backend/test/assistant.service.spec.ts` | B2, H1, H3 | 21 | 0 | 0 | RUNTIME_PASS |
| `backend/test/auth-cookie-options.spec.ts` | B2 | 1 | 0 | 0 | RUNTIME_PASS |
| `backend/test/auth.google-otp.spec.ts` | B2 | 21 | 0 | 0 | RUNTIME_PASS |
| `backend/test/auth.service.spec.ts` | B2 | 5 | 0 | 0 | RUNTIME_PASS |
| `backend/test/business-scope-guard.spec.ts` | B2 | 2 | 1 | 0 | RUNTIME_FAIL |
| `backend/test/business-source-router.spec.ts` | B2 | 8 | 0 | 0 | RUNTIME_PASS |
| `backend/test/clarification-guard.spec.ts` | B2 | 4 | 0 | 0 | RUNTIME_PASS |
| `backend/test/conversation-context.spec.ts` | B2 | 16 | 2 | 0 | RUNTIME_FAIL |
| `backend/test/conversation-intent.recovery.spec.ts` | B2 | 6 | 0 | 0 | RUNTIME_PASS |
| `backend/test/conversation-provider.spec.ts` | B2, H1 | 44 | 0 | 0 | RUNTIME_PASS |
| `backend/test/csrf-origin.middleware.spec.ts` | B2 | 2 | 0 | 0 | RUNTIME_PASS |
| `backend/test/database-foundation.spec.ts` | B2 | 6 | 0 | 0 | RUNTIME_PASS |
| `backend/test/email.service.spec.ts` | B2 | 4 | 0 | 0 | RUNTIME_PASS |
| `backend/test/env.validation.spec.ts` | B2 | 13 | 0 | 0 | RUNTIME_PASS |
| `backend/test/faq-import.spec.ts` | B2 | 8 | 0 | 0 | RUNTIME_PASS |
| `backend/test/gemini-model-diagnostic.spec.ts` | B2 | 5 | 0 | 0 | RUNTIME_PASS |
| `backend/test/google-token-verifier.spec.ts` | B2 | 3 | 0 | 0 | RUNTIME_PASS |
| `backend/test/grounded-answer-plan.spec.ts` | B2 | 3 | 2 | 0 | RUNTIME_FAIL |
| `backend/test/intelligence-evaluation.spec.ts` | B2 | 6 | 3 | 0 | RUNTIME_FAIL |
| `backend/test/intelligence-foundation.spec.ts` | B2 | 5 | 0 | 0 | RUNTIME_PASS |
| `backend/test/knowledge-base.faq-import.spec.ts` | B2, H2 | 2 | 0 | 0 | RUNTIME_PASS |
| `backend/test/knowledge-base.service.spec.ts` | B2 | 18 | 5 | 0 | RUNTIME_FAIL |
| `backend/test/knowledge-controller.routes.spec.ts` | B2, H1 | 3 | 0 | 0 | RUNTIME_PASS |
| `backend/test/knowledge-indexing.spec.ts` | B2 | 6 | 0 | 0 | RUNTIME_PASS |
| `backend/test/knowledge-processing.spec.ts` | B2 | 24 | 6 | 0 | RUNTIME_FAIL |
| `backend/test/knowledge-website-publication.spec.ts` | B2 | 0 | 6 | 0 | RUNTIME_FAIL |
| `backend/test/knowledge-worker.spec.ts` | B2 | 5 | 0 | 0 | RUNTIME_PASS |
| `backend/test/knowledge.service.spec.ts` | B2 | 22 | 3 | 0 | RUNTIME_FAIL |
| `backend/test/multilingual-semantics.spec.ts` | B2 | 22 | 2 | 0 | RUNTIME_FAIL |
| `backend/test/phase00-api-contracts.spec.ts` | N1, N2 | 20 | 1 | 0 | RUNTIME_FAIL |
| `backend/test/phase00-flow-storage.spec.ts` | N1, N2, H5 | 2 | 0 | 0 | RUNTIME_PASS |
| `backend/test/playground.dto.spec.ts` | B2 | 6 | 0 | 0 | RUNTIME_PASS |
| `backend/test/quality-benchmark-fixtures.spec.ts` | B2 | 6 | 0 | 0 | RUNTIME_PASS |
| `backend/test/request-id.middleware.spec.ts` | B2 | 1 | 0 | 0 | RUNTIME_PASS |
| `backend/test/response-safety.spec.ts` | B2 | 8 | 0 | 0 | RUNTIME_PASS |
| `backend/test/retrieval-query-plan.spec.ts` | B2 | 4 | 1 | 0 | RUNTIME_FAIL |
| `backend/test/scope-splitting.spec.ts` | B2 | 2 | 0 | 0 | RUNTIME_PASS |
| `backend/test/social-conversation.spec.ts` | B2 | 6 | 0 | 0 | RUNTIME_PASS |
| `backend/test/website-pages-visibility.spec.ts` | B2 | 3 | 3 | 0 | RUNTIME_FAIL |
| `backend/test/workspace-dashboard.spec.ts` | B2 | 2 | 0 | 0 | RUNTIME_PASS |
| `backend/test/workspace.module.spec.ts` | B2 | 1 | 0 | 0 | RUNTIME_PASS |
| `backend/test/workspace.service.spec.ts` | B2, H1 | 17 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/api-client.test.ts` | F3, F5 | 13 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/app.test.tsx` | F6 | 4 | 10 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/assistant-pages.test.tsx` | F6 | 3 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/auth-bootstrap.test.tsx` | F6 | 1 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/auth-redirect.test.ts` | F10 | 1 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/business-data-visibility.test.tsx` | F10 | 1 | 6 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/chatflow-builder.test.tsx` | F10 | 36 | 20 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/config.test.ts` | F10 | 2 | 1 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/connectors-page.test.tsx` | F10 | 1 | 3 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/conversations-inbox.test.tsx` | F10 | 1 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/dashboard-capabilities.test.ts` | F10 | 10 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/error-states.test.tsx` | F10 | 3 | 1 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/faq-import-dashboard.test.tsx` | F6 | 3 | 1 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/knowledge-access.test.ts` | F3 | 2 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/knowledge-api-routes.test.ts` | F3 | 2 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/knowledge-base.test.tsx` | F10 | 14 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/knowledge-bases.test.tsx` | F6 | 4 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/phase00-active-behavior.test.tsx` | F6, F9 | 2 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/phase00-workspace-isolation.test.tsx` | F8, F9 | 2 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/playground-chat.test.tsx` | F10 | 19 | 4 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/playground-copy.test.ts` | F10 | 3 | 1 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/playground-live-flow.test.tsx` | F10 | 4 | 2 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/playground-provenance.test.ts` | F10 | 3 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/shopify-dashboard-regression.test.tsx` | F10 | 12 | 21 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/shopify-permissions-panel.test.tsx` | F10 | 1 | 7 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/theme-switcher.test.tsx` | F10 | 4 | 0 | 0 | RUNTIME_PASS |
| `frontend/src/tests/tickets-page.test.tsx` | F10 | 0 | 1 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/training-center.test.tsx` | F6 | 1 | 1 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/widget-installation.test.tsx` | F6 | 0 | 2 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/widget-runtime.test.ts` | F6, F7 | 5 | 2 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/workspace-onboarding.test.tsx` | F10 | 1 | 1 | 0 | RUNTIME_FAIL |
| `frontend/src/tests/workspace-switching.test.tsx` | F6 | 0 | 1 | 0 | RUNTIME_FAIL |


## Continuation saved run snapshot

This snapshot predates source changes made 2026-10-26; no suite was run in that continuation. Backend full run: **813 pass, 0 fail, exit 0** across 76 suites. Frontend full run: **217 pass, 26 fail, exit 1** (243 assertions). Targeted frontend run: **97 pass, 3 fail, exit 1** (100 assertions, 16 suites). Local HTTP: 7/7 pass; offline guard: 3/3 pass. Per-assertion historical mapping and the 2 nonhistorical frontend failures are in [phase00-continuation-dispositions.json](phase00-continuation-dispositions.json).
