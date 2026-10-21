import { describe, expect, it } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { findPersonalAssistant } from "./personal-assistant";

const agent = (overrides: Partial<Agent> = {}) => ({
  id: "sammi", companyId: "metabiz", name: "sammi", status: "idle",
  metadata: { personalAssistantForUserIds: ["adam"] }, ...overrides,
} as Agent);

describe("personal assistant scope", () => {
  it("resolves the explicitly configured secretary for this company and user", () => {
    expect(findPersonalAssistant([agent()], "metabiz", "adam")?.id).toBe("sammi");
  });
  it("never carries a secretary across companies or users, even with stale roster data", () => {
    expect(findPersonalAssistant([agent()], "sendheart", "adam")).toBeNull();
    expect(findPersonalAssistant([agent()], "metabiz", "customer")).toBeNull();
    expect(findPersonalAssistant([agent()], "metabiz", null)).toBeNull();
    expect(findPersonalAssistant([agent()], null, "adam")).toBeNull();
  });
  it("does not infer ownership from a name, title or role", () => {
    expect(findPersonalAssistant([agent({ metadata: null })], "metabiz", "adam")).toBeNull();
  });
  it("fails closed for ambiguous, malformed and unavailable configurations", () => {
    expect(findPersonalAssistant([agent(), agent({ id: "other" })], "metabiz", "adam")).toBeNull();
    expect(findPersonalAssistant([agent({ metadata: { personalAssistantForUserIds: "adam" } })], "metabiz", "adam")).toBeNull();
    for (const status of ["terminated", "pending_approval"] as const)
      expect(findPersonalAssistant([agent({ status })], "metabiz", "adam")).toBeNull();
  });
});
