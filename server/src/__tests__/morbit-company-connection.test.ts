import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      const saved = await first.update({ expectedRevision: 0, companyUrl: "https://company.example", accessMethod: "direct", provider: "none", instructions: "Use the company URL." });
      expect(saved.revision).toBe(1);
      expect(await second.get()).toEqual(saved);
      await expect(Promise.all([
        second.update({ expectedRevision: 1, companyUrl: "https://one.example", accessMethod: "direct", provider: "none", instructions: "" }),
        second.update({ expectedRevision: 1, companyUrl: "https://two.example", accessMethod: "direct", provider: "none", instructions: "" }),
      ])).rejects.toBeInstanceOf(MorbitCompanyConnectionRevisionConflict);
      expect(JSON.parse(await readFile(join(root, "data/morbit/company-connection.json"), "utf8")).revision).toBe(2);
      expect(initial.revision).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
