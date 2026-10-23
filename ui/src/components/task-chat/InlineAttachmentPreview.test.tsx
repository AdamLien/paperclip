// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { IssueAttachment } from "@paperclipai/shared";
import { InlineAttachmentPreview } from "./InlineAttachmentPreview";

vi.mock("../task-side-panel/TaskAttachmentPanel", () => ({ TaskAttachmentPanel: ({ issueId, attachmentId, embedded }: { issueId: string; attachmentId: string; embedded?: boolean }) => <div data-testid="viewer">{issueId}/{attachmentId}/{String(embedded)}</div> }));
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

it("automatically mounts the authorized task viewer only while visible and keeps download separate", async () => {
  let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: typeof intersect) { intersect = callback; } observe() {} disconnect = disconnect; });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const expand = vi.fn();
  const file = { id: "report", issueId: "authorized-issue", originalFilename: "report.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", contentPath: "/api/attachments/report/content", downloadPath: "/api/attachments/report/content?download=1" } as IssueAttachment;
  flushSync(() => root.render(<InlineAttachmentPreview attachment={file} onExpand={expand} />));
  expect(container.querySelector('[data-testid="viewer"]')).toBeNull();
  await act(async () => intersect([{ isIntersecting: true }]));
  expect(container.querySelector('[data-testid="viewer"]')?.textContent).toBe("authorized-issue/report/true");
  expect(expand).not.toHaveBeenCalled();
  const download = container.querySelector("a[download]");
  expect(download?.getAttribute("href")).toBe("/api/attachments/report/content?download=1");
  flushSync(() => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(expand).toHaveBeenCalledOnce();
  await act(async () => intersect([{ isIntersecting: false }]));
  expect(container.querySelector('[data-testid="viewer"]')).toBeNull();
  flushSync(() => root.unmount());
  expect(disconnect).toHaveBeenCalledOnce();
});
