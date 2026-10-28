# Carteio P2028 Crawl Persistence Fix

## Summary

A controlled crawl of `carteio.in` discovered 9 URLs, extracted 7 pages, reported 2 failed pages, prepared 8 chunks, and ended with `complete: false`. Persistence failed with Prisma `P2028` while the active operation label was `crawl.page_persistence`; the public error was `DATABASE_ERROR`.

The exact P2028 subtype is not established by the supplied runtime evidence. It did not include Prisma transaction `meta.error`, `meta.timeout`, or `meta.timeTaken`. Source inspection identifies interactive-transaction expiration as the leading explanation, but not as a proven cause.

## Transaction and operation trace

The failing path is `KnowledgeProcessingService.processWebsite()` in `backend/src/modules/workspaces/knowledge-processing.service.ts`.

Website fetching, extraction, chunk preparation, and optional embedding generation happen before the publication transaction. There are no website or provider network calls inside the transaction. The publication transaction then:

1. Revalidates the worker lease and website authorization.
2. For each indexed page, writes the page and sequentially inserts that page’s chunks.
3. Marks removed pages where applicable.
4. Switches `KnowledgeSource.activeIndexGeneration` and updates source status.
5. Updates the `KnowledgeSyncRun`, completes the leased job, and deletes old chunks.

The transaction is interactive (`$transaction(async tx => ...)`). Page and chunk writes are awaited sequentially. The old page path did a `findFirst` followed by `create` or `update` for every page, in addition to one raw insert per chunk. The transaction client is only used inside the callback; there are no nested transactions or concurrent promises in this block.

The installed Prisma client defaults interactive transactions to a 5,000 ms timeout and 2,000 ms max wait. The observed 7-page/8-chunk crawl therefore ran a multi-round-trip Neon-backed transaction under a short default lifetime. Network latency is a plausible contributor, but was not measured. There is no evidence of a closed transaction being reused after its callback.

## Changes implemented

The page persistence path now uses one Prisma `upsert` per page, keyed by the existing unique `(sourceId, canonicalUrl, sourceVersion)` constraint. It removes the extra per-page lookup while retaining the owning source’s organization ID on create. Chunk writes remain sequential and use the same tenant, source, generation, page, and deterministic sequence values.

The active-generation publication remains in the same transaction as page and chunk persistence. The transaction now has an explicit 30-second timeout and 5-second max wait. This is a bounded allowance for the existing sequential writes and remote database round trips; it is not evidence that Neon caused the failure and is not an unbounded timeout.

For future diagnosis, sanitized P2028 logging now includes a classified subtype (`TRANSACTION_TIMEOUT`, `TRANSACTION_CLOSED`, or `TRANSACTION_API_ERROR`) and safe integer `timeout`/`timeTaken` values when Prisma supplies them. Raw exception text, SQL, parameters, and connection details are never emitted.

## Consistency, retry, and partial crawl behavior

Page upserts, chunk inserts, source generation switch, sync-run update, job completion, and old-generation cleanup remain atomic. If any operation fails, PostgreSQL rolls the transaction back, so retrieval cannot observe a partially published generation. The existing deterministic chunk IDs and generation calculation remain unchanged, preserving retry idempotency after rollback.

Partial extraction is still represented as partial: the supplied crawl had 2 failed pages and `complete: false`. Publication records warning status and the crawl error; it does not mark that crawl as a fully successful snapshot or advance `lastSuccessfulSyncAt`.

Tenant ownership remains tied to the source resolved for the job, the `organizationId` written for created pages/chunks, and organization-scoped source publication and job/run updates. No schema, crawler, URL safety, TLS, renderer, retrieval, or queue behavior changed.

## Regression tests created

- `backend/test/knowledge-website-publication.spec.ts`: multiple pages/chunks, large page content, transaction bounds, no generation publication after persistence failure, partial crawl warnings, and deterministic retry chunk identity.
- `backend/test/knowledge-processing.spec.ts`: P2028 subtype/timing metadata is logged as safe categories/numbers without raw error text.

Tests were not executed, as requested. No builds, database operations, migrations, crawls, provider calls, or worker startup were performed.

## Remaining uncertainty and next verification

The exact P2028 subtype remains unconfirmed until a controlled retry produces sanitized transaction metadata. On a separately approved crawl, check whether the failure log includes `transactionMessageClass: TRANSACTION_TIMEOUT` and whether `transactionTimeTakenMs` is near `transactionTimeoutMs`. If it instead reports `TRANSACTION_CLOSED` or the bounded transaction still fails, retain the operation label and inspect that specific transaction boundary; do not infer a timeout.

For the next controlled crawl, require the operator to approve one retry after confirming there is no competing worker or duplicate active job. Verify the worker claims one job, records page/chunk publication, and only then emits completion. Confirm `activeIndexGeneration` changes and source status becomes `READY` (or the expected warning state for partial extraction), and verify a retrieval preview can see the published generation. Do not call the crawl fixed until that runtime verification succeeds.
