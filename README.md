# Carteio AI — Phase 01

A secure monorepo foundation for Carteio AI, using exactly one React + Vite frontend and one NestJS backend. The official domain is [ai.carteio.in](https://ai.carteio.in). This phase establishes routes, visual foundations, an API health endpoint, infrastructure templates, and planning docs. It does not implement authentication or business features.

## Architecture

- `frontend/`: React, Vite, TypeScript, React Router, Tailwind CSS; local port **3000**.
- `backend/`: NestJS, TypeScript; local port **5000**, API prefix `/api/v1`.
- `packages/shared-types/`: small HTTP contract package.
- `infrastructure/nginx/`: production routing templates for one frontend build and the private API.

There are only two local servers. Vite proxies `/api/v1` to `http://localhost:5000/api/v1`, and browser services use relative `/api/v1` requests. No Nginx, Docker, database, or third app server is needed for local development.

## Install and run manually

After installing pnpm 9.15+ and Node.js 22, the developer may install dependencies and run one or both apps:

```sh
pnpm install
pnpm dev                 # both applications
pnpm dev:frontend        # frontend only: http://localhost:3000
pnpm dev:backend         # backend only: http://localhost:5000
```

Copy `frontend/.env.example` and `backend/.env.example` to local `.env` files if you need to override defaults. Vite and the Node 22 backend load their app-local `.env` files at startup. The backend binds to `127.0.0.1` locally; production containers should use `HOST=0.0.0.0` only on a private network. Frontend `VITE_*` values are public and must never contain secrets. Backend variables are private. See [environment guidance](docs/architecture/ENVIRONMENT.md).

Health check: `GET http://localhost:3000/api/v1/health` through Vite, or `GET http://localhost:5000/api/v1/health` directly. The dashboard calls the same-origin proxied endpoint and offers a manual retry. Login and signup are nonfunctional UI placeholders. Dashboard is an unprotected development preview; do not enter private data.

## Configuration and reliability

Backend configuration is validated before the listener opens. Development defaults bind to `127.0.0.1:5000` and allow the Vite origin. Production requires an explicit HTTPS `CORS_ALLOWED_ORIGINS`; set `HOST=0.0.0.0` only inside the private runtime network. `TRUST_PROXY_HOPS` defaults to `0` and must match the known proxy topology. The API uses JSON structured request logs, validated request IDs, safe JSON errors, Helmet headers, strict DTO validation, and a 1 MB request body limit. Browser requests use same-origin `/api/v1`, an 8-second timeout, and cancellation; the dashboard uses manual retry only.

## Useful scripts

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

CI runs typecheck, lint, unit/e2e tests, and production builds without production credentials. Dependency installation in CI is lockfile-frozen. Locally, install dependencies before running checks.

## Production routing

Build the frontend with `pnpm --filter @carteio/frontend build`, serve `frontend/dist` using the Nginx template, and run NestJS behind a private network upstream. Nginx sends `/api/v1/` to NestJS with the prefix preserved; all other nested app URLs fall back to the one React `index.html`. API failures do not return frontend HTML. TLS provisioning and deployment are intentionally manual and not performed here. See `infrastructure/nginx/README.md`.

## Data and security boundaries

The backend now has a Neon PostgreSQL and Prisma schema foundation. No database is connected until backend-only Neon URLs are configured; development remains in explicit limited mode without them. The browser never accesses the database directly. See [database plan](docs/architecture/DATABASE_PLAN.md), [schema](docs/architecture/DATABASE_SCHEMA.md), and [security foundation](docs/security/FOUNDATION.md).

## Repository map

```text
frontend/                 React + Vite app and tests
backend/                  NestJS API and endpoint tests
packages/shared-types/     Shared transport contracts
infrastructure/nginx/      Production routing templates
docs/                      Architecture, security, and phase report
.github/workflows/         CI checks
```

See [architecture overview](docs/architecture/OVERVIEW.md), [routing and SEO plan](docs/architecture/ROUTING.md), and [Phase 01 report](docs/phases/PHASE_01_REPORT.md) for scope and limitations.
