import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import WebSocket from "ws";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  companies,
  companyMemberships,
  createDb,
  principalPermissionGrants,
} from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

const COST_ACTIVITIES = [
  { action: "cost.reported", entityType: "cost_event", details: { costCents: 1234, model: "gpt-x" }, amountKeys: ["costCents"] },
  { action: "company.budget_updated", entityType: "company", details: { budgetMonthlyCents: 50000 }, amountKeys: ["budgetMonthlyCents"] },
  { action: "agent.budget_updated", entityType: "agent", details: { budgetMonthlyCents: 9000 }, amountKeys: ["budgetMonthlyCents"] },
  { action: "company.updated", entityType: "company", details: { name: "Renamed", budgetMonthlyCents: 70000, spentMonthlyCents: 100 }, amountKeys: ["budgetMonthlyCents", "spentMonthlyCents"] },
  { action: "budget.policy_upserted", entityType: "budget_policy", details: { scopeType: "company", amount: 80000, windowKind: "calendar_month_utc" }, amountKeys: ["amount"] },
  { action: "budget.soft_threshold_crossed", entityType: "budget_incident", details: { scopeType: "agent", amountObserved: 850, amountLimit: 1000 }, amountKeys: ["amountObserved", "amountLimit"] },
  { action: "budget.hard_threshold_crossed", entityType: "budget_incident", details: { scopeType: "agent", amountObserved: 1100, amountLimit: 1000, approvalId: null }, amountKeys: ["amountObserved", "amountLimit"] },
  { action: "budget.incident_resolved", entityType: "budget_incident", details: { action: "raise_budget_and_resume", amount: 2000, scopeType: "agent" }, amountKeys: ["amount"] },
] as const;

function withheld(details: Record<string, unknown>, amountKeys: readonly string[]) {
  return Object.fromEntries(Object.entries(details).map(([key, value]) => [key, amountKeys.includes(key) ? null : value]));
}

function boardActor(userId: string, companyId: string): Express.Request["actor"] {
  return { type: "board", userId, companyIds: [companyId], source: "session", isInstanceAdmin: false };
}

describePostgres("cost amounts in activity details", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-activity-cost-details-");
    db = createDb(tempDb.connectionString);
    // Load the modules once here so their cold import does not count
    // against the first test's timeout when files run in parallel.
    await import("../routes/activity.js");
    await import("../realtime/live-events-ws.js");
  }, 180_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => tempDb?.cleanup());

  async function seed() {
    const company = await db.insert(companies).values({
      name: "Ledger Co",
      issuePrefix: `LC${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!);
    await db.insert(companyMemberships).values([
      { companyId: company.id, principalType: "user", principalId: "owner", status: "active", membershipRole: "owner" },
      { companyId: company.id, principalType: "user", principalId: "operator", status: "active", membershipRole: "operator" },
      { companyId: company.id, principalType: "user", principalId: "viewer", status: "active", membershipRole: "viewer" },
    ]);
    return company;
  }

  async function grantCostsView(companyId: string, userId: string) {
    await db.insert(principalPermissionGrants).values({
      companyId,
      principalType: "user",
      principalId: userId,
      permissionKey: "costs:view",
      scope: null,
      grantedByUserId: null,
    });
  }

  describe("company activity API", () => {
    async function listActivity(userId: string, companyId: string) {
      const { activityRoutes } = await import("../routes/activity.js");
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.actor = boardActor(userId, companyId);
        next();
      });
      app.use("/api", activityRoutes(db));
      app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(error.status ?? 500).json({ error: error.message ?? "Internal server error" });
      });
      const response = await request(app).get(`/api/companies/${companyId}/activity?limit=100`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const items: Array<{ action: string; details: Record<string, unknown> | null }> =
        Array.isArray(response.body) ? response.body : response.body.items;
      return new Map(items.map((item) => [item.action, item.details]));
    }

    async function logAll(companyId: string) {
      const { logActivity } = await import("../services/activity-log.js");
      for (const activity of COST_ACTIVITIES) {
        await logActivity(db, {
          companyId,
          actorType: "user",
          actorId: "owner",
          action: activity.action,
          entityType: activity.entityType,
          entityId: randomUUID(),
          details: { ...activity.details },
        });
      }
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: "owner",
        action: "issue.created",
        entityType: "issue",
        entityId: randomUUID(),
        details: { title: "Ship it", amount: 3 },
      });
    }

    it("withholds amounts from members without costs:view but keeps the events", async () => {
      const company = await seed();
      await logAll(company.id);

      for (const userId of ["operator", "viewer"]) {
        const details = await listActivity(userId, company.id);
        for (const activity of COST_ACTIVITIES) {
          expect(details.get(activity.action), `${userId} ${activity.action}`).toEqual(withheld(activity.details, activity.amountKeys));
        }
      }
    }, 60_000);

    it("returns full amounts to owners and to members granted costs:view", async () => {
      const company = await seed();
      await grantCostsView(company.id, "operator");
      await logAll(company.id);

      for (const userId of ["owner", "operator"]) {
        const details = await listActivity(userId, company.id);
        for (const activity of COST_ACTIVITIES) {
          expect(details.get(activity.action), `${userId} ${activity.action}`).toEqual(activity.details);
        }
      }
    }, 60_000);

    it("leaves non-cost activity untouched", async () => {
      const company = await seed();
      await logAll(company.id);
      const details = await listActivity("viewer", company.id);
      expect(details.get("issue.created")).toEqual({ title: "Ship it", amount: 3 });
    }, 60_000);
  });

  describe("live events websocket", () => {
    let server: Server | null = null;
    const sockets: WebSocket[] = [];

    afterEach(async () => {
      for (const socket of sockets.splice(0)) socket.terminate();
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    });

    async function startServer() {
      const { setupLiveEventsWebSocketServer } = await import("../realtime/live-events-ws.js");
      server = createServer();
      setupLiveEventsWebSocketServer(server, db, {
        deploymentMode: "authenticated",
        resolveSessionFromHeaders: async (headers) => {
          const userId = headers.get("x-test-user");
          return userId ? { session: { id: `session-${userId}`, userId }, user: { id: userId } as never } : null;
        },
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
      return (server.address() as AddressInfo).port;
    }

    async function connect(port: number, companyId: string, userId: string) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/api/companies/${companyId}/events/ws`, {
        headers: { "x-test-user": userId },
      });
      sockets.push(socket);
      const messages: Array<{ type: string; payload: Record<string, any> }> = [];
      const waiters: Array<() => void> = [];
      socket.on("message", (raw) => {
        messages.push(JSON.parse(raw.toString()));
        waiters.splice(0).forEach((wake) => wake());
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
      });
      return {
        async take(count: number) {
          const deadline = Date.now() + 10_000;
          while (messages.length < count) {
            if (Date.now() > deadline) throw new Error(`timed out waiting for ${count} messages, got ${messages.length}`);
            await new Promise<void>((resolve) => {
              waiters.push(resolve);
              setTimeout(resolve, 100);
            });
          }
          return messages.splice(0, count);
        },
      };
    }

    async function publish(companyId: string, action: string, details: Record<string, unknown>) {
      const { publishLiveEvent } = await import("../services/live-events.js");
      publishLiveEvent({
        companyId,
        type: "activity.logged",
        payload: { actorType: "user", actorId: "owner", action, entityType: "cost_event", entityId: randomUUID(), details },
      });
    }

    it("sends each subscriber cost amounts according to their own permission", async () => {
      const company = await seed();
      const port = await startServer();
      const owner = await connect(port, company.id, "owner");
      const viewer = await connect(port, company.id, "viewer");

      await publish(company.id, "cost.reported", { costCents: 1234, model: "gpt-x" });

      const [ownerEvent] = await owner.take(1);
      const [viewerEvent] = await viewer.take(1);
      expect(ownerEvent!.payload.details).toEqual({ costCents: 1234, model: "gpt-x" });
      expect(viewerEvent!.payload.details).toEqual({ costCents: null, model: "gpt-x" });
      expect(viewerEvent!.payload.action).toBe("cost.reported");
    }, 60_000);

    it("applies a revoked costs:view to the next pushed event", async () => {
      const company = await seed();
      await grantCostsView(company.id, "operator");
      const port = await startServer();
      const operator = await connect(port, company.id, "operator");

      await publish(company.id, "budget.soft_threshold_crossed", { scopeType: "agent", amountObserved: 850, amountLimit: 1000 });
      expect((await operator.take(1))[0]!.payload.details).toEqual({ scopeType: "agent", amountObserved: 850, amountLimit: 1000 });

      await db.delete(principalPermissionGrants);
      await publish(company.id, "budget.soft_threshold_crossed", { scopeType: "agent", amountObserved: 900, amountLimit: 1000 });
      expect((await operator.take(1))[0]!.payload.details).toEqual({ scopeType: "agent", amountObserved: null, amountLimit: null });
    }, 60_000);

    it("keeps non-cost events intact and in publish order", async () => {
      const company = await seed();
      const port = await startServer();
      const viewer = await connect(port, company.id, "viewer");

      await publish(company.id, "cost.reported", { costCents: 1, model: "m" });
      await publish(company.id, "issue.created", { title: "Ship it", amount: 3 });

      const events = await viewer.take(2);
      expect(events.map((event) => event.payload.action)).toEqual(["cost.reported", "issue.created"]);
      expect(events[1]!.payload.details).toEqual({ title: "Ship it", amount: 3 });
    }, 60_000);
  });
});
