import { useQuery } from "@tanstack/react-query";
import { agentsApi } from "@/api/agents";
import { authApi } from "@/api/auth";
import { useCompany } from "@/context/CompanyContext";
import { findPersonalAssistant } from "@/lib/personal-assistant";
import { queryKeys } from "@/lib/queryKeys";
import { agentRouteRef } from "@/lib/utils";
import { useAgentChatEnabled } from "./useAgentChatEnabled";

export function usePersonalAssistant() {
  const { selectedCompanyId } = useCompany();
  const { enabled } = useAgentChatEnabled();
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession() });
  const roster = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: enabled && !!selectedCompanyId,
  });
  const userId = session.data?.user?.id ?? session.data?.session?.userId ?? null;
  const agent = enabled && session.isSuccess && roster.isSuccess
    ? findPersonalAssistant(roster.data, selectedCompanyId, userId) : null;
  return agent ? { agent, to: `/chats/${encodeURIComponent(agentRouteRef(agent))}` } : null;
}
