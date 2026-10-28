# Carteio Model-Driven Conversation Review

## Findings

The ordinary business-answer path is already model-generated: `ConversationOrchestrator.playgroundChat()` interprets the request, searches authorized Knowledge and catalog sources, builds a bounded evidence context, then calls the selected provider and runs response validation. The authenticated Testing surfaces route through the same Playground path. This work did not replace that orchestration or add a response map.

The material fixed-response problem found on the business-knowledge path was `safeKnowledgeUnconfirmed()` in `business-source-router.ts`. When model uncertainty generation returned invalid output, the orchestrator returned canned English, Hindi, or Roman Hinglish wording. That fallback could repeat irrelevant product clarification. It has been removed. The no-evidence path now lets the configured model express uncertainty naturally using the current question, bounded recent turns, language/script guidance, and server-computed availability flags. It explicitly forbids outside business facts and asks clarification only when it could change the answer.

The provider-unavailable or invalid-generation case retains one minimal fact-free technical fallback: “I can’t confirm that right now.” It is used only when the no-evidence model response cannot safely be used. This avoids claiming unsupported merchant information when generation is unavailable.

## Customer-facing fixed-response inventory

| Purpose | Current source | Handling |
|---|---|---|
| Normal business conversation | `conversation-orchestrator.service.ts` grounded answer generation | Provider-generated from revalidated evidence; no static business answer map was found in this path. |
| Missing business evidence | Former `safeKnowledgeUnconfirmed()` in `business-source-router.ts` | Removed from the response path; model-generated uncertainty is used. |
| Clarification | `clarification-guard.ts` (`clarificationReply`) and orchestrator clarification branch | The orchestrator first asks the configured model to phrase a clarification. The fixed localized sentence remains a bounded fail-safe if model generation fails or is rejected. It is not used for a clear business policy question. |
| Out-of-scope / partial-scope | `business-scope-guard.ts` (`safeScopeRedirect`, `safePartialScopeHandoff`, `safePartialScopeNote`) | Deterministic scope boundary messages remain. The guard can stop unrelated requests or constrain a mixed request; it does not provide merchant facts. |
| Provider unavailable / invalid output | provider HTTP exceptions and `SAFE_GENERATION_FAILURE_REPLY` in `conversation-orchestrator.service.ts` | Provider errors remain structured technical errors on normal generation. The no-evidence response has the single fact-free fallback described above. |
| Authentication / privacy / action security | orchestrator policy branches, `safeBusinessLimitation()` in `business-source-router.ts`, `appendRequiredLiveLimitation()` | Deterministic guard messages remain so model wording cannot imply private-record access, authorization, or live action capability. |
| Simple social messages | `social-conversation.ts` (`generateSafeSocialReply`, response maps, configured greeting) | Existing deterministic social acknowledgments/greetings remain outside the business-evidence path. This change did not increase their templates or alter their behavior. |
| Assistant identity | `generateSafeAssistantIdentityReply()` in `social-conversation.ts` | Deterministic factual statement about the assistant’s non-human identity remains. Company-location questions continue through Knowledge retrieval. |
| Ticket workflow | ticket branch in `conversation-orchestrator.service.ts` | Model-generated dialogue uses server-owned workflow state; a minimal configured/technical fallback remains for empty generation. Ticket references are added from server results. |
| Capability response | capability branch in `conversation-orchestrator.service.ts` | Provider-generated from server-computed capability flags, with no factual policy claims. |

The remaining fixed messages are limited to social conveniences, authorization/privacy boundaries, scope handling, or failure handling. They are documented here rather than silently presented as dynamically generated. They remain potential follow-up scope if the product later chooses to route social and scope-redirection messages through the model; doing so changes provider usage and was not necessary to correct the observed cross-language retrieval failure.

## Language and evidence handling

The existing interpretation call now produces a concise semantic retrieval expression for a clear non-English or mixed-language business question. It uses authorized source-language hints when they identify the content language and defaults to English wording when hints are missing or unclear. The original question remains in the plan. The answer-generation instruction continues to follow an explicit customer language request first, then the latest meaningful message’s language and script, with bounded conversation context available for follow-ups.

No-evidence generation receives a server-computed “no verified matching evidence” signal and is instructed not to answer from outside knowledge. This is a prompt boundary, not complete semantic claim verification. Provider responses with no evidence are still subject to existing output safety checks; unsupported business claims remain a residual model risk.

## Files changed

- `backend/src/modules/workspaces/conversation-orchestrator.service.ts` — language-independent query-planning instructions in both interpretation/aspect prompts; safe retrieval metadata; model-generated uncertainty and minimal technical failure fallback.
- `backend/src/modules/workspaces/business-source-router.ts` — removed the language-specific `safeKnowledgeUnconfirmed()` reply builder.
- `backend/test/assistant.playground.spec.ts` — deterministic orchestration coverage for English, Roman Hinglish, Devanagari, model-generated no-evidence uncertainty, and unavailable-generation fallback.
- `docs/ai-audit/CARTEIO_CROSS_LANGUAGE_RETRIEVAL_FIX.md` — source-grounded retrieval path and verification report.
- `docs/ai-audit/CARTEIO_MODEL_DRIVEN_CONVERSATION_REFACTOR.md` — this inventory and behavior report.

## Verification state

Tests were added or adjusted but not executed. No build, server, worker, database query, crawl, or provider call was run. The source changes do not establish runtime accuracy. The next manual verification is the correlated Playground comparison described in `CARTEIO_CROSS_LANGUAGE_RETRIEVAL_FIX.md`, followed by widget verification after its independent origin and session checks.
