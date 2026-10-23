// @vitest-environment jsdom
import { act, useContext } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { IssueAttachment } from "@paperclipai/shared";
import { AttachmentPreviewProvider } from "./AttachmentPreviewProvider";
import { AttachmentFileCard } from "./AttachmentFileCard";
import { TextAttachmentContext } from "@/context/TextAttachmentContext";
import { queryKeys } from "@/lib/queryKeys";

vi.mock("./task-side-panel/PdfAttachmentPreview", () => ({ default: ({ url }: { url: string }) => <canvas data-url={url} /> }));
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <article>{children}</article> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

function Card({ file }: { file: IssueAttachment }) {
  const open = useContext(TextAttachmentContext)!;
  return <AttachmentFileCard attachment={file} onOpen={() => open(file.id, file.originalFilename!)} />;
}

it.each([["html", "text/html", "iframe"], ["pdf", "application/pdf", "canvas"], ["pptx", "application/octet-stream", "canvas"], ["png", "image/png", "img"], ["mp4", "video/mp4", "video"], ["mp3", "audio/mpeg", "audio"]])("opens %s in one reader with only download and close, and returns to chat", async (ext, type, selector) => {
  const file = { id: "file", issueId: "issue", originalFilename: `report.${ext}`, contentType: type, byteSize: 100, contentPath: "/api/attachments/file/content" } as IssueAttachment;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.issues.attachments("issue"), [file]);
  const fetch = vi.fn().mockResolvedValue(new Response("<h1>Report</h1>")); vi.stubGlobal("fetch", fetch);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = (files = [file], issueId = "issue") => root.render(<QueryClientProvider client={client}><AttachmentPreviewProvider issueId={issueId} attachments={files} fallbackGallery={() => false}><p>對話內容</p><Card file={file} /></AttachmentPreviewProvider></QueryClientProvider>);
  await act(async () => render());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.className).toContain("!h-[100dvh]");
  expect(dialog.querySelectorAll("header")).toHaveLength(1);
  expect(dialog.querySelectorAll("a[download]")).toHaveLength(1);
  expect(dialog.querySelector("a[download]")?.getAttribute("href")).toBe("/api/attachments/file/content?download=1");
  expect(dialog.querySelector("a[download]")?.textContent).toBe("下載");
  await vi.waitFor(() => expect(dialog.querySelector(selector)).not.toBeNull());
  expect(dialog.querySelector('[aria-label="Raw"]')).toBeNull();
  expect(dialog.querySelector("video, audio")?.hasAttribute("autoplay") ?? false).toBe(false);
  await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "關閉")!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toContain("對話內容");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => render([], "other-issue"));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => root.unmount()); client.clear();
});

it("does not display an attachment denied by the authorized task list", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.issues.attachments("issue"), []);
  const file = { id: "foreign", issueId: "issue", originalFilename: "other.html", contentType: "text/html", byteSize: 100 } as IssueAttachment;
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}><AttachmentPreviewProvider issueId="issue" attachments={[file]} fallbackGallery={() => false}><Card file={file} /></AttachmentPreviewProvider></QueryClientProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(document.querySelector("iframe")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  await act(async () => root.unmount()); client.clear();
});
