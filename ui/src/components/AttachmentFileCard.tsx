import type { IssueAttachment } from "@paperclipai/shared";
import { FileText, Image, Music, Play, Presentation } from "lucide-react";
import { formatFileSize } from "./task-chat/task-chat-attachments";
import { isAudioAttachment, isImageAttachment, isVideoAttachment } from "@/lib/issue-attachments";

type File = Pick<IssueAttachment, "id" | "originalFilename" | "contentType" | "byteSize">;

/** A single, predictable action for every attached file; viewers load on demand. */
export function AttachmentFileCard({ attachment, onOpen }: { attachment: File; onOpen: () => void }) {
  const title = attachment.originalFilename ?? "附件";
  const image = isImageAttachment(attachment);
  const Icon = image ? Image : isVideoAttachment(attachment) ? Play : isAudioAttachment(attachment) ? Music : /\.pptx?$/i.test(title) ? Presentation : FileText;
  const kind = title.split(".").pop()?.toUpperCase();
  const size = formatFileSize(attachment.byteSize);
  return <button type="button" onClick={onOpen} aria-label={`預覽 ${title}`} data-testid="attachment-file-card"
    className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-muted/30 p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="size-5" aria-hidden /></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={title}>{title}</span>
      <span className="block text-xs text-muted-foreground">{[kind, size, "點一下閱讀"].filter(Boolean).join(" · ")}</span></span>
  </button>;
}
