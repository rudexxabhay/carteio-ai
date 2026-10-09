# Phase 04 report — Authentication

## Implemented

- Database-backed account identity, Argon2id credentials, opaque sessions, verification and reset tokens; migration SQL prepared and not applied.
- Signup, login, current-user, logout/logout-all, email verification/resend, forgot password, and reset password APIs.
- Resend email adapter, strict origin protection, same-site HttpOnly cookies, in-memory account/IP throttling, safe public user payloads, session cleanup, and password-reset session revocation.
- React auth context and bootstrap, responsive forms for login/signup/recovery/reset/verification, protected dashboard routes, validated internal redirects, navbar account entry, and authenticated dashboard identity/empty organization state.
- Focused backend service tests added. Existing landing behavior is retained; no homepage redesign was made.

## Review status: partially complete, not verified

The development Neon branch was manually checked: neither Phase 04 migration is recorded in `_prisma_migrations`, and none of the six Phase 04 authentication tables exists. History on other databases has not been verified. The migrations are split by dependency: `20261009120000_phase_04_authentication` creates `PasswordCredential`, `UserSession`, `EmailVerificationToken`, and `PasswordResetToken`; `20261009130000_phase_04_google_otp_auth` creates `AuthIdentity` and `EmailOtpChallenge`. The auth endpoints have not been run against Neon; focused tests and TypeScript checks have not completed. The user reports that the Resend domain is verified; confirm private API key and sender settings before delivery. Do not treat this phase as production-ready until the manual steps below and review are complete.

## Manual steps

1. Copy the app examples to private environment files as needed. Google sign-in needs matching `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID` values; email/password and OTP can operate without Google. Email OTP additionally needs a private `AUTH_OTP_HASH_SECRET` of at least 32 bytes. Production also requires database URLs, HTTPS `PUBLIC_APP_URL`, matching exact CORS origins, Resend API key, and verified `AUTH_EMAIL_FROM`. OTP defaults are five minutes, five attempts, and a 60-second resend cooldown.
2. From the repository root run `pnpm install --lockfile-only` to update `pnpm-lock.yaml`, then `pnpm install` to install dependencies. This continuation adds `google-auth-library`; the earlier Phase 04 work added `argon2`. No package command was run for this continuation.
3. Before applying, verify that neither migration has been applied to any other database. If either is already recorded elsewhere, stop and preserve that database's migration checksum/history. After confirming history, review and manually apply the two SQL files in timestamp order to the intended Neon branch. Do not reset the database. Run `pnpm --filter @carteio/backend prisma:generate` after the schema is applied.
4. Confirm `RESEND_API_KEY` and `AUTH_EMAIL_FROM` use the verified Resend domain. Confirm provider acceptance and test verification, reset, and OTP delivery with non-production accounts.
5. Run focused auth and frontend tests, then manually verify signup, verification, login, refresh/session bootstrap, logout, reset, CSRF rejection, mobile layout, and dashboard redirects.

## Known limitations

- No distributed rate limiter; in-memory limits are local to one backend process.
- Email delivery uses Resend as the first adapter; a provider abstraction exists but no other provider is implemented.
- No organization creation or membership authorization API is included. New users have no organization access.
- No database-backed integration test has run and no Neon data was mutated.
