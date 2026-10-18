import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, gte, isNull, lte, lt, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyMemberships, companies, pushCompletionEvents, pushDevices, pushNotificationDeliveries } from "@paperclipai/db";
import type { PushDeviceRegistration } from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { logger } from "../middleware/logger.js";

const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 15 * 60 * 1000;

export function deliveryRetryDelay(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.min(Math.max(attempts, 0), 10)));
}

export function isInvalidFcmResponse(status: number, body: unknown): boolean {
  if (status !== 400 && status !== 404) return false;
  if (!body || typeof body !== "object") return false;
  const error = (body as { error?: { details?: Array<{ errorCode?: unknown }> } }).error;
  return error?.details?.some((detail) => detail.errorCode === "UNREGISTERED") === true;
}

export type PushDeviceMetadata = Omit<typeof pushDevices.$inferSelect, "token">;

export function isIssueCompletionActivity(details: unknown): boolean {
  if (!details || typeof details !== "object") return false;
  const value = details as Record<string, unknown>;
  const previous = value._previous;
  const previousStatus = previous && typeof previous === "object"
    ? (previous as Record<string, unknown>).status
    : undefined;
  return value.status === "done" &&
    typeof previousStatus === "string" && previousStatus !== "done";
}

export function toPushDeviceMetadata(row: typeof pushDevices.$inferSelect): PushDeviceMetadata {
  const { token: _token, ...safe } = row;
  return safe;
}

type ServiceAccount = { project_id?: string; client_email?: string; private_key?: string };

async function readFcmAccessToken(): Promise<{ projectId: string; accessToken: string } | null> {
  const path = process.env.PAPERCLIP_FCM_SERVICE_ACCOUNT_PATH;
  const configuredProject = process.env.PAPERCLIP_FCM_PROJECT_ID;
  if (!path || configuredProject !== "metabiz") return null;
  let account: ServiceAccount;
  try {
    account = JSON.parse(await readFile(path, "utf8")) as ServiceAccount;
  } catch {
    throw new Error("FCM service account could not be read");
  }
  if (!account.client_email || !account.private_key || account.project_id !== configuredProject) throw new Error("FCM service account is invalid");
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const claim = encode({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const assertion = `${header}.${claim}.${signer.sign(account.private_key, "base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error("FCM OAuth token request failed");
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("FCM OAuth response did not contain an access token");
  return { projectId: configuredProject, accessToken: body.access_token };
}

async function sendFcm(device: typeof pushDevices.$inferSelect, event: { eventId: string; issueId: string; companyId: string }) {
  const auth = await readFcmAccessToken();
  if (!auth) return { kind: "disabled" as const };
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(auth.projectId)}/messages:send`, {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: {
      authorization: `Bearer ${auth.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: device.token,
        notification: { title: "任務已完成", body: "Crew 任務已完成，點擊查看結果。" },
        data: {
          eventId: event.eventId,
          companyId: event.companyId,
          issueId: event.issueId,
          navigation: `/companies/${event.companyId}/issues/${event.issueId}`,
        },
      },
    }),
  });
  if (response.ok) return { kind: "sent" as const };
  const body = await response.json().catch(() => null) as unknown;
  if (isInvalidFcmResponse(response.status, body)) return { kind: "invalid" as const, error: "FCM token is unregistered" };
  return { kind: "retry" as const, error: `FCM request failed (${response.status})` };
}

type PushSendResult =
  | { kind: "disabled" }
  | { kind: "sent" }
  | { kind: "invalid"; error: string }
  | { kind: "retry"; error: string };

export function pushNotificationService(db: Db, options: { send?: (device: typeof pushDevices.$inferSelect, event: { eventId: string; issueId: string; companyId: string }) => Promise<PushSendResult> } = {}) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const fcmConfigured = () => Boolean(process.env.PAPERCLIP_FCM_SERVICE_ACCOUNT_PATH && process.env.PAPERCLIP_FCM_PROJECT_ID === "metabiz");
  const runWorker = () => void processPending().catch(() => {
    logger.warn({ service: "push-notifications", operation: "worker_tick" }, "push notification worker tick failed");
  });
  const assertActiveMembership = async (companyId: string, userId: string) => {
    const membership = await db.select({ companyId: companyMemberships.companyId })
      .from(companyMemberships)
      .innerJoin(companies, and(eq(companies.id, companyMemberships.companyId), eq(companies.status, "active")))
      .where(and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId),
        eq(companyMemberships.status, "active"),
      )).then((rows) => rows[0] ?? null);
    if (!membership) throw forbidden("Active company membership required");
  };

  const processPending = async () => {
    if (running) return;
    if (!fcmConfigured()) return;
    running = true;
    try {
      const now = new Date();
      await db.update(pushNotificationDeliveries).set({ status: "failed", leaseUntil: null, lastError: "retry limit reached", updatedAt: now }).where(and(
        eq(pushNotificationDeliveries.status, "processing"),
        lt(pushNotificationDeliveries.leaseUntil, now),
        gte(pushNotificationDeliveries.attempts, MAX_ATTEMPTS),
      ));
      const events = await db.select().from(pushCompletionEvents)
        .where(eq(pushCompletionEvents.status, "pending"))
        .orderBy(pushCompletionEvents.createdAt)
        .limit(50);
      for (const event of events) {
        const devices = await db.select().from(pushDevices).where(and(
          eq(pushDevices.companyId, event.companyId),
          eq(pushDevices.userId, event.recipientUserId),
          isNull(pushDevices.revokedAt),
          lte(pushDevices.createdAt, event.createdAt),
        ));
        for (const device of devices) {
          await db.insert(pushNotificationDeliveries).values({ eventId: event.id, deviceId: device.id, deviceBindingGeneration: device.bindingGeneration }).onConflictDoNothing();
        }
        await db.update(pushCompletionEvents).set({ status: "processed", processedAt: now }).where(eq(pushCompletionEvents.id, event.id));
      }

      const deliveries = await db.select({ delivery: pushNotificationDeliveries, device: pushDevices, event: pushCompletionEvents })
        .from(pushNotificationDeliveries)
        .innerJoin(pushDevices, eq(pushDevices.id, pushNotificationDeliveries.deviceId))
        .innerJoin(pushCompletionEvents, eq(pushCompletionEvents.id, pushNotificationDeliveries.eventId))
        .innerJoin(companies, and(eq(companies.id, pushCompletionEvents.companyId), eq(companies.status, "active")))
        .innerJoin(companyMemberships, and(
          eq(companyMemberships.companyId, pushCompletionEvents.companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, pushCompletionEvents.recipientUserId),
          eq(companyMemberships.status, "active"),
        ))
        .where(and(
          or(eq(pushNotificationDeliveries.status, "pending"), and(eq(pushNotificationDeliveries.status, "processing"), lt(pushNotificationDeliveries.leaseUntil, now))),
          lte(pushNotificationDeliveries.nextAttemptAt, now),
          lt(pushNotificationDeliveries.attempts, MAX_ATTEMPTS),
          eq(pushDevices.userId, pushCompletionEvents.recipientUserId),
          eq(pushNotificationDeliveries.deviceBindingGeneration, pushDevices.bindingGeneration),
          isNull(pushDevices.revokedAt),
        )).limit(50);
      for (const row of deliveries) {
        const claimed = await db.update(pushNotificationDeliveries).set({
          status: "processing",
          attempts: sql`${pushNotificationDeliveries.attempts} + 1`,
          leaseUntil: new Date(Date.now() + 60_000),
          updatedAt: new Date(),
        }).where(and(eq(pushNotificationDeliveries.id, row.delivery.id), or(eq(pushNotificationDeliveries.status, "pending"), and(eq(pushNotificationDeliveries.status, "processing"), lt(pushNotificationDeliveries.leaseUntil, now))))).returning({ id: pushNotificationDeliveries.id });
        if (!claimed[0]) continue;
        const fresh = await db.select({ device: pushDevices })
          .from(pushDevices)
          .innerJoin(companies, and(eq(companies.id, row.event.companyId), eq(companies.status, "active")))
          .innerJoin(companyMemberships, and(
            eq(companyMemberships.companyId, row.event.companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, row.event.recipientUserId),
            eq(companyMemberships.status, "active"),
          ))
          .where(and(
            eq(pushDevices.id, row.device.id),
            eq(pushDevices.companyId, row.event.companyId),
            eq(pushDevices.userId, row.event.recipientUserId),
            eq(pushDevices.bindingGeneration, row.delivery.deviceBindingGeneration),
            isNull(pushDevices.revokedAt),
          )).then((rows) => rows[0]?.device ?? null);
        if (!fresh) {
          await db.update(pushNotificationDeliveries).set({ status: "failed", leaseUntil: null, lastError: "recipient binding changed", updatedAt: new Date() }).where(eq(pushNotificationDeliveries.id, row.delivery.id));
          continue;
        }
        let result: Awaited<ReturnType<typeof sendFcm>>;
        try {
          result = await (options.send ?? sendFcm)(fresh, { eventId: row.event.id, issueId: row.event.issueId, companyId: row.event.companyId });
        } catch {
          result = { kind: "retry", error: "FCM request failed" };
        }
        if (result.kind === "disabled") {
          await db.update(pushNotificationDeliveries).set({ status: "failed", leaseUntil: null, lastError: "FCM disabled: credentials unavailable", updatedAt: new Date() }).where(eq(pushNotificationDeliveries.id, row.delivery.id));
        } else if (result.kind === "sent") {
          await db.update(pushNotificationDeliveries).set({ status: "sent", leaseUntil: null, sentAt: new Date(), updatedAt: new Date(), lastError: null }).where(eq(pushNotificationDeliveries.id, row.delivery.id));
        } else if (result.kind === "invalid") {
          await db.update(pushDevices).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(pushDevices.id, fresh.id));
          await db.update(pushNotificationDeliveries).set({ status: "failed", leaseUntil: null, lastError: result.error, updatedAt: new Date() }).where(eq(pushNotificationDeliveries.id, row.delivery.id));
        } else {
          const attempts = row.delivery.attempts + 1;
          const delay = deliveryRetryDelay(attempts);
          await db.update(pushNotificationDeliveries).set({ status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", leaseUntil: null, nextAttemptAt: new Date(Date.now() + delay), lastError: result.error, updatedAt: new Date() }).where(eq(pushNotificationDeliveries.id, row.delivery.id));
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    list: async (companyId: string, userId: string) => {
      await assertActiveMembership(companyId, userId);
      const rows = await db.select().from(pushDevices).where(and(eq(pushDevices.companyId, companyId), eq(pushDevices.userId, userId), isNull(pushDevices.revokedAt)));
      return rows.map(toPushDeviceMetadata);
    },
    register: async (companyId: string, userId: string, input: PushDeviceRegistration) => {
      await assertActiveMembership(companyId, userId);
      return db.transaction(async (tx) => {
        const existing = await tx.select().from(pushDevices).where(and(eq(pushDevices.companyId, companyId), eq(pushDevices.installationId, input.installationId))).then((rows) => rows[0] ?? null);
        if (existing && existing.userId !== userId) {
          await tx.delete(pushNotificationDeliveries).where(and(
            eq(pushNotificationDeliveries.deviceId, existing.id),
            or(eq(pushNotificationDeliveries.status, "pending"), eq(pushNotificationDeliveries.status, "processing")),
          ));
        }
        const now = new Date();
        const [row] = await tx.insert(pushDevices).values({ ...input, companyId, userId, createdAt: now, updatedAt: now, revokedAt: null }).onConflictDoUpdate({ target: [pushDevices.companyId, pushDevices.installationId], set: { userId, token: input.token, platform: input.platform, appId: input.appId, environment: input.environment, createdAt: now, bindingGeneration: sql`${pushDevices.bindingGeneration} + 1`, revokedAt: null, updatedAt: now } }).returning();
        return toPushDeviceMetadata(row);
      });
    },
    revoke: async (userId: string, installationId: string, companyId?: string) => {
      if (companyId) await assertActiveMembership(companyId, userId);
      const where = companyId ? and(eq(pushDevices.companyId, companyId), eq(pushDevices.userId, userId), eq(pushDevices.installationId, installationId)) : and(eq(pushDevices.userId, userId), eq(pushDevices.installationId, installationId));
      const rows = await db.update(pushDevices).set({ revokedAt: new Date(), updatedAt: new Date() }).where(where).returning();
      return rows.map(toPushDeviceMetadata);
    },
    start: () => { if (!timer && fcmConfigured()) { timer = setInterval(runWorker, 5000); timer.unref?.(); runWorker(); } },
    stop: () => { if (timer) { clearInterval(timer); timer = null; } },
    process: processPending,
  };
}
