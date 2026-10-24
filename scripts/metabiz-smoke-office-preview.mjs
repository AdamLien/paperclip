#!/usr/bin/env node
// Run on Linux using the checked-in synthetic fixtures. Pass a built service path.
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const service = process.argv[2];
if (!service) throw new Error("Usage: node scripts/metabiz-smoke-office-preview.mjs BUILT_OFFICE_PREVIEW_JS");
const { createOfficePreview } = await import(pathToFileURL(resolve(service)).href);
for (const filename of ["slides.pptx", "letter.docx", "sheet.xlsx"]) {
  const path = resolve("server/src/__fixtures__/office-preview", filename);
  const start = Date.now();
  const pdf = await createOfficePreview({ filename, byteSize: (await stat(path)).size, stream: createReadStream(path) });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const result = spawnSync("pdfinfo", ["-"], { input: pdf, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const pages = Number(result.stdout.match(/Pages:\s+(\d+)/)?.[1]);
  assert.equal(pages, filename === "slides.pptx" ? 2 : 1);
  console.log(JSON.stringify({ filename, pdfBytes: pdf.length, pages, elapsedMs: Date.now() - start }));
}
