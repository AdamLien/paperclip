// Per-run cost keys adapters and the heartbeat ledger write into a run's
// usageJson and resultJson. Members without costs:view still see the run,
// its status and token usage, with these amounts nulled.
const RUN_COST_KEYS = ["costUsd", "cost_usd", "total_cost_usd", "cacheAdjustedCostUsd"] as const;

function withholdCostKeys(json: unknown) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return json;
  const withheld: Record<string, unknown> = { ...(json as Record<string, unknown>) };
  for (const key of RUN_COST_KEYS) {
    if (key in withheld) withheld[key] = null;
  }
  return withheld;
}

export function withholdRunCosts<T>(run: T): T {
  if (!run || typeof run !== "object") return run;
  const record = run as Record<string, unknown>;
  return {
    ...record,
    ...("usageJson" in record ? { usageJson: withholdCostKeys(record.usageJson) } : {}),
    ...("resultJson" in record ? { resultJson: withholdCostKeys(record.resultJson) } : {}),
  } as T;
}
