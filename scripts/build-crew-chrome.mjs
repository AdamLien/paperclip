#!/usr/bin/env node
// Build only committed companion files. This does not install or deploy them.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const [outputArg, buildNumber, environment] = process.argv.slice(2);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '');
if (!outputArg || !/^\d{11}$/.test(buildNumber ?? '') || !['uat', 'prod'].includes(environment)) throw new Error('Usage: build-crew-chrome.mjs NEW_OUTPUT_DIR YYYYMMDDNNN uat|prod');
const serial = Number(buildNumber.slice(8));
if (buildNumber.slice(0, 8) !== today || serial < 1 || serial % 2 !== (environment === 'uat' ? 1 : 0)) throw new Error('Use today in Taipei, an odd UAT serial, or an even production serial.');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('diff', 'HEAD', '--', 'scripts/crew-chrome', 'scripts/build-crew-chrome.mjs')) throw new Error('Commit companion source before building.');
const sourceRevision = git('rev-parse', 'HEAD');
const output = resolve(outputArg); const extension = join(output, 'extension');
await mkdir(output); await mkdir(extension);
const hashes = {};
for (const file of ['manifest.json', 'popup.html', 'popup.js', 'worker.js', 'bridge.js', 'README.md']) {
  let data = execFileSync('git', ['show', `${sourceRevision}:scripts/crew-chrome/${file}`]);
  if (file === 'manifest.json') {
    const manifest = JSON.parse(data.toString()); manifest.version_name = `${manifest.version} (${buildNumber} ${environment})`;
    data = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  }
  await writeFile(join(extension, file), data); hashes[file] = createHash('sha256').update(data).digest('hex');
}
const license = execFileSync('git', ['show', `${sourceRevision}:LICENSE`]);
await writeFile(join(extension, 'LICENSE'), license); hashes.LICENSE = createHash('sha256').update(license).digest('hex');
await writeFile(join(output, 'manifest.json'), JSON.stringify({ sourceRevision, buildNumber, environment, hashes, installed: false, deployed: false }, null, 2));
execFileSync('python3', ['-c', 'import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"x",compression=zipfile.ZIP_DEFLATED); [(lambda i,p:z.writestr(i,p.read_bytes()))(zipfile.ZipInfo(p.name,(2026,1,1,0,0,0)),p) for p in sorted(root.iterdir()) if p.is_file()]; z.close()', extension, join(output, `crew-chrome-${buildNumber}.zip`)]);
console.log(JSON.stringify({ output, sourceRevision, buildNumber, installed: false, deployed: false }));
