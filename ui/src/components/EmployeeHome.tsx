import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Issue } from "@paperclipai/shared";
import { Link, useNavigate } from "@/lib/router";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl, issueUrl } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusIcon } from "./StatusIcon";

const LIST_LIMIT = 5;
const TITLE_LIMIT = 120;

/** Title for a question task: its first non-empty line, kept within a short length. */
function questionTitle(question: string): string {
  const firstLine = question.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return firstLine.length > TITLE_LIMIT ? `${firstLine.slice(0, TITLE_LIMIT - 1)}…` : firstLine;
}

function IssueList({ issues, empty, testId }: { issues: Issue[]; empty: string; testId: string }) {
  return (
    <Card data-testid={testId} className="@container block py-0 divide-y divide-border overflow-hidden">
      {issues.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        issues.slice(0, LIST_LIMIT).map((issue) => (
          <Link
            key={issue.id}
            to={issueUrl(issue)}
            className="dashboard-list-row flex items-center gap-2 text-sm no-underline text-inherit hover:bg-accent/50 transition-colors"
          >
            <StatusIcon status={issue.status} />
            <span className="min-w-0 flex-1 truncate" title={issue.title}>{issue.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(issue.updatedAt)}</span>
          </Link>
        ))
      )}
    </Card>
  );
}

/**
 * Home for members who do not manage the workspace: ask an AI partner first,
 * then their own partners, tasks and results. Management figures (spend,
 * paused agents, approvals) stay on the managers' dashboard.
 */
export function EmployeeHome({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [chosenAgentId, setChosenAgentId] = useState("");

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });
  const { data: myIssues } = useQuery({
    queryKey: [...queryKeys.issues.listMineByMe(companyId), "employee-home"] as const,
    queryFn: () => issuesApi.list(companyId, { touchedByUserId: "me", limit: 50 }),
  });

  const partners = (agents ?? []).filter((agent) => agent.status !== "terminated");
  const partnerId = chosenAgentId || partners[0]?.id || "";
  const openTasks = (myIssues ?? []).filter((issue) => issue.status !== "done" && issue.status !== "cancelled");
  const results = (myIssues ?? []).filter((issue) => issue.status === "done");

  const ask = useMutation({
    mutationFn: () => issuesApi.create(companyId, {
      title: questionTitle(question),
      description: question.trim(),
      status: "todo",
      assigneeAgentId: partnerId,
    }),
    onSuccess: async (issue) => {
      setQuestion("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
      navigate(issueUrl(issue));
    },
  });

  const canSend = question.trim().length > 0 && partnerId !== "" && !ask.isPending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) ask.mutate();
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-2">
        <h2 className="text-lg font-semibold">What can your AI partner help with?</h2>
        <Textarea
          aria-label="Ask your AI partner"
          placeholder="Ask a question or describe the work you need"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          className="min-h-24"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {partners.length === 0 ? (
            <span className="mr-auto text-sm text-muted-foreground">No AI partners yet. Ask a workspace admin to add one.</span>
          ) : (
            <select
              aria-label="AI partner"
              value={partnerId}
              onChange={(event) => setChosenAgentId(event.target.value)}
              className="mr-auto rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            >
              {partners.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          )}
          {ask.isError && <span className="text-sm text-destructive">{ask.error.message}</span>}
          <Button type="submit" disabled={!canSend}>
            {ask.isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>

      <div className="grid gap-4 md:grid-cols-3">
        <section className="min-w-0">
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">My AI partners</h3>
          <Card className="block py-0 divide-y divide-border overflow-hidden">
            {partners.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No AI partners yet.</p>
            ) : (
              partners.map((agent) => (
                <Link
                  key={agent.id}
                  to={agentUrl(agent)}
                  className="dashboard-list-row flex items-center gap-2 text-sm no-underline text-inherit hover:bg-accent/50 transition-colors"
                >
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                </Link>
              ))
            )}
          </Card>
        </section>

        <section className="min-w-0">
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">My tasks</h3>
          <IssueList issues={openTasks} empty="No open tasks." testId="employee-home-tasks" />
        </section>

        <section className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">My results</h3>
            <Link to="/artifacts" className="text-xs underline underline-offset-2 text-muted-foreground">All results</Link>
          </div>
          <IssueList issues={results} empty="No finished tasks yet." testId="employee-home-results" />
        </section>
      </div>
    </div>
  );
}
