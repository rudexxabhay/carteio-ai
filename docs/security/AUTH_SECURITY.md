# Authentication security notes

## Controls in this phase

- Argon2id password hashing (19 MiB memory, 2 iterations, one lane); 12–128 character limits and a small common-password pattern check.
- Cryptographically random 32-byte sessions and action tokens; SHA-256 token digests only in PostgreSQL; token compare uses constant-time equality after digest lookup.
- 14-day configurable session lifetime, revocation checks, inactive-account rejection, five-minute write throttling for `lastUsedAt`, logout, logout-all, and session revocation on password reset.
- Email verification required before login. Verification and reset tokens have 24-hour and one-hour validity, respectively, single-use atomic consumption, and resend/request cooldowns.
- HttpOnly, host-only cookies with `SameSite=Strict`; Secure in production. Exact-origin checks and exact-origin credentialed CORS protect mutations.
- Account-aware and IP-aware authentication throttles. The backend trusts forwarded IP only through configured Express proxy hops.
- Security logs contain event names/status but never credentials, cookies, or raw tokens. Email token links use URL fragments to keep them out of HTTP request logs.
- The frontend stores no session token and treats `/auth/me` as the source of truth. Route guards are UX only; API authorization remains server-side.
- Google ID tokens are verified against the configured OAuth audience, issuer, signature, and expiry with Google's maintained Node auth library. Provider subjects have a unique database identity; matching email alone never links accounts.
- Email OTPs use cryptographic random generation and a keyed HMAC digest, 5-minute expiry, at most five bad attempts, 60-second resend cooldown, and atomic single-use consumption. A separate `AUTH_OTP_HASH_SECRET` protects the digest; rotating it invalidates pending codes.

## Operational requirements and limitations

1. Apply the reviewed Phase 04 migration manually to the development Neon branch and regenerate Prisma Client.
2. Install and lock `argon2` and `google-auth-library` using the documented workspace command. This change intentionally did not run package installation, so `pnpm-lock.yaml` still needs a lock-only update before frozen installs.
3. Configure `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, and a verified sending domain with the provider's required SPF/DKIM DNS records. Production startup fails if mail credentials are missing. Email API delivery failures are logged without token contents.
4. The in-memory rate limiter is per backend replica and is not distributed. Deploy a shared limiter before scaling horizontally.
5. Auth endpoints are database-backed and are not mounted in local limited mode without `DATABASE_URL` and `DIRECT_URL`. Health/readiness behavior remains available.
6. There is no password-change UI, MFA, login notification, device/session management screen, or complete role authorization in this phase. Organization membership/invitations and tenant permission checks remain future work.

## Incident response

Disable a user by changing `User.status`; session validation rejects non-active users. Revoke a user's sessions by updating `UserSession.revokedAt`. Never copy token or password values into support tickets or audit metadata.
