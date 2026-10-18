---
title: Native push devices
summary: Authenticated device registration and task-complete notifications
---

Native Crew clients opt in by registering an FCM token for the signed-in board user.
The server never accepts a client supplied user id and never returns the token.

`GET /api/companies/{companyId}/push-devices` returns the current user's active
device metadata. `POST` to the same path accepts:

```json
{
  "installationId": "uuid",
  "token": "fcm-token",
  "platform": "ios",
  "appId": "work.metabiz.crew.uat",
  "environment": "uat"
}
```

Logout should call `DELETE /api/push-devices/{installationId}`. A company scoped
variant is also available at `DELETE /api/companies/{companyId}/push-devices/{installationId}`.
Registration requires active company membership. Re-registering an installation
atomically rotates its owner/token, so an account switch cannot leave the prior
user opted in on that installation.

Only a real `issue.updated` transition whose activity details contain
`status: "done"` and `_previous.status !== "done"` creates a durable notification
event. Delivery is deduplicated per completion event and device, retried with a
bounded backoff, and invalid FCM registrations are revoked. Devices registered
after completion do not receive historical notifications.

FCM is disabled unless both `PAPERCLIP_FCM_PROJECT_ID` (must equal `metabiz`)
and `PAPERCLIP_FCM_SERVICE_ACCOUNT_PATH` are configured. The service-account file
must remain outside the repository and is read only by the server process.

The worker delivers only to the activity's resolved `responsibleUserId`, after
rechecking the active company, membership, device owner, and device binding
generation. FCM `UNREGISTERED` responses revoke a device; other 400 responses
remain retryable because malformed payloads do not prove that the token is dead.
The outbox is at-least-once: a process crash after FCM accepts a message and
before the local receipt is committed can produce a duplicate notification.
