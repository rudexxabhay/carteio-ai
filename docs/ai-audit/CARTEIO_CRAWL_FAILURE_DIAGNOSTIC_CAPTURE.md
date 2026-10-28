# Carteio AI — Website Crawl Failure Diagnostic Capture

**Scope:** read-only local inspection on 18 October 2026. No job was retried, no crawl was triggered, and no database record, source file, configuration value, credential, or runtime was changed.

## Result

The original structured `knowledge_processing_job_failed` event is **not recoverable from the available local workspace**.

- No retained `.log`/runtime-output file outside dependencies and build output contains the event.
- A complete text search of accessible source, documentation, and local non-build artifacts found only the logger implementation and references—not a historical event.
- The current Codex thread has no attached terminal session, so it has no terminal buffer to inspect.
- The database retains `DATABASE_ERROR`, job stage, status, and source/sync state, but not the event's diagnostic fields.
- No connection to an external deployment log sink was supplied or accessed.

Therefore the exact original failing Prisma operation, Prisma code, SQLSTATE, and sanitized database message remain **unknown**.

## Correlation available without sensitive values

The read-only database evidence identifies three failed CRAWL jobs by irreversible short fingerprints only:

- `310e9aee9a3f`
- `0b0ea6a10345`
- `b67493cdb32b`

Each has the same persisted outcome: `status=FAILED`, `stage=BROWSER_RENDERING`, `attempts=1`, `errorCode=DATABASE_ERROR`; its paired sync run is `FAILED/DATABASE_ERROR`; its source has no active index generation; and it has zero related `KnowledgePage` and `KnowledgeChunk` rows. No source URL, source content, raw UUID, tenant identifier, or customer data is included here.

## What the existing worker would log on one authorized manual website refresh

The failure handler always emits one JSON warning at:

`backend/src/modules/workspaces/knowledge-processing.service.ts`, lines 862–881.

The event shape is:

```json
{
  "event": "knowledge_processing_job_failed",
  "stage": "index_processing",
  "operation": "<failureOperation>",
  "code": "<safe processing code>",
  "retryable": false,
  "errorType": "<safe error class, when recognizable>",
  "prismaCode": "Pxxxx (only when present)",
  "databaseCode": "SQLSTATE (only when present and valid)",
  "databaseCategory": "<safe category, only when derivable>",
  "databaseMessage": "<recognized sanitized category, only when derivable>"
}
```

`safeWorkerDatabaseDiagnostic()` (lines 187–210) intentionally suppresses raw driver messages and parameters. It can emit only recognized safe values such as `syntax error`, `relation missing`, `column missing`, `function missing`, `operator missing`, `invalid input syntax`, `permission denied`, `statement timeout`, or `deadlock detected`.

## Important limitation of the current diagnostic label

The expected `operation` for a failure while crawling is **`website_crawl`**, including a failure of the stage-progress write. This is because `processWebsite()` sets:

```ts
setFailureOperation('website_crawl');
await this.crawler.crawl({ ..., onStage: async (stage) => {
  await this.db.knowledgeProcessingJob.updateMany(...);
}});
```

See `knowledge-processing.service.ts` lines 914–915. The `onStage` callback does not set a more specific label before its `updateMany` call.

The `BROWSER_RENDERING` stage itself is invoked immediately before renderer execution at `website-crawler.ts` line 489. Consequently, a future event with:

```text
stage=index_processing
operation=website_crawl
```

would narrow the failure to the crawler envelope, but would **not distinguish** among:

1. the `knowledgeProcessingJob.updateMany` stage-progress write inside `onStage`,
2. the renderer invocation or its dependencies,
3. another database-facing callback reached during the crawl, or
4. an error that the crawler propagated while its outer label was still `website_crawl`.

The additional Prisma/SQL fields will be present only if the thrown error carries them in the shapes the sanitizer recognizes. A generic adapter/network `ErrorEvent`, for example, may produce only `errorType` (or `unknown`) and omit Prisma/SQL fields. Thus one manual refresh can recover more evidence, but it cannot guarantee the exact leaf database call under the current instrumentation.

## Minimal evidence-supported recommendation

Do not change crawler logic, SQL, schema, migrations, or indexing behavior.

If an authorized manual website refresh is later requested, capture the complete structured worker warning from the same worker process immediately when it occurs, correlate it to the newly created job with a one-way fingerprint, and retain the safe diagnostic fields above. If that event reports only `operation=website_crawl` without Prisma/SQL metadata, the existing instrumentation is insufficient to identify an exact database operation; a separately approved diagnostic-instrumentation change would then be required before any corrective change.

No minimal code correction is supported by the currently available evidence.
