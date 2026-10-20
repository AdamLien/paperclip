import { describe, expect, it } from "vitest";
import { completedThreadHistoryStart } from "./completed-thread-history";

describe("completed thread delivery", () => {
  it("keeps short conversations intact", () => {
    expect(completedThreadHistoryStart([{ role: "user" }, { role: "assistant" }])).toBe(0);
  });
  it("keeps all final deliverables after the last request", () => {
    const history = Array.from({ length: 20 }, () => ({ role: "assistant" }));
    expect(completedThreadHistoryStart([...history, { role: "user" }, { role: "assistant" }, { role: "system" }, { role: "assistant" }])).toBe(21);
  });
  it("never hides the latest unanswered request", () => {
    expect(completedThreadHistoryStart([...Array.from({ length: 20 }, () => ({ role: "assistant" })), { role: "user" }])).toBe(13);
  });
});
