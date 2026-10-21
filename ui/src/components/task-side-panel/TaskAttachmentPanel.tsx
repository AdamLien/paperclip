import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Code2, Download, Eye } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { Button } from "@/components/ui/button";
import { MarkdownBody } from "@/components/MarkdownBody";
import { attachmentDownloadPath, isAudioAttachment, isMermaidAttachment, isHtmlAttachment, isMarkdownAttachment, isTextAttachment } from "@/lib/issue-attachments";
import { htmlReportPreviewDocument } from "@/lib/html-report-preview";
import { queryKeys } from "@/lib/queryKeys";

export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

/** Bound the actual response, not just producer-supplied attachment metadata. */
export async function readTextPreview(response: Response) {
  if (!response.ok) throw new Error(`Could not load file (${response.status}).`);
  if (!response.body) throw new Error("The file response is empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > TEXT_PREVIEW_MAX_BYTES) throw new Error("This file is too large to preview. Download it instead.");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (text.includes("\0")) throw new Error("This file contains binary data. Download it instead.");
    return text;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export function TextAttachmentPreview({ title, text, markdown, html = false, mermaid = false, downloadUrl }: {
  title: string;
  text: string;
  markdown: boolean;
  html?: boolean;
  mermaid?: boolean;
  downloadUrl: string;
}) {
  const [raw, setRaw] = useState(false);
  const previewDocument = useMemo(() => html ? htmlReportPreviewDocument(text) : null, [html, text]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>{title}</h2>
        {markdown || html || mermaid ? (
          <div className="flex gap-1" role="group" aria-label={html ? "HTML view" : "Markdown view"}>
            <Button size="icon-sm" variant={raw ? "ghost" : "secondary"} aria-label="Rendered" title="Rendered" aria-pressed={!raw} onClick={() => setRaw(false)}>
              <Eye aria-hidden />
            </Button>
            <Button size="icon-sm" variant={raw ? "secondary" : "ghost"} aria-label="Raw" title="Raw" aria-pressed={raw} onClick={() => setRaw(true)}>
              <Code2 aria-hidden />
            </Button>
          </div>
        ) : null}
        <Button asChild variant="ghost" size="icon-sm">
          <a href={downloadUrl} download aria-label={`Download ${title}`} title={`Download ${title}`}><Download aria-hidden /></a>
        </Button>
      </header>
      {html && !raw && previewDocument ? (
        <iframe title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={previewDocument} className="min-h-0 w-full flex-1 border-0 bg-white" />
      ) : <div className="min-h-0 flex-1 overflow-auto p-4">
        {text.length === 0 ? <p className="text-sm text-muted-foreground">File is empty.</p>
          : (markdown || mermaid) && !raw ? <MarkdownBody>{mermaid ? "```mermaid\n" + text + "\n```" : text}</MarkdownBody>
          : <pre className="whitespace-pre-wrap break-words font-mono text-sm" aria-label={`${title} raw text`}>{text}</pre>}
      </div>}
    </div>
  );
}

export function TaskAttachmentPanel({ issueId, attachmentId }: { issueId: string; attachmentId: string }) {
  const [audioError, setAudioError] = useState(false);
  useEffect(() => setAudioError(false), [attachmentId]);
  const attachments = useQuery({
    queryKey: queryKeys.issues.attachments(issueId),
    queryFn: () => issuesApi.listAttachments(issueId),
  });
  // Re-resolve against this task's authorized attachment list; never trust persisted URLs.
  const attachment = attachments.data?.find((item) => item.id === attachmentId);
  const eligible = attachment && (isTextAttachment(attachment) || isMermaidAttachment(attachment)) && attachment.byteSize <= TEXT_PREVIEW_MAX_BYTES;
  const content = useQuery({
    queryKey: ["task-text-attachment", issueId, attachmentId],
    queryFn: async ({ signal }) => readTextPreview(await fetch(
      `/api/attachments/${encodeURIComponent(attachmentId)}/content`,
      { signal, credentials: "same-origin" },
    )),
    enabled: Boolean(eligible),
    retry: false,
  });
  if (attachments.isLoading) return <p className="p-4 text-sm" role="status">Loading file…</p>;
  if (attachments.isError) return <div className="p-4" role="alert">Could not load attachment details. <Button onClick={() => void attachments.refetch()}>Retry</Button></div>;
  if (!attachment) return <p className="p-4 text-sm" role="status">File no longer available. Close this tab or choose another file.</p>;
  const downloadUrl = attachmentDownloadPath(attachment);
  if (isAudioAttachment(attachment)) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{attachment.originalFilename ?? attachment.id}</h2>
          <Button asChild variant="ghost" size="icon-sm">
            <a href={downloadUrl} download aria-label={`Download ${attachment.originalFilename ?? attachment.id}`}><Download aria-hidden /></a>
          </Button>
        </header>
        <div className="space-y-3 p-4">
          <audio controls preload="metadata" src={`/api/attachments/${encodeURIComponent(attachment.id)}/content`}
            aria-label={attachment.originalFilename ?? attachment.id} className="w-full"
            onError={() => setAudioError(true)} />
          {audioError ? <p role="status" className="text-sm text-muted-foreground">無法播放此音訊，可能是格式不支援或連線失敗；請重試或下載檔案。</p> : null}
        </div>
      </div>
    );
  }

  if (!eligible || content.isError) {
    return (
      <div className="space-y-3 p-4" role="alert">
        <p className="text-sm">{content.isError ? "Could not preview this file. Retry or download it." : "This file is too large or is not supported for text preview. Download it instead."}</p>
        {eligible ? <Button onClick={() => void content.refetch()}>Retry</Button> : null}
        <Button asChild variant="outline"><a href={downloadUrl} download>Download file</a></Button>
      </div>
    );
  }
  if (content.data === undefined) return <p className="p-4 text-sm" role="status">Loading file…</p>;
  return <TextAttachmentPreview key={attachment.id} title={attachment.originalFilename ?? attachment.id} text={content.data} markdown={isMarkdownAttachment(attachment)} html={isHtmlAttachment(attachment)} mermaid={isMermaidAttachment(attachment)} downloadUrl={downloadUrl} />;
}
