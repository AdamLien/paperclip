#!/usr/bin/env node
// Produce a Git-built overlay. Activation is a separate, recorded operation.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { transform, version as esbuildVersion } from 'esbuild';

const [outputArg, baselineArg, baseRevision, buildNumber, environment] = process.argv.slice(2);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '');
if (!outputArg || !baselineArg || !baseRevision || !/^\d{11}$/.test(buildNumber ?? '') || !['uat', 'prod'].includes(environment)) throw new Error('Usage: metabiz-build-browser-workspace.mjs NEW_OUTPUT BASELINE_DIST BASE_REV YYYYMMDDNNN uat|prod');
const serial = Number(buildNumber.slice(8));
if (buildNumber.slice(0, 8) !== today || serial < 1 || serial % 2 !== (environment === 'uat' ? 1 : 0)) throw new Error('Use today in Taipei with odd UAT / even production serials.');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('diff', 'HEAD', '--', 'server/src', 'ui/src', 'scripts/metabiz-build-browser-workspace.mjs', 'skills/crew-shared-browser')) throw new Error('Commit source before building.');
const options = { loader: 'ts', target: 'esnext', format: 'esm' };
const normalize = async text => (await transform(text, { ...options, minifySyntax: true, minifyWhitespace: true })).code;
const sha = data => createHash('sha256').update(data).digest('hex');
const baselineHashes = {};
const preserved = ['app', 'middleware/logger', 'middleware/http-log-policy', 'middleware/http-log-redaction'];
for (const file of preserved) {
  const baseline = await readFile(join(resolve(baselineArg), `${file}.js`));
  let expected = await normalize(git('show', `${baseRevision}:server/src/${file}.ts`));
  let actual = await normalize(baseline.toString());
  // The installed management release moved this named import to the top.
  // This is the sole allowed baseline variation; retain all runtime statements.
  if (file === 'app') {
    const managementImport = 'import{crewManagementRoutes}from"./routes/crew-management.js";';
    if (expected.split(managementImport).length !== 2 || actual.split(managementImport).length !== 2) throw new Error('Management import baseline is not unique');
    expected = expected.replace(managementImport, ''); actual = actual.replace(managementImport, '');
  }
  if (expected !== actual) throw new Error(`Runtime drift in ${file}; refuse overlay`);
  baselineHashes[`server/dist/${file}.js`] = sha(baseline);
}
const output = resolve(outputArg); await mkdir(output);
for (const file of [...preserved, 'routes/crew-browser', 'services/crew-browser']) {
  const destination = join(output, 'server/dist', `${file}.js`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, (await transform(await readFile(`server/src/${file}.ts`, 'utf8'), options)).code);
}
const sourceRevision = git('rev-parse', 'HEAD');
execFileSync('rtk', ['--ultra-compact', process.execPath, 'node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn'], { cwd: 'ui', stdio: 'inherit', env: { ...process.env, PAPERCLIP_BUILD_COMMIT: sourceRevision } });
await cp('ui/dist', join(output, 'server/ui-dist'), { recursive: true });
await cp('skills/crew-shared-browser', join(output, 'skills/crew-shared-browser'), { recursive: true });
const hashes = {};
async function inventory(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = prefix + entry.name;
    if (entry.isDirectory()) await inventory(join(directory, entry.name), `${file}/`);
    else hashes[file] = sha(await readFile(join(directory, entry.name)));
  }
}
await inventory(output);
await writeFile(join(output, 'manifest.json'), JSON.stringify({ buildNumber, environment, sourceRevision, baseRevision, baselineHashes, esbuildVersion, hashes, activated: false }, null, 2));
console.log(JSON.stringify({ output, sourceRevision, buildNumber, activated: false }));
