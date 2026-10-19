// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Issue } from "@paperclipai/shared";
import { setLocale } from "../i18n";
import { IssueApprovalBanner } from "./IssueApprovalBanner";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
const issue = { id: "task", status: "in_review", executionState: { status: "pending", currentStageType: "approval", currentParticipant: { type: "user", userId: "adam" } } } as Issue;
const onDecision = vi.fn();
async function render(user = "adam", task = issue) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<IssueApprovalBanner issue={task} currentUserId={user} userLabels={new Map([["adam", "Adam"]])} onDecision={onDecision} />));
}
async function comment(value: string) {
  const field = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
afterEach(async () => { if(root) await act(async () => root.unmount()); host?.remove(); setLocale("en"); vi.resetAllMocks(); });
it("shows the named approver and switches language on the mounted banner", async () => {
  setLocale("zh-TW"); await render();
  expect(host.textContent).toContain("等待 Adam 核准");
  expect([...host.querySelectorAll("button")].map(b => b.textContent)).toEqual(["核准", "退回修改"]);
  expect(host.querySelector("button")?.disabled).toBe(true);
  await act(async () => { setLocale("en"); });
  expect(host.textContent).toContain("Waiting for Adam to approve");
});
it.each([[0, "done"], [1, "in_progress"]] as const)("submits decision %s with a required comment through the existing update", async (index, status) => {
  await render(); await comment("  Checked report  ");
  await act(async () => host.querySelectorAll("button")[index].click());
  expect(onDecision).toHaveBeenCalledExactlyOnceWith({status, comment: "Checked report"});
});
it("shows pending approval without actions for another user", async () => {
  await render("blake"); expect(host.textContent).toContain("Adam"); expect(host.querySelector("button")).toBeNull();
});
it("does not offer approval for a review or completed stage", async () => {
  await render("adam", {...issue, status: "done"}); expect(host.textContent).toBe("");
});
it("keeps the comment and reports a failed decision", async () => {
  onDecision.mockRejectedValue(new Error("Forbidden")); await render(); await comment("Please revise");
  await act(async () => host.querySelectorAll("button")[1].click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Forbidden");
  expect(host.querySelector("textarea")?.value).toBe("Please revise");
});
