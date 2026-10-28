# Flow engine increment

## Scope

This increment is limited to `backend/src/modules/workspaces/flow.service.ts` and its direct unit spec. It retains the existing v1 graph format, route/API call signature, workspace manager authorization, and existing Assistant and Knowledge Processing service integrations. No schema, migration, frontend, dependency, or persistence changes were made.

## Changes

- Added a typed per-run context carrying the original input, current value, and per-node outputs.
- Kept current v1 execution semantics: transforms and assistants pass text forward; conditions record a routing decision and pass the tested text to the selected branch; knowledge lookup records retrieval results but does not alter downstream text; response nodes return the current text.
- Made the run ID available from the start of execution and added an additive `trace` response field containing request/run IDs, flow version, input size, and ordered node execution metadata.
- Enriched `steps` additively with execution index, input/output value types and safe sizes, while retaining existing fields and branch labels. Trace metadata contains no prompt, customer message, or generated content.
- Added direct unit coverage for the privacy-safe value-size helper.
- Corrected trace units so knowledge retrieval counts are reported as `outputItems`, never `outputChars`; text lengths remain character counts. Added a run-level spec covering selected-branch execution, skipped nodes, workspace manager authorization forwarding, ordered trace metadata, and absence of raw input text in the trace.

## Preserved behavior and security

- Flow v1 node/edge schema, existing topology validation, output fields, assistant turn IDs, source aggregation, knowledge previews, abort-signal forwarding to assistant execution, and manager-only run access are retained.
- Flow reads remain scoped to the authorized workspace organization. Assistant nodes continue to call the existing assistant service, and knowledge nodes continue to use the existing permission-checked preview service.
- This is synchronous request/response execution; the trace is returned to the caller and is not stored durably.

## Validation status

- Targeted command attempted: `node node_modules/jest/bin/jest.js src/modules/workspaces/flow.service.spec.ts --runInBand --verbose` from `backend/`. The process produced no output and exceeded 30 seconds; it was stopped by the timeout. `pnpm exec jest` could not start because pnpm attempted to create a temporary tool directory under `/home/rudexabhay/.local/share/pnpm/` and received `ENOENT`.
- `git diff --check` over the modified files passed. Builds, migrations, installs, and other validation commands were not run.

## Remaining engine gaps

- No durable run history, retries, resumable runs, cancellation checks between non-assistant nodes, streaming events, or persisted failure traces.
- Knowledge node results remain diagnostic outputs and are not inserted into subsequent assistant prompts. Doing that safely needs an explicit graph/data contract and source-grounding policy.
- No loops, joins, shared branching state, tool nodes, subflows, human checkpoints, or generalized node plugin catalog; current v1 validation intentionally rejects these topologies.
- Per-node trace timing is only returned after successful completion. Failures still propagate through the existing exception path and do not return a partial trace.

## Knowledge node to Assistant connection audit

### Verified behavior

- In `FlowService.run`, a Knowledge Search node calls `KnowledgeProcessingService.searchPreview(..., 'INTERNAL_MANAGER_PREVIEW')`. Its retrieved content is returned in the manager-only `knowledgeRuns` result.
- The run context records the retrieval node's type/count, then restores the prior text as the downstream value. A following Assistant receives only that text in `playgroundChat`; it does not receive the knowledge results.
- The assistant path already has its own retrieval, evidence selection, source revalidation, grounding, citation, and persistence pipeline in `ConversationOrchestrator.executeSharedAI`. That path is scoped to the assistant receiving the turn.
- The flow node may specify a different `assistantId` from the following Assistant node. Therefore manager-preview evidence can come from a scope different from the assistant that would generate the response.

### Why no direct injection was added

Passing `knowledgeRuns[].results[].content` through a prompt template or concatenating it to the message would bypass the assistant pipeline's source eligibility, revalidation, grounding/citation, and response persistence checks. It would also make manager-preview retrieval available to a downstream assistant, despite the public-playground retrieval path using a different audience boundary. This could cross both audience and assistant-source scopes. Running a second public retrieval in `FlowService` and concatenating it would still duplicate the existing retrieval and skip its normal source verification contract.

### Precise safe extension point

Add an internal, server-only evidence input to the conversation orchestration path, separate from `PlaygroundChatDto` and the public request body. The flow adapter should supply structured evidence identities from a public-audience retrieval (chunk/source IDs, source version, content hash, source metadata), bound by the existing evidence budget. The orchestrator should require that the evidence is authorized for the exact downstream assistant and organization, revalidate it with its existing evidence revalidation path, select it with `buildEvidenceContext`, and pass the validated set through the standard grounded-answer and citation verification stages. Prefer an orchestration option that replaces or merges with the normal retrieval stage to avoid duplicate retrieval. Until this contract exists, the Knowledge node is an inspectable manager preview and does not affect downstream generation.

No flow or orchestration code changed for this audit, so no additional test was added or run.
