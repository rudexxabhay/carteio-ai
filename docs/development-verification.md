# Development runtime and verification

For the current approved roadmap, use the [Phase 00 verification record](development/phase-00-verification.md) and [regression safety procedure](development/regression-protection.md). The environment observations and phase numbering below are historical; they are not current PASS results or authorization to install, generate, migrate, start services, or enter a later phase.

## Supported runtime

- Node.js 24.11 or newer in the 24.x line (`.nvmrc` selects the installed 24.x release).
- pnpm 9.15.0, pinned by the root `packageManager` field.
- Prisma 7.10.0 and TypeScript 5.9.x from the current lockfile.

The frontend and backend check scripts do not regenerate Prisma Client on each
invocation. Generate it once after install or after a schema change, then run
type checks and tests. The root `typecheck` and `test` commands prepare the
backend client once before delegating to the workspace packages.

## Windows and WSL dependency separation

The Windows PowerShell project and a Linux/WSL project must not share one
`node_modules` tree. Native packages such as Prisma engines and Rollup are
platform-specific, and install scripts for native addons cannot be cross-built
by listing another platform as a supported architecture. The observed Codex
workspace is `/mnt/c/...` (a Windows-mounted NTFS path), with a pnpm store and
symlinks created by Windows. Linux was missing the Linux Rollup package and
Prisma's Linux engine artifacts. This is an installation/platform mismatch,
not evidence that Node.js 24 is unsupported.

Use PowerShell for the Windows checkout and its Windows installation. If a
Linux-native verification copy is needed, place a separate checkout under the
WSL Linux filesystem (for example, `~/src/carteio-ai`) and run a Linux pnpm
install there. Never copy `node_modules` between those checkouts. Copy source
changes as needed, but exclude private `.env` files and enter test-only
configuration separately.

The current Codex container could not fetch pnpm from the npm registry, and its
Windows-installed pnpm tree cannot be repaired safely in-place from Linux.
Consequently, Linux-native install and verification remain a manual setup step
in this environment.

## Verification ladder

Run these in PowerShell from the repository root. Do not use the Linux Node
installation against the Windows `node_modules` tree.

### Level 1: Tool startup

```powershell
node --version
pnpm --version
pnpm --filter @carteio/backend exec tsc --version
pnpm --filter @carteio/backend exec jest --version
pnpm --filter @carteio/frontend exec vitest --version
pnpm --filter @carteio/backend exec prisma --version
```

### Level 2: Generate Prisma Client and run static checks

```powershell
pnpm install --frozen-lockfile
pnpm --filter @carteio/backend prisma:generate
pnpm --filter @carteio/backend exec prisma validate
pnpm typecheck
pnpm lint
```

### Level 3: Isolated unit tests

```powershell
pnpm test:backend
pnpm test:frontend
```

The backend Jest script runs serially. The frontend Vitest script limits worker
count to one. Neither script makes live provider requests by design; tests
that need providers must use mocks.

### Level 4: Safe integration checks

Use only an isolated development/test database and synthetic fixtures. The
read-only migration check is:

```powershell
pnpm --filter @carteio/backend exec prisma migrate status
```

Do not use reset, `db push`, or migration-apply commands as part of routine
verification.

### Level 5: Local application smoke checks

Start the existing local frontend/backend using the repository's documented
development process, then verify authenticated Playground behavior manually.
Do not treat unit tests as browser or provider verification.

### Level 6: External services

Use only explicitly authorized development database/provider credentials and
synthetic prompts. Never run paid OpenAI checks as part of automated CI.

## CI

The CI workflow uses Node 24 and pnpm 9.15.0, generates Prisma Client once,
and runs the workspace checks without requiring provider secrets. The UAT
workflow also performs its type checks with Node 24; its database migration
and deployment stages remain governed by their existing UAT controls.

## Current environment findings

- Codex: Node 24.15.0, Linux x64 under WSL2, repository on `/mnt/c`.
- User Windows runtime reported: Node 24.11.0.
- Codex's `pnpm` resolves to the Windows user-level pnpm shim. Invoking its
  JavaScript entry point works, but Corepack cannot download the pinned package
  because registry DNS is unavailable in the sandbox.
- The installed dependency metadata points to a Windows pnpm store. Linux
  Rollup and Prisma artifacts are absent.
- Seventeen migration directories are present in the current checkout. The
  latest development-database status was not rechecked because the Linux
  Prisma CLI did not start; an earlier user-run status predates this checkout
  state and should not be treated as confirmation for all 17 directories.
- TypeScript configuration discovery succeeds quickly; full TypeScript
  analysis did not finish within the bounded 40-second check on the mounted
  checkout. Jest startup (`--version`), Vitest execution, and Prisma CLI startup
  also exceeded their bounded startup checks without diagnostics. This is
  consistent with the cross-platform installation and mounted-filesystem
  constraint; it does not prove an application type/test failure.
- All environment files were audited by variable name. No required variable
  name was missing from its private file. Provider keys remain backend-only;
  optional provider keys are not required at application startup. No `.env`
  file was changed.

## Phase 09A test coverage note

Current backend source test files cover website-source retirement, crawler
boundaries, and website synchronization. The repository currently has no
dedicated ConversationOrchestrator regression spec, so the focused Phase 09A
security and lifecycle suite still needs to be added before that behavior can
be treated as regression-tested.
