# Security foundation

## Implemented foundation

- Browser and server trust boundaries are explicit. Vite `VITE_*` values are public bundle configuration; backend `.env` values are private. No secrets or database/provider credentials are included.
- NestJS applies Helmet headers, exact-origin CORS, a 1 MB JSON/form body limit, request IDs, DTO validation with unknown-field rejection, safe exception responses, and shutdown hooks. CORS origins are validated at startup; production requires an explicit HTTPS origin and rejects loopback origins.
- Error responses preserve the shared transport shape and contain a stable code, safe message, request ID, timestamp, and matched route. Validation constraint messages may be returned; stack traces, request bodies, credentials, and raw URLs are not returned or logged.
- Proxy headers are ignored by default. Configure a numeric `TRUST_PROXY_HOPS` only for a known fixed deployment topology. Never trust client-supplied forwarding headers directly.
- Vite configuration accepts only a same-origin API path. Browser variables are public by design; credentials belong only in backend runtime secret storage.
- Nginx keeps the backend upstream private, caps request bodies, preserves the API route, sets security headers, and keeps API errors out of the SPA fallback.
- The login/signup screens accept no credentials. Dashboard is an explicitly unprotected development preview and shows no private user information.
- Phase 03 adds a backend-only Prisma/Neon database foundation and organization-scoped relational constraints. No database is connected by default in development; production requires both encrypted backend URLs. This does not implement authentication, authorization, or PostgreSQL RLS. See [database security](DATABASE_SECURITY.md).

## Future security work

### Universal AI connectors

- Associate every connector and connection with a tenant, and verify its owner and tenant scope in trusted backend policy on every operation.
- Validate external URLs against SSRF risks at connection time and after DNS resolution and every redirect. Block loopback, private, link-local, and metadata-service addresses.
- Encrypt connector credentials at rest, scope them to approved capabilities, and ensure revocation prevents all later execution.
- Require owners to explicitly approve exposed capabilities. Independently verify end-user identity and permissions in the backend; model output is never authorization.
- Never grant AI unrestricted database or administrative permissions. Require explicit approval for high-risk actions and audit actor, tenant, capability, decision, and outcome.

### Operations

Keep structured logs and request IDs as the initial diagnostic baseline. Add OpenTelemetry, error tracking, cloud monitoring, and alerting only after selecting and configuring an approved destination, data retention, redaction, and sampling policy. Never send development data to a third party by default. For future AI calls, set provider-specific timeouts, bounded retries with idempotency rules, rate limits, circuit breakers, cancellation, streaming limits, and token/cost accounting before production use. Use a queue such as Redis-backed jobs only when long-running work needs durable background execution.

- **Tenant authorization:** derive tenant context from authenticated identity on the server; check membership and resource scope at every service boundary; add PostgreSQL RLS as defense in depth.
- **Connector scope and revocation:** bind each website connector to a verified origin and narrowly scoped tenant resources; support immediate credential and permission revocation.
- **Action approvals and audit:** require owner-defined approvals for consequential tools; write append-only audit events for identity, scope, decision, and outcome without storing unnecessary sensitive payloads.
- **Credential encryption:** encrypt integration credentials with managed key material, rotate keys, and never return stored credentials to clients.
- **Webhooks:** verify provider signatures over raw request bytes, enforce timestamp/replay protection, and rotate signing secrets.
- **SSRF:** do not fetch arbitrary URLs. If website ingestion is introduced, allowlist schemes, resolve and block private/link-local IPs at connection time, re-check redirects and DNS, cap response size/time, and isolate egress.
- **Prompt injection:** treat retrieved content and user input as untrusted data, separate instructions from content, constrain tools server-side, enforce authorization independently of model output, and require approval for consequential actions.

These future controls are plans, not implemented protections. Phase 02 does not include authentication, authorization, URL fetching, integrations, or AI execution. Before launch, review proxy topology, rate limiting, CSP compatibility, dependency advisories (`pnpm audit`), and secret management with deployment-specific settings.
