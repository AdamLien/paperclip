# mCrew browser workspace

Approved product direction: an App browser entry with cloud browser and My Chrome, visible device/tab/agent, explicit sharing and immediate stop.

Implementation choice: one short-lived, company/user/agent/task-bound session broker. A Chrome companion shares only the tab selected by the human; a separate cloud worker can use an isolated browser. Neither exports cookies nor exposes a CDP port. The App shows screenshots and navigation controls, not an iframe of arbitrary sites. Agent commands use the authenticated mCrew API and the same ownership checks.

Sessions live only in process memory and expire after two hours; restart revokes pairing. Pairing credentials are random, short-lived, returned once and never logged. Browser results are bounded, transient and never written into the activity log; log only start/stop metadata. One in-flight command per session, no automatic retry of actions. Only the named Agent and creating human may access a session. Agent access additionally requires the run's responsible user to match the sharing human.

Acceptance: pair on a selected tab, view screenshot in App, navigate/click/type through an assigned Agent, switch company without leakage, stop and reject further commands. Synthetic integration tests cover wrong user/company/agent, expiry, pending limits and stop. Actual Chrome installation/sharing remains a human action; never mark paired from configuration alone.

Existing `.71` crew_browser remains independent and isolated. Interactive cloud workers must run under that same company confinement before production enablement. No automatically enabled host browser worker or unsandboxed fallback.

## Verification and release state

- 82 focused server/browser and HTTP log privacy tests pass.
- Five mocked Chrome companion lifecycle tests pass. These are not actual Chrome device acceptance.
- 17 browser workspace and company-route UI tests pass. UI typecheck and UI production build pass.
- Server-wide typecheck does not pass in this checkout: runner package declarations are missing and downstream native-runtime errors remain. No full repository test/build success is claimed.
- Token gate reports four violations in the pre-existing attachment reader files. The browser workspace adds no arbitrary bracket values. The earlier attachment work is outside this PR's base diff.
- No database migration or provider credential is included. The lockfile's existing local change is excluded.
- Existing production entry differs from the Git baseline only by relocation of the management import. The browser artifact builder verifies that exact variation and the unchanged logging baselines, then records hashes. It refuses other runtime drift.
- The browser artifact and companion ZIP are built from committed source; build does not activate or install them. Production and device acceptance remain separate gates.

Manual acceptance must include a harmless page, matching company/user/task/Agent, Chrome permission approval, visible screenshot, Agent read/click/type, a company switch, local Stop and server Stop. Do not mark this feature ready for general use before those checks and review.

## Production receipt — 2026-10-23

Production build `20261023010` was built from Git commit `a3cbc9e01af9b8d23ad19ec4e00c6f50dee00446`, staged independently, and activated using the existing versioned server binding. Hashes and baseline validation passed. Local health and the authenticated public Browser page were verified separately; the sidebar preserves the company URL prefix. Previous release `20261023008` remains available for rollback. Server-side anonymous requests to the public health URL returned an edge 403; they were not used as the service-health gate.

The Git-built `crew-shared-browser` package was imported through the native company skill UI and assigned to all seven existing Agents. The UI confirmed seven assignments. Assignment is configuration evidence, not proof of an Agent operating Chrome.

The desktop companion `20261023010` was subsequently installed by the human. The assigned Agent typed a test string and checked a checkbox on a public Selenium fixture; independent Chrome accessibility state confirmed both. The owner revoked the session, and the Agent confirmed it disappeared. That version did not return form values in snapshots and the Agent could not revoke its own session; both limitations are addressed below. The cloud interactive viewer remains disabled. This draft is not ready for general release or merge.


## No-code daily launch — 2026-10-23

Requested and approved in this conversation: install/sign in once, start a dedicated Agent tab from mCrew without copying a pairing code, and hand over an existing tab through the companion. Keep explicit task selection and immediate Stop. Implementation stays with the existing session broker; no new database or persistent bearer credential.

The allowlisted mCrew origin gets a top-frame-only content-script bridge. Normal board session authentication creates the same company/user/Agent/task-scoped ephemeral capability. The bridge passes that credential directly to the worker; it is never put in a URL or stored. Dedicated launch creates a new harmless HTTPS tab; existing-tab handoff requires popup selection, then an explicit task/start click on the App. Mobile/webviews without the desktop bridge retain manual fallback. This is desktop Chrome integration, not remote mobile device discovery.

Agent snapshots now return labels, safe form values and checkbox/radio state, omitting password/card/OTP values. The assigned active-task Agent may revoke its own session; other Agents/tasks cannot. Companion Stop also revokes the server capability. Skills instruct Agents to stop when work completes.

Acceptance gates: bridge sender correlation/origin/frame checks; no arbitrary existing-tab IDs; correct environment; failed-start session rollback; Agent stop isolation; actual updated Chrome extension and Git-built server read/click/type/readback/stop. Automated checks do not replace the updated-extension device gate.

## Automatic-launch server receipt — 2026-10-23

Production server build `20261023012`, source `487fac6a9a32de13ad62a85d7fb36d7815482700`, was staged with artifact SHA-256 `8e3927577edb20d4861bbf5c7422c4e7cbbf566f1b7565ede9df8f9ab916b1a7`. Baseline and staged hashes passed; the active versioned binding was switched and service health passed. Every static asset referenced by the served index matches the release artifact. The pre-existing health endpoint reports its older base commit; the overlay revision is recorded in `deployment.json`, so that health field is not evidence of this overlay's source revision. Previous server `20261023010` and the previous company skill directory remain available for rollback. The company skill now points to the Git-built versioned package, preserving assignments.

The updated extension's handshake succeeded in actual Chrome. Build `20261023012` then timed out starting a new background tab: fresh tabs do not have the popup-granted `activeTab` metadata access. Extension build `20261023014`, source `df13f6a14f24ed333d808594bad5b33782f2f00c`, validates the created tab through its scoped debugger attachment instead; no global tabs/all-site permission was added. Eleven companion/bridge tests cover this missing-URL case and safe form readback; nineteen focused server/UI tests and UI typecheck pass. Updated-extension end-to-end acceptance is pending.
