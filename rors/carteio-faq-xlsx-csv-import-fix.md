# Carteio FAQ XLSX/CSV Import Fix

## Root cause

The exact message `The import file has no header row.` is produced in the backend by `parseFaqImport()` when the parsed grid has zero rows. The frontend does not generate that message; it displays the API error returned by the preview endpoint.

The XLSX reader used regular expressions that only recognized unprefixed SpreadsheetML element names such as `<row>`, `<c>`, `<v>`, and `<t>`. Valid OOXML documents may use namespace-prefixed names such as `<x:row>` and `<x:c>`. In that case the reader returned no rows, which reached the zero-row check and appeared as a missing header even though the worksheet contained the `question` and `answer` cells. The reader also needed to follow `workbook.xml` relationships to locate the workbook's first worksheet rather than rely on a physical `sheet1.xml` filename.

The specific uploaded workbook was not present in the workspace, so its XML bytes could not be inspected. The parser defect and the exact branch producing the error are confirmed from source; whether that particular file used prefixed tags cannot be asserted without its bytes.

## File selection and transfer findings

The active route is `/workspace/:slug/knowledge`, rendered by the source dashboard's `Knowledge` page. The browser file object was passed to `FormData` under the `file` field, and the API client preserves `FormData` and does not set a multipart content type itself; the browser supplies the boundary. The preview endpoint is `POST /api/v1/workspaces/:slug/knowledge-bases/:baseId/sources/faqs/import/preview`; commit uses the matching `/import` endpoint. Both Nest routes use `FileInterceptor('file')`, with a 2 MB limit.

The old input handler cleared `event.currentTarget.value` immediately after saving the `File` object in React state. That explains why the native control showed “No file chosen” while the file was still retained for the request. It also made the visible state confusing after a failed preview. The displayed parser error was nevertheless a backend response, not evidence that no file had been sent.

The previous CSV parser already handled quoted commas, doubled quote escaping, and CRLF/LF records. Its decoding path assumed UTF-8; it now explicitly handles UTF-8 BOM, UTF-16LE/BE BOMs, and a Windows-1252 fallback when UTF-8 decoding is invalid.

## Changes implemented

- `backend/src/modules/workspaces/faq-import.ts`
  - Resolves the first worksheet using the workbook relationship entry and validates that the resolved path stays inside `xl/worksheets/`.
  - Reads namespace-prefixed or unprefixed worksheet, row, cell, shared-string, and value tags.
  - Preserves worksheet row numbers for validation messages and avoids silently dropping rows beyond the 500-row limit.
  - Normalizes header whitespace and casing before required/optional-header checks and duplicate detection. Required `question`/`answer` headers remain mandatory; unsupported and duplicate headers remain errors.
  - Distinguishes empty input, unsupported extension, corrupt XLSX/ZIP entries, missing worksheet, empty first worksheet, missing required headers, and malformed CSV.
  - Decodes supported CSV encodings and trims required values before validation; blank records remain skipped.
- `frontend/src/dashboard-source/pages.tsx`
  - Keeps the native selected filename visible instead of immediately clearing the file input.
  - Separates import errors from general Knowledge page errors; selecting a new file or clearing it resets the import-specific error.
  - Adds explicit remove and retry-validation actions. A failed preview keeps the selected file available for retry; a failed commit keeps the reviewed file/preview available to retry.
  - Uses a request generation guard so a stale preview/import response cannot overwrite a newer file, destination base, or workspace state.
  - Clears the input after explicit removal or confirmed import, so selecting the same file again triggers normally.
  - Reports the backend's actual created/skipped/failed/updated counts and clarifies that indexing is queued separately.
- `backend/src/modules/workspaces/knowledge.service.ts` and the controller pipeline were inspected and left unchanged: the existing import transaction creates FAQ source rows, Knowledge Base memberships, and one queued indexing job per new source. Workspace access and active Knowledge Base ownership are checked before persistence. The existing worker handles the queued jobs.
- The existing 2 MB and 500-row limits remain in force. 154 rows fit the current limit; production code contains no hardcoded 154 value.

## Regression tests added

- `backend/test/faq-import.spec.ts`: namespace-prefixed XLSX with workbook relationship pointing to `sheet2.xml`, optional category, required-only/quoted multiline CSV, BOM and UTF-16 CSV, 154-row workbook, empty/corrupt/headerless workbooks, missing headers, duplicate normalized headers, and formula rejection.
- `backend/test/knowledge.service.spec.ts`: workspace authorization, foreign Knowledge Base denial, persistence failure propagation, and persistence plus index-job creation for 154 rows.
- `backend/test/knowledge-base.faq-import.spec.ts`: preview/import route contracts and missing multipart `file` handling.
- `frontend/src/tests/api-client.test.ts`: exact preview endpoint, multipart `file` field, selected binary File object, credentials, and no manually set multipart boundary.
- `frontend/src/tests/faq-import-dashboard.test.tsx`: retained selected filename after preview failure, retrying the same file, confirmed import result, queued-indexing status, clearing selection, and blocking import without a selected file.

## Verification status

Tests/builds were not run. No packages were installed and no database, environment, or deployment changes were made. Direct local `tsc --noEmit` static checks were attempted: backend reports an existing unrelated type error in `connector-sync-worker.service.spec.ts:46`; frontend reports multiple existing project errors (including unrelated dashboard and legacy Playground code). No compiler diagnostics pointed to the FAQ parser, the FAQ UI state changes, or the added FAQ tests. Static source tracing confirms the route, multipart field, backend parser path, scoped service checks, transactional persistence, queued indexing jobs, and dashboard refresh behavior.

The actual 154-FAQ workbook was not available in the workspace, and no authenticated browser/API upload was performed. Therefore the specific workbook's received bytes and live post-import indexing status remain unverified. Supported uploads remain `.xlsx` and `.csv`; legacy `.xls` is not supported. The backend retains its 2 MB file-size limit.
