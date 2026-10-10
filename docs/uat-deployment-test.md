# UAT Vercel Git deployment test

This documentation-only commit verifies that Git-triggered Vercel builds for the `uat` branch are skipped by the Ignored Build Step configured on both UAT projects. GitHub Actions deployment remains gated unless the UAT environment variable `UAT_DEPLOY_ENABLED` is explicitly set to `true`.
