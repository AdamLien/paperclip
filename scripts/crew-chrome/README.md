# mCrew Chrome Companion

Use only the company-provided package. Browser control remains limited to one task/Agent-bound tab, with a two-hour maximum. No cookie export, public CDP port, stored browser password or persistent pairing credential.

## Daily use

1. Install/update the companion, then reload mCrew in the **same Chrome profile**.
2. Sign in normally. Open mCrew **瀏覽器**, select the task, and click **啟動 Agent 分頁**. The extension creates a dedicated `https://example.com` tab and mCrew passes the short-lived task credential automatically. The Agent can then navigate that tab.
3. For an existing tab, click the companion **將此分頁交給 Agent**. It opens mCrew; select the task and click **交接選定分頁**. Only that explicitly selected tab can be handed over, once.
4. Stop from mCrew, the companion, or the assigned Agent's `stop` client command. The server capability is revoked. A command already dispatched can finish; stopping cannot undo submitted actions.

The bridge is injected only into the two allowlisted mCrew HTTPS origins and rejects iframe/untrusted senders. Normal mCrew login and company/task authorization remain required. Tabs are not automatically shared simply because the extension is installed. Native mobile Apps and other browsers without the companion do not have this local bridge; manual pairing remains a fallback in collapsed settings.

A snapshot includes visible text, labels, safe editable values and checked states. Password/card/OTP values are omitted. Tab contents/screenshots may contain sensitive data: share only pages needed for the authorized task. The debugger banner shows ongoing Chrome access.
