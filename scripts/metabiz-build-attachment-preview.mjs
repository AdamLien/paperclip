#!/usr/bin/env node
// Build a Git-pinned overlay for an existing release; no runtime mutation.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, cp, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { transform, version as esbuildVersion } from "esbuild";

const [outputArg, baselineArg, baseRevision] = process.argv.slice(2);
if (!outputArg || !baselineArg || !baseRevision) throw new Error("Usage: node scripts/metabiz-build-attachment-preview.mjs OUTPUT PREVIOUS_ISSUES_JS BASE_GIT_REVISION");
const output = resolve(outputArg);
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git("diff", "HEAD", "--", "server/src", "ui/src", "ui/package.json", "scripts/metabiz-build-attachment-preview.mjs")) throw new Error("Commit source changes before building.");
const baseline = await readFile(resolve(baselineArg));
const options = { loader: "ts", target: "esnext", format: "esm" };
const normalize = async (text) => (await transform(text, { ...options, minifySyntax: true, minifyWhitespace: true })).code;
const baseSource = git("show", `${baseRevision}:server/src/routes/issues.ts`);
if (await normalize(baseSource) !== await normalize(baseline.toString())) throw new Error("Live issue routes do not match the selected Git baseline; refusing an overlay.");
await mkdir(output); // Never overwrite an existing artifact.
for (const path of ["routes/issues", "services/office-preview"]) {
  const result = await transform(await readFile(`server/src/${path}.ts`, "utf8"), options);
  await mkdir(join(output, "server", path.split("/")[0]), { recursive: true });
  await writeFile(join(output, "server", `${path}.js`), result.code);
}
const sourceRevision = git("rev-parse", "HEAD");
execFileSync("rtk", ["--ultra-compact", "pnpm", "--filter", "@paperclipai/ui", "build"], { stdio: "inherit", env: { ...process.env, VITE_BUILD_COMMIT: sourceRevision } });
await cp("ui/dist", join(output, "ui"), { recursive: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const hashes = {};
async function inventory(directory, prefix = "") {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + item.name;
    if (item.isDirectory()) await inventory(join(directory, item.name), `${path}/`);
    else hashes[path] = sha(await readFile(join(directory, item.name)));
  }
}
await inventory(output);
await writeFile(join(output, "manifest.json"), JSON.stringify({ sourceRevision, baseRevision, baselineIssuesSha256: sha(baseline), esbuildVersion, builtAt: new Date().toISOString(), hashes }, null, 2));
console.log(JSON.stringify({ output, sourceRevision, files: Object.keys(hashes).length, activated: false }));
