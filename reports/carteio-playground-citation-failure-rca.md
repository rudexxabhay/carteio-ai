# Carteio Playground citation failure — RCA

Date: 2026-10-27  
Status: **IMPLEMENTED — NOT RUNTIME VERIFIED**

## 1. Executive summary

The supplied request reached answer generation, but the deterministic grounding verifier found no recognized citation marker in the initial draft. The verifier correctly refused to publish an uncited merchant answer. One bounded citation-recovery provider call then returned an HTTP 200 response with a choice but no normalized text; the provider adapter correctly raised `PLAYGROUND_PROVIDER_EMPTY_RESPONSE`, so the request failed rather than publishing unverified content.

Source review found two actionable contract defects: citation instructions used `[S#]` / `[C#]` placeholders without spelling out that `#` must be replaced by the actual `reference` value; and recovery assembled an assistant draft followed by a system instruction, leaving the request ending in a system message. The prompt now states the exact marker mapping, and recovery now puts its system instruction before a bounded, explicitly untrusted user-data wrapper containing the draft. The adapter also logs safe response-shape metadata for empty completions.

The supplied logs do **not** contain the initial draft or the raw recovery response. Therefore they do not prove the model literally emitted `[S#]`, nor that the recovery message ordering caused the provider’s empty response. No provider, key, billing, model, or prompt-only compatibility defect is established. No model content is fabricated or silently accepted.

## 2. Supplied request timeline

Request ID `920ecdba-c111-4360-a64e-5e1c008307bd`; assistant `f3cbbb63-1277-449e-a350-37eb7aee0ac6`; customer message `Carteio kya h`; route `openrouter / google/gemini-2.5-flash-lite`.

| Order | Supplied evidence | Assessment |
|---|---|---|
| Interpretation | Completed | **CONFIRMED FROM PROVIDED LOG**; exact semantic JSON was not supplied. |
| Knowledge retrieval | Completed in about 9,175 ms; semantic retrieval skipped; three records selected | **CONFIRMED FROM PROVIDED LOG**. Record text/IDs were not supplied, so relevance cannot be assessed. |
| Evidence check | Revalidation completed | **CONFIRMED FROM PROVIDED LOG**. |
| Initial grounded answer | Provider call completed in 1,274 ms; verifier returned `citation_missing_reference` | **CONFIRMED FROM PROVIDED LOG**. This verifier result means it recognized zero exact citation tokens; the original draft is unavailable. |
| Citation recovery | One recovery attempt started; provider returned HTTP 200, choice present, no usable content, finish `stop`; adapter raised `PLAYGROUND_PROVIDER_EMPTY_RESPONSE` | **CONFIRMED FROM PROVIDED LOG**. Whether the raw response contained unsupported content that normalization discarded is unknown. |
| Final delivery | Request outcome failed; stream HTTP request returned 200 after about 34,752 ms | **CONFIRMED FROM PROVIDED LOG**. The stream status is expected after headers are flushed; the application outcome is still failure. |

The reported three provider attempts are consistent with interpretation, initial answer, and one recovery call. Per-call timestamps were not supplied, so the full 34.752 seconds cannot be apportioned further from this evidence.

## 3. Confirmed source defects and runtime limits

### A. Citation prompt contract ambiguity — source-confirmed; exact runtime causality unproven

`validateGroundedResponse` extracts only bracketed `S`/`C` numeric references and returns `missing_reference` when none are recognized ([`grounded-response-validation.ts:89–114`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/grounded-response-validation.ts:89)). The prompt asked for `[S#]` / `[C#]`, while evidence objects carry bare values such as `S1` and `C1` ([`knowledge-context-builder.ts:60–64`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/knowledge-context-builder.ts:60)). It did not explicitly say that `#` was placeholder notation or map an evidence field value `S1` to output token `[S1]`.

This is a real prompt/validator contract ambiguity. The unavailable initial draft prevents proving that it caused this specific rejection; the model may simply have omitted a citation.

### B. Recovery message ordering — source-confirmed assembly defect; causal link unproven

Previously, recovery appended the initial answer as an `assistant` message, then appended the repair instructions as a `system` message. Recovery now keeps the system repair instruction ahead of the draft and supplies the draft as bounded JSON user data marked untrusted ([`conversation-orchestrator.service.ts:1443–1451`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/conversation-orchestrator.service.ts:1443)). The original question, bounded history, authorized evidence, answer plan, language instruction, assistant behavior, and protected platform policy remain in the request context.

This corrects the message-role ordering and makes the draft’s trust boundary explicit. The raw recovery response is unavailable, so this cannot be claimed as the proven cause of the empty response.

### C. Empty recovery response — provider-versus-adapter cause unknown

The OpenAI-compatible normalizer accepts string content and text parts in content arrays, extracts tool calls, and classifies a stop-finished response with no text/tool call as empty ([`conversation-provider.service.ts:372–406`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/conversation-provider.service.ts:372)). The observed `PLAYGROUND_PROVIDER_EMPTY_RESPONSE` is consistent with that contract. HTTP 200 and a nonempty choices array alone do not mean content was generated.

The existing failure log reports only `choicesPresent`, `usableContentPresent`, and finish-reason category ([`conversation-provider.service.ts:326–350`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/conversation-provider.service.ts:326)). It did not show response content type/length, choice count, tool-call presence, normalization outcome, or usage. Those safe fields are now logged. The actual raw response was not provided; whether it was truly empty or used a response shape the adapter did not support remains **UNKNOWN**. No arbitrary retry was added.

## 4. Five whys

1. **Why did Playground fail?** Recovery threw a typed provider-empty error; the orchestrator propagated provider failures.
2. **Why was recovery attempted?** The grounded verifier rejected the first answer as `missing_reference`.
3. **Why was the first answer rejected?** The verifier recognized no `[S<number>]` or `[C<number>]` token. The raw draft is unavailable.
4. **Why was the recovery response unusable?** The supplied provider metadata reports no usable content and finish reason `stop`; source shows this is treated as empty. Raw provider content is unavailable.
5. **Why could the pipeline not recover?** The provider supplied no usable normalized text, and the old recovery prompt had weaker role ordering plus ambiguous citation placeholder syntax. The latter are source defects fixed here; their causal contribution to this exact response is unproven.

## 5. Provider response analysis

- The initial answer provider request completed in 1,274 ms per the supplied log. Its normalized text then failed citation validation; this is an application verification outcome, not a provider transport failure.
- Recovery returned HTTP 200 with choices present, no usable content, and finish category `stop`. The adapter distinguishes successful HTTP transport from a usable completion and raises `PLAYGROUND_PROVIDER_EMPTY_RESPONSE` when normalized text and tool calls are absent ([`conversation-provider.service.ts:300–328`, `372–406`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/conversation-provider.service.ts:300)).
- The supported OpenAI-compatible response shapes include string `message.content` and text parts in content arrays. Source does not prove whether this request contained null/empty content or an unsupported meaningful shape. Raw provider response data is unavailable, so adapter loss versus genuinely empty provider output is **UNKNOWN**.
- The recovery request used the same selected provider/model, existing bounded answer budget, conversation messages, evidence and answer plan. It did not add tools or unlimited retries. Source confirms an ordering improvement and explicit draft boundary; whether that would change the provider completion is **RUNTIME NOT VERIFIED**.

## 6. RAG and grounding analysis

- Required syntax is now explicit: evidence `reference: "S1"` must appear as `[S1]`; `reference: "C1"` as `[C1]`. Valid references are bound to the currently supplied evidence, not accepted merely because they match the syntax ([`grounded-response-validation.ts:108–123`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/grounded-response-validation.ts:108)).
- Knowledge references are assigned after evidence selection ([`knowledge-context-builder.ts:60–64`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/knowledge-context-builder.ts:60)). Revalidation preserves the evidence identity only when source/chunk/version/hash/content checks still match; recovery revalidates again before accepting its draft ([`conversation-orchestrator.service.ts:1400–1420`, `1453–1475`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/conversation-orchestrator.service.ts:1400)). No reference-ID mismatch is shown in the supplied evidence.
- The server plan maps answer aspects to candidate references but expressly does not prove entailment ([`grounded-answer-plan.ts:40–78`, `133–171`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/grounded-answer-plan.ts:40)). The deterministic validator enforces citation presence, reference authorization, and numeric/date/URL/contact/product checks; it does not prove arbitrary prose entailment. This was not weakened or changed.
- Three evidence records being selected does not establish they were relevant or supported the answer. Their excerpts were not supplied, so this remains **UNKNOWN**.
- Semantic retrieval being skipped is recorded runtime evidence, but no source shows it caused the citation rejection. It is **NOT RELATED** to the missing-reference result absent further evidence.
- “Carteio kya h” may be a business identity question, but the actual interpreted semantics, answer text, and selected excerpts were not provided. Whether it should have followed a non-factual identity path cannot be confirmed from this trace summary.

## 7. Latency

The measured retrieval, generation, and total durations above are supplied runtime evidence. Source confirms the initial response is followed by a bounded verification, and citation recovery makes one additional provider call only after rejection. Evidence is revalidated before final delivery and again after the recovery provider call to catch source/version/authorization changes. Those checks are sequentially necessary security boundaries; source evidence does not justify deleting them or adding authorization-sensitive caching.

No duplicate retrieval or repeated eligibility check was confirmed as responsible for this request. No latency change was made. The reported total includes time not fully itemized by supplied per-call timings; **its remaining breakdown is UNKNOWN**.

## 8. Fixes implemented

| File / function | Previous behavior | New behavior | Compatibility/security |
|---|---|---|---|
| [`conversation-orchestrator.service.ts`, grounded prompt and citation recovery](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/conversation-orchestrator.service.ts:1183) | Citation placeholders were not distinguished from literal output; repair system message followed an assistant draft. | Explicit actual-token mapping; repair instruction precedes a bounded untrusted draft payload. One existing recovery call remains, and verification still gates delivery. | Provider/model and `PROMPT_ONLY_COMPATIBILITY` are unchanged. No citation is attached by code. |
| [`conversation-provider.service.ts`, `responseShapeDiagnostic` / `logFailure`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/conversation-provider.service.ts:326) | Empty-response diagnostics could not distinguish null/empty content, unsupported shapes, zero text length, or tool-call presence. | Failure logs add choice count, content type/length, tool-call presence, normalization outcome, and available usage. No raw response content or credentials are logged. | Empty output remains a typed failure; no retries/fallbacks were added. |
| [`playground-diagnostics.ts`, `setCitationValidation`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/playground-diagnostics.ts:211) and orchestrator caller | Trace lacked explicit expected syntax, recognized marker count, supplied references, initial-draft nonempty flag, and recovery evidence-revalidation flag. | These bounded fields are added to the existing Playground trace. | Reference IDs only; no private excerpt or model/customer text is added. |

## 9. Preservation and stream behavior

Source-level review confirms no changes to provider routing/model, keys, fallback policy, Shopify eligibility, Knowledge selection, evidence revalidation, numeric/citation rejection, tenant scoping, saved Bot Behavior, graph execution, persistence, or widget flow. OpenRouter prompt-only compatibility logic remains at [`conversation-orchestrator.service.ts:535–550`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/conversation-orchestrator.service.ts:535).

The streaming controller sets status 200 and flushes SSE headers before orchestration; later failures are sent as a `failure` event followed by terminal `FAILED` ([`assistant.controller.ts:103–144`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/backend/src/modules/workspaces/assistant.controller.ts:103)). The frontend stream client turns a `failure` event into an `ApiError` and does not treat the HTTP status as a successful answer ([`client.ts:149–179`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/frontend/src/services/api/client.ts:149)). Playground stores a failed message with the same retry turn ID ([`pages.tsx:430–469`](/mnt/c/Users/Karan%20Singh%20Gaharwar/desktop/ai%20carteio/frontend/src/dashboard-source/pages.tsx:430)). HTTP 200 is expected after SSE headers are committed; the application failure is communicated separately. No HTTP-status or retry-contract change was needed.

## 10. Remaining limitations

The deterministic grounding validator does not establish semantic entailment for arbitrary prose. It still requires supplied authorized references and preserves strict numeric/date/URL/contact/product validation. This correction does not claim that it proves arbitrary claims, and it never auto-attaches references. The exact first draft, recovery payload, evidence excerpts and raw provider response were not supplied, so the exact runtime cause remains unresolved until the added diagnostics are observed.

## 11. Manual verification plan

After separately authorized test/runtime verification is available:

1. Ask “Carteio kya h” and confirm the trace shows provider/model, selected evidence references, initial draft nonempty/citation count, verification result, and response origin. A delivered business answer must have an actually supported `[S#]` citation.
2. Ask a shipping-policy question in English, then request it in simple Hindi/Hinglish. Confirm the cited source remains authorized and each factual answer passes verification.
3. Repeat the question and ask a short follow-up; confirm contextual retrieval and citation references point to current revalidated evidence.
4. Ask a product-plus-policy question; verify Knowledge and Shopify paths remain independently permission-gated and each claim cites its own supported evidence.
5. Mock OpenRouter HTTP 200 with empty `content`, string content, and supported text-part content. Empty must produce a failed trace with `PROVIDER_EMPTY_RESPONSE`; valid usable content must normalize; no unverified draft may be delivered.
6. Mock citation recovery deadline exhaustion and recovery with invalid references. Confirm no unsafe content is persisted and same-turn retry remains safe.

Acceptance: successful answers have authorized, verified citations; failed/empty generation remains a typed failure with safe diagnostics; no fake citations or altered provider route.

## 12. Execution disclosure and remaining verification

Regression coverage written (not run):

- `backend/test/assistant.playground.spec.ts`: a simple merchant introduction with a source-supported recovery; exact citation syntax and untrusted draft message ordering; empty recovery remains a typed provider failure.
- `backend/test/conversation-provider.spec.ts`: HTTP 200 with a stop-finished empty OpenRouter choice logs safe structural metadata and remains `PLAYGROUND_PROVIDER_EMPTY_RESPONSE`.
- `backend/src/modules/workspaces/playground-diagnostics.spec.ts`: citation trace exposes only bounded format/count/reference metadata and recovery evidence status.

Existing tests remain for valid citation repair, invalid citation rejection, evidence revocation, Hindi grounding, product/catalog routing, provider 429 handling, tenant/session isolation, and SSE failure events. No existing assertion was disabled or weakened.

- **TESTS NOT RUN**.
- **BUILDS NOT RUN. TYPECHECKS NOT RUN.**
- Servers were not started; migrations/deployments were not run.
- No live provider, Shopify, database, or external API call was made.
- The supplied runtime failure is not replayed. The fixes are **NOT RUNTIME VERIFIED**.
- Exact initial answer text, recovery response payload, raw evidence excerpts, and provider-side response metadata beyond the supplied safe fields remain unavailable. These prevent attributing the specific missing citation to literal placeholder output or proving why the provider returned no usable content.
