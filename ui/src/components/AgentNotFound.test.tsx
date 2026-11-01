import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { isNotFoundError, retryUnlessNotFound } from "./AgentNotFound";

describe("agent lookup errors", () => {
  it("stops retrying a partner the server says is not found", () => {
    const notFound = new ApiError("Agent not found", 404, { error: "Agent not found" });
    expect(isNotFoundError(notFound)).toBe(true);
    expect(retryUnlessNotFound(0, notFound)).toBe(false);
  });

  it("keeps retrying other failures a few times", () => {
    const unavailable = new ApiError("Unavailable", 503, null);
    expect(retryUnlessNotFound(0, unavailable)).toBe(true);
    expect(retryUnlessNotFound(3, unavailable)).toBe(false);
    expect(retryUnlessNotFound(0, new Error("network"))).toBe(true);
  });
});
