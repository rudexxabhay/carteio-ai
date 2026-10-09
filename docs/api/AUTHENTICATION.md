# Authentication API

Base path: `/api/v1/auth`. JSON requests use same-origin credentials and require the exact allowed browser `Origin` on state-changing routes. Cookie authentication uses `HttpOnly`; clients must not attempt to read or persist it.

## Requests

- `POST /signup`: `{ "name": "Full name", "email": "person@example.com", "password": "at least 12 characters" }`
- `POST /login`: `{ "email": "person@example.com", "password": "..." }`; successful response sets the session cookie and returns `{ "user": { "id", "name", "email", "emailVerified", "status" } }`.
- `POST /google`: `{ "credential": "Google ID token" }`; verifies the token server-side and sets the existing session cookie. It does not merge an existing account by email.
- `POST /google/link`: `{ "credential": "Google ID token" }`; requires a current session and a verified Google email equal to the signed-in account email.
- `POST /otp/request`: `{ "email": "person@example.com" }`; requests a six-digit code. The response is generic; `deliveryAccepted` is true only after Resend accepts the request, and an accepted request includes `challengeId`.
- `POST /otp/verify`: `{ "email": "person@example.com", "challengeId": "UUID", "code": "123456" }`; consumes the code once, sets the existing session cookie, and returns the public user.
- `GET /me`: returns `{ "user": ... }`; requires a valid session.
- `POST /logout`, `POST /logout-all`: revoke the current session or all sessions for the current user.
- `POST /verify-email`, `POST /reset-password`: `{ "token": "..." }`; reset also takes `password`.
- `POST /resend-verification`, `POST /forgot-password`: `{ "email": "person@example.com" }`.

Errors follow the shared API error envelope with safe messages. Login credentials use a generic failure. Google sign-in requires `GOOGLE_CLIENT_ID`; no client secret is used. OTP codes expire after five minutes by default, allow five invalid attempts, and have a 60-second resend cooldown. OTP also requires a private `AUTH_OTP_HASH_SECRET` of at least 32 bytes. Signup and OTP delivery require a configured email provider. Password recovery returns a generic response to avoid account enumeration; the response's `deliveryAvailable` flag reflects provider configuration, not per-address delivery confirmation.
