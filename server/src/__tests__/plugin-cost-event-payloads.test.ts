import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityLog, companies, createDb } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
type Db = ReturnType<typeof createDb>;

// Pins current behavior documented in the plugin SDK README ("Cost and budget
// amounts"): plugins with events.subscribe receive these amounts unfiltered,
// even though members without costs:view get them nulled in the activity API
// and live events. If plugin filtering is added, update the README with it.
describePostgres("cost and budget amounts in plugin events", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId = "";

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-plugin-cost-events-");
    db = createDb(tempDb.connectionString);
    await import("../services/activity-log.js");
  }, 180_000);

  beforeEach(async () => {
    companyId = await db.insert(companies).values({
      name: "Plugin Co",
      issuePrefix: `PL${randomUUID().slice(0, 6).toUpperCase()}`,
    }).returning().then((rows) => rows[0]!.id);
  });

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(companies);
  });

  afterAll(async () => tempDb?.cleanup());

  async function publicationFor(action: string, entityType: string, details: Record<string, unknown>) {
    const { persistActivity } = await import("../services/activity-log.js");
    const { publication } = await persistActivity(db, {
      companyId,
      actorType: "user",
      actorId: "owner",
      action,
      entityType,
      entityId: randomUUID(),
      details,
    });
    return publication;
  }

  it("forwards budget incident amounts to plugins unfiltered", async () => {
    const opened = await publicationFor("budget.soft_threshold_crossed", "budget_incident", {
      scopeType: "agent",
      amountObserved: 850,
      amountLimit: 1000,
    });
    expect(opened.pluginEvent?.eventType).toBe("budget.incident.opened");
    expect(opened.pluginEvent?.payload).toMatchObject({ amountObserved: 850, amountLimit: 1000 });

    const hard = await publicationFor("budget.hard_threshold_crossed", "budget_incident", {
      scopeType: "agent",
      amountObserved: 1100,
      amountLimit: 1000,
    });
    expect(hard.pluginEvent?.eventType).toBe("budget.incident.opened");
    expect(hard.pluginEvent?.payload).toMatchObject({ amountObserved: 1100, amountLimit: 1000 });

    const resolved = await publicationFor("budget.incident_resolved", "budget_incident", {
      action: "raise_budget_and_resume",
      amount: 2000,
      scopeType: "agent",
    });
    expect(resolved.pluginEvent?.eventType).toBe("budget.incident.resolved");
    expect(resolved.pluginEvent?.payload).toMatchObject({ amount: 2000 });
  }, 60_000);

  it("forwards company budget fields in company.updated to plugins unfiltered", async () => {
    const updated = await publicationFor("company.updated", "company", {
      name: "Renamed",
      budgetMonthlyCents: 70000,
      spentMonthlyCents: 100,
    });
    expect(updated.pluginEvent?.eventType).toBe("company.updated");
    expect(updated.pluginEvent?.payload).toMatchObject({ budgetMonthlyCents: 70000, spentMonthlyCents: 100 });
  }, 60_000);

  it("sends plugins no event for cost reports, budget updates or budget policies", async () => {
    for (const [action, entityType, details] of [
      ["cost.reported", "cost_event", { costCents: 1234, model: "gpt-x" }],
      ["company.budget_updated", "company", { budgetMonthlyCents: 50000 }],
      ["agent.budget_updated", "agent", { budgetMonthlyCents: 9000 }],
      ["budget.policy_upserted", "budget_policy", { scopeType: "company", amount: 80000 }],
    ] as const) {
      const publication = await publicationFor(action, entityType, { ...details });
      expect(publication.pluginEvent, action).toBeNull();
    }
  }, 60_000);
});
