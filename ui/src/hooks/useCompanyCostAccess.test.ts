import { describe, expect, it } from "vitest";
import type { CurrentBoardAccess } from "@/api/access";
import { canViewCompanyCosts } from "./useCompanyCostAccess";

function snapshot(overrides: Partial<CurrentBoardAccess> = {}): CurrentBoardAccess {
  return {
    user: { id: "user-1", email: "jane@example.com", name: "Jane Example", image: null },
    userId: "user-1",
    isInstanceAdmin: false,
    companyIds: ["company-1"],
    memberships: [{ companyId: "company-1", membershipRole: "operator", status: "active" }],
    source: "session",
    keyId: null,
    ...overrides,
  };
}

describe("canViewCompanyCosts", () => {
  it("is false until the board access snapshot is known", () => {
    expect(canViewCompanyCosts("company-1", undefined)).toBe(false);
  });

  it("always passes local boards and instance admins", () => {
    expect(canViewCompanyCosts("company-1", snapshot({ source: "local_implicit" }))).toBe(true);
    expect(canViewCompanyCosts("company-1", snapshot({ isInstanceAdmin: true }))).toBe(true);
  });

  it.each(["owner", "admin"] as const)("passes an active company %s", (membershipRole) => {
    const access = snapshot({
      memberships: [{ companyId: "company-1", membershipRole, status: "active" }],
    });
    expect(canViewCompanyCosts("company-1", access)).toBe(true);
  });

  it.each(["operator", "viewer", "member", null] as const)("rejects a company %s", (membershipRole) => {
    const access = snapshot({
      memberships: [{ companyId: "company-1", membershipRole, status: "active" }],
    });
    expect(canViewCompanyCosts("company-1", access)).toBe(false);
  });

  it("ignores inactive memberships and other companies", () => {
    const suspended = snapshot({
      memberships: [{ companyId: "company-1", membershipRole: "owner", status: "suspended" }],
    });
    expect(canViewCompanyCosts("company-1", suspended)).toBe(false);
    const elsewhere = snapshot({
      memberships: [{ companyId: "company-2", membershipRole: "owner", status: "active" }],
    });
    expect(canViewCompanyCosts("company-1", elsewhere)).toBe(false);
  });
});
