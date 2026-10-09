# Nginx production templates

`ai.carteio.in.conf.template` serves the single Vite build and proxies `/api/v1/` to a private NestJS upstream. Its upstream intentionally preserves the complete path. `/api/v1` cannot fall through to React HTML. The static fallback supports direct visits and refreshes on nested React Router paths.

Before enabling the TLS server, provision certificates, replace/confirm certificate paths, build and copy `frontend/dist` to `/srv/carteio/frontend`, and make `backend:5000` resolvable only on the private deployment network. The HTTP redirect is a separate template so the operator can enable it after DNS and TLS provisioning. No local Nginx or certificate is needed during development.

Buffering is disabled for future streaming compatibility. Current proxy read/send timeouts are 60 seconds; revise them with the streaming protocol and heartbeat behavior before supporting long-lived AI responses. Revisit body limits, rate limits, cache policy, real IP trust, and CSP with the relevant production deployment. Restrict firewall ingress to HTTPS and keep NestJS inaccessible from the public network.

`index.html` receives no immutable cache header; hashed files under `/assets/` are cached as immutable. Confirm the Vite output uses content-hashed asset names before deployment. Validate the rendered configuration with `nginx -t` on the target host after substituting the actual upstream and certificate paths. The templates are not a complete deployment by themselves.
