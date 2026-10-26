import { mkdir, mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createMorbitCompanyConnectionService,
  MorbitCompanyConnectionRevisionConflict,
} from "../services/morbit-company-connection.js";

describe("morbit company connection persistence", () => {
  it("rereads durable metadata and serializes stale revision checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "morbit-company-connection-"));
    try {
      const first = createMorbitCompanyConnectionService({ instanceRoot: root, now: () => new Date("2026-10-26T00:00:00.000Z") });
      const second = createMorbitCompanyConnectionService({ instanceRoot: root });
      const initial = await first.get();
      const audit = { actorType: "user" as const, actorId: "admin", actorSource: "session" };
      const saved = await first.update({ expectedRevision: 0, companyUrl: "https://company.example", accessMethod: "direct", provider: "none", instructions: "Use the company URL." }, audit);
      expect(saved.revision).toBe(1);
      expect(await second.get()).toEqual(saved);
      const persisted = JSON.parse(await readFile(join(root, "data/morbit/company-connection.json"), "utf8"));
      expect(persisted.lastChanges).toHaveLength(1);
      expect(persisted.lastChanges[0]).toMatchObject({ actorId: "admin", revision: 1, accessMethod: "direct", provider: "none" });
      expect(persisted.lastChanges[0]).not.toHaveProperty("companyUrl");
      expect(persisted.lastChanges[0]).not.toHaveProperty("instructions");
      await expect(Promise.all([
        second.update({ expectedRevision: 1, companyUrl: "https://one.example", accessMethod: "direct", provider: "none", instructions: "" }, audit),
        second.update({ expectedRevision: 1, companyUrl: "https://two.example", accessMethod: "direct", provider: "none", instructions: "" }, audit),
      ])).rejects.toBeInstanceOf(MorbitCompanyConnectionRevisionConflict);
      expect(JSON.parse(await readFile(join(root, "data/morbit/company-connection.json"), "utf8")).revision).toBe(2);
      expect(initial.revision).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails within the bound when another process holds the file lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "morbit-company-connection-lock-"));
    try {
      const lockPath = join(root, "data/morbit/company-connection.json.lock");
      await mkdir(lockPath, { recursive: true });
      await utimes(lockPath, new Date(0), new Date(0));
      const service = createMorbitCompanyConnectionService({ instanceRoot: root, lockTimeoutMs: 25 });
      const failure = service.update({ expectedRevision: 0, companyUrl: "https://company.example", accessMethod: "direct", provider: "none", instructions: "" }, { actorType: "user", actorId: "admin", actorSource: "session" });
      await expect(failure).rejects.toMatchObject({ message: "Timed out waiting for company connection lock" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
