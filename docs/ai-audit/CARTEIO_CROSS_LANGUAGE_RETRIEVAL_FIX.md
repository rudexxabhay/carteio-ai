# Carteio Cross-Language Retrieval Correction

## Summary

The authenticated “Testing” chat is the same Playground execution path used by `AssistantService.playgroundChat()` and `ConversationOrchestrator.playgroundChat()`. It already performs authorized knowledge retrieval before answer generation. The source shows no Testing-specific RAG bypass.

The confirmed code weakness was in query interpretation: two prompt instructions asked for an English equivalent only when authorized source-language hints identified English. Those hints are derived solely from explicit `KnowledgeSource.languageHint` metadata and may be empty or uninformative. In that case a Roman Hindi or Devanagari query could remain the lexical query against English-only content. PostgreSQL lexical search uses English and `simple` dictionaries, but those dictionaries do not translate Hindi wording into English terms. The reported Hinglish turn has no request-correlated retrieval event/query-plan evidence, so this is a confirmed design gap and the leading explanation for that runtime miss, not proof of that exact request’s candidate count.

## Execution path reviewed

1. `WidgetInstallationPage.tsx` labels the test surface and states that it uses the authenticated Playground API. The assistant Testing modal also calls the same Playground endpoint.
2. `AssistantController.playgroundChat()` validates the authenticated request and delegates to `AssistantService.playgroundChat()`.
3. `AssistantService.playgroundChat()` delegates to `ConversationOrchestrator.playgroundChat()`.
4. The orchestrator authorizes the workspace and assistant, loads bounded session history, selects the provider route, and calls the configured provider once for query interpretation.
5. `KnowledgeProcessingService.publicSourceLanguageHints()` returns only language hints from currently eligible public sources. The interpreter now uses these hints when they identify the content language, and otherwise creates a concise English semantic search representation for clear non-English business questions.
6. `buildRetrievalQueryPlan()` preserves the original query and bounded contextual/aspect queries, deduplicating and validating any identifier-shaped expansions.
7. `KnowledgeProcessingService.searchPreview()` applies the effective Knowledge Base resolver, tenant/source authorization, visibility, ready-state, active-generation, and Shopify connector checks. It runs existing lexical retrieval and optional semantic retrieval; it does not enable vector search when embeddings are unavailable.
8. The orchestrator selects and revalidates evidence before building the model context and running existing grounding validation.

`PUBLIC_VISITOR` retrieval in the authenticated Playground is an existing public-safe knowledge audience. Widget requests still pass their own origin, session, and assistant authorization before reaching this pipeline.

## Changes made

- `conversation-orchestrator.service.ts`: the existing interpretation call now requests a concise semantic search representation for every clear non-English or mixed-language business question. Source language hints guide the search language; missing or unrecognized hints fall back to English wording. The original customer wording remains first and is retained in the query plan. The answer-aspect instruction uses the same rule. No additional provider call was added.
- `conversation-orchestrator.service.ts`: `playground_retrieval_complete` now records metadata-only `queryPlanningMode`, bounded language/script classes, mixed-language status, lexical variant count, retrieval mode, result/evidence counts, and existing outcome data. It does not log customer text or generated search queries.
- `business-source-router.ts` and `conversation-orchestrator.service.ts`: removed the language-specific `safeKnowledgeUnconfirmed()` canned business response. When there is no matching evidence, the existing model is asked to express uncertainty naturally in the customer’s language and may ask a useful clarification only when needed. If that generation fails or returns an invalid response, the only new fixed wording is the minimal technical fallback “I can’t confirm that right now.” It asserts no merchant fact.
- `assistant.playground.spec.ts`: added mocked orchestration cases for English, Roman Hinglish, and Devanagari questions. They assert that the original question and semantic search expression reach the existing authorized retrieval adapter, evidence enters the answer context, and the requested language/script instruction reaches generation. Updated the no-evidence case to verify use of model-generated uncertainty rather than one exact canned sentence; added a provider-unavailable technical fallback case.

## Root-cause assessment

The English question can match English policy text directly. A Hinglish question can also work when the interpretation model supplies an English query or when the indexed text happens to share searchable terms. Before this change, the prompt made that semantic representation conditional on source hints. Since hints are optional metadata, equivalent questions did not have a consistent retrieval representation. This explains how the same source could be found for English and missed for Hinglish without a separate RAG route.

The exact failed runtime request cannot be attributed more narrowly from the available evidence. Existing logs avoid raw query text, correctly, and the supplied observation did not include its request ID plus `playground_retrieval_complete`, `conversation_retrieval_candidates`, and `playground_llm_context_assembled` records. The new event distinguishes model interpretation from original-query fallback and reports safe counts, but never logs rewritten query text.

## Security and behavior preserved

- Rewritten queries are advisory search expressions only; they do not change workspace, assistant, source, or tenant authorization.
- Original customer wording, negation, exact identifiers, and bounded conversation references remain in the plan.
- Restricted, deleted, processing, stale-generation, and unauthorized connector sources remain filtered by existing server-side rules.
- The widget’s origin/session checks, Shopify permissions, evidence revalidation, citation checks, and grounding validation are unchanged.
- Lexical search remains available when semantic indexing is disabled. No vector capability is claimed or enabled by this change.
- No crawler, index, database, schema, provider configuration, or retrieval algorithm was changed.

## Tests and verification

Regression tests were written but not run. No build, test, server, worker, database, crawl, or provider request was executed.

Manual verification should use one authorized Playground session with an English shipping-policy source and compare:

1. `What is Carteio’s shipping policy?`
2. `carteio ki shipping policy kya h`
3. `कार्टेयो की शिपिंग पॉलिसी क्या है?`

For each request, correlate the request ID across interpretation/retrieval/context/answer events. Confirm `queryPlanningMode` is `MODEL_INTERPRETED`, the lexical variant count includes the semantic representation, the same authorized source/chunk is selected and included in model context, and the response follows the current message’s language/script with the source citation. Also verify a genuinely missing policy still produces uncertainty without unsupported merchant claims. This manual runtime comparison is still required; this report does not claim cross-language retrieval accuracy has been established.

## Remaining limits

- The model’s semantic query rewrite may still be imperfect; lexical retrieval quality depends on indexed text and query terms.
- With no semantic index, unrelated wording still requires the interpreter to produce a useful lexical query.
- Existing deterministic checks do not prove full natural-language entailment.
- If query interpretation itself fails, the system uses the bounded original query; this can still miss cross-language evidence. The added diagnostic marks that fallback without exposing the query.
