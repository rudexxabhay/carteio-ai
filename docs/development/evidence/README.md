# Phase 00 retained evidence

- `baseline-summary.json`: final gate, disjoint scope counts and live-data limitations.
- `test-suite-ledger.md`: per-file latest pass/fail counts and contributing runs.
- `backend-latest-assertions.json`, `frontend-latest-assertions.json`: exact assertion identities/statuses, deduplicated across completed runs. Filtered pending results never overwrite failures.
- Named run JSON files: sanitized original runner counters and individual assertions; no provider request bodies, credentials, DB rows or raw failure payloads are copied here.
- `frontend-threads-partial.json`: only actually printed completed assertions from the timed-out broad run; superseded for coverage by completed file batches, retained as historical evidence.
- `frontend-remaining-command.json`: exact argv/cwd/file selection for F10.
- `grounding-date-diagnostic.json`: direct execution of the actual validator against a synthetic authorized stock snapshot.
- `offline-guard.tap`: three actual network-denial test results.
- `checkpoint-metadata.json`, `git-status-before.txt`, `source-sha256-before.json`: initial branch/dirty state and source checkpoint identity.
- `phase-00-file-manifest.json`: exact phase-owned modifications/additions, source hashes and zero-production-change verification; it excludes its own digest to avoid self-referential hashing.

The full source checkpoint and raw per-run logs remain under the documented `/tmp` paths. Preserve that private source checkpoint before the environment is removed. Runtime successes here are unit/component/contract/local-health evidence with synthetic dependencies, not live merchant/provider/deployed-system verification.
