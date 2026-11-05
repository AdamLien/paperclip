import { describe, expect, it } from "vitest";
import { MBASE_DEFAULT_PRICE, MBASE_MODEL_PRICES, estimateMbaseCostUsd } from "../services/mbase-model-prices.js";

describe("mBase model price table", () => {
  it("prices a real Sonnet 5.5 run the same as the Claude CLI's own list-price total", () => {
    // One run: 60 fresh input + 19,995 one-hour cache writes, 362,324 cache reads, 5,803 output. The CLI reported 0.1743624.
    const estimate = estimateMbaseCostUsd("anthropic/claude-sonnet-5-5", {
      inputTokens: 20_055, cacheCreationInputTokens: 19_995, cachedInputTokens: 362_324, outputTokens: 5_803,
    });
    expect(estimate.priceSource).toBe("table");
    expect(estimate.usd).toBeCloseTo(0.1743624, 6);
  });

  it("uses the fixed default price for a model missing from the table and says so", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const estimate = estimateMbaseCostUsd("anthropic/claude-unlisted-9", usage);
    expect(estimate.priceSource).toBe("default");
    expect(estimate.usd).toBeCloseTo(MBASE_DEFAULT_PRICE.inputPerMTokUsd + MBASE_DEFAULT_PRICE.outputPerMTokUsd, 6);
  });

  it("treats cache writes the CLI did not report separately as fresh input", () => {
    const estimate = estimateMbaseCostUsd("anthropic/claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 0 });
    expect(estimate.usd).toBeCloseTo(MBASE_MODEL_PRICES["anthropic/claude-sonnet-5-5"]!.inputPerMTokUsd, 6);
  });

  it("returns no estimate without usage rather than a zero", () => {
    expect(estimateMbaseCostUsd("anthropic/claude-sonnet-5-5", null)).toEqual({ usd: null, priceSource: null });
  });
});
