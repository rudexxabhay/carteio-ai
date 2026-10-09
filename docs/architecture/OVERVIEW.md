# Carteio AI architecture overview

## Runtime

Carteio AI has two independently running applications: one React + Vite browser application in `frontend/`, and one NestJS API in `backend/`. Vite listens on port 3000 and proxies `/api/v1` to NestJS on port 5000. The browser uses relative `/api/v1` requests, so local health checks remain same-origin. Root scripts can start both or either workspace independently. A local database, container runtime, and third application server are not required; without Neon URLs, the backend runs in explicit limited database mode.

The frontend has one React build for public, authentication-placeholder, documentation, help, and dashboard routes. React Router selects separate public, auth, and dashboard layouts. The dashboard is explicitly a preview and is not protected. The backend is the trusted boundary for future secrets, authorization, business data, and AI calls; browser code must never receive database or provider credentials.

Backend settings are validated at startup. Production must provide its HTTPS CORS origin, and proxy trust stays disabled unless the deployment has a fixed, documented proxy hop count. API requests return JSON errors with stable codes and request IDs. Request logs include method, matched route, status, duration, and request ID without request bodies or query strings.

## Production

Nginx serves the built Vite static files for all frontend routes and falls back to `index.html` on nested paths. `/api/v1/` goes to a private NestJS upstream with the API prefix preserved. The Vite server is development-only. HTTPS certificates and deployment are configured manually later.

## Evolution boundaries

Phase 02 added reliability and security foundations. Phase 03 adds the initial PostgreSQL/Prisma schema and connection/readiness foundation only. Authentication, tenant authorization, RLS, database-backed business APIs, AI, integrations, jobs, and billing remain unimplemented. Shared types contain transport contracts only; backend runtime and browser UI do not share executable modules.

Environment variables and browser visibility are listed in [ENVIRONMENT.md](ENVIRONMENT.md).
