import { loadDraft, loadDraftAttachments, loadDraftSubmission } from "../../lib/composer-draft";

/** Move only tracked uploaded images out of legacy draft text. Never rewrite uncertain sends. */
export function loadPreviewDraft(key: string) {
  let body = loadDraft(key);
  const pending = loadDraftSubmission(key);
  const attachments = loadDraftAttachments(key).map((attachment) => {
    if (pending || !attachment.inline) return attachment;
    const path = attachment.contentPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const image = new RegExp(`!\\[(?:\\\\.|[^\\]\\\\])*\\]\\(${path}\\)`, "g");
    if (!image.test(body)) return attachment;
    body = body.replace(image, "");
    return { ...attachment, inline: false };
  });
  return { body, attachments };
}
