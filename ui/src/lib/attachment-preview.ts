type FileType = { contentType: string; originalFilename?: string | null };
const OFFICE_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.presentation", "application/vnd.oasis.opendocument.spreadsheet",
  "application/rtf", "text/rtf",
]);
const mime = (file: FileType) => file.contentType.toLowerCase().split(";")[0].trim();
export function isOfficeAttachment(file: FileType) {
  const type = mime(file);
  return OFFICE_TYPES.has(type) || (["", "application/octet-stream", "application/zip"].includes(type)
    && /\.(pptx?|docx?|xlsx?|od[pts]|rtf)$/i.test(file.originalFilename ?? ""));
}
export function isPdfAttachment(file: FileType) {
  return mime(file) === "application/pdf" || (["", "application/octet-stream"].includes(mime(file)) && /\.pdf$/i.test(file.originalFilename ?? ""));
}
