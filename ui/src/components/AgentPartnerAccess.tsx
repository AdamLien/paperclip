import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const [draft, setDraft] = useState<AgentVisibility | null>(null);
  useEffect(() => {
    if (visibilityQuery.data) {
      setDraft({ mode: visibilityQuery.data.mode, allowedUserIds: visibilityQuery.data.allowedUserIds });
    }
  }, [visibilityQuery.data]);

  const save = useMutation({
    mutationFn: (next: AgentVisibility) => agentsApi.updateVisibility(agentId, next, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.visibility(agentId) });
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

  if (visibilityQuery.isError) {
    return <p className="text-sm text-destructive">Could not load who can use this partner. Refresh the page to try again.</p>;
  }
  if (!draft) return null;
  const candidates = visibilityQuery.data?.candidates ?? [];
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
            {candidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">No other members in this workspace yet.</p>
            ) : (
              <ul className="space-y-2">
                {candidates.map((member) => (
                  <li key={member.userId}>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={draft.allowedUserIds.includes(member.userId)}
                        onCheckedChange={(checked) => toggleMember(member.userId, checked === true)}
                      />
                      <span>{member.name ?? member.email ?? member.userId}</span>
                      {member.name && member.email ? (
                        <span className="text-xs text-muted-foreground">{member.email}</span>
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
