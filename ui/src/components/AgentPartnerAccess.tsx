import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accessApi } from "../api/access";
import { agentsApi, type AgentVisibility } from "../api/agents";
import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { translateUiLiteral } from "@/i18n/LegacyLiteralLocalizer";
import { useToastActions } from "../context/ToastContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Lets a workspace manager choose who can find and use an AI partner. The
 * server enforces the choice; this only edits it.
 */
export function AgentPartnerAccess({ agentId, companyId }: { agentId: string; companyId: string }) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const visibilityQuery = useQuery({
    queryKey: queryKeys.agents.visibility(agentId),
    queryFn: () => agentsApi.visibility(agentId, companyId),
  });
  const membersQuery = useQuery({
    queryKey: queryKeys.access.companyMembers(companyId),
    queryFn: () => accessApi.listMembers(companyId),
  });
  const [draft, setDraft] = useState<AgentVisibility | null>(null);
  useEffect(() => {
    if (visibilityQuery.data) setDraft(visibilityQuery.data);
  }, [visibilityQuery.data]);

  const members = useMemo(
    () =>
      (membersQuery.data?.members ?? []).filter(
        (member) =>
          member.status === "active" &&
          member.membershipRole !== "owner" &&
          member.membershipRole !== "admin",
      ),
    [membersQuery.data],
  );

  const save = useMutation({
    mutationFn: (next: AgentVisibility) => agentsApi.updateVisibility(agentId, next, companyId),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.agents.visibility(agentId), saved);
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
      pushToast({ title: translateUiLiteral("Partner access saved"), tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: translateUiLiteral("Could not save partner access"),
        body: err instanceof ApiError || err instanceof Error ? err.message : undefined,
        tone: "error",
      });
    },
  });

  if (!draft) return null;
  const isPrivate = draft.mode === "private";
  const dirty =
    draft.mode !== visibilityQuery.data?.mode ||
    [...draft.allowedUserIds].sort().join() !== [...(visibilityQuery.data?.allowedUserIds ?? [])].sort().join();

  const toggleMember = (userId: string, checked: boolean) =>
    setDraft({
      ...draft,
      allowedUserIds: checked
        ? [...draft.allowedUserIds, userId]
        : draft.allowedUserIds.filter((id) => id !== userId),
    });

  return (
    <section data-testid="agent-partner-access">
      <h3 className="text-sm font-medium mb-3">Who can use this partner</h3>
      <div className="border border-border rounded-lg p-4 space-y-4 text-sm">
        <fieldset className="space-y-2">
          <legend className="sr-only">Who can use this partner</legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name={`partner-access-${agentId}`}
              checked={!isPrivate}
              onChange={() => setDraft({ mode: "discoverable", allowedUserIds: [] })}
            />
            <span>Everyone in this workspace</span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name={`partner-access-${agentId}`}
              checked={isPrivate}
              onChange={() => setDraft({ ...draft, mode: "private" })}
            />
            <span>Only selected members</span>
          </label>
        </fieldset>
        {isPrivate ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Owners and admins can always see this partner. Other members cannot find it, open it, or give it work.</p>
            {members.length === 0 ? (
              <p className="text-xs text-muted-foreground">No other members in this workspace yet.</p>
            ) : (
              <ul className="space-y-2">
                {members.map((member) => (
                  <li key={member.principalId}>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={draft.allowedUserIds.includes(member.principalId)}
                        onCheckedChange={(checked) => toggleMember(member.principalId, checked === true)}
                      />
                      <span>{member.user?.name ?? member.user?.email ?? member.principalId}</span>
                      {member.user?.name && member.user.email ? (
                        <span className="text-xs text-muted-foreground">{member.user.email}</span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>Save access</Button>
        </div>
      </div>
    </section>
  );
}
