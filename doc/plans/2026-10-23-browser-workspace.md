# mCrew browser workspace

Approved product direction: an App browser entry with cloud browser and My Chrome, visible device/tab/agent, explicit sharing and immediate stop.

Implementation choice: one short-lived, company/user/agent/task-bound session broker. A Chrome companion shares only the tab selected by the human; a separate cloud worker can use an isolated browser. Neither exports cookies nor exposes a CDP port. The App shows screenshots and navigation controls, not an iframe of arbitrary sites. Agent commands use the authenticated mCrew API and the same ownership checks.

Sessions live only in process memory and expire after two hours; restart revokes pairing. Pairing credentials are random, short-lived, returned once and never logged. Browser results are bounded, transient and never written into the activity log; log only start/stop metadata. One in-flight command per session, no automatic retry of actions. Only the named Agent and creating human may access a session. Agent access additionally requires the run's responsible user to match the sharing human.

Acceptance: pair on a selected tab, view screenshot in App, navigate/click/type through an assigned Agent, switch company without leakage, stop and reject further commands. Synthetic integration tests cover wrong user/company/agent, expiry, pending limits and stop. Actual Chrome installation/sharing remains a human action; never mark paired from configuration alone.

Existing `.71` crew_browser remains independent and isolated. Interactive cloud workers must run under that same company confinement before production enablement. No automatically enabled host browser worker or unsandboxed fallback.

## Verification and release state

- 82 focused server/browser and HTTP log privacy tests pass.
- Five mocked Chrome companion lifecycle tests pass. These are not actual Chrome device acceptance.
- Browser workspace UI lifecycle test, UI typecheck and UI production build pass.
- Server-wide typecheck does not pass in this checkout: runner package declarations are missing and downstream native-runtime errors remain. No full repository test/build success is claimed.
- Token gate reports four violations in the pre-existing attachment reader files. The browser workspace adds no arbitrary bracket values. The earlier attachment work is outside this PR's base diff.
- No database migration or provider credential is included. The lockfile's existing local change is excluded.
- Existing production entry differs from the Git baseline only by relocation of the management import. The browser artifact builder verifies that exact variation and the unchanged logging baselines, then records hashes. It refuses other runtime drift.
- The browser artifact and companion ZIP are built from committed source; build does not activate or install them. Production and device acceptance remain separate gates.

Manual acceptance must include a harmless page, matching company/user/task/Agent, Chrome permission approval, visible screenshot, Agent read/click/type, a company switch, local Stop and server Stop. Do not mark this feature ready for general use before those checks and review.
