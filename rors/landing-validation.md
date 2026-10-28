# CARTEIO AI Landing Page Fidelity Pass

Date: 2026-10-18 (UTC)

## Scope

This pass is limited to the public landing page. The existing worktree already contains the replacement landing page and its styles; this pass changed the hero headline and supporting sentence only. No other application areas or shared authentication/backend logic were edited.

## Reference evidence

- The live Flowise page was independently rediscovered through REA at `https://flowiseai.com/` (target `FAC3B401DA772B41FB0F7008F40F972A`).
- Fresh desktop viewport capture: 1920×794, Evidence `ev_5dda617d2d2b1af439d1ff1c8726e3fe0c34d02fc04936e2e0852c31ff912758`, PNG SHA-256 `c2bbf4775d3f2287aeb7a95457899a8d3ad8df11547eb374855dcf65f3c6d0f0`.
- Existing [live Flowise audit](live-flowise-audit.md) includes accessibility inventory and a 390×844 screenshot scenario (Evidence `ev_7d29f1011f78d4640d76f78391e947a2c66a08839dd9d91caada884eeab0b492`). It reported cropped mobile content; this is treated as a limitation to learn from, not as a layout behavior to reproduce.

The current desktop reference capture shows a temporary sunset announcement strip; that time-sensitive message is not appropriate for Carteio branding. The stable composition is a dark header, large centered one-line headline with purple/blue gradient emphasis, short supporting line, two pill-shaped actions, and a wide framed workflow editor preview. The screenshot does not establish lower-page visual details or hover behavior.

## Implementation

- Updated the hero headline to `Build AI Agents Visually`, preserving the gradient accent on “Visually”. Removing the hard-coded line break lets desktop widths keep the headline on one line and lets smaller viewports wrap it naturally.
- Shortened the hero description to one line or two at common desktop widths and made the Carteio brand explicit.
- Existing page structure below the hero includes workflow capabilities, an illustrated four-step flow, business use cases, supported systems, resources, a final signup call to action, and the footer. The current landing page does not present the Flowise customer story, pricing, community-post, webinar, or enterprise sections; adding those requires real Carteio content and product decisions and was not invented in this visual-only pass.

## Validation status

| Viewport | Flowise reference | Carteio render | Status |
|---|---|---|---|
| Desktop 1920×794 | REA screenshot captured | Not captured | Blocked: parent reports Vite cannot start because installed dependencies lack `@rollup/rollup-linux-x64-gnu@4.64.2`; no local target was available for this pass. |
| Tablet | Not independently captured in this pass | Not captured | Pending runtime. |
| Mobile 390×844 | Prior REA scenario exists, but reference capture was clipped | Not captured | Pending runtime; Carteio responsive behavior remains unverified. |

Static diff whitespace validation (`git diff --check` for `frontend/src/pages/landing/LandingPage.tsx`) passed. No build, tests, server, or performance measurement was run in this pass. No claim of visual parity is made. Once the dependency blocker is resolved and the app is reachable, capture matched desktop/tablet/mobile viewports, compare the hero and full-page section rhythm, and adjust spacing and clipping from rendered evidence.

## Remaining visual gaps

- The current Carteio hero illustration uses three static cards, while the reference presents a denser editor preview with its toolbar and node palette. Keep it clearly identified as an illustration unless it is wired to the actual builder.
- No matching announcement is used because the reference’s current message is time-sensitive. The Carteio header still has its own navigation and authentication actions.
- No screenshot comparison or performance result exists for Carteio while its local app is unreachable.
