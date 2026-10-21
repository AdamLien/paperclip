// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/context/ThemeContext";
import { TextAttachmentPreview } from "./TaskAttachmentPanel";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg aria-label="sequence diagram"><text>Adam → Assistant</text></svg>' })),
}));
vi.mock("mermaid", () => ({ default: mermaid }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Mermaid report previews", () => {
  it.each([false, true])("renders Mermaid in Markdown or a standalone diagram (standalone=%s)", async (standalone) => {
    const source = "sequenceDiagram\n  Adam->>Assistant: Prepare report";
    const text = standalone ? source : "# Workflow\n\n```mermaid\n" + source + "\n```";
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<ThemeProvider><TextAttachmentPreview
        title={standalone ? "flow.mmd" : "report.md"} text={text} markdown={!standalone} mermaid={standalone}
        downloadUrl="/api/attachments/diagram/content?download=1" /></ThemeProvider>));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      expect(host.querySelector('.paperclip-mermaid svg')?.getAttribute("aria-label")).toBe("sequence diagram");
      expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict" }));
      expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), source);
      await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Raw"]')!.click());
      expect(host.querySelector("pre")?.textContent).toBe(text);
      expect(host.querySelector('.paperclip-mermaid')).toBeNull();
      expect(host.querySelector('a[download]')?.getAttribute("href")).toContain("download=1");
    } finally {
      await act(async () => root.unmount()); host.remove();
    }
  });
});
