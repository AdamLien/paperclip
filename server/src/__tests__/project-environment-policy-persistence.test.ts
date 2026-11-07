import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, projects as projectsTable } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { projectService } from "../services/projects.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres project environment policy tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// The project policy environmentId decides where runs execute, so the project
// read API must return it; otherwise the UI shows the project as unpinned.
describeEmbeddedPostgres("project executionWorkspacePolicy.environmentId persistence", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let prefixCounter = 0;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-project-env-policy-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(projectsTable);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(): Promise<string> {
    prefixCounter += 1;
    const [company] = await db
      .insert(companies)
      .values({ name: "Env Co", issuePrefix: `ENV${prefixCounter}` })
      .returning();
    return company.id;
  }

  it("returns a saved environmentId from update, getById and list", async () => {
    const companyId = await seedCompany();
    const projects = projectService(db);
    const environmentId = randomUUID();
    const created = await projects.create(companyId, { name: "Pinned" });

    const updated = await projects.update(created.id, {
      executionWorkspacePolicy: { enabled: true, defaultMode: "isolated_workspace", environmentId },
    });
    expect(updated?.executionWorkspacePolicy?.environmentId).toBe(environmentId);

    const fetched = await projects.getById(created.id);
    expect(fetched?.executionWorkspacePolicy?.environmentId).toBe(environmentId);

    const listed = await projects.list(companyId);
    expect(listed.find((project) => project.id === created.id)?.executionWorkspacePolicy?.environmentId).toBe(
      environmentId,
    );
  });

  it("clears the environmentId of projects pinned to a removed environment", async () => {
    const companyId = await seedCompany();
    const projects = projectService(db);
    const removedEnvironmentId = randomUUID();
    const otherEnvironmentId = randomUUID();
    const pinned = await projects.create(companyId, {
      name: "Pinned",
      executionWorkspacePolicy: { enabled: true, environmentId: removedEnvironmentId },
    });
    const other = await projects.create(companyId, {
      name: "Other",
      executionWorkspacePolicy: { enabled: true, environmentId: otherEnvironmentId },
    });

    const cleared = await projects.clearExecutionWorkspaceEnvironmentSelection(companyId, removedEnvironmentId);
    expect(cleared).toBe(1);

    expect((await projects.getById(pinned.id))?.executionWorkspacePolicy?.environmentId).toBeNull();
    expect((await projects.getById(other.id))?.executionWorkspacePolicy?.environmentId).toBe(otherEnvironmentId);
  });
});
