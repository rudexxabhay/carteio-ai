# Local `.env` template sync — 2026-11-03

Copied the structure and all 64 active variable names from `backend/.env.example` into ignored local `backend/.env`; all values for those variables were left blank at the user's request. No variables were missing and no example-derived values remained nonblank (read-only structural check exit 0). No tests were run because this was a configuration-file change. A private pre-edit copy was placed in `/tmp/carteio-env-checkpoints/`.

The filesystem reports mode `0777` for `backend/.env` after a chmod request, so this mounted workspace does not appear to honor POSIX file permissions. The values are currently blank. Before entering credentials, ensure the Windows/host ACL restricts access to this file.

Required local values called out in `.env`: `DATABASE_URL`, `DIRECT_URL`, `AUTH_OTP_HASH_SECRET` (at least 32 random bytes), `PUBLIC_APP_URL`, and `AI_DEFAULT_PROVIDER` plus the matching provider API key/model. Fill the email sender/key if using email OTP. Feature-specific optional integration values may remain blank when those features are unused.
