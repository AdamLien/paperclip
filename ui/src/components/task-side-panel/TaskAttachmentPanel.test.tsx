// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskAttachmentPanel, TextAttachmentPreview, readTextPreview, TEXT_PREVIEW_MAX_BYTES } from "./TaskAttachmentPanel";
import { isAudioAttachment, isMermaidAttachment, isHtmlAttachment, isTextAttachment } from "@/lib/issue-attachments";
import { readTaskSidePanelState, taskPanelAttachmentTab, writeTaskSidePanelState } from "@/lib/task-side-panel-state";
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <article data-rendered>{children}</article> }));
vi.mock("./PdfAttachmentPreview", () => ({ default: ({ url }: { url: string }) => <div data-pdf-url={url}>文件預覽</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals(); });

describe("text attachment tabs", () => {
  it.each([
    ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "?preview=pdf"],
    ["letter.docx", "application/octet-stream", "?preview=pdf"],
    ["sheet.xlsx", "application/octet-stream", "?preview=pdf"],
    ["report.pdf", "application/pdf", ""],
  ])("opens %s in the app and keeps original download separate", async (name, type, query) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(queryKeys.issues.attachments("task"), [{ id: "document", originalFilename: name, contentType: type, byteSize: 5_000_000, contentPath: "/api/attachments/document/content" }]);
    const host = document.createElement("div"); const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><TaskAttachmentPanel issueId="task" attachmentId="document" /></QueryClientProvider>));
    expect(host.querySelector("[data-pdf-url]")?.getAttribute("data-pdf-url")).toBe(`/api/attachments/document/content${query}`);
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/api/attachments/document/content?download=1");
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => root.render(<QueryClientProvider client={client}><TaskAttachmentPanel issueId="task" attachmentId="not-authorized" /></QueryClientProvider>));
    expect(host.querySelector("[data-pdf-url]")).toBeNull();
    await act(async () => root.unmount()); client.clear();
  });
  it("does not fetch missing or oversized attachments and offers download for oversized files", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(queryKeys.issues.attachments("task"), [{ id: "large", originalFilename: "large.txt", contentType: "text/plain", byteSize: TEXT_PREVIEW_MAX_BYTES + 1, contentPath: "/api/attachments/large/content" }]);
    const host = document.createElement("div"); const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><TaskAttachmentPanel issueId="task" attachmentId="missing" /></QueryClientProvider>));
    expect(host.textContent).toContain("File no longer available");
    await act(async () => root.render(<QueryClientProvider client={client}><TaskAttachmentPanel issueId="task" attachmentId="large" /></QueryClientProvider>));
    expect(host.textContent).toContain("too large");
    expect(host.querySelector("a")?.textContent).toBe("Download file");
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => root.unmount()); client.clear();
  });

  it("previews audio with native controls only after resolving the task attachment", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    client.setQueryData(queryKeys.issues.attachments("task"), [{
      id: "audio", originalFilename: "meeting.mp3", contentType: "audio/mpeg", byteSize: TEXT_PREVIEW_MAX_BYTES + 1,
      contentPath: "/api/attachments/audio/content",
    }]);
    const host = document.createElement("div"); const root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={client}><TaskAttachmentPanel issueId="task" attachmentId="audio" /></QueryClientProvider>));
    const audio = host.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("/api/attachments/audio/content");
    expect(audio?.hasAttribute("controls")).toBe(true);
    expect(audio?.hasAttribute("autoplay")).toBe(false);
    expect(host.querySelector("a")?.getAttribute("href")).toContain("download=1");
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => audio!.dispatchEvent(new Event("error")));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("無法播放");
    await act(async () => root.render(<QueryClientProvider client={client}><TaskAttachmentPanel issueId="task" attachmentId="other-company-audio" /></QueryClientProvider>));
    expect(host.querySelector("audio")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => root.unmount()); client.clear();
  });
  it("recognizes audio and Mermaid without overriding a specific conflicting MIME type", () => {
    expect(isAudioAttachment({ contentType: "audio/mpeg" })).toBe(true);
    expect(isAudioAttachment({ contentType: "application/octet-stream", originalFilename: "meeting.m4a" })).toBe(true);
    expect(isAudioAttachment({ contentType: "image/png", originalFilename: "fake.mp3" })).toBe(false);
    expect(isMermaidAttachment({ contentType: "text/plain", originalFilename: "flow.mmd" })).toBe(true);
    expect(isMermaidAttachment({ contentType: "application/vnd.mermaid" })).toBe(true);
    expect(isMermaidAttachment({ contentType: "application/zip", originalFilename: "fake.mmd" })).toBe(false);
  });
  it("classifies text without treating PDF or images as text", () => {
    for (const [contentType, originalFilename] of [["text/plain", "notes.txt"], ["application/octet-stream", "AGENTS.md"], ["application/json", "report.json"]]) expect(isTextAttachment({ contentType, originalFilename })).toBe(true);
    expect(isTextAttachment({ contentType: "application/pdf", originalFilename: "report.pdf" })).toBe(false);
    expect(isTextAttachment({ contentType: "image/png", originalFilename: "fake.txt" })).toBe(false);
    expect(isHtmlAttachment({ contentType: "text/html; charset=utf-8", originalFilename: "report" })).toBe(true);
    expect(isHtmlAttachment({ contentType: "application/octet-stream", originalFilename: "report.htm" })).toBe(true);
    expect(isHtmlAttachment({ contentType: "image/png", originalFilename: "fake.html" })).toBe(false);
  });
  it("retains attachment tabs when workspace browsing is disabled", () => {
    const tab = taskPanelAttachmentTab("file-1", "AGENTS.md");
    writeTaskSidePanelState("user", "company", "task", { state: { tabs: [tab], activeTabId: tab.id }, launcherOpen: false, userInteracted: true, autoPlanHandled: false, updatedAt: 1 });
    expect(readTaskSidePanelState("user", "company", "task", false)?.state.tabs).toEqual([tab]);
    expect(taskPanelAttachmentTab("file-1", "Renamed.md").id).toBe(tab.id);
  });
  it("switches rendered/raw Markdown and keeps a download action", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<TextAttachmentPreview title="AGENTS.md" markdown text="# Charter" downloadUrl="/api/attachments/file-1/content?download=1" />));
    expect(host.querySelector("[data-rendered]")).not.toBeNull();
    const raw = host.querySelector<HTMLButtonElement>('button[aria-label="Raw"]');
    const rendered = host.querySelector<HTMLButtonElement>('button[aria-label="Rendered"]');
    expect(raw?.querySelector("svg")).not.toBeNull();
    expect(rendered?.querySelector("svg")).not.toBeNull();
    expect(raw?.textContent).toBe("");
    await act(async () => raw!.click());
    expect(host.querySelector("pre")?.textContent).toBe("# Charter");
    expect(host.querySelector("a")?.getAttribute("href")).toContain("download=1");
    await act(async () => rendered!.click());
    expect(host.querySelector("[data-rendered]")).not.toBeNull();
    await act(async () => root.unmount()); host.remove();
  });
  it("shows plain text literally without Markdown controls", async () => {
    const host = document.createElement("div"); const root = createRoot(host);
    await act(async () => root.render(<TextAttachmentPreview title="notes.txt" markdown={false} text="<script>alert(1)</script>" downloadUrl="/download" />));
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("pre")?.textContent).toContain("<script>");
    expect(host.querySelector('[aria-label="Markdown view"]')).toBeNull();
    expect(host.querySelector('a[aria-label="Download notes.txt"] svg')).not.toBeNull();
    await act(async () => root.unmount());
  });
  it("renders HTML reports in an opaque, offline sandbox and retains source/download controls", async () => {
    const host = document.createElement("div"); const root = createRoot(host);
    const html = '<h1>申皇報告</h1><style>h1{color:red}</style><script>parent.document.body.remove()</script><meta http-equiv="refresh" content="0;url=https://example.com"><a href="https://example.com" ping="https://example.com">link</a><img src="https://example.com/private"><form action="https://example.com"><input></form>';
    await act(async () => root.render(<TextAttachmentPreview title="report.html" markdown={false} html text={html} downloadUrl="/download" />));
    const frame = host.querySelector("iframe")!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    const preview = new DOMParser().parseFromString(frame.getAttribute("srcdoc")!, "text/html");
    expect(preview.querySelector("h1")?.textContent).toBe("申皇報告");
    expect([...preview.querySelectorAll("style")].some((style) => style.textContent?.includes("color:red"))).toBe(true);
    expect(preview.querySelector("script,form,meta[http-equiv=refresh]")).toBeNull();
    expect(preview.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(preview.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(preview.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("default-src 'none'");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Raw"]')!.click());
    expect(host.querySelector("pre")?.textContent).toBe(html);
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/download");
    await act(async () => root.unmount());
  });
  it("rejects HTTP errors, oversized responses and binary data", async () => {
    await expect(readTextPreview(new Response("denied", { status: 403 }))).rejects.toThrow("403");
    await expect(readTextPreview(new Response("x".repeat(TEXT_PREVIEW_MAX_BYTES + 1)))).rejects.toThrow("too large");
    await expect(readTextPreview(new Response("binary\0data"))).rejects.toThrow("binary");
    expect(await readTextPreview(new Response(""))).toBe("");
    expect(await readTextPreview(new Response("héllo"))).toBe("héllo");
  });
});
