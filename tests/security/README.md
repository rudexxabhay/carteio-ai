# Security verification notes

Automated backend coverage includes health contract, safe unknown-route behavior, and invalid environment configuration. Frontend tests cover route navigation, dashboard API success/failure/manual retry, mobile menu behavior, and unknown routes. CI runs these with typecheck/lint/build.

Manual deployment checks (run only after Nginx is provisioned):

1. `nginx -t` against the rendered deployment configuration.
2. Confirm a nested frontend URL refresh serves the React app.
3. Confirm `/api/v1/health` returns JSON and a missing API route returns JSON 404, never `text/html`.
4. Confirm browser requests from the approved origin work and an unapproved origin receives no permissive CORS response.
5. Confirm the NestJS port is unreachable from the public network and required security headers are present over HTTPS.
6. Confirm logs contain request IDs without secrets, authorization values, or request bodies.

Nginx is not assumed available in Phase 01 and none of these manual checks are claimed as run.
