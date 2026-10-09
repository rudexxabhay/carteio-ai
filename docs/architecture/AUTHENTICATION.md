# Authentication architecture (Phase 04)

Carteio AI uses first-party, opaque, PostgreSQL-backed sessions. The browser receives a random 256-bit token in an HttpOnly cookie; PostgreSQL stores only its SHA-256 digest. The backend resolves the digest for each protected request and checks session expiry, revocation, and user status. The initial lifetime is 14 days (`AUTH_SESSION_DAYS`, configurable from 1 to 90 days). Passwords use Argon2id. Identity does not imply organization membership: signup creates a user and credential only.

## Lifecycle

1. Password signup normalizes email, hashes the password, creates the user and sends a 24-hour single-use email verification link.
2. Verification atomically consumes a hashed random token and marks the user verified. Login is denied until verification succeeds.
3. Login creates a database session and sets `carteio_session` locally or `__Host-carteio_session` in production. The cookie is HttpOnly, `SameSite=Strict`, host-only, and Secure in production.
4. `/api/v1/auth/me` is the frontend bootstrap source of truth. Logout revokes the current session before clearing the cookie. Logout-all revokes every session.
5. Reset links expire after one hour. Consuming one updates the password and revokes every current session in one transaction.
6. Google sign-in verifies a Google ID token on the backend. New Google accounts are keyed by provider subject; an existing email account is never linked automatically. `/google/link` requires a current session and a verified Google email matching that account.
7. Email OTP requests send a six-digit code with a five-minute default lifetime. Only an HMAC digest is stored using `AUTH_OTP_HASH_SECRET`, attempts are capped at five, resend waits 60 seconds, and successful consumption plus user upsert and session creation is atomic.

Expired session and token records are removed opportunistically during login requests. Expired or old consumed OTP challenges are removed during OTP requests. This avoids a separate cleanup process; low-traffic deployments may retain expired records until a login or OTP request occurs.

## Email adapter

`EmailService` is the provider boundary. The current adapter calls Resend's transactional email API and requires `RESEND_API_KEY` plus `AUTH_EMAIL_FROM`. Production environment validation requires both values. Signup, verification, recovery, and OTP delivery need an accepted provider response; no code, token, or link is written to application logs. OTP HMAC uses the separate `AUTH_OTP_HASH_SECRET`, so rotating it invalidates outstanding challenges. Configure a verified sending domain and its SPF/DKIM DNS records before delivery.

## CSRF, CORS, and proxy

All state-changing `/api/v1/auth/*` requests require an exact configured `Origin`; if `Referer` is present it must have that same origin. CORS lists exact origins and enables credentials without wildcard access. Vite proxies `/api/v1` to localhost:5000; Nginx preserves the API path and terminates HTTPS. Production trust proxy hops must match the known Nginx topology. Email tokens are URL fragments, so they are not sent to Nginx or in referrer headers.

Rate limits are per process and keyed by both trusted client IP and normalized account/email for relevant endpoints. Behind Nginx, configure `TRUST_PROXY_HOPS` to the exact proxy count. In-memory limits do not coordinate across replicas; use a shared store in a later infrastructure phase.

## Schema and manual migration

The Phase 04 migrations create `PasswordCredential`, `UserSession`, `EmailVerificationToken`, and `PasswordResetToken` in `20261009120000_phase_04_authentication`, followed by `AuthIdentity` and `EmailOtpChallenge` in `20261009130000_phase_04_google_otp_auth`. Provider subject and normalized challenge email are unique. The development Neon branch was manually verified to have neither migration applied and none of these tables present. Verify migration history on every other database before applying because that history has not been checked. Review and apply both SQL files manually against the intended Neon branch; never reset the database. Regenerate Prisma Client after applying the schema.

## API

All routes are under `/api/v1/auth`:

| Method | Route | Authentication | Purpose |
|---|---|---|---|
| POST | `/signup` | No | Create an unverified user and request verification mail |
| POST | `/login` | No | Verify credentials and issue a session cookie |
| POST | `/google` | No | Verify a Google ID token and issue a session cookie |
| POST | `/google/link` | Session | Link the verified Google subject to the signed-in account |
| POST | `/otp/request` | No | Request a passwordless email code (generic response) |
| POST | `/otp/verify` | No | Consume a single-use email code and issue a session cookie |
| GET | `/me` | Session | Return public user fields |
| POST | `/logout` | Session | Revoke current session |
| POST | `/logout-all` | Session | Revoke all sessions |
| POST | `/verify-email` | No | Consume a verification token |
| POST | `/resend-verification` | No | Request a verification email |
| POST | `/forgot-password` | No | Request a reset email (generic response) |
| POST | `/reset-password` | No | Consume a reset token and change password |

No organization data API or organization permissions are introduced in this phase.
