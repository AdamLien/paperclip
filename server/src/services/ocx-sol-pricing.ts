import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";

export const SOL_PRICING = {
  model: "gpt-6.1-sol",
  currency: "USD",
  inputPerMillion: 2,
  cachedInputPerMillion: 0.1,
  cacheWritePerMillion: 2.5,
  outputPerMillion: 10,
  source: "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
  verifiedAt: "2026-10-20",
} as const;

/** Standard-tier list-price estimate, never a provider invoice or customer debit.
 * CLI run totals do not identify per-request long-context, regional or tier
 * premiums, or cache-write tokens. Keep that limitation with the receipt.
 */
export function applyOcxSolPricing(
  result: AdapterExecutionResult,
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number } | null,
  adapterType: string,
  config: Record<string, unknown>,
): AdapterExecutionResult {
  const env = config.env as Record<string, unknown> | undefined;
  if (adapterType !== "codex_local" || !env?.OCX_API_KEY ||
      result.model !== SOL_PRICING.model || !usage ||
      result.costUsd != null || result.cacheAdjustedCostUsd != null) return result;
  const { inputTokens, cachedInputTokens, outputTokens } = usage;
  if (![inputTokens, cachedInputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0) ||
      cachedInputTokens > inputTokens || inputTokens + outputTokens === 0) return result;
  const estimate = ((inputTokens - cachedInputTokens) * SOL_PRICING.inputPerMillion +
    cachedInputTokens * SOL_PRICING.cachedInputPerMillion +
    outputTokens * SOL_PRICING.outputPerMillion) / 1_000_000;
  return {
    ...result,
    biller: "ocx",
    billingType: "api",
    costUsd: estimate,
    cacheAdjustedCostUsd: estimate,
    resultJson: {
      ...result.resultJson,
      pricing: { ...SOL_PRICING, estimated: true, basis: "standard_tier_list_price",
        limitations: "Excludes unreported cache writes, long-context, service-tier, regional and tool fees; not an OCX invoice." },
    },
  };
}
