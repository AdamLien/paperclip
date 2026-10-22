#!/usr/bin/env node
// Stage a narrow release without replacing the live package or restarting it.
import { access, copyFile, cp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const [runtimeArg, payloadArg, releaseArg] = process.argv.slice(2);
if (!runtimeArg || !payloadArg || !releaseArg) {
  throw new Error("Usage: node scripts/metabiz-stage-management.mjs RUNTIME PAYLOAD NEW_RELEASE");
}
const runtime = resolve(runtimeArg), payload = resolve(payloadArg), release = resolve(releaseArg);
const previous = await realpath(join(runtime, "node_modules/@paperclipai/server"));
const server = join(release, "server");
for (const path of ["server/routes/crew-management.js", "server/services/crew-management.js", "dist/index.html"]) {
  await access(join(payload, path));
}
await mkdir(release); // Fail if a release already exists; never overwrite one.
await mkdir(server);
await copyFile(join(previous, "package.json"), join(server, "package.json"));
await cp(join(previous, "dist"), join(server, "dist"), { recursive: true, dereference: false });
await symlink(join(previous, "node_modules"), join(server, "node_modules"));
await symlink(join(previous, "skills"), join(server, "skills"));
await cp(join(payload, "dist"), join(release, "ui"), { recursive: true });
// Keep content-addressed assets for tabs which still use the previous UI.
await cp(join(previous, "ui-dist/assets"), join(release, "ui/assets"), { recursive: true, force: false });
await symlink(join(release, "ui"), join(server, "ui-dist"));
const hashes = {};
for (const kind of ["routes", "services"]) {
  const path = `${kind}/crew-management.js`;
  const contents = await readFile(join(payload, "server", path));
  await writeFile(join(server, "dist", path), contents);
  hashes[path] = createHash("sha256").update(contents).digest("hex");
}
const app = join(server, "dist/app.js");
const original = await readFile(app, "utf8");
const mount = "  api.use(companySkillRoutes(db));";
const managementImport = 'import { crewManagementRoutes } from "./routes/crew-management.js";';
const managementMount = "  api.use(crewManagementRoutes(db));";
const alreadyMounted = original.split(managementImport).length === 2 && original.split(managementMount).length === 2;
if ((!alreadyMounted && original.includes("crewManagementRoutes")) || original.split(mount).length !== 2) {
  throw new Error("Unexpected application mount. The staged release was not activated.");
}
await writeFile(app, alreadyMounted ? original : `${managementImport}\n`
  + original.replace(mount, `${mount}\n${managementMount}`));
await writeFile(join(release, "deployment.json"), JSON.stringify({
  previousServer: previous, previousUi: await realpath(join(previous, "ui-dist")),
  stagedServer: server, hashes, stagedAt: new Date().toISOString(),
}, null, 2));
console.log(JSON.stringify({ stagedServer: server, activated: false,
  next: "Import the staged app, verify it, then switch the package link. Keep the previous link for rollback." }));
