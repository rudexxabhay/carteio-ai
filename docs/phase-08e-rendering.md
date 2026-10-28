> **Product retirement notice (2026-10-11):** Public website knowledge ingestion has been removed from the active product. Website source creation, DNS challenge/verification, crawling, sync, scheduling, and browser rendering are disabled; legacy create/sync/verification routes return `410 WEBSITE_KNOWLEDGE_UNAVAILABLE`. Existing website sources, page records, migrations, and historical code are retained for compatibility and investigation, but are excluded from active Knowledge lists, processing, and assistant retrieval. Do not follow the historical activation instructions below. Current Knowledge supports manual FAQs, CSV/XLSX FAQ import, and manual text. Document ingestion is also unavailable.

# Phase 08E: automatic website rendering

## Actual status

HTML-first crawling, automatic fallback, a real Playwright worker, resource brokerage, page-method persistence and dashboard wiring are implemented. Browser execution is **BLOCKED BY CONFIGURATION** on the inspected deployment: no Docker/runsc installation, reviewed renderer image or demonstrated isolation boundary is present. No browser, server or worker was started; no database migration was applied. `https://expense.carteio.in/` has not been rendered or end-to-end tested by this change. Do not report that website recovered until the activation tests below pass.

No customer-side code, SDK or custom knowledge endpoint is required. No AI provider is used for extraction. Root `pnpm dev` remains unchanged. PDF/document ingestion remains deferred.

## Pipeline and limits

1. A verified, workspace-owned source enters the existing durable PostgreSQL crawl queue.
2. The existing pinned HTTP fetcher fetches initial HTML; parse5 evaluates useful non-navigation text.
3. Meaningful HTML publishes through the normal pipeline without Chromium.
4. An empty SPA shell/loading/navigation-only page requests automatic rendering.
5. The adapter checks Linux, explicit enablement, a local immutable image ID, Docker runtime configuration and every container's isolation settings before starting it.
6. A fresh Playwright context requests only scoped GET resources through a bounded JSON-line stdio broker. The trusted fetcher applies DNS/IP pinning, TLS checks, robots, path scope, shared PostgreSQL host pacing and total crawl budgets to every resource/redirect. The container itself has no external network.
7. Actual visible DOM content, title, headings, canonical metadata and links return to the shared parse5 extraction/chunking/index pipeline. Job/source/version/lease authority is rechecked. Atomic publication preserves the old generation on failure.

Limits: 25 seconds per task including preflight; browser work at most 20 seconds; an independent 22-second container watchdog; 60 resource requests; five redirects; 1.5 MB per response/returned HTML; 6 MB renderer resource bytes; 50,000 DOM elements; 200,000 extracted characters; 2,000 returned links. Existing 120-second crawl, 15 MB total bytes, page/depth caps and global two-job/one-job-per-workspace coordination still apply. Container limits: 512 MiB memory with no extra swap, one CPU, 256 processes, bounded `/tmp` and `/dev/shm` tmpfs. Failure to remove a created task prevents success.

Job stages are `HTML_EXTRACTION`, `BROWSER_RENDERING`, `INDEXING`, `INDEX_PUBLISHED`. Page methods are `HTML` / `BROWSER_RENDERED`. Neither stage nor navigation completion is proof that content was indexed. Search remains PostgreSQL lexical by default, with exact source/page citations. No embedding key is needed and no semantic translation capability is implied.

## Isolation contract

The required deployment is a dedicated Linux worker environment with a trusted Docker daemon and gVisor `runsc`. Create a Docker runtime named `carteio-renderer` with runtime path ending in `runsc` and runtime args containing `--network=none`. Merge this into the administrator-managed Docker daemon configuration, preserving unrelated settings:

```json
{
  "runtimes": {
    "carteio-renderer": {
      "path": "/usr/local/bin/runsc",
      "runtimeArgs": ["--network=none"]
    }
  }
}
```

Install gVisor using its [official installation instructions](https://gvisor.dev/docs/user_guide/install/), then have the administrator restart/validate Docker. [gVisor networking documentation](https://gvisor.dev/docs/user_guide/networking/) describes the external-network-disabled runtime mode. The adapter requires Docker's `info` JSON to expose the runtime path/args; missing proof fails closed. Runtime names alone do not establish isolation. The administrator must verify the installed binary, daemon and actual containment tests.

Containers use both Docker `--network none` and runsc `--network=none`, no published ports/host mounts, read-only root, non-root `pwuser`, dropped capabilities, no new privileges, private IPC and a fixed worker entrypoint. Chromium sandbox is explicitly enabled. Contexts have no stored cookies, credentials, permissions, downloads, extensions or profiles. Service workers/WebSockets are blocked. No API environment secrets, proxy variables or Docker user contexts are inherited by the container. Docker commands use the local Unix socket only; remote `DOCKER_HOST` configuration is intentionally ignored.

Request routing alone is insufficient. A browser exploit or native request bypass must still have no host filesystem, host network or external egress. The container may read its own reviewed image and bounded temporary files, never the backend filesystem. Treat all renderer output as untrusted and bounded. The trusted broker does not permit arbitrary headers, credentials, POST/API calls or URLs outside the verified scope.

Docker permission is highly privileged; do not grant the public API host Docker socket access casually. Run the existing backend-hosted worker on a dedicated Linux worker deployment where this authority is an explicit administrator decision. There is no independent new queue or publicly exposed renderer endpoint. Native Windows cannot satisfy the adapter's Linux gate. WSL2 with a dedicated Linux Docker/runsc setup can be evaluated for development; ordinary Docker Desktop with no custom runsc runtime cannot satisfy the contract.

Chromium/gVisor/default-seccomp compatibility is **unverified**. If Chromium sandbox startup fails, stop and diagnose the isolated deployment. Do not add `--no-sandbox`, `--privileged`, `SYS_ADMIN`, host networking, `seccomp=unconfined`, host mounts or an unrestricted Playwright service to bypass the gate. Supporting another isolation arrangement requires a reviewed adapter change.

## Manual setup, Windows PowerShell

### Database and normal app

Confirm manually that private backend database URLs target only the authorized Neon development branch. Do not print credentials. Current migration history was not queried in this task. Review the reported pending chain and new migration before deployment:

```powershell
pnpm --filter @carteio/backend exec prisma migrate status
Get-ChildItem .\backend\prisma\migrations\20261011*\migration.sql | Sort-Object FullName | ForEach-Object { Get-Content $_.FullName }
```

The chain is `20261011120000_phase_08_index_foundation`, `20261011130000_phase_08a_embedding_profiles`, `20261011140000_phase_08_lexical_and_optional_semantic`, `20261011150000_phase_08_website_sync_lifecycle`, `20261011160000_phase_08_global_crawl_coordination`, then `20261011170000_phase_08e_browser_extraction`. Apply only pending migrations; stop for failed/partial/checksum states. Existing migrations were not edited. pgvector 0.8.6 is the user-reported prerequisite for the historical vector foundation. The new migration only adds page method/default/check and nullable job stage/check; it preserves source IDs, links and content. It is a Prisma tracked migration, not a manually rerunnable SQL script.

Only after development target and SQL approval:

```powershell
pnpm --filter @carteio/backend exec prisma migrate deploy
pnpm --filter @carteio/backend exec prisma generate
```

Keep browser rendering disabled at first. Only after migrations/client generation set existing `KNOWLEDGE_WORKER_ENABLED=true` manually in the appropriate private backend environment. Root installation is not newly required by this phase when existing dependencies are installed. Start normal app manually:

```powershell
pnpm dev
```

### Optional isolated renderer (administrator action)

Prepare a Linux worker with Docker/runsc as described above. No external paid renderer account is used. This environment is a manual prerequisite; there is no automatic installation. The renderer package lives outside pnpm workspaces so normal frontend/backend installation does not install browsers.

On that worker, from a project checkout (PowerShell syntax shown for a Linux PowerShell session):

```powershell
docker info --format '{{json .Runtimes}}'
docker build -t carteio-knowledge-renderer:08e ./infrastructure/renderer
docker image inspect carteio-knowledge-renderer:08e --format '{{.Id}}'
```

The manual image build installs only Playwright `1.64.0` inside the container and obtains Chromium/system dependencies from the matching official image. No `pnpm exec playwright install` is needed on the API host. The [official Playwright Docker documentation](https://playwright.dev/docs/docker) requires matching image/package versions and warns that its base image alone is not a security boundary for untrusted websites. Review the base image and pin an approved digest for deployment. The adapter accepts only the local `sha256:...` image ID, not a mutable tag, and never pulls an image during crawling.

Before enabling, an administrator must demonstrate under the actual runtime: native/browser IPv4/IPv6/private/loopback/metadata/DNS egress denied, no host filesystem mounts, no application secrets, no public debugger/socket access, Chromium sandbox enabled, watchdog/container cleanup on crash, and limits under hostile fixtures. The Node tests below verify application controls; they do not demonstrate this OS boundary. Perform these probes on a controlled fixture environment, not on random production domains.

After successful isolation tests, manually configure the **Linux worker backend**:

```dotenv
KNOWLEDGE_BROWSER_RENDERING_ENABLED=true
KNOWLEDGE_RENDERER_IMAGE=sha256:THE_REVIEWED_LOCAL_64_HEX_IMAGE_ID
```

Do not enable these settings on an ordinary native Windows API process. Resource planning: the existing global job cap permits up to two tasks, each with a 512 MiB container limit; allow additional memory/CPU for Docker/gVisor, backend and operating system. Actual capacity and Chromium headroom must be load-tested. Self-hosting uses CPU/RAM and optional image downloads; it does not promise zero operating cost.

### Functional verification

1. Verify a controlled public website through the existing DNS TXT challenge flow. Registering a URL alone is insufficient.
2. Run Sync now for traditional HTML. Expect no browser stage, actual pages and method `HTML`.
3. Run Sync now for a controlled React/Vite SPA on the verified exact hostname. Expect HTML attempt, browser stage, real visible headings/policy text and method `BROWSER_RENDERED` after successful index publication.
4. Confirm genuinely linked FAQ/privacy URLs are discovered, robots/private-path limits are respected and no invented routes appear.
5. Link the base to an ACTIVE assistant. Test manager preview with phrases present in extracted text and check exact page citations. Check cross-tenant/public restrictions. No chatbot answer is generated.
6. Cancel/archive/delete during rendering; confirm task cancellation and no new generation publication. Test failed extraction retaining the prior valid index, retry and daily/weekly scheduling.
7. Only then test the authorized `https://expense.carteio.in/` source using its existing DNS verification and Sync now. No website code modification is part of this workflow.

Focused local checks, without Prisma generation/server startup:

```powershell
node .\backend\test\website-rendering.node-test.cjs
node .\node_modules\typescript\bin\tsc --noEmit --incremental false --pretty false -p .\backend\tsconfig.build.json
node .\node_modules\typescript\bin\tsc --noEmit --incremental false --pretty false -p .\frontend\tsconfig.json
node --check .\infrastructure\renderer\worker.mjs
node --check .\infrastructure\renderer\render-page.mjs
```

## Supported limits and diagnostics

- Only exact verified hostname and configured paths/robots are allowed, including subresources. Third-party CDN scripts, cross-origin APIs, unapproved subdomains, POST/login/private data, WebSockets and service workers are blocked. Sites depending on them may remain unsupported; no general React/Vite compatibility claim is made until tested.
- Same-host linked routes and canonical URLs are used. No route brute force occurs. Hash-router routes are not independently crawled because URL hashes are normalized away. Broad scope may be needed for same-host `/assets` resources; the crawler still excludes private/API paths.
- `BROWSER_RENDERING_NOT_CONFIGURED`: disabled by default; static crawling still works.
- `BROWSER_ISOLATION_REQUIRED`: wrong platform/runtime/inspection settings. Never loosen the gate to make a page pass.
- `BROWSER_IMAGE_NOT_CONFIGURED` / `BROWSER_RUNTIME_UNAVAILABLE`: review local immutable image, Docker availability and runtime evidence.
- `BROWSER_SANDBOX_FAILED`: actual Chromium sandbox/runtime compatibility needs diagnosis.
- `BROWSER_CONTENT_INSUFFICIENT`: rendered visible text is still absent/loading/insufficient, or required resources were blocked. Navigation success alone is insufficient.
- `BROWSER_RESOURCE_LIMIT` / `BROWSER_RENDER_TIMEOUT`: bounded request/body/DOM/time resource failure, not a successful page.
- `BROWSER_CLEANUP_FAILED`: operator must inspect Docker availability and remove the orphan task before retry. Worker EOF/watchdog also revokes authority, but successful external cleanup must not be assumed.

No browser run, real SPA extraction, isolation escape test, live Neon search, migration or browser UI verification has been performed in this implementation environment. The Phase 09 retrieval contract remains the existing source-grounded, authorized excerpt interface.

## Executed verification

The bounded focused Node suite passed **30 tests** on the available Node 24 environment. It executes real crawler/extraction/broker/policy logic with controlled DNS and HTTP transports, fake Playwright context hooks, and fake database transactions. It checks navigation/loading rejection, Unicode, rendered-link discovery, resource restrictions, denied private/mixed DNS and redirects, cancellation, page-backed lexical publication and public visibility filtering. Backend and frontend strict TypeScript checks passed without emitting files or generating Prisma Client. Both renderer modules passed `node --check`. The renderer package/image was not installed/built and no Playwright browser was launched. The production package targets Node >=22; that separate Node 22 execution and OS/browser/database integration remain unverified.
