# Initialize organization background configuration

Some plugins use a local folder and scheduled jobs but do not declare an
`instanceConfigSchema` or a custom settings page. Their folder path and their
organization configuration are separate records. The folder can work during a
user request while a scheduled job still lacks proactive organization scope.

## Operator steps

1. Select the organization that must use the plugin.
2. Open **Settings → Plugins**, then the plugin's settings page.
3. In **Background configuration**, check the selected organization name.
4. As an instance administrator, select **Initialize background configuration**.
5. Confirm that the page says the configuration is saved.
6. Use the **Status** tab to verify that scheduled jobs run and produce the
   expected result. A saved configuration is not proof that a job succeeded.

The background section appears for plugins with local folders and scheduled jobs
that have no regular configuration form or custom settings page. The existing
managed-environment policy still controls whether local-folder settings are
available. Plugins with a schema keep their normal configuration form.

In Traditional Chinese, the action is **初始化此工作區的外掛背景設定**.

## What initialization changes

Initialization creates an empty `plugin_config` row for the selected
plugin/organization pair only when no row exists. The insert is atomic. If another
operator has already saved values, initialization returns that row without
changing its values or timestamps.

It does not change folder paths, replace saved options, or synchronize secret
references from an empty payload. It uses the same instance-admin authorization,
company checks, audit logging, proactive-scope refresh and worker notification as
the normal configuration API. Worker notification uses the stored configuration,
not an empty replacement. Declared plugin capabilities do not change.

## API

`POST /api/plugins/:pluginId/config/initialize`

```json
{
  "companyId": "<organization UUID>"
}
```

The response is the persisted `PluginConfig` record. This route always uses
create-only behavior. It rejects non-empty `configJson` input rather than treating
initialization as a replacement write.

The existing `POST /api/plugins/:pluginId/config` API also accepts an optional
`initializeOnly: true` with an empty `configJson`. Normal saves are unchanged. The
UI uses the distinct initialization URL so an older server returns 404 instead of
ignoring a new flag and replacing existing values.

Non-admin humans and agents receive 403. A failed configuration read prevents the
UI from sending initialization. A failed save displays an error, not a success
state. Pending initialization disables repeated clicks. Switching organizations
does not apply the previous organization's save result to the new selection.

## Verification

The component tests cover missing and existing configuration, read failure,
permission refusal, loading, duplicate clicks, organization selection and
organization changes during a save. Route tests cover instance-admin checks,
preserving secret references and worker scope updates. Embedded PostgreSQL tests
cover concurrent initialization and preservation of existing values and timestamps.

These tests do not establish that a plugin's scheduled work is correct. Test that
separately with the real worker RPC boundary and the real scheduler.
