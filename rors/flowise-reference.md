# Flowise reference investigation

Date: 2026-10-18

## Scope and evidence

The correct public reference is [flowiseai.com](https://flowiseai.com). Public site text was inspected with the web reader and checked against Flowise's official documentation. A follow-up REA investigation successfully discovered the public homepage, captured its DOM/accessibility tree and screenshot, and completed a mobile-width scenario. Detailed Evidence IDs and limitations are recorded in [live-flowise-audit.md](live-flowise-audit.md). The hosted sign-in page was inaccessible to the web reader (502), so no account or private application access was attempted.

## Public landing page

The visible information architecture includes a top navigation (Features, Case Studies, Pricing, Community, Webinars, Docs, Get Started), a “Build AI Agents Visually” hero, customer logo strip, feature sections, case studies/testimonials, pricing, community/social material, webinar content, enterprise contact, and legal footer. The current page also displays a sunset announcement.

The sunset notice says feature development stopped July 29, 2026, the source repository would be archived August 10, 2026, and end of life was August 31, 2026. These dates precede this investigation date. The notice says the source remains available under Apache 2.0. This is relevant context for the reference, not a claim about Carteio's license or implementation.

## Official builder model

The official docs describe three builders:

- **Assistant:** beginner-oriented chat assistant configured with instructions, tools, and retrieval over uploaded knowledge.
- **Chatflow:** single-agent chatbot and simple LLM flows, including advanced retrieval patterns such as Graph RAG, reranking, and retrievers.
- **Agentflow:** a broader orchestration builder for assistants, single/multi-agent systems, and complex workflows.

The documentation describes graph sequencing and dependency execution; shared flow state; streaming; human checkpoints and approvals; tool, retriever, HTTP, condition, iteration, loop, direct reply, and subflow nodes; templates; API/SDK/CLI/embed; observability and evaluations; workspace/security features. These are documented capabilities, not runtime-confirmed observations of the unavailable hosted app.

## Official Agentflow V2 behavior details

The official [Agentflow V2 guide](https://docs.flowiseai.com/using-flowise/agentflowv2) describes nodes as standalone operations in an execution queue, with connections controlling path/order and previous-node outputs available to later nodes. It describes `$flow.state` as per-run state initialized by the Start node; keys must be declared there before other nodes update them. The documented node reference includes Start, LLM, Agent, Tool, Retriever, HTTP, Condition, Condition Agent, Iteration, Loop, Human Input, Direct Reply, and Custom Function. Conditions expose outcome-specific branches; loops have a maximum count; Human Input pauses at a checkpoint and resumes on a user-selected path. This is a documentation-based feature inventory, not an observation of the hosted builder's current rendering or defaults.

The [prediction API reference](https://docs.flowiseai.com/api-reference/prediction) documents request data for question/form input, streaming, configuration overrides, conversation history, file uploads, and human-input checkpoint resumption. The [streaming guide](https://docs.flowiseai.com/using-flowise/streaming) specifies data-only server-sent events with `start`, `token`, `error`, `end`, `metadata`, `sourceDocuments`, and `usedTools` events. The [embed guide](https://docs.flowiseai.com/using-flowise/embed) documents per-widget theme settings, custom CSS, custom welcome/error/disclaimer content, starter prompts, feedback, and CORS configuration.

## Rebuild implications grounded in the reference

The current Carteio builder's graph format stores only node IDs and two-ended connections. Its runner supports one linear input → template(s) → configured Carteio assistant → response path. It has no shared per-run state object, output bindings, branch ports, checkpoint/resume record, subflow/iteration executor, token event stream, or file-bearing prediction contract. Therefore it must not be described as Agentflow-equivalent. The next major architecture step, before adding additional node types, is an execution context with typed node outputs and per-run state plus a graph scheduler that understands output ports; human checkpoints then need durable, resumable state rather than holding an HTTP request open. Carteio's existing workspace authorization, assistant pipeline, knowledge retrieval policy, and connector permission contracts remain the integration boundaries.

## Unknowns and limits

The authenticated dashboard, builder DOM/CSS, exact current node catalog, drag behavior, runtime timing, API requests, and private integrations were not observable. The REA browser provider failure prevented those captures. No implementation details are inferred from screenshots or claimed as observed.

## REA environment recheck

On 2026-10-18, a corrected controlled-browser request passed action validation but the provider returned a non-retryable `execution_failure`; cleanup was reported incomplete with no resource identifiers. Per the provider's remediation, `rea doctor` was run. It confirms the Codex REA registration and installed skill version are aligned, while the audit-wide environment is unhealthy: no browser providers were listed, several unrelated native analysis engines are unconfigured, and the Claude Code registration has drift. The doctor output does not identify which condition caused the Playwright browser provider failure. No reinstall or setup command was run, and further captures are paused until provider health can be established.

## Public landing page structure

**Observed from the public page reader (text and link structure):** the live page presents the sections in this sequence: sunset announcement and navigation; split headline hero with Get Started and GitHub links; repeated customer logo strip; “Iterate, fast” introduction with install commands; six capability areas (Agentflow multi-agent, Chatflow assistants, human-in-the-loop, execution traces, API/SDK/embed, production scale); customer stories; Free/Starter/Pro pricing; community/social embeds; affiliate offer; webinars; enterprise contact; and legal/social footer. Current public page sections and contents were fetched at [flowiseai.com](https://flowiseai.com/).

The page reader does not provide rendered pixels or runtime interaction. Typography, exact spacing/colors, hover styles, mobile menu behavior, responsive breakpoints, animation timing, and below-fold screenshot comparisons remain unverified. The landing-page reconstruction should use original Carteio graphics and true Carteio information, so it intentionally avoids copied customer logos, fabricated testimonials, Flowise pricing, and webinar embeds.

## Official repository findings

**Source-inspected on GitHub:** the repository is read-only/archived as of Aug 13, 2026. The relevant application frontend lives under `packages/ui`; backend services and API contracts live under `packages/server`; reusable node implementations live under `packages/components`; the standalone Agentflow editor is in `packages/agentflow`.

- `packages/ui/src/layout/MainLayout/index.jsx` composes a fixed app bar, Header, collapsible Sidebar, announcement banner, and route `Outlet`. It persists banner dismissal in local storage, opens/closes the sidebar through Redux state, derives the default drawer state from the responsive breakpoint, and uses MUI transitions.
- UI routes cover agentflows, Agentflow V2, executions, canvas, chatbot, chatflows, credentials, datasets/document store, evaluations, marketplaces, schedule, settings, tools, variables, and vector stores. The shell therefore spans more than a single canvas/editor.
- The reusable `@flowiseai/agentflow` README describes a ReactFlow canvas with pan/zoom/minimap/fit controls, dynamic node editing, credentials, variables, field visibility rules, flow validation, themes, read-only embeds, keyboard save, and an imperative editor API. It lists Start, Agent, LLM, Condition, Condition Agent, Direct Reply, Custom Function, Tool, Retriever, Sticky Note, HTTP, Iteration, and Execute Flow nodes; its own README cautions that Loop and Human Input were not fully verified end-to-end.
- `packages/agentflow/src/core/types/node.ts` defines node editor inputs as typed metadata, including defaults, options, conditional visibility, variable acceptance, nested/array values, async option loaders, credential selectors, and code language/examples. This supports a schema-driven parameter editor rather than a bespoke fixed form for each node.
- `packages/server/src/Interface.ts` defines chatflow, multi-agent, assistant, and Agentflow types and execution lifecycle states, along with persistent flow, credentials, tools, variables, and execution records. The main Agentflow executor is `packages/server/src/utils/buildAgentflow.ts`.
- Agentflow V2 documentation describes dependency-ordered execution, per-run shared flow state, condition branches, loops/iterations, human approval/checkpoint resume, streaming, tool execution, and subflows. These are documentation/source findings, not runtime-confirmed behavior of the hosted app.
- Marketplace previews use ReactFlow in read-only mode and route copied templates to the appropriate canvas. The flow configuration UI exposes editable API overrides, variables, and per-node config overrides.

Sources: [Flowise UI MainLayout source](https://github.com/FlowiseAI/Flowise/blob/main/packages/ui/src/layout/MainLayout/index.jsx), [Agentflow package README](https://github.com/FlowiseAI/Flowise/blob/main/packages/agentflow/README.md), [node parameter schema](https://github.com/FlowiseAI/Flowise/blob/main/packages/agentflow/src/core/types/node.ts), [server interface](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/src/Interface.ts), [Agentflow executor](https://github.com/FlowiseAI/Flowise/blob/main/packages/server/src/utils/buildAgentflow.ts), and [Agentflow V2 guide](https://docs.flowiseai.com/using-flowise/agentflowv2).

The repository is an inspection reference only. No Flowise implementation source, restricted hosted assets, logos, customer marks, screenshots, or pricing copy was copied into Carteio.

## Landing page implementation note

The Carteio public page was rebuilt to a longer product-page structure with a hero, original workflow illustration, capability grid, flow sequence, build steps, use-case panels, supported provider/commerce overview, resources, signup CTA, and existing shared footer. Shared public navigation and footer links were aligned to the new anchors. Copy only names current Carteio capabilities; no customer stories, competitor prices, or unsupported Flowise-like features are claimed.

No local visual screenshot was captured. Pixel and responsive comparison needs a local frontend runtime, which was not started because the user explicitly prohibited starting servers/builds without approval.

## Sources

- [Official website](https://flowiseai.com/)
- [Sunset announcement](https://flowiseai.com/sunset)
- [Official docs introduction](https://docs.flowiseai.com/)
- [Agentflow V2 documentation](https://docs.flowiseai.com/using-flowise/agentflowv2)
- [Prediction API](https://docs.flowiseai.com/api-reference/prediction)
- [Streaming](https://docs.flowiseai.com/using-flowise/streaming)
- [Embed configuration](https://docs.flowiseai.com/using-flowise/embed)
