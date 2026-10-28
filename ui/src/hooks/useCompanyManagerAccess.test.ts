import { describe, expect, it } from "vitest";
import type { CurrentBoardAccess } from "@/api/access";
import { isCompanyManager } from "./useCompanyManagerAccess";

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

describe("isCompanyManager", () => {
  it("is false until the board access snapshot is known", () => {
    expect(isCompanyManager("company-1", undefined)).toBe(false);
  });

  it("always passes local boards and instance admins", () => {
    expect(isCompanyManager("company-1", snapshot({ source: "local_implicit" }))).toBe(true);
    expect(isCompanyManager("company-1", snapshot({ isInstanceAdmin: true }))).toBe(true);
  });

  it.each(["owner", "admin"] as const)("passes an active company %s", (membershipRole) => {
    const access = snapshot({ memberships: [{ companyId: "company-1", membershipRole, status: "active" }] });
    expect(isCompanyManager("company-1", access)).toBe(true);
  });

  it.each(["operator", "viewer", "member", null] as const)("rejects a company %s", (membershipRole) => {
    const access = snapshot({ memberships: [{ companyId: "company-1", membershipRole, status: "active" }] });
    expect(isCompanyManager("company-1", access)).toBe(false);
  });

  it("rejects an admin of another company or an inactive membership", () => {
    expect(isCompanyManager("company-1", snapshot({
      memberships: [{ companyId: "company-2", membershipRole: "admin", status: "active" }],
    }))).toBe(false);
    expect(isCompanyManager("company-1", snapshot({
      memberships: [{ companyId: "company-1", membershipRole: "admin", status: "suspended" }],
    }))).toBe(false);
  });
});
