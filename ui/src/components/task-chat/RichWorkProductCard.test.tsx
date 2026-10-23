// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { IssueWorkProduct } from "@paperclipai/shared";
import { TextAttachmentContext } from "@/context/TextAttachmentContext";
import { RichWorkProductCard } from "./RichWorkProductCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each(["pptx", "html", "png"])("opens generated %s attachments in the common reader instead of downloading", async (extension) => {
  const id = "f045cfd5-9a7a-4058-8f69-109ae605a18f";
  const path = `/api/attachments/${id}/content`;
  const title = `report.${extension}`;
  const product = {
    id: "product", type: "artifact", provider: "paperclip", title,
    status: "ready_for_review", reviewState: "needs_board_review",
    metadata: { attachmentId: id, originalFilename: title, contentType: "application/octet-stream", byteSize: 100,
      contentPath: path, openPath: path, downloadPath: `${path}?download=1` },
  } as unknown as IssueWorkProduct;
  const open = vi.fn(); const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<TextAttachmentContext.Provider value={open}><RichWorkProductCard workProduct={product} href={path} /></TextAttachmentContext.Provider>));
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).not.toContain("Review");
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="預覽 ${title}"]`)!;
    expect(button).not.toBeNull();
    await act(async () => button.click());
    expect(open).toHaveBeenCalledWith(id, title);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
