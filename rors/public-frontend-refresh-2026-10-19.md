# Public frontend refresh

## Scope

- Reworked the public landing opening to use the supplied reference's clean white grid, centered hero, compact announcement pill, paired calls to action, and browser-style product preview.
- Kept the existing React/Vite application, API contracts, authentication flows, and protected routes intact.
- Removed the public-header theme selector so the public experience stays consistently light; theme selection remains available where it is used in the authenticated application.

## Validation

- `pnpm --filter @carteio/frontend build` completed successfully (TypeScript check and Vite production build).
- The landing route was inspected at 1440px desktop and 390px mobile. The mobile document width matched the viewport (`375px` effective client width; `375px` scroll width), with no horizontal overflow.
- The login route was inspected at the mobile breakpoint after lazy loading. The real password, Google, and OTP UI rendered and the document remained free of horizontal overflow (`390px` scroll/client width).
- The resulting lazy landing bundle is `16,315` bytes of JavaScript and `34,444` bytes of route CSS before transport compression. Dashboard modules remain independently split into route chunks.

## Notes

- The workspace preview is deliberately labelled and constructed as an illustrative static preview. It is not presented as a live dashboard control surface.
- No public assets or source files were deleted because the worktree contains extensive uncommitted work outside this redesign. Avoiding deletion preserves unrelated in-progress changes.
