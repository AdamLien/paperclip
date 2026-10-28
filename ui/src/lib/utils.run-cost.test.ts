import { describe, expect, it } from "vitest";
import { visibleRunCostUsd } from "./utils";

describe("visibleRunCostUsd", () => {
  it("reads the run cost when the server includes it", () => {
    expect(visibleRunCostUsd({ costUsd: 0.42 }, { total_cost_usd: 0.42 })).toBe(0.42);
  });

  // Run pages only render a cost above zero, so a withheld (null) amount is
  // hidden rather than shown as $0.
  it("treats amounts withheld from members without costs:view as no cost", () => {
    expect(
      visibleRunCostUsd(
        { inputTokens: 120, costUsd: null, cacheAdjustedCostUsd: null },
        { summary: "Built it", costUsd: null, cost_usd: null, total_cost_usd: null },
      ),
    ).toBe(0);
  });
});
