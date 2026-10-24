# mOrbit login welcome

## Scope

Replace the self-hosted sign-in page ASCII panel with the approved mOrbit copy.
Use the existing metabiz gold logo and red Deck label for the app identity.
The Web page is shared with the Electron client; no second login is added.
Cloud redirects, session recovery, password-manager fields and form submission
continue to use the existing authentication path.

## Presentation

- Desktop: form on the left, brand copy on the right.
- Mobile: brand copy above the form in one scrollable view.
- Four text blocks fade and rise once. The last block finishes after 1.35 seconds.
- Text remains visible after the sequence. The form never waits for animation.
- Reduced motion: all text appears immediately without motion.
- Visual values live in `ui/src/index.css`; component styles consume tokens.

## Local validation

- Auth tests: 11 passed, including existing cloud recovery and form coverage.
- Vite production build passed. Existing chunk/CSS warnings remain.
- Token gates passed.
- UI typecheck is blocked by an existing workspace dependency resolution gap:
  `packages/plugins/sdk/src/ui/components.ts` cannot resolve React typings in
  this isolated checkout. No plugin SDK or dependency files were changed.
- Headless Chrome against the built frontend: 1440×960 dark, 390×844 light,
  and 1440×960 light with reduced motion. Copy, no horizontal overflow,
  final opacity, reduced-motion rule and synthetic failed-sign-in feedback passed.
- API responses were synthetic. No real account or production API was used.
- The Vite dev entry failed to load with shared worktree dependencies; browser
  checks used the built frontend instead.

## Promotion

Feature branch → develop → UAT. This change does not deploy the server or
release a new Electron installer. Real UAT and device acceptance remain pending.
The whole-monorepo test, typecheck and build matrix is not part of this scoped
local UI check; CI and release validation remain required before merge.

## 2026-10-24 name consistency correction

Adam clarified that the product he opens must consistently say **mDeck**.
Use mDeck in the welcome headline, accessible panel name, static page title,
startup notices, installed Web-app name and breadcrumb page titles. mOrbit
remains the suite/repository name. Technical identifiers, storage keys, app IDs,
URLs and upstream attribution are not renamed.

Read-only runtime investigation found that the existing UAT and production
hostnames point to one service. That service runs an installed package outside
a Git checkout. No live deployment was performed or claimed. Updating one
hostname would also update the other; a separate release plan is required.
