#!/usr/bin/env node
// Verify and stage a narrow release. Activation/restart remains a separate operation.
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const [runtimeArg, payloadArg, releaseArg] = process.argv.slice(2);
if (!runtimeArg || !payloadArg || !releaseArg) throw new Error("Usage: node scripts/metabiz-stage-attachment-preview.mjs RUNTIME PAYLOAD NEW_RELEASE");
const runtime = resolve(runtimeArg), payload = resolve(payloadArg), release = resolve(releaseArg);
const previous = await realpath(join(runtime, "node_modules/@paperclipai/server"));
const sha = (data) => createHash("sha256").update(data).digest("hex");
const manifest = JSON.parse(await readFile(join(payload, "manifest.json"), "utf8"));
if (sha(await readFile(join(previous, "dist/routes/issues.js"))) !== manifest.baselineIssuesSha256) throw new Error("Live baseline changed; stage refused.");
for (const [path, hash] of Object.entries(manifest.hashes)) {
  if (!resolve(payload, path).startsWith(`${payload}/`) || sha(await readFile(join(payload, path))) !== hash) throw new Error(`Invalid artifact: ${path}`);
}
await mkdir(release);
const server = join(release, "server"); await mkdir(server);
await copyFile(join(previous, "package.json"), join(server, "package.json"));
await cp(join(previous, "dist"), join(server, "dist"), { recursive: true, dereference: false });
await symlink(join(previous, "node_modules"), join(server, "node_modules"));
await symlink(join(previous, "skills"), join(server, "skills"));
await cp(join(payload, "ui"), join(release, "ui"), { recursive: true });
await cp(join(previous, "ui-dist/assets"), join(release, "ui/assets"), { recursive: true, force: false });
await symlink(join(release, "ui"), join(server, "ui-dist"));
for (const path of ["routes/issues.js", "services/office-preview.js"]) await copyFile(join(payload, "server", path), join(server, "dist", path));
await writeFile(join(release, "deployment.json"), JSON.stringify({ ...manifest, previousServer: previous, stagedServer: server, stagedAt: new Date().toISOString() }, null, 2));
console.log(JSON.stringify({ stagedServer: server, sourceRevision: manifest.sourceRevision, activated: false }));
