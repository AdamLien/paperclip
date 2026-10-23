import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createOfficePreview, officePreviewExtension, officeSandboxArgs, OFFICE_PREVIEW_MAX_BYTES } from "../services/office-preview.js";

describe("isolated Office previews", () => {
  it("accepts only supported document extensions, not caller-controlled commands or paths", () => {
    for (const extension of ["pptx", "docx", "xlsx", "ppt", "doc", "xls", "odp", "odt", "ods", "rtf"]) {
      expect(officePreviewExtension(`report.${extension.toUpperCase()}`)).toBe(`.${extension}`);
    }
    for (const name of ["script.sh", "slide.pptx.exe", "file.pdf", "file", "report.pptm"]) expect(officePreviewExtension(name)).toBeNull();
    expect(() => officeSandboxArgs("/tmp/private", ".pptx;curl example.com")).toThrow();
  });
  it("unshares the network and exposes only system files plus the isolated job directory", () => {
    const args = officeSandboxArgs("/tmp/private-job", ".pptx");
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--clearenv");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("--die-with-parent");
    expect(args).toContain("--cpu=40");
    expect(args).toContain("--as=2147483648");
    expect(args).toContain("--fsize=41943040");
    expect(args.filter((arg) => arg === "--bind")).toHaveLength(1);
    expect(args.slice(args.indexOf("--bind"), args.indexOf("--bind") + 3)).toEqual(["--bind", "/tmp/private-job", "/work"]);
    expect(args).not.toContain("/home");
    expect(args).not.toContain("--share-net");
    expect(args.at(-1)).toBe("/work/input.pptx");
  });
  it("rejects unsupported and oversized files before starting a converter", async () => {
    await expect(createOfficePreview({ filename: "bad.exe", byteSize: 3, stream: Readable.from("bad") })).rejects.toMatchObject({ status: 415 });
    await expect(createOfficePreview({ filename: "large.pptx", byteSize: OFFICE_PREVIEW_MAX_BYTES + 1, stream: Readable.from("bad") })).rejects.toMatchObject({ status: 413 });
  });
});
