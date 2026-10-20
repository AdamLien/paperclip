# metabiz push deployment preparation

This runbook prepares a stage-only release for the installed npm Paperclip runtime on `metabiz-71-tailscale`. It does not SSH, stop Paperclip, run migrations, change `node_modules/@paperclipai/*`, or activate a release. The operator performs those actions only after review, backup, and acceptance.

## Prepare the release

Run from the pulled, committed source checkout on the host:

```sh
node scripts/metabiz-deploy-push.mjs \
  --revision <push-commit> \
  --base 90bca334 \
  --runtime /home/metabiz-admin/Documents/workspace/metabiz/paperclip-local
```

The script archives exactly `<push-commit>`. Within `server/`, `packages/db/`, and `packages/shared/`, production changes must be exact members of the compile or migration source lists; only `*.test.ts` files are additionally allowed. `ui/`, `tests/`, `doc/`, and `docs/` changes are allowed because this stage does not overlay UI or documentation. Other root paths are refused. It copies the installed `server`, `db`, and `shared` packages into a new `releases/push-<sha>` directory, and compiles only the selected server/schema/shared files with the source checkout's esbuild. Existing runtime patches remain in the copied package files. It copies only migration `0306_persistent_push_notifications.sql` and the migration journal from the source snapshot.

The output JSON and `metabiz-push-release.json` are the review record. The manifest retains both the exact resolved base commit and the literal `--base` argument passed by the parent deployment operator. Confirm the release directory is complete before any activation work. The UI release is a separate parent/backend/UI-agent responsibility and is deliberately not built here.

The script resolves each installed package through `realpath` before copying, so a package symlink cannot make the stage operation write through to a live release. It clones each package's package-local `node_modules` from its realpath with nested symlinks dereferenced, preserving dependencies such as `acpx`; it then replaces only staged `@paperclipai/db` and `@paperclipai/shared` bindings. The staged package root has a fallback symlink to the runtime's existing `node_modules`; isolated bindings point `server` to the staged `db` and `shared`, and point `db` to the staged `shared`. It hashes `server/dist/services/heartbeat.js` and `server/dist/routes/agents.js` before and after staging and fails if either preserved runtime patch changes. Finally, it imports staged `server/dist/app.js`, `db/dist/schema/index.js`, and `shared/dist/index.js` in a child Node process without starting the server.

## Required gates before activation

1. Confirm the source revision, base diff, generated manifest, and package copies.
2. Confirm the existing runtime patches under `root/patches/` remain present in the installed runtime and are represented in the copied package files.
3. Run the backend/API and push acceptance checks against the staged release.
4. Take and verify the operator's existing database backup procedure. This script intentionally does not guess a backup API or implement rollback SQL.
5. Confirm no agent run is active and coordinate the service stop with the parent deployment operator.
6. Activate using the existing service procedure, preserving the current release for rollback. Apply the migration through the existing Paperclip migration procedure; never hand-edit, drop, or roll back the push tables with ad hoc SQL.
7. Verify health, agent heartbeat behavior, push-device registration, notification delivery, and rollback readiness separately from the stage result.

## Push configuration

FCM credentials and related external-provider environment values must remain in the existing runtime secret/environment mechanism. Do not put service-account JSON, private keys, device tokens, or customer data in Git, the release manifest, or this document. The activation operator must verify the exact environment variable names from the merged backend implementation and the host's existing secret configuration before starting the staged release.


## Native app registration and acceptance

The installed iOS/Android app requests notification permission after the first authenticated login with a selected company. FCM supplies the device token; iOS delivery uses FCM to APNs. Browser/PWA sessions do not register native tokens. Returning to the app retries a failed registration or reconciles a permission change. A manual opt-out is remembered per user on that installation and can be reversed in the account menu. Both standard and production layouts expose the controls.

Registration is tied to the authenticated user, company, installation and native app ID. Logout revokes the server binding before clearing the native token. Switching user/company revokes the old binding before registering the new one; a changed login session prevents token registration under a stale user identity.

The current backend queues real task transitions into `done` for the responsible user and sends only to that user's active company registrations. It does not forward every inbox entry, replay historical completion events to newly registered installations, or broadcast to all company members. Review requests and other inbox categories require their own recipient/event contract before they are added.

Acceptance: install the native app, sign in, allow notifications, then confirm device metadata is registered without exposing the token. Complete a newly created test task owned by that user, verify the delivery record and physical receipt, and tap the notification to confirm company-scoped navigation. Verify denial, manual opt-out and logout suppress delivery. A successful web build or provider response alone does not establish physical receipt.
