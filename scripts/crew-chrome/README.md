# mCrew Chrome Companion

Status: development preview. Chrome device acceptance is pending. The server and UI must be deployed together before pairing can work. The UAT host in this build is a reserved target; its availability must be checked before use.

This extension shares one desktop Chrome tab selected by the human. It sends the tab URL, title and screenshot to the selected mCrew server. A snapshot command also returns visible text and labeled controls. The assigned task Agent can navigate, click, type, press supported keys and scroll. A shared page can contain private data; share only the tab needed for the task.

## Installation and pairing

1. Check the source revision, build number and file hashes in the adjacent build manifest.
2. Unzip the extension into a dedicated folder. Open `chrome://extensions` in desktop Chrome, enable Developer mode, then choose **Load unpacked** and this folder.
3. Review Chrome's debugger permission prompt yourself. The debugger permission is powerful. This extension restricts operations to the single tab you choose; it does not export the browser cookie store.
4. In mCrew, open **瀏覽器**, select a task assigned to an Agent and create a pairing code. The code is valid for five minutes until first contact.
5. Select the website tab in desktop Chrome. Open the companion, select the matching environment, paste the code and press **分享這個分頁**.
6. Confirm the device label, task, Agent, site URL and screenshot in mCrew before asking the Agent to operate.
7. Press **停止分享** in Chrome or **停止控制** in mCrew to revoke control. Chrome's own debugger banner can also disconnect the companion. A command already sent to the page can finish; stopping cannot undo a submitted action.

No passwords, cookies or pairing codes belong in an Agent conversation. Pairing tokens are held only in extension memory. Browser/server restart or two-hour expiry requires a new share. A network failure stops sharing; action commands are not retried. No arbitrary Agent-supplied JavaScript is accepted.

## Agent client

Install `skills/crew-shared-browser/` through the company skill workflow and assign it to the task Agent. Its bundled Python client uses the current run's Paperclip API credential and responsible-user context. The server requires an active run for that exact task. Installation and assignment remain deployment steps; this package alone does not change Agent permissions.

## Build

From the repository root, after committing source:

```sh
node scripts/build-crew-chrome.mjs /absolute/new/output YYYYMMDDNNN uat
```

Use today's Taipei date. UAT serials are odd; production serials are even. The command reads Git source, makes an unpacked directory, ZIP and SHA-256 manifest, and never activates a release.

## Remaining acceptance

- Deploy the server and UI against the verified runtime baseline.
- Install and assign the bundled Agent skill.
- Human installation and explicit tab sharing in actual Chrome.
- An assigned Agent reads, clicks and types on a harmless test page.
- Device screenshot in App, company switching and stop/revocation checks.
- Cloud interactive worker integration under the existing company sandbox. The existing isolated Agent browser is a separate tool and is not a completed live viewer here.
