# Carteio AI Knowledge and Language Fix

## 1. Testing chat execution path

The assistant modal labeled **Testing** uses the existing Playground request path. `PlaygroundChat` calls `sendPlaygroundMessage()` in `frontend/src/services/api/assistants.ts`, which posts to `POST /workspaces/:slug/assistants/:assistantId/playground/chat`. `AssistantController.playgroundChat()` forwards the authenticated user, workspace slug, assistant ID, request ID, and cancellation signal through `AssistantService.playgroundChat()` to `ConversationOrchestrator.playgroundChat()`.

The Widget Installation test chat also calls `sendPlaygroundMessage()`. Neither UI has a separate provider-only answer route. The Playground orchestration authenticates the workspace and active assistant, resolves the session and bounded history, interprets the request, and for an accepted business question calls `KnowledgeProcessingService.searchPreview()`. It then selects bounded evidence, revalidates it, builds the provider context, generates the response, validates grounding, and persists the turn.

**Conclusion:** source inspection does not show a Testing-only RAG bypass. Normal business questions use the shared retrieval path. The path can return early for validated social/capability/refusal/clarification or scope decisions; those branches intentionally do not perform ordinary policy retrieval.

## 2. Retrieval finding and limits

`searchPreview()` resolves effective sources for the authenticated workspace and active assistant. Public retrieval then requires tenant ownership, public visibility, non-deleted state, `REGISTERED` and `READY` source state, a published active index generation, matching chunk source version/generation, and the existing connector/Shopify authorization checks. Generic public website retrieval does not require the website hostname to match the widget installation domain. The existing resolver provides the eligible source IDs; retrieval does not require a model-selected knowledge tool.

Semantic retrieval is optional. With `semanticIndexEnabled=false`, the existing path uses lexical retrieval and reports `lexical_only`; it does not fabricate embeddings. Before this change, lexical matching used only PostgreSQL's `simple` text-search configuration. The natural question “What is your shipping policy?” becomes an AND query that includes generic terms such as “what” and “is”; the `simple` configuration does not remove English stop words. A policy chunk can therefore be missed when it contains the meaningful terms but not those generic words.

The lexical query now evaluates both the existing `simple` configuration and PostgreSQL's `english` configuration. The English branch normalizes English stop words and word forms; the existing `simple` branch remains for unstemmed and multilingual text. Results still use the existing ranking, bounded candidate selection, source filters, active-generation checks, evidence limits, and response grounding. This is a code-confirmed retrieval recall weakness and a targeted correction. No database or index change is required.

No database query or runtime trace was run for the reported `carteio.in` chunks. Therefore the exact chunk text, whether it matched before or after this change, and the cause of that particular reply remain unverified. Runtime diagnostics (`conversation_retrieval_candidates`, `playground_retrieval_complete`, `playground_llm_context_assembled`, and `conversation_grounding_validation`) distinguish no eligible sources, no matching chunks, evidence omitted from context, and grounding fallback. They contain request correlation and safe counts/IDs, not message or evidence text. The retrieval/context events now also identify the entry point; context diagnostics include detected response language and script.

## 3. Response language and prompt priority

The answer prompt already carried the interpreted language and script, but it appended a conflicting directive: “Follow configured language, tone and response style.” If the assistant's configured default was Hindi or Hinglish, that instruction could override a customer's current English message. The prompt now states that current customer-language/script guidance and explicit session preference take priority; the assistant default is used only when the customer's language cannot be identified. The no-evidence generation path follows the same rule.

The interpretation prompt now clarifies that a clear general business-policy/process question is a complete static-information request. It should not request a product name unless authorized evidence establishes that the policy varies by product. Existing semantic language/script interpretation remains model-driven and distinguishes Latin-script Hindi/Hinglish from Devanagari Hindi. Explicit language requests and current bounded-session preferences remain supported.

The deterministic no-evidence fallback no longer asks a customer who already named a policy to identify “a particular product or policy.” It acknowledges that the requested detail could not be confirmed and asks a neutral clarification only where needed. This does not supply a merchant fact or change the grounded-answer requirement.

## 4. Provider and evidence construction

The configured provider/model route, including OpenRouter when configured, continues through the existing provider adapter and fallback policy. The prompt includes only the currently selected and revalidated authorized evidence, bounded by the existing evidence and provider context limits. Knowledge sources retain their `[S#]` references; structured catalog evidence retains `[C#]` references. Grounding validation remains the existing deterministic validator and is not represented as complete semantic entailment verification.

## 5. Security and compatibility

The change preserves authenticated Playground authorization, tenant-scoped source resolution, public visibility, source readiness, active index generation/source-version checks, source revalidation, widget session/origin controls, Shopify ownership checks, and private customer/order-data permission checks. It does not change the crawler, knowledge relationships, schema, embedding provider, provider routes, or stored conversation contract.

## 6. Files changed

- `backend/src/modules/workspaces/knowledge-processing.service.ts` — added English full-text lexical matching alongside the existing simple-language search.
- `backend/src/modules/workspaces/conversation-orchestrator.service.ts` — aligned answer and no-evidence language priority with the latest customer message; clarified policy-question interpretation; added entry-point/language metadata to existing safe diagnostics.
- `backend/src/modules/workspaces/business-source-router.ts` — made the deterministic no-evidence response avoid asking for a product/policy already named.
- `backend/test/knowledge-processing.spec.ts` — added a deterministic lexical-policy regression fixture and SQL-shape assertions.
- `backend/test/assistant.playground.spec.ts` — added an orchestration fixture for English policy retrieval with an English reply despite a Hindi assistant default; updated the no-evidence wording assertion.
- `docs/ai-audit/CARTEIO_AI_KNOWLEDGE_AND_LANGUAGE_FIX.md` — this report.

## 7. Tests added, not run

The new retrieval test uses a synthetic shipping-policy chunk and checks the English/simple lexical query branches without embeddings. The orchestration test uses deterministic provider/database mocks to check that the Playground searches through `searchPreview()`, includes authorized evidence in provider context, and asks for English when the latest request is English even if the assistant default is Hindi. The existing Playground tests already cover Hinglish evidence retrieval, contextual follow-up retrieval, empty retrieval, and grounding behavior.

Tests and builds were not executed. The mocked retrieval test does not execute PostgreSQL full-text search, so SQL behavior and actual `carteio.in` retrieval still require a controlled local runtime check.

## 8. Manual runtime verification

1. In the authenticated Playground for the Carteio assistant, send “What is your shipping policy?” and record the request ID.
2. Confirm `conversation_retrieval_candidates` shows an eligible source and candidate chunks. Confirm `playground_retrieval_complete` reports `lexical_only` when semantic retrieval is unavailable and has a nonzero result/evidence count.
3. Confirm `playground_llm_context_assembled` reports knowledge evidence and English/Latin response metadata; the provider request should contain the retrieved policy evidence and its `[S#]` reference.
4. Confirm the response cites the retrieved source and passes `conversation_grounding_validation`. Check that the persisted reply and source references agree.
5. Repeat with “Shipping policy batao” and a Devanagari Hindi question. Confirm Roman Hinglish and Devanagari response behavior respectively; explicitly request another language to verify the preference.
6. If retrieval returns zero results, use the same request ID and safe counts/source identifiers to determine whether eligibility, lexical matching, evidence selection, context assembly, or response verification was the earliest failing stage. Do not infer the actual chunk text from the source's indexed status alone.

## 9. Remaining limitations

- No runtime retrieval, provider call, test, or build was performed. No accuracy improvement is claimed.
- Actual indexed `carteio.in` page/chunk text was not read; the exact policy facts and current matching behavior remain to be confirmed in the authorized local preview.
- The English full-text branch adds a second text-search normalization path. A real PostgreSQL query should verify its plan and relevance on the merchant corpus.
- Semantic retrieval remains disabled when its existing embedding configuration/index is unavailable. This change does not enable it.
- Language/script detection and generated language adherence remain model-dependent, except for explicit prompt priority and deterministic fallback behavior.
- Existing deterministic grounding checks do not prove semantic support for every natural-language claim.
