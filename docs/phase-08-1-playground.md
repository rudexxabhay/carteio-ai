# Phase 08.1 Playground chat

## Scope

AI Training → Playground is an authenticated owner/admin test chat. It is not the production widget and does not write conversation analytics. It uses the existing Chatbot behavior fields, AssistantBusinessRule records, assistant-to-base/direct-source links, KnowledgeSource rows, and the existing retrieval service. Session context is held in process memory, keyed by organization, user, assistant, and client-generated session UUID; it expires after 30 minutes, retains at most six recent exchanges, and is reset by New Chat or an application restart.

The backend requires an ACTIVE assistant and searches only effective FAQ/Text sources with `PUBLIC_REFERENCE` visibility. Manager-only internal sources are not included. Search results and citations are derived from the published source generation. When search returns no evidence, the configured fallback is returned without asking the answer model to invent a response. Model output citations are checked against the returned reference set; invalid or missing citations fall back safely.

## Provider setup

An owner/admin selects exactly `groq` or `openai` and enters the model ID in Playground. The provider and model are stored on the existing Chatbot record. The provider key remains server-side:

- `GROQ_API_KEY` for Groq
- `OPENAI_API_KEY` for OpenAI

Set only the key for the selected provider in the private backend environment. The service uses fixed HTTPS API endpoints and makes no provider fallback. A missing provider, model, or key is reported as setup required. The query-understanding call and response call use the selected provider/model; query interpretation returns a bounded English retrieval query and language label, while the fixed search service—not the model—performs tenant-scoped retrieval. The model receives bounded excerpts, never source IDs as authority or database tools.

Provider model availability and account billing depend on the provider account. No key is required for existing FAQ/Text lexical indexing. No provider API is called until an owner/admin explicitly selects a provider/model and sends a Playground message.

## Migration

The additive migration `20261011190000_phase_08_1_playground_chat` adds nullable provider/model columns and a check limiting providers to Groq/OpenAI. NULL means no provider is configured; there is no implicit selection. Apply it only after checking the intended development database and reviewing the complete pending migration list. Prisma Client generation is needed after migration.

## Manual verification checklist

1. Configure exactly one provider key in the private backend environment, migrate the approved development database, generate Prisma Client, and start the app.
2. Select an ACTIVE assistant, choose a provider and account-enabled model, and save. Confirm no key appears in browser network responses or rendered UI.
3. Link a Knowledge Base containing both an `INTERNAL_RESTRICTED` and a `PUBLIC_REFERENCE` FAQ. Ask a question supported by each: only the public-reference item may be cited or returned.
4. Ask a supported question in English, Hindi, and Hinglish where the source text is English. Confirm the same approved provider handles interpretation and response, the reply preserves supported facts, and citations name actual returned sources.
5. Ask an unsupported question and confirm the configured fallback is returned with no source citation.
6. Continue with a follow-up question using “it”; confirm bounded prior turns help query interpretation. Choose New Chat and confirm the next question has no prior context.
7. Test an inactive assistant, a missing key, provider rate limit, timeout, and two workspaces/users. Confirm errors are actionable, contexts do not cross identities, and no assistant/tool side effects occur.

## Limits and Phase 09 handoff

The per-user and per-workspace rate counters and short conversation sessions are in-memory and therefore per backend process; deployments with multiple API replicas need a shared rate limiter and session store before relying on a global quota. The Playground is not streaming and has no stop-generation control. It is a narrow reusable service path, not the complete production conversation, persistence, analytics, moderation, widget-origin, or escalation system. Prompt instructions reduce risk but are not a formal guarantee; Phase 09 must retain deterministic authorization and add provider-specific adversarial evaluations.

The language detector/query interpreter and grounded response use the explicitly selected provider. They are not verified until real configured-provider tests are run. PostgreSQL lexical search alone remains non-semantic; query interpretation is the only cross-language query normalization in this Playground path.
