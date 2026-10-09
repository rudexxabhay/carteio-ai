# Environment variables

Use `frontend/.env.example` and `backend/.env.example` as safe templates. Every new, changed, or removed environment variable must be reflected in the relevant example file in the same development phase. Never copy private values into an example file or commit a private `.env` file. Frontend `VITE_*` values are public after bundling and must not contain secrets.

## Frontend

| Variable | Required? | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | Optional | Public API root used by the browser; defaults to `/api/v1`. |
| `VITE_GOOGLE_CLIENT_ID` | Required to enable Google sign-in | Public Google OAuth Web Client ID used by Google Identity Services. It is safe to include in the browser bundle. |

## Backend — Application

| Variable | Required? | Purpose |
|---|---|---|
| `NODE_ENV` | Optional | Runtime mode: `development`, `test`, or `production`; defaults to `development`. |
| `PORT` | Optional | Backend listening port; defaults to `5000` and must be from 1 through 65535. |
| `HOST` | Optional | Bind address; defaults to `127.0.0.1` locally and `0.0.0.0` in production. |
| `API_PREFIX` | Optional | API route prefix; the current backend requires `api/v1`. |
| `CORS_ALLOWED_ORIGINS` | Required in production | Comma-separated list of exact HTTP(S) browser origins; local default is `http://localhost:3000`. Production origins must use HTTPS and cannot be loopback. |
| `LOG_LEVEL` | Optional | Logging detail (`error`, `warn`, `log`, `debug`, or `verbose`); defaults to `log`. |
| `TRUST_PROXY_HOPS` | Optional | Number of trusted reverse proxies (0–5); defaults to `0` and must be `0` outside production. |

## Backend — Database

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | Required in production; optional in local limited mode | Pooled PostgreSQL URL for runtime queries; must use `sslmode=require`. |
| `DIRECT_URL` | Required with `DATABASE_URL` and in production | Direct PostgreSQL URL for Prisma schema and migration commands; must use `sslmode=require`. |

When either database URL is set, both must be configured. In local development and tests, leave both unset to use limited mode (`GET /api/v1/ready` reports `not_configured`). See [database plan](DATABASE_PLAN.md) for setup and migration steps. Keep these URLs in the private backend environment only.

## Backend — Authentication

| Variable | Required? | Purpose |
|---|---|---|
| `AUTH_SESSION_DAYS` | Optional | Session lifetime in days, from 1 to 90; defaults to `14`. |
| `PUBLIC_APP_URL` | Required in production | Exact public frontend origin used to construct verification and password reset links; local default is `http://localhost:3000`. It must also appear in `CORS_ALLOWED_ORIGINS`. |
| `GOOGLE_CLIENT_ID` | Required to enable Google sign-in | Google OAuth Web Client ID for backend token validation; no client secret is needed for the ID-token callback flow. |
| `AUTH_OTP_EXPIRES_MINUTES` | Optional | Email OTP challenge lifetime in minutes (1–5); defaults to `5`. |
| `AUTH_OTP_MAX_ATTEMPTS` | Optional | Invalid code attempts per challenge (1–5); defaults to `5`. |
| `AUTH_OTP_RESEND_COOLDOWN_SECONDS` | Optional | Minimum wait between codes to one email (60–900 seconds); defaults to `60`. |
| `AUTH_OTP_HASH_SECRET` | Required to enable email OTP | Private random key of at least 32 bytes used to HMAC OTP values. |

Google Identity Services uses the configured client IDs for the browser callback and backend token audience. Keep both unset to leave existing email/password sign-in available without Google. Development, UAT, and production may share a client ID when all origins are registered in Google Cloud; environment-specific clients provide stronger isolation. Email OTP settings configure challenge expiration, attempts, resend cooldown, and its dedicated HMAC key. Rotating the OTP key invalidates outstanding codes.

## Backend — Email Provider (Resend)

| Variable | Required? | Purpose |
|---|---|---|
| `RESEND_API_KEY` | Required in production; optional in development | Private Resend API credential used to deliver account emails. |
| `AUTH_EMAIL_FROM` | Required in production; optional in development | Verified sender name and email address used for account messages. |

The Resend adapter and production validation both use these exact variable names. Verify the sending domain and publish its SPF/DKIM records before production delivery. See [authentication architecture](AUTHENTICATION.md) and [Phase 04 report](../phases/PHASE_04_REPORT.md).

Backend configuration is validated before listening. Production requires explicit CORS origins, an HTTPS `PUBLIC_APP_URL`, both database URLs, and both Resend settings. Set `HOST=0.0.0.0` only in a private deployment network. Set `TRUST_PROXY_HOPS=1` only when one known Nginx proxy is directly in front of the backend; otherwise keep it at `0`. Node 22 loads `backend/.env`; Vite reads `frontend/.env`. CI does not require production configuration.
