#!/usr/bin/env node

import { access, cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, relative, resolve } from "node:path";

const exec = promisify(execFile);

const ALLOWED_CHANGED_FILES = new Set([
  "scripts/metabiz-deploy-push.mjs",
  "server/src/middleware/http-log-policy.ts",
]);

const PRESERVED_PATCH_FILES = [
  ["server", "dist/services/heartbeat.js"],
  ["server", "dist/routes/agents.js"],
];

const COMPILED_FILES = [
  ["server/src/app.ts", "server/dist/app.js"],
  ["server/src/middleware/http-log-policy.ts", "server/dist/middleware/http-log-policy.js"],
  ["server/src/services/activity-log.ts", "server/dist/services/activity-log.js"],
  ["server/src/services/push-notifications.ts", "server/dist/services/push-notifications.js"],
  ["server/src/routes/push-devices.ts", "server/dist/routes/push-devices.js"],
  ["packages/db/src/schema/push_notifications.ts", "db/dist/schema/push_notifications.js"],
  ["packages/db/src/schema/index.ts", "db/dist/schema/index.js"],
  ["packages/shared/src/push-devices.ts", "shared/dist/push-devices.js"],
  ["packages/shared/src/index.ts", "shared/dist/index.js"],
];

const MIGRATION_FILES = [
  ["packages/db/src/migrations/0306_persistent_push_notifications.sql", "db/dist/migrations/0306_persistent_push_notifications.sql"],
  ["packages/db/src/migrations/meta/_journal.json", "db/dist/migrations/meta/_journal.json"],
];

const COMPILED_SOURCES = new Set(COMPILED_FILES.map(([source]) => source));
const MIGRATION_SOURCES = new Set(MIGRATION_FILES.map(([source]) => source));

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error("usage: node scripts/metabiz-deploy-push.mjs --revision <commit> --base <commit> --runtime <installed-root> [--release-root <dir>]");
  process.exit(2);
}

function argsFrom(argv) {
  const args = {};
  const allowed = new Set(["revision", "base", "runtime", "release-root"]);
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) usage(`unexpected argument: ${value}`);
    const key = value.slice(2);
    if (key === "help") usage();
    if (!allowed.has(key)) usage(`unknown option: --${key}`);
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) usage(`missing value for --${key}`);
    args[key] = argv[++i];
  }
  for (const key of ["revision", "base", "runtime"]) if (!args[key]) usage(`--${key} is required`);
  return args;
}

async function git(repo, ...gitArgs) {
  const { stdout } = await exec("git", ["-C", repo, ...gitArgs], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

async function hashFile(path) {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function replacePackageBindings(stagedRelease) {
  for (const packageName of ["server", "db", "shared"]) {
    const scope = join(stagedRelease, packageName, "node_modules/@paperclipai");
    try {
      if ((await lstat(scope)).isSymbolicLink()) await rm(scope, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await mkdir(scope, { recursive: true });
  }
  for (const [consumer, dependency] of [["server", "db"], ["server", "shared"], ["db", "shared"]]) {
    const target = join(stagedRelease, consumer, "node_modules/@paperclipai", dependency);
    await rm(target, { recursive: true, force: true });
    await symlink(relative(dirname(target), join(stagedRelease, dependency)), target);
  }
}

async function clonePackageDependencies(sourcePackages, stagedRelease) {
  for (const packageName of ["server", "db", "shared"]) {
    const sourceModules = join(sourcePackages[packageName], "node_modules");
    const stagedModules = join(stagedRelease, packageName, "node_modules");
    let sourceModulesRealpath;
    try {
      sourceModulesRealpath = await realpath(sourceModules);
    } catch {
      throw new Error(`missing package-local dependencies: ${sourceModules}`);
    }
    await rm(stagedModules, { recursive: true, force: true });
    await cp(sourceModulesRealpath, stagedModules, { recursive: true, dereference: true, preserveTimestamps: true });
  }
}

async function compile(source, output) {
  const { transform } = await import("esbuild");
  const code = await readFile(source, "utf8");
  const result = await transform(code, {
    loader: "ts",
    format: "esm",
    platform: "node",
    target: "node24",
    sourcemap: false,
    legalComments: "eof",
    sourcefile: source,
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, result.code);
}

async function archive(repo, revision, destination) {
  const tarPath = join(destination, `${revision.slice(0, 12)}.tar`);
  await exec("git", ["-C", repo, "archive", "--format=tar", `--output=${tarPath}`, revision]);
  const extracted = join(destination, revision.slice(0, 12));
  await mkdir(extracted);
  await exec("tar", ["-xf", tarPath, "-C", extracted]);
  return extracted;
}

async function smokeImport(stagedRelease) {
  const imports = [
    `./server/dist/app.js`,
    `./db/dist/schema/index.js`,
    `./shared/dist/index.js`,
  ];
  const code = `for (const path of ${JSON.stringify(imports)}) { const module = await import(path); if (!module || typeof module !== "object") throw new Error("invalid module: " + path); }`;
  await exec(process.execPath, ["--input-type=module", "--eval", code], {
    cwd: stagedRelease,
    env: { ...process.env },
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  const sourceRepo = resolve(process.cwd());
  const runtime = resolve(args.runtime);
  const revision = await git(sourceRepo, "rev-parse", "--verify", `${args.revision}^{commit}`);
  const base = await git(sourceRepo, "rev-parse", "--verify", `${args.base}^{commit}`);
  try {
    await exec("git", ["-C", sourceRepo, "merge-base", "--is-ancestor", base, revision]);
  } catch {
    throw new Error(`base ${base} is not an ancestor of revision ${revision}`);
  }
  const changed = (await git(sourceRepo, "diff", "--name-only", `${base}..${revision}`)).split("\n").filter(Boolean);
  const unexpected = changed.filter((path) => {
    if (ALLOWED_CHANGED_FILES.has(path)) return false;
    if (path.startsWith("ui/") || path.startsWith("tests/") || path.startsWith("doc/") || path.startsWith("docs/")) return false;
    if (path.startsWith("server/") || path.startsWith("packages/db/") || path.startsWith("packages/shared/")) {
      if (COMPILED_SOURCES.has(path) || MIGRATION_SOURCES.has(path)) return false;
      if (path.endsWith(".test.ts")) return false;
    }
    return true;
  });
  if (unexpected.length) throw new Error(`refusing revision with out-of-scope changes:\n${unexpected.join("\n")}`);

  const runtimePackages = {
    server: join(runtime, "node_modules/@paperclipai/server"),
    db: join(runtime, "node_modules/@paperclipai/db"),
    shared: join(runtime, "node_modules/@paperclipai/shared"),
  };
  const resolvedRuntimePackages = {};
  for (const [name, path] of Object.entries(runtimePackages)) {
    const packageJson = join(path, "package.json");
    try { await readFile(packageJson); } catch { throw new Error(`missing installed runtime package: ${name} (${path})`); }
    resolvedRuntimePackages[name] = await realpath(path);
  }

  const stageRoot = resolve(args["release-root"] ?? join(runtime, "releases"));
  const releaseName = `push-${revision.slice(0, 12)}`;
  const release = join(stageRoot, releaseName);
  await mkdir(stageRoot, { recursive: true });
  const temp = await mkdtemp(join(stageRoot, ".push-stage-"));
  try {
    const sourceSnapshot = await archive(sourceRepo, revision, temp);
    const stagedRelease = join(temp, "release");
    await mkdir(stagedRelease, { recursive: true });
    await Promise.all(Object.entries(resolvedRuntimePackages).map(([name, path]) => cp(path, join(stagedRelease, name), { recursive: true, preserveTimestamps: true })));
    await exec("ln", ["-s", join(runtime, "node_modules"), join(stagedRelease, "node_modules")]);

    await clonePackageDependencies(resolvedRuntimePackages, stagedRelease);
    await replacePackageBindings(stagedRelease);

    const preservedBefore = Object.fromEntries(await Promise.all(PRESERVED_PATCH_FILES.map(async ([pkg, file]) => [file, await hashFile(join(resolvedRuntimePackages[pkg], file))])));

    for (const [sourcePath, outputPath] of COMPILED_FILES) {
      const source = join(sourceSnapshot, sourcePath);
      const output = join(stagedRelease, outputPath);
      await rm(output, { force: true });
      await compile(source, output);
    }
    for (const [sourcePath, outputPath] of MIGRATION_FILES) {
      const source = join(sourceSnapshot, sourcePath);
      const output = join(stagedRelease, outputPath);
      await mkdir(dirname(output), { recursive: true });
      await rm(output, { force: true });
      await cp(source, output, { preserveTimestamps: true });
    }

    const preservedAfter = Object.fromEntries(await Promise.all(PRESERVED_PATCH_FILES.map(async ([pkg, file]) => [file, await hashFile(join(stagedRelease, pkg, file))])));
    for (const file of Object.keys(preservedBefore)) {
      if (preservedBefore[file] !== preservedAfter[file]) throw new Error(`preserved runtime patch changed: ${file}`);
    }
    await smokeImport(stagedRelease);

    const manifest = {
      mode: "stage-only",
      revision,
      base,
      baseArgument: args.base,
      release,
      nodeModules: join(release, "node_modules"),
      packages: Object.fromEntries(await Promise.all(Object.entries(runtimePackages).map(async ([name]) => [name, await hashFile(join(stagedRelease, name, "package.json"))]))),
      preservedPatchHashes: preservedAfter,
      smokeImports: ["server/dist/app.js", "db/dist/schema/index.js", "shared/dist/index.js"],
      compiled: COMPILED_FILES.map(([, output]) => output),
      migrations: MIGRATION_FILES.map(([, output]) => output),
      activation: "manual-after-backup-and-acceptance",
    };
    await writeFile(join(stagedRelease, "metabiz-push-release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    try {
      await access(release);
      throw new Error(`release already exists; refusing to overwrite: ${release}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(stagedRelease, release);
    console.log(JSON.stringify(manifest, null, 2));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`metabiz push release preparation failed: ${error.message}`);
  process.exitCode = 1;
});
