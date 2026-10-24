// Shared by the durable FCM outbox and desktop inbox. Do not expose activity
// details (which may contain customer data) in lock-screen notifications.
export function workNotification(activity: { action: string; entityType: string; entityId: string; details: unknown }) {
  const details = activity.details as Record<string, unknown> | null;
  const previous = details?._previous as Record<string, unknown> | undefined;
  if (activity.entityType === "issue" && activity.action === "issue.updated" && typeof previous?.status === "string" && previous.status !== details?.status) {
    if (details?.status === "done") return { kind: "completed", title: "工作已完成", body: "你的工作已有結果，點擊查看。", route: "issues" } as const;
    if (details?.status === "blocked") return { kind: "failed", title: "工作需要你協助", body: "工作遇到阻礙，點擊查看處理方式。", route: "issues" } as const;
  }
  if (activity.entityType === "approval" && ["approval.created", "approval.resubmitted"].includes(activity.action)) {
    return { kind: "approval", title: "有操作需要核准", body: "請查看操作內容並決定是否核准。", route: "approvals" } as const;
  }
  return null;
}
