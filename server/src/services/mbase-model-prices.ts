/**
 * mBase model price table, maintained by us and changed only through a reviewed PR.
 *
 * mBase cannot see which upstream account (subscription or metered key) paid for a run, so the
 * billed amount stays unknown. Budgets count this table's estimate instead. USD per million tokens,
 * standard (non-batch, non-regional) API list prices.
 *
 * Source: https://claude.com/pricing, checked 2026-11-05. Cache writes use the one-hour rate
 * (2x input): Claude Code writes one-hour cache entries, and the CLI does not report the split.
 * Haiku 5.5 is listed at its <=100K-prompt rate; longer prompts cost 5x and are not priced here.
 */
export interface MbaseModelPrice {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  cacheWritePerMTokUsd: number;
  cacheReadPerMTokUsd: number;
}

export const MBASE_MODEL_PRICES: Readonly<Record<string, MbaseModelPrice>> = {
  "anthropic/claude-fable-5-1": { inputPerMTokUsd: 10, outputPerMTokUsd: 50, cacheWritePerMTokUsd: 20, cacheReadPerMTokUsd: 0.25 },
  "anthropic/claude-opus-5-5": { inputPerMTokUsd: 4, outputPerMTokUsd: 20, cacheWritePerMTokUsd: 8, cacheReadPerMTokUsd: 0.2 },
  "anthropic/claude-sonnet-5-5": { inputPerMTokUsd: 2, outputPerMTokUsd: 10, cacheWritePerMTokUsd: 4, cacheReadPerMTokUsd: 0.1 },
  "anthropic/claude-haiku-5-5": { inputPerMTokUsd: 0.1, outputPerMTokUsd: 0.5, cacheWritePerMTokUsd: 0.2, cacheReadPerMTokUsd: 0.01 },
};

/** Fixed price for a model missing from the table: the most expensive listed model, so a budget never under-counts. */
export const MBASE_DEFAULT_PRICE: MbaseModelPrice = MBASE_MODEL_PRICES["anthropic/claude-fable-5-1"]!;

export interface MbaseUsage {
  /** Prompt tokens, including cache writes when the adapter folds them in. */
  inputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
}

const count = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

export function estimateMbaseCostUsd(
  model: string | null | undefined,
  usage: MbaseUsage | null | undefined,
): { usd: number | null; priceSource: "table" | "default" | null } {
  if (!usage) return { usd: null, priceSource: null };
  const listed = model ? MBASE_MODEL_PRICES[model] : undefined;
  const price = listed ?? MBASE_DEFAULT_PRICE;
  const cacheWrites = Math.min(count(usage.cacheCreationInputTokens), count(usage.inputTokens));
  const freshInput = count(usage.inputTokens) - cacheWrites;
  const usd = (freshInput * price.inputPerMTokUsd
    + cacheWrites * price.cacheWritePerMTokUsd
    + count(usage.cachedInputTokens) * price.cacheReadPerMTokUsd
    + count(usage.outputTokens) * price.outputPerMTokUsd) / 1_000_000;
  return { usd, priceSource: listed ? "table" : "default" };
}
