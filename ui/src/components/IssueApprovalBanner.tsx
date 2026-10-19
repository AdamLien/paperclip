import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Issue } from "@paperclipai/shared";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { formatUserLabel } from "../lib/assignees";

export function IssueApprovalBanner({ issue, currentUserId, userLabels, onDecision }: {
  issue: Issue;
  currentUserId: string | null;
  userLabels: ReadonlyMap<string, string>;
  onDecision: (data: { status: "done" | "in_progress"; comment: string }) => Promise<unknown>;
}) {
  const { i18n } = useTranslation();
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = issue.executionState;
  const participant = state?.currentParticipant;
  if (issue.status !== "in_review" || state?.status !== "pending" ||
      state.currentStageType !== "approval" || participant?.type !== "user") return null;
  const zh = i18n.resolvedLanguage === "zh-TW";
  const name = formatUserLabel(participant.userId, userLabels) ?? (zh ? "核准人" : "approver");
  const canDecide = !!currentUserId && currentUserId === participant.userId;
  const submit = async (status: "done" | "in_progress") => {
    if (pending || !canDecide || !comment.trim()) return;
    setPending(true);
    setError(null);
    try {
      await onDecision({ status, comment: comment.trim() });
      setComment("");
    } catch (err) {
      setError(err instanceof Error ? err.message : (zh ? "送出失敗，請重試。" : "Could not submit decision. Try again."));
    } finally {
      setPending(false);
    }
  };
  return <section aria-label={zh ? "任務核准" : "Task approval"} className="rounded-md border border-border bg-accent/30 p-3 space-y-3">
    <p role="status" className="text-sm font-medium">{zh ? `等待 ${name} 核准` : `Waiting for ${name} to approve`}</p>
    {canDecide ? <>
      <Textarea aria-label={zh ? "審核意見" : "Decision comment"} placeholder={zh ? "請填寫核准意見或需修改的內容" : "Explain your approval or the required changes"} value={comment} onChange={(event) => setComment(event.target.value)} disabled={pending} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || !comment.trim()} onClick={() => void submit("done")}>{zh ? "核准" : "Approve"}</Button>
        <Button variant="outline" disabled={pending || !comment.trim()} onClick={() => void submit("in_progress")}>{zh ? "退回修改" : "Request changes"}</Button>
      </div>
    </> : <p className="text-sm text-muted-foreground">{zh ? "由指定核准人登入後操作。" : "The assigned approver must sign in to submit a decision."}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
