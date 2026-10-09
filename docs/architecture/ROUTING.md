# Routing and SEO plan

## Frontend routes

- `/` landing
- `/features`, `/integrations`, `/how-it-works` product overview foundations
- `/docs`, `/help` documentation and support foundations
- `/login`, `/signup` UI placeholders with no credential processing
- `/dashboard` development-preview shell; no authentication or private data
- `/dashboard/*` dashboard namespace placeholder
- `*` accessible not-found page

React Router owns browser route selection. The Nginx static fallback returns the React entry document for nested page refreshes. API locations are matched first and never use the SPA fallback.

## API routes

NestJS globally prefixes its controllers with `api/v1`. `GET /api/v1/health` reports process availability without checking services that are not installed. Vite forwards the `/api/v1` path unchanged to `http://localhost:5000`. Production Nginx preserves the same prefix, returns API errors from NestJS, and never applies the frontend SPA fallback to API paths.

The readiness contract currently matches liveness because the supported workload has no external dependencies. Add distinct readiness checks only when a real dependency or startup lifecycle makes them useful.

## SEO

The app uses semantic landmarks, one primary heading per page, page titles/descriptions and canonical URLs. `public/robots.txt`, `public/sitemap.xml`, and an SVG favicon establish initial crawl metadata. A client-only SPA does not provide the same crawlability as prerendered HTML. The later landing-page milestone should prerender the appropriate public pages from the Vite build, maintain canonical/description metadata per route, and verify the output with a crawler and Search Console. Auth and dashboard routes should later be excluded from indexing.
