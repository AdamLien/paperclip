// Amount fields that cost and budget activity entries carry in their details.
// Members without costs:view still see these entries, with the amounts nulled.
const COST_DETAIL_KEYS_BY_ACTION: Record<string, readonly string[]> = {
  "cost.reported": ["costCents"],
  "company.budget_updated": ["budgetMonthlyCents"],
  "agent.budget_updated": ["budgetMonthlyCents"],
  "company.updated": ["budgetMonthlyCents", "spentMonthlyCents"],
  "budget.policy_upserted": ["amount"],
  "budget.soft_threshold_crossed": ["amountObserved", "amountLimit"],
  "budget.hard_threshold_crossed": ["amountObserved", "amountLimit"],
  "budget.incident_resolved": ["amount"],
};

export function activityCarriesCostDetails(action: unknown) {
  return typeof action === "string" && action in COST_DETAIL_KEYS_BY_ACTION;
}

export function withholdActivityCostDetails<T extends { action?: unknown; details?: unknown }>(entry: T): T {
  if (!activityCarriesCostDetails(entry.action)) return entry;
  const details = entry.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return entry;
  const keys = COST_DETAIL_KEYS_BY_ACTION[entry.action as string]!;
  const withheld: Record<string, unknown> = { ...(details as Record<string, unknown>) };
  for (const key of keys) {
    if (key in withheld) withheld[key] = null;
  }
  return { ...entry, details: withheld };
}
