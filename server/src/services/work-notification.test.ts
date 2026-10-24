import { describe, expect, it } from "vitest";
import { workNotification } from "./work-notification.js";
describe("work notification policy", () => {
 it("only notifies final transitions and approval requests, without private details", () => {
  const issue={action:"issue.updated",entityType:"issue",entityId:"id",details:{status:"done",_previous:{status:"in_progress"},title:"PRIVATE"}};
  expect(workNotification(issue)?.kind).toBe("completed");
  expect(JSON.stringify(workNotification(issue))).not.toContain("PRIVATE");
  expect(workNotification({...issue,details:{status:"done",_previous:{status:"done"}}})).toBeNull();
  expect(workNotification({...issue,details:{status:"done"}})).toBeNull();
  expect(workNotification({...issue,details:{status:"blocked",_previous:{status:"in_progress"}}})?.kind).toBe("failed");
  expect(workNotification({...issue,action:"issue.comment_added"})).toBeNull();
  expect(workNotification({action:"approval.created",entityType:"approval",entityId:"id",details:null})?.route).toBe("approvals");
 });
});
