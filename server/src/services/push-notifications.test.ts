import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { activityLog, applyPendingMigrations, companyMemberships, companies, createDb, getEmbeddedPostgresTestSupport, pushCompletionEvents, pushDevices, pushNotificationDeliveries, startEmbeddedPostgresTestDatabase } from "@paperclipai/db";
import { deliveryRetryDelay, isInvalidFcmResponse, isIssueCompletionActivity, pushNotificationService, toPushDeviceMetadata } from "./push-notifications.js";
import { pushDeviceRegistrationSchema } from "@paperclipai/shared";
import { pushDeviceRoutes } from "../routes/push-devices.js";
import { persistActivity } from "./activity-log.js";

describe("native push completion gating", () => {
  it("only recognizes a real transition into done", () => {
    expect(isIssueCompletionActivity({ status: "done", _previous: { status: "in_progress" } })).toBe(true);
    expect(isIssueCompletionActivity({ status: "done", _previous: { status: "done" } })).toBe(false);
    expect(isIssueCompletionActivity({ status: "done" })).toBe(false);
    expect(isIssueCompletionActivity({ status: "todo", _previous: { status: "in_progress" } })).toBe(false);
  });

  it("removes the FCM token from every API metadata shape", () => {
    const metadata = toPushDeviceMetadata({
      id: "device",
      companyId: "company",
      userId: "user",
      installationId: "installation",
      token: "secret-token",
      bindingGeneration: 1,
      platform: "ios",
      appId: "work.metabiz.crew.uat",
      environment: "uat",
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(metadata).not.toHaveProperty("token");
    expect(metadata.userId).toBe("user");
  });

  it("rejects client identity fields and caps retry backoff", () => {
    const parsed = pushDeviceRegistrationSchema.safeParse({
      installationId: "00000000-0000-4000-8000-000000000001",
      token: "a-valid-token-that-is-long-enough",
      platform: "ios",
      appId: "work.metabiz.crew.uat",
      environment: "uat",
      userId: "attacker-controlled-user",
    });
    expect(parsed.success).toBe(false);
    expect(deliveryRetryDelay(1)).toBe(2000);
    expect(deliveryRetryDelay(100)).toBe(15 * 60 * 1000);
    expect(isInvalidFcmResponse(404, { error: { details: [{ errorCode: "UNREGISTERED" }] } })).toBe(true);
    expect(isInvalidFcmResponse(400, { error: { details: [{ errorCode: "INVALID_ARGUMENT" }] } })).toBe(false);
    expect(isInvalidFcmResponse(503, { error: { details: [{ errorCode: "UNREGISTERED" }] } })).toBe(false);
  });
});

const testDatabaseUrl = process.env.PAPERCLIP_TEST_DATABASE_URL;
const embeddedSupport = testDatabaseUrl ? { supported: true } : await getEmbeddedPostgresTestSupport();
const databaseSuite = embeddedSupport.supported ? describe : describe.skip;

databaseSuite("native push recipient isolation", () => {
  it("persists completion delivery, enforces routes, and skips stale recipients", async () => {
    const temporary = testDatabaseUrl ? null : await startEmbeddedPostgresTestDatabase("paperclip-push-recipient-");
    const connectionString = testDatabaseUrl ?? temporary!.connectionString;
    const db = createDb(connectionString);
    const previousProject = process.env.PAPERCLIP_FCM_PROJECT_ID;
    const previousCredentials = process.env.PAPERCLIP_FCM_SERVICE_ACCOUNT_PATH;
    try {
      await applyPendingMigrations(connectionString);
      const companyId = randomUUID();
      const responsibleUserId = randomUUID();
      const otherUserId = randomUUID();
      const installationId = randomUUID();
      const rebindInstallationId = randomUUID();
      const suspendedInstallationId = randomUUID();
      const issueId = randomUUID();
      await db.insert(companies).values({ id: companyId, name: "Push test", issuePrefix: `P${randomUUID().slice(0, 7).toUpperCase()}` });
      await db.insert(companyMemberships).values([
        { companyId, principalType: "user", principalId: responsibleUserId, status: "active" },
        { companyId, principalType: "user", principalId: otherUserId, status: "active" },
      ]);
      process.env.PAPERCLIP_FCM_PROJECT_ID = "metabiz";
      process.env.PAPERCLIP_FCM_SERVICE_ACCOUNT_PATH = "injected-test-credentials";
      const routeApp = (actor: express.Request["actor"]) => {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.actor = actor; next(); });
        app.use(pushDeviceRoutes(db).router);
        app.use((error: { status?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
          res.status(error.status ?? 500).json({ error: error.message });
        });
        return app;
      };
      const activeActor: express.Request["actor"] = {
        type: "board", source: "session", userId: responsibleUserId,
        companyIds: [companyId], memberships: [{ companyId, status: "active", membershipRole: "member" }],
      };
      const activeOtherActor: express.Request["actor"] = { ...activeActor, userId: otherUserId };
      const registration = { token: "responsible-token-1234567890", platform: "ios", appId: "work.metabiz.crew.uat", environment: "uat" };
      const firstRegistration = await request(routeApp(activeActor)).post(`/companies/${companyId}/push-devices`).send({ ...registration, installationId });
      expect(firstRegistration.status, JSON.stringify(firstRegistration.body)).toBe(200);
      expect(firstRegistration.body).not.toHaveProperty("token");

      const completion = await persistActivity(db, {
        companyId, actorType: "agent", actorId: randomUUID(), action: "issue.updated", entityType: "issue", entityId: issueId,
        details: { status: "done", _previous: { status: "in_progress" } }, responsibleUserIdOverride: responsibleUserId,
      });
      const completionEvents = await db.select().from(pushCompletionEvents).where(eq(pushCompletionEvents.activityLogId, completion.activity.id));
      expect(completionEvents).toHaveLength(1);

      let sendCount = 0;
      const service = pushNotificationService(db, { send: async () => { sendCount += 1; return { kind: "sent" }; } });
      await service.process();
      await service.process();
      expect(sendCount).toBeGreaterThan(0);

      await request(routeApp(activeActor)).delete(`/companies/${companyId}/push-devices/${installationId}`).expect(204);
      const revoked = await db.select({ revokedAt: pushDevices.revokedAt }).from(pushDevices).where(eq(pushDevices.installationId, installationId));
      expect(revoked[0]?.revokedAt).toBeInstanceOf(Date);
      const revokeAudits = await db.select({ action: activityLog.action, entityId: activityLog.entityId, details: activityLog.details })
        .from(activityLog)
        .where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "push_device.revoked")));
      expect(revokeAudits).toHaveLength(1);
      expect(revokeAudits[0]?.entityId).toBeTruthy();
      expect(revokeAudits[0]?.details).toEqual({ installationId });

      await request(routeApp(activeActor)).post(`/companies/${companyId}/push-devices`).send({ ...registration, installationId: rebindInstallationId }).expect(200);
      await persistActivity(db, {
        companyId, actorType: "agent", actorId: randomUUID(), action: "issue.updated", entityType: "issue", entityId: randomUUID(),
        details: { status: "done", _previous: { status: "in_progress" } }, responsibleUserIdOverride: responsibleUserId,
      });
      let rebindSendCount = 0;
      const retryService = pushNotificationService(db, { send: async () => { rebindSendCount += 1; return { kind: "retry", error: "temporary test failure" }; } });
      await retryService.process();
      await retryService.process();
      const rebindRows = await db.select({ status: pushCompletionEvents.status }).from(pushCompletionEvents).where(and(eq(pushCompletionEvents.companyId, companyId), eq(pushCompletionEvents.recipientUserId, responsibleUserId)));
      expect(rebindRows.length, JSON.stringify(rebindRows)).toBe(2);
      expect(rebindSendCount).toBe(1);
      const pendingBeforeRebind = await db.select({ status: pushNotificationDeliveries.status })
        .from(pushNotificationDeliveries)
        .innerJoin(pushDevices, eq(pushDevices.id, pushNotificationDeliveries.deviceId))
        .where(eq(pushDevices.installationId, rebindInstallationId));
      expect(pendingBeforeRebind.some((row) => row.status === "pending")).toBe(true);
      await request(routeApp(activeOtherActor)).post(`/companies/${companyId}/push-devices`).send({ ...registration, installationId: rebindInstallationId, token: "other-token-1234567890" }).expect(200);
      const afterRebind = await db.select({ status: pushNotificationDeliveries.status, bindingGeneration: pushNotificationDeliveries.deviceBindingGeneration, currentGeneration: pushDevices.bindingGeneration })
        .from(pushNotificationDeliveries)
        .innerJoin(pushDevices, eq(pushDevices.id, pushNotificationDeliveries.deviceId))
        .where(eq(pushDevices.installationId, rebindInstallationId));
      expect(afterRebind).toHaveLength(0);
      await retryService.process();
      expect(rebindSendCount).toBe(1);

      await request(routeApp(activeOtherActor)).post(`/companies/${companyId}/push-devices`).send({ ...registration, installationId: suspendedInstallationId }).expect(200);
      await persistActivity(db, {
        companyId, actorType: "agent", actorId: randomUUID(), action: "issue.updated", entityType: "issue", entityId: randomUUID(),
        details: { status: "done", _previous: { status: "in_progress" } }, responsibleUserIdOverride: otherUserId,
      });
      await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, otherUserId)));
      await retryService.process();
      await retryService.process();
      expect(rebindSendCount).toBe(1);
    } finally {
      if (previousProject === undefined) delete process.env.PAPERCLIP_FCM_PROJECT_ID;
      else process.env.PAPERCLIP_FCM_PROJECT_ID = previousProject;
      if (previousCredentials === undefined) delete process.env.PAPERCLIP_FCM_SERVICE_ACCOUNT_PATH;
      else process.env.PAPERCLIP_FCM_SERVICE_ACCOUNT_PATH = previousCredentials;
      await db.$client.end();
      await temporary?.cleanup();
    }
  });
});
