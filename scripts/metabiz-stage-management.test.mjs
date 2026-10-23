import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("stages only management modules and UI, retaining runtime patches and rollback link", async () => {
  const root = await mkdtemp(join(tmpdir(), "crew-management-stage-"));
  try {
    const runtime = join(root, "runtime"), old = join(root, "old"), payload = join(root, "payload");
    for (const path of ["dist/routes", "dist/services", "node_modules", "skills", "ui-dist/assets"]) await mkdir(join(old, path), { recursive: true });
    await mkdir(join(runtime, "node_modules/@paperclipai"), { recursive: true });
    await symlink(old, join(runtime, "node_modules/@paperclipai/server"));
    await writeFile(join(old, "package.json"), '{}');
    await writeFile(join(old, "dist/app.js"), '  api.use(companySkillRoutes(db));\n');
    await writeFile(join(old, "dist/services/heartbeat.js"), 'keep runtime patch');
    await writeFile(join(old, "ui-dist/assets/previous.js"), 'previous tab');
    for (const path of ["server/routes", "server/services", "dist/assets"]) await mkdir(join(payload, path), { recursive: true });
    for (const kind of ["routes", "services"]) await writeFile(join(payload, `server/${kind}/crew-management.js`), 'new module');
    await writeFile(join(payload, "dist/index.html"), 'new UI');
    const release = join(root, "release");
    execFileSync(process.execPath, [resolve("scripts/metabiz-stage-management.mjs"), runtime, payload, release]);
    assert.equal(await readFile(join(release, "server/dist/services/heartbeat.js"), "utf8"), 'keep runtime patch');
    assert.equal(await readFile(join(release, "ui/assets/previous.js"), "utf8"), 'previous tab');
    assert.match(await readFile(join(release, "server/dist/app.js"), "utf8"), /api.use\(crewManagementRoutes\(db\)\)/);
    assert.equal(await realpath(join(runtime, "node_modules/@paperclipai/server")), await realpath(old));
    assert.equal(JSON.parse(await readFile(join(release, "deployment.json"), "utf8")).previousServer, await realpath(old));
  } finally { await rm(root, { recursive: true, force: true }); }
});
