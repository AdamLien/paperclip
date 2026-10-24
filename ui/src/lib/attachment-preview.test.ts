import { describe, expect, it } from "vitest";
import { isOfficeAttachment, isPdfAttachment } from "./attachment-preview";

describe("attachment document preview classification", () => {
  it("recognizes Office formats with correct MIME or generic upload MIME", () => {
    for (const originalFilename of ["brief.PPTX", "brief.docx", "data.xlsx", "brief.ppt", "brief.doc", "data.xls", "brief.odp"]) {
      expect(isOfficeAttachment({ contentType: "application/octet-stream", originalFilename })).toBe(true);
    }
    expect(isOfficeAttachment({ contentType: "application/vnd.ms-powerpoint", originalFilename: "slides.ppt" })).toBe(true);
  });
  it("does not override conflicting MIME or accept arbitrary files", () => {
    expect(isOfficeAttachment({ contentType: "image/png", originalFilename: "fake.pptx" })).toBe(false);
    expect(isOfficeAttachment({ contentType: "application/octet-stream", originalFilename: "fake.pptx.exe" })).toBe(false);
    expect(isOfficeAttachment({ contentType: "application/zip", originalFilename: "bundle.zip" })).toBe(false);
    expect(isPdfAttachment({ contentType: "application/octet-stream", originalFilename: "report.PDF" })).toBe(true);
    expect(isPdfAttachment({ contentType: "image/png", originalFilename: "fake.pdf" })).toBe(false);
  });
});
