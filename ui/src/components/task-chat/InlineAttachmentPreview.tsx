import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { IssueAttachment } from "@paperclipai/shared";
import { Download, Maximize2 } from "lucide-react";
import { attachmentDownloadPath, isAudioAttachment, isHtmlAttachment, isMarkdownAttachment, isMermaidAttachment, isVideoAttachment } from "@/lib/issue-attachments";
import { isOfficeAttachment, isPdfAttachment } from "@/lib/attachment-preview";

const AttachmentPanel = lazy(() => import("../task-side-panel/TaskAttachmentPanel").then(module => ({ default: module.TaskAttachmentPanel })));

export function canPreviewInline(file: IssueAttachment) {
  return isOfficeAttachment(file) || isPdfAttachment(file) || isAudioAttachment(file) || isVideoAttachment(file)
    || isHtmlAttachment(file) || isMarkdownAttachment(file) || isMermaidAttachment(file);
}

/** Only visible cards mount a viewer; old conversation files must not all convert at once. */
export function InlineAttachmentPreview({ attachment, onExpand }: { attachment: IssueAttachment; onExpand?: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!card.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "120px" });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, []);
  const title = attachment.originalFilename ?? "附件";
  return <div ref={card} className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-background" data-testid="inline-attachment-preview">
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm" title={title}>{title}</span>
      {onExpand ? <button type="button" aria-label={`Open ${title}`} title="放大閱讀" className="shrink-0 rounded p-2 hover:bg-muted" onClick={onExpand}><Maximize2 size={16} /></button> : null}
      <a href={attachmentDownloadPath(attachment)} download aria-label={`下載原檔 ${title}`} title="下載原檔" className="shrink-0 rounded p-2 hover:bg-muted"><Download size={16} /></a>
    </div>
    <div className={isAudioAttachment(attachment) ? "h-40" : "h-[420px] max-h-[65vh] min-h-48"}>
      {visible ? <Suspense fallback={<p role="status" className="p-4 text-sm">載入預覽…</p>}>
        <AttachmentPanel issueId={attachment.issueId} attachmentId={attachment.id} embedded />
      </Suspense> : <p className="p-4 text-sm text-muted-foreground">附件將在捲動至此處時直接顯示。</p>}
    </div>
  </div>;
}
