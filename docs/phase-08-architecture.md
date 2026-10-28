> **Product retirement notice (2026-10-11):** Public website knowledge ingestion has been removed from the active product. Website source creation, DNS challenge/verification, crawling, sync, scheduling, and browser rendering are disabled; legacy create/sync/verification routes return `410 WEBSITE_KNOWLEDGE_UNAVAILABLE`. Existing website sources, page records, migrations, and historical code are retained for compatibility and investigation, but are excluded from active Knowledge lists, processing, and assistant retrieval. Do not follow the historical activation instructions below. Current Knowledge supports manual FAQs, CSV/XLSX FAQ import, and manual text. Document ingestion is also unavailable.

# Phase 08 knowledge engine

## Implemented code paths

The existing `KnowledgeSource`, `KnowledgeBaseSource`, `AssistantKnowledgeBase`, and legacy `AssistantKnowledgeSource` remain the canonical records and access configuration. FAQ/text and verified website sources use the same PostgreSQL-backed `KnowledgeProcessingJob` queue and `KnowledgeChunk` index. The worker runs in the backend only when `KNOWLEDGE_WORKER_ENABLED=true`; migration deployment and Prisma Client generation are prerequisites.

FAQ and text are chunked and published into a new generation in a transaction. Website jobs verify the source is still verified, fetch bounded pages, extract text, chunk each page, write page provenance and chunks, then switch the source's active generation in one transaction. Search filters on organization, assistant-effective source IDs, active source version/generation, and READY status. Old chunks/pages are removed after publication. Search is lexical by default and returns excerpts/citations; it never generates answers.

The website crawler uses Node HTTP(S) directly, resolves DNS for every request, rejects mixed or non-public answers, pins the selected checked IP in the request lookup callback, disables inherited proxy behavior, retains TLS validation, manually handles redirects, and restricts the final host to the registered hostname. It enforces default page/depth/body/total/time/redirect limits, robots allow/disallow rules, sitemap limits, and same-host path scope. `parse5` parses server-returned HTML without executing scripts; extraction prefers main/article content and removes common navigation, consent and advertisement blocks.

Phase 08E adds automatic fallback when initial HTML contains insufficient non-navigation content. `IsolatedContainerRenderer` executes one fresh Chromium task in an inspected, network-disabled gVisor container, if explicitly enabled on a suitably isolated Linux worker. All allowed GET requests are brokered over stdio through the same pinned HTTP fetcher, robots/path policy and PostgreSQL host pacing. Browser requests never use direct Internet access. Actual visible DOM text and discovered links return to the same parse5/page/chunk/publication pipeline. Each page records `HTML` or `BROWSER_RENDERED`; jobs record extraction/indexing stages. Rendering is disabled by default and is not operationally verified. This repository has no installed Docker/runsc boundary or reviewed browser image. See [Phase 08E rendering](phase-08e-rendering.md) for deployment gates and limitations. Documents/OCR remain excluded.

DNS TXT ownership verification stores only a SHA-256 challenge digest, expires after 24 hours, binds to a workspace-owned source and consumes the challenge atomically. Multiple workspaces may verify the same domain only if its DNS owner publishes each workspace's independent proof; there is no global exclusive domain claim. HTTPS hosted-file verification is not implemented.

## Retrieval and providers

PostgreSQL lexical mode works without an AI key. It uses `simple` text search, phrase matching, title matching, tenant filters, and page citations. This is not semantic cross-language retrieval: Hindi or Romanized Hinglish may match exact shared terms but lexical token matching cannot promise translation equivalence.

Optional embedding writes are disabled unless explicitly configured. The only current embedding adapter is OpenAI `text-embedding-3-small` at 1536 dimensions; it is independent from Groq/OpenAI Phase 09 chat selection. Embedding failure does not block lexical publication. Do not configure the embedding key unless content transfer and possible billing are approved.

`KnowledgeProcessingService.resolvePublicVisitorSources` is a server-side policy hook, not an HTTP endpoint. It requires an active assistant bound to an active verified Website, an exact HTTPS origin match, assistant-effective sources, and `PUBLIC_REFERENCE` visibility. End-to-end public widget authentication/origin invocation is not implemented here. Manager search preview is authenticated OWNER/ADMIN-only and may show internal content.

## Current limits

- Sync policies are manual/daily/weekly. The backend worker polls due sources; no separate scheduler or distributed service is required. A PostgreSQL advisory lock serializes claims, caps active jobs globally, and allows at most one active job per organization. A `KnowledgeHostRateLimit` reservation table spaces requests to the same hostname across worker processes. Sync keeps a previous page unless its URL receives a confirmed 404/410; a partial crawl failure does not publish.
- Website sync details and history are persisted in `KnowledgeSyncRun`.
- Archive cancels queued work and immediately makes sources ineligible. Restore preserves visibility. Website restore deliberately clears verification and requires a new DNS proof and crawl.
- Permanent deletion is OWNER-only and physically deletes the source plus its linked base/assistant links, jobs, pages, and chunks through tenant-safe foreign keys; the audit event retains the impact summary. There are no external files to clean up because document ingestion is out of scope.
- Document upload and processing remain disabled. No PDF, DOCX, object-storage or OCR implementation is part of this phase.
- The Phase 08 migration chain now includes the additive `20261011170000_phase_08e_browser_extraction` migration after global crawl coordination. Current applied status has not been queried. No historical migration was modified in Phase 08E; apply only the migrations reported pending on the authorized development branch.

## Phase 09 contract

Call the retrieval service with server-derived organization, assistant, audience, and verified origin context. Do not accept these as authority from model output or an untrusted visitor. Treat every excerpt as untrusted reference data. Retrieval supplies source IDs, source versions, chunks and page URLs; answer generation, business scope and conversation state remain outside Phase 08.
