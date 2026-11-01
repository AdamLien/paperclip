import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, type AgentModelSource as AgentModelSourceValue } from "../api/agents";
import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { translateUiLiteral } from "@/i18n/LegacyLiteralLocalizer";
import { useToastActions } from "../context/ToastContext";
import { Button } from "@/components/ui/button";

/**
 * Lets a workspace manager run an AI partner on the instance's mBase models.
 * The server checks the model and projects mBase access per run; nothing
 * secret is shown or stored here.
 */
export function AgentModelSource({ agentId, companyId }: { agentId: string; companyId: string }) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const stateQuery = useQuery({
    queryKey: queryKeys.agents.modelSource(agentId),
    queryFn: () => agentsApi.modelSource(agentId, companyId),
  });
  const [draft, setDraft] = useState<{ source: "default" | "mbase"; model: string } | null>(null);
  useEffect(() => {
    if (stateQuery.data) {
      setDraft({
        source: stateQuery.data.source,
        model: stateQuery.data.model ?? stateQuery.data.mbase.models[0] ?? "",
      });
    }
  }, [stateQuery.data]);

  const save = useMutation({
    mutationFn: (next: AgentModelSourceValue) => agentsApi.updateModelSource(agentId, next, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.modelSource(agentId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentId) });
      pushToast({ title: translateUiLiteral("Model source saved"), tone: "success" });
    },
    onError: (err) => {
      pushToast({
        title: translateUiLiteral("Could not save the model source"),
        body: err instanceof ApiError || err instanceof Error ? err.message : undefined,
        tone: "error",
      });
    },
  });

  if (stateQuery.isError) {
    return <p className="text-sm text-destructive">Could not load this partner's model source. Refresh the page to try again.</p>;
  }
  const state = stateQuery.data;
  if (!state || !draft) return null;
  // Only offer mBase where it can work, but always let a partner already on mBase switch back.
  if (!state.supported && state.source !== "mbase") return null;

  const models = state.mbase.models;
  const mbaseReady = state.mbase.configured && models.length > 0;
  const dirty = draft.source !== state.source || (draft.source === "mbase" && draft.model !== state.model);
  const canSave = dirty && !save.isPending && (draft.source === "default" || (mbaseReady && models.includes(draft.model)));

  return (
    <section data-testid="agent-model-source">
      <h3 className="text-sm font-medium mb-3">Model source</h3>
      <div className="border border-border rounded-lg p-4 space-y-4 text-sm">
        <fieldset className="space-y-2">
          <legend className="sr-only">Model source</legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name={`model-source-${agentId}`}
              checked={draft.source === "default"}
              onChange={() => setDraft({ ...draft, source: "default" })}
            />
            <span>This partner's own login or AI connection</span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name={`model-source-${agentId}`}
              checked={draft.source === "mbase"}
              disabled={!mbaseReady && state.source !== "mbase"}
              onChange={() => setDraft({ source: "mbase", model: draft.model || models[0] || "" })}
            />
            <span>mBase (your company AI service)</span>
          </label>
        </fieldset>
        {!mbaseReady ? (
          <p className="text-xs text-muted-foreground">mBase is not available on this instance yet. Connect an Anthropic account in Management → mBase first.</p>
        ) : null}
        {draft.source === "mbase" && mbaseReady ? (
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Model</span>
            <select
              className="w-full rounded-md border border-border bg-background px-2 py-1.5"
              value={draft.model}
              onChange={(event) => setDraft({ source: "mbase", model: event.target.value })}
            >
              {models.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            <span className="block text-xs text-muted-foreground">Each run gets mBase access only while it works. Usage appears in mBase usage and logs.</span>
          </label>
        ) : null}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!canSave}
            onClick={() => save.mutate(draft.source === "mbase" ? { source: "mbase", model: draft.model } : { source: "default" })}
          >
            Save model source
          </Button>
        </div>
      </div>
    </section>
  );
}
