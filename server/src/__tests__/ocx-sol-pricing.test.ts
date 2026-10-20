import { describe, expect, it } from "vitest";
import { applyOcxSolPricing } from "../services/ocx-sol-pricing.js";

const result = { exitCode: 0, signal: null, timedOut: false, model: "gpt-6.1-sol", billingType: "subscription" as const };
const config = { env: { OCX_API_KEY: { type: "secret_ref" } } };
const price = (usage: {inputTokens:number;cachedInputTokens:number;outputTokens:number}) => applyOcxSolPricing(result, usage, "codex_local", config);
describe("OCX Sol standard list-price estimates", () => {
  it("prices the verified customer run and identifies the estimate", () => {
    const receipt = price({ inputTokens: 10628, cachedInputTokens: 0, outputTokens: 76 });
    expect(receipt.costUsd).toBeCloseTo(0.022016, 9);
    expect(receipt.billingType).toBe("api");
    expect(receipt.biller).toBe("ocx");
    expect(receipt.resultJson?.pricing).toMatchObject({ estimated: true, currency: "USD" });
  });
  it("charges cached input once at the discounted rate", () => {
    expect(price({ inputTokens: 1_000_000, cachedInputTokens: 900_000, outputTokens: 100_000 }).costUsd).toBeCloseTo(1.29);
  });
  it("leaves unknown models, non-OCX runs, missing and invalid receipts unchanged", () => {
    const usage = {inputTokens:10,cachedInputTokens:0,outputTokens:2};
    expect(applyOcxSolPricing(result,usage,"codex_local",{})).toBe(result);
    const unknown = {...result,model:"another-model"};
    expect(applyOcxSolPricing(unknown,usage,"codex_local",config)).toBe(unknown);
    expect(applyOcxSolPricing(result,null,"codex_local",config)).toBe(result);
    expect(price({...usage,cachedInputTokens:11})).toBe(result);
  });
  it("preserves provider cost receipts", () => {
    const reported = {...result,costUsd:0.5};
    expect(applyOcxSolPricing(reported,{inputTokens:10,cachedInputTokens:0,outputTokens:2},"codex_local",config)).toBe(reported);
  });
});
