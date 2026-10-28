# Flowise source audit

**Scope:** Public source and official documentation reviewed for the CARTEIO AI reconstruction. This is a source audit, not a runtime test of a local Flowise instance. Findings below are marked as source-verified where the cited official code or docs directly support them; deductions are labeled as inferences.

## Sources and licensing boundary

- The official repository describes the server, UI, and component packages as a workspace application. The server package depends on `flowise-ui` and `flowise-components`; its package metadata identifies the server as the `flowise` package. [Server package](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/package.json)
- **Verified:** The repository's server README identifies its source as Apache License 2.0. The enterprise subtree has a separate commercial license stating that it applies to software not distributed under Apache 2.0, requires a valid commercial subscription for production use, and prohibits unauthorized use of Enterprise and Cloud versions. [Server README](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/README.md), [enterprise license](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/src/enterprise/LICENSE.md)
- **Implementation boundary:** CARTEIO should independently implement product behavior and visual patterns. Do not copy Flowise source, logos, branded assets, or enterprise/cloud code. Common interaction concepts (node canvas, palette, configuration panel, streaming) can guide CARTEIO's own design and implementation. This audit does not provide legal advice.
- Current GitHub pages report the repository archived on Aug 13, 2026. This is a page observation and describes the repository status at audit time, not an assertion about the live service. [Repository package source page](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/package.json)

## Source-verified architecture

### Packages and editor

- **Verified:** The source is split into at least `packages/server`, `packages/ui`, `packages/components`, and `packages/agentflow`. Server metadata lists UI and components as workspace dependencies; `@flowiseai/agentflow` is a separate React package described as an embeddable editor. [Server package](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/package.json), [Agentflow package](https://github.com/FlowiseAI/Flowise/blob/main/packages/agentflow/package.json)
- **Verified:** The marketplace canvas is built with React Flow, React Router, Redux selection state, Material UI, and custom node/edge renderers; it loads serialized `flowData` into node and edge state. This directly verifies the marketplace preview canvas, not every editor surface. [MarketplaceCanvas.jsx](https://github.com/FlowiseAI/Flowise/blob/main/packages/ui/src/views/marketplaces/MarketplaceCanvas.jsx)
- **Verified:** The Agentflow package describes its canvas as ReactFlow-based and documents zoom/pan/minimap/fit-view controls, 13 built-in node types, connection/flow validation, async option loading, credential editing, a variable picker, conditional fields, light/dark themes, read-only mode, an imperative API, and request interception. The README cautions that the package API is still dev/unstable and Loop and Human Input are not fully end-to-end verified. [Agentflow README](https://github.com/FlowiseAI/Flowise/blob/main/packages/agentflow/README.md)
- **Verified:** Agentflow's `useAgentflow` exposes serializable flow retrieval, JSON export, validation, fit view, ReactFlow instance access, programmatic add/clear, and execution status controls. [useAgentflow.ts](https://github.com/FlowiseAI/Flowise/blob/main/packages/agentflow/src/useAgentflow.ts)
- **Verified:** The Agentflow node type source says these definitions feed `GET /api/v1/nodes`, the palette, drag payloads, and node initialization. [Agentflow node types](https://github.com/FlowiseAI/Flowise/blob/main/packages/agentflow/src/core/types/node.ts)

### Data model, routing, execution

- **Verified:** Server interfaces model chatflow kinds `CHATFLOW`, `MULTIAGENT`, `ASSISTANT`, and `AGENTFLOW`; a flow record includes name, serialized `flowData`, publish/deploy and chatbot configuration fields, and workspace association. Execution params carry the flow, incoming input, workspace/org context, cache, telemetry, streaming interface, files, cancellation signal, and recursive/tool/iteration context. [Server Interface.ts](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/src/Interface.ts)
- **Verified:** The prediction API is documented as `POST /api/v1/prediction/:id`. It supports chat interaction, streaming, memory/session context, file input, and runtime configuration overrides. [Prediction docs](https://docs.flowiseai.com/using-flowise/prediction)
- **Verified:** The documented stream event vocabulary includes `start`, `token`, `error`, `end`, `metadata`, `sourceDocuments`, and `usedTools`. [Streaming docs](https://docs.flowiseai.com/using-flowise/streaming)
- **Verified:** The server has separate internal-prediction and public-prediction routes; the public prediction endpoint is in the server whitelist. The repository advisory describes public access as gated by API key or chatbot publish/whitelist state and says both paths reach flow construction. [Server constants](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/src/utils/constants.ts), [prediction security advisory](https://github.com/FlowiseAI/Flowise/security/advisories/GHSA-hx55-h48h-7rw9)
- **Verified:** Chatflow save routes include create/update permission checks for chatflows and agentflows. The advisory describes the flow JSON as stored verbatim. [Chatflow route reference in advisory](https://github.com/FlowiseAI/Flowise/security/advisories/GHSA-hx55-h48h-7rw9)
- **Verified:** The source has a dedicated `buildAgentflow.ts`, and server interface execution parameters include recursive execution, tool context, and iteration context. Together these establish agentflow-specific execution and support for nested/tool/iteration context. They do not by themselves specify every runtime scheduling rule. [buildAgentflow.ts](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/src/utils/buildAgentflow.ts), [Server Interface.ts](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/src/Interface.ts)

### Nodes, integrations, and knowledge data

- **Verified:** `packages/components` is a distinct package for Flowise components, with exported package entry points for package and nodes. This is the source-level home of the extensible node catalog. [Components package](https://github.com/FlowiseAI/Flowise/blob/main/packages/components/package.json)
- **Verified:** Agentflow node types include Start, Agent, LLM, Condition, Condition Agent, Direct Reply, Custom Function, Tool, Retriever, Sticky Note, HTTP, Iteration, and Execute Flow; the README describes typed editor inputs such as text, number, boolean, dropdown, arrays, JSON/code, async options, and specialized condition/message/schema editors. [Agentflow README](https://github.com/FlowiseAI/Flowise/blob/main/packages/agentflow/README.md)
- **Verified:** The server exposes document-store controller code; the product docs position document stores as a knowledge-ingestion/configuration feature. [Document store controller](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/src/controllers/documentstore/index.ts), [official docs index](https://docs.flowiseai.com/)
- **Inference:** For CARTEIO, existing provider, crawler, Shopify, and RAG systems should be wrapped behind explicit node capability contracts and reused by execution services. Flowise's package split suggests keeping node metadata/editor schemas separate from execution adapters, but the specific CARTEIO boundary is an architectural recommendation, not a Flowise fact.

## API surface indicated by public source/docs

The source constants and official docs establish these as relevant API families (this is a representative list, not a complete generated API inventory):

| Area | Evidence / behavior |
|---|---|
| Predictions | `POST /api/v1/prediction/:id`; supports streaming, file input, runtime overrides, conversation context. [Docs](https://docs.flowiseai.com/using-flowise/prediction) |
| Streamed predictions | SSE/event stream with token, metadata, source document, tool, and lifecycle events. [Docs](https://docs.flowiseai.com/using-flowise/streaming) |
| Chatflow configuration | Create/update routes with create/update permissions; serialized flow definition is persisted. [Route reference](https://github.com/FlowiseAI/Flowise/security/advisories/GHSA-hx55-h48h-7rw9) |
| Node metadata | `GET /api/v1/nodes` feeds Agentflow palette and initialization metadata. [Node types source](https://github.com/FlowiseAI/Flowise/blob/main/packages/agentflow/src/core/types/node.ts) |
| Chatflow lookup and publish | Constants whitelist includes API-key lookup, public chatflow/config, prediction, webhook, streaming, upload, feedback, and related routes. [Constants](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/src/utils/constants.ts) |
| Document stores | Dedicated server controller/service area exists. [Controller](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/src/controllers/documentstore/index.ts) |

## Implications for reconstruction

1. Persist the graph as a versioned structured document containing nodes, edges, positions, and node configuration; retain a durable flow identity plus workspace/owner scope. Flowise's source model stores `flowData` as serialized data, but CARTEIO should add its own schema/version migration discipline.
2. Keep node catalog metadata and execution adapters linked by stable node type IDs. Generate palette entries and configuration controls from schemas; validate at edit/save/run boundaries.
3. Treat interactive editing and runtime execution as separate systems connected by a well-defined flow document and run request. Track run events and node statuses so streaming and debugging reflect actual execution.
4. Implement runtime overrides, session memory, uploaded files, source-document outputs, tool-use events, and abort/cancellation as explicit capabilities; do not render features as active until a backend path exists.
5. Apply strict permission and workspace scoping to every flow read, edit, prediction, and integration call. Public/published chat access should use a constrained public capability, not internal credentials.
6. Audit untrusted URLs, custom code, uploads, and outbound calls before enabling integrations. Flowise's own security advisories document SSRF and upload risks in affected versions; treat these as design hazards to guard against, not behavior to reproduce. [SSRF advisory](https://github.com/FlowiseAI/Flowise/security/advisories/GHSA-hx55-h48h-7rw9), [upload advisory](https://github.com/FlowiseAI/Flowise/security/advisories/GHSA-j8g8-j7fc-43v6)

## Evidence limitations

- This audit is based on public GitHub source pages and official documentation. It did not clone/build/run Flowise, inspect private enterprise implementation, exhaust every route, enumerate every component schema, or conduct a runtime browser walkthrough.
- Where repository code was blocked or not directly surfaced by the browsing tool, findings are limited to pages available through official source pages, official docs, and official GitHub advisories. Detailed workflow scheduling, every legacy Chatflow node's schema, and full UI route inventory remain to be audited from accessible source in a later pass.
- The GitHub archive banner and repository version metadata are time-sensitive. Recheck against the target commit before using this as a compatibility baseline.
