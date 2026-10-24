import { useCallback, useState, type ReactNode, type MouseEvent } from "react";
import type { IssueAttachment } from "@paperclipai/shared";
import { Download, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TaskAttachmentPanel } from "./task-side-panel/TaskAttachmentPanel";
import { TextAttachmentContext } from "@/context/TextAttachmentContext";
import { IssueGalleryContext } from "@/context/IssueGalleryContext";
import { attachmentDownloadPath } from "@/lib/issue-attachments";

/** All conversation attachment entry points share the same full-screen reader. */
export function AttachmentPreviewProvider({ issueId, attachments, children, fallbackGallery }: {
  issueId: string;
  attachments: IssueAttachment[];
  children: ReactNode;
  fallbackGallery: (src: string) => boolean;
}) {
  const [selected, setSelected] = useState<{ issueId: string; id: string } | null>(null);
  const file = selected?.issueId === issueId ? attachments.find(a => a.id === selected.id) : undefined;
  const open = useCallback((id: string) => setSelected({ issueId, id }), [issueId]);
  const find = useCallback((src: string) => {
    try {
      const url = new URL(src, window.location.href);
      if (url.origin !== window.location.origin) return undefined;
      const match = /^\/api\/attachments\/([^/]+)\/content$/.exec(url.pathname);
      return match ? attachments.find(a => a.id === match[1]) : undefined;
    } catch { return undefined; }
  }, [attachments]);
  const gallery = useCallback((src: string) => {
    const attachment = find(src);
    if (!attachment) return fallbackGallery(src);
    open(attachment.id); return true;
  }, [find, fallbackGallery, open]);
  const interceptLink = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(target instanceof HTMLAnchorElement) || target.hasAttribute("download")) return;
    const url = new URL(target.href, window.location.href);
    if (url.searchParams.get("download") === "1") return;
    const attachment = find(target.href);
    if (attachment) { event.preventDefault(); event.stopPropagation(); open(attachment.id); }
  };
  return <TextAttachmentContext.Provider value={open}><IssueGalleryContext.Provider value={gallery}>
    <div className="contents" onClickCapture={interceptLink}>{children}</div>
    <Dialog open={Boolean(file)} onOpenChange={next => { if (!next) setSelected(null); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined}
        className="!fixed !inset-0 !top-0 !left-0 !flex !h-[100dvh] !w-screen !max-w-none !translate-x-0 !translate-y-0 !flex-col !gap-0 !rounded-none !border-0 !p-0 !pt-[env(safe-area-inset-top)] !pb-[env(safe-area-inset-bottom)]">
        {file ? <>
          <header className="flex shrink-0 items-center gap-2 border-b px-3 py-3">
            <DialogTitle className="min-w-0 flex-1 truncate text-sm" title={file.originalFilename ?? "附件"}>{file.originalFilename ?? "附件"}</DialogTitle>
            <Button asChild variant="outline" size="sm"><a href={attachmentDownloadPath(file)} download><Download aria-hidden />下載</a></Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}><X aria-hidden />關閉</Button>
          </header>
          <div className="min-h-0 flex-1"><TaskAttachmentPanel issueId={issueId} attachmentId={file.id} embedded /></div>
        </> : null}
      </DialogContent>
    </Dialog>
  </IssueGalleryContext.Provider></TextAttachmentContext.Provider>;
}
