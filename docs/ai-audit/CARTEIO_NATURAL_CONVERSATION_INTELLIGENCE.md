# Carteio Natural Conversation Intelligence

## 1. Finding

The repeated response was not a replay of a previously stored assistant turn. Playground replay is scoped to a client turn ID. The source-confirmed weakness was routing: the semantic interpretation contract did not distinguish feedback about the assistant's conversational behavior from merchant questions. A message such as “Why do you keep repeating yourself?” could be labeled `OTHER` / `UNKNOWN`, then sent through knowledge retrieval. With no matching merchant evidence, the no-evidence prompt asked the model to explain that the requested business detail could not be confirmed, even though the latest turn was feedback about the conversation.

Standalone acknowledgements had a separate deterministic shortcut that returned fixed wording before the existing model-backed social response path. This made acknowledgements less contextual and prevented normal model variation.

## 2. Existing decision flow

Playground and trusted widget customer turns both enter `ConversationOrchestrator.executeSharedAI`. The shared path resolves a configured provider, loads bounded session turns, makes one interpretation call, validates the structured semantic result, applies server-side safety and capability decisions, and then either routes a safe conversational turn or runs authorized retrieval/tool selection. Knowledge evidence is revalidated before it is supplied to answer generation; factual answers pass existing grounding checks before persistence. Widget origin, session, and tenant authorization occur upstream and remain separate from this shared execution.

## 3. Changes made

- `multilingual-semantics.ts` accepts a new advisory semantic intent, `CONVERSATION_FEEDBACK`.
- The existing interpretation prompt asks the configured model to use that intent only when the main purpose is feedback about the assistant's conversational behavior. Complaints about a product, order, policy, or service remain business/support intents.
- `conversation-orchestrator.service.ts` routes a validated, single-intent feedback turn to the existing model response path with recent bounded turns. It does not retrieve merchant facts or expose tools for that turn. The response instructions address feedback directly, avoid repeating the prior answer, and prohibit business facts, claims of access, and actions.
- The normal deterministic acknowledgement shortcut was removed. Valid standalone acknowledgements now use the existing model-backed social path and bounded recent context. Exact deterministic acknowledgement remains only as a limited fallback when interpretation output is invalid; deterministic safe social fallbacks also remain for provider failure.
- A server-approved, confidently classified out-of-scope request now receives model-composed redirect wording under a no-answer/no-business-claims policy. The server scope decision remains authoritative; the model does not decide scope. The existing bounded deterministic redirect remains the fallback if generation fails or output is invalid.
- Added mocked-provider regression cases for feedback after a missing-evidence turn and for a contextual acknowledgment. They check routing, history in the provider context, and that retrieval is not called. A semantic contract case verifies feedback remains advisory and cannot add authorization.

No additional interpretation call or dependency was introduced. Ordinary feedback now uses the existing answer-generation call instead of making an unnecessary knowledge search. Valid acknowledgements and confirmed out-of-scope redirects also use configured response generation instead of normal fixed text, so those turns may add provider latency and usage/cost compared with the former shortcuts; no provider was called here and no price estimate is claimed. Business questions, Shopify permissions, source authorization, grounding, persistence, and provider routing remain on their existing paths.

## 4. Scope and memory

The assistant still uses the existing bounded conversation history. Feedback behavior uses the most recent selected turns, while the current user message remains the current turn. No persistent cross-session memory or customer profile was added. Session and tenant boundaries, including existing ticket-linked retention behavior, were not changed.

## 5. Remaining limitations

Feedback recognition depends on the configured model returning a valid semantic interpretation. Invalid or ambiguous interpretation does not authorize a conversational bypass; it follows existing fallback/business handling. The response remains model-generated and can still be awkward or repeat itself. Its no-business-facts instruction is a prompt control, not a semantic claim verifier. No runtime response quality or accuracy improvement is claimed.

## 6. Regression tests

Tests added or updated, but not executed:

- `backend/test/assistant.playground.spec.ts`
- `backend/test/multilingual-semantics.spec.ts`

No build, test, provider call, database operation, server, or worker was run.

## 7. Manual verification

After the compilation and test gates are approved, use one authorized Playground session:

1. Ask a business question whose evidence is deliberately absent and confirm the answer expresses uncertainty without inventing a fact.
2. Acknowledge that response, then send feedback that it is repeating itself. Confirm the response addresses the feedback, stays in the current language/script, and does not reissue the missing-fact explanation.
3. Send a standalone acknowledgment and confirm it is context-aware; then ask a clearly unrelated general question and confirm it is redirected without answering its external facts.
4. Ask a new business question and confirm normal authorized retrieval still occurs.
5. Repeat in a widget session only after normal origin and session authorization; verify the same shared orchestration while retaining independent widget security.

Inspect the correlated metadata-only request trace to confirm the selected route and retrieval outcome. Do not infer success from the response label alone.
