import type { Agent } from "@paperclipai/shared";

/** Shortcut configuration is scoped to both the active company and signed-in user.
 * This selects navigation only; server conversation permissions remain authoritative. */
export function findPersonalAssistant(agents: Agent[], companyId: string | null, userId: string | null) {
  if (!companyId || !userId) return null;
  const matches = agents.filter(agent => {
    const owners = agent.metadata?.personalAssistantForUserIds;
    return agent.companyId === companyId
      && agent.status !== "terminated" && agent.status !== "pending_approval"
      && Array.isArray(owners) && owners.includes(userId);
  });
  // A conflicting configuration must not silently select somebody else's secretary.
  return matches.length === 1 ? matches[0] : null;
}
