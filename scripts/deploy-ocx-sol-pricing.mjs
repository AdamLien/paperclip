// Apply only the pricing seams to the installed, previously patched server.
// Run from this Git checkout; compile the helper instead of copying source.
import { readFile, writeFile, copyFile, rename, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const runtime = process.argv[2];
if (!runtime) throw new Error('Usage: node scripts/deploy-ocx-sol-pricing.mjs <runtime>');
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const heartbeat = path.join(runtime, 'node_modules/@paperclipai/server/dist/services/heartbeat.js');
const constants = path.join(runtime, 'node_modules/@paperclipai/shared/dist/constants.js');
let source = await readFile(heartbeat, 'utf8');
function once(before, after) {
  if (source.split(before).length !== 2) throw new Error('Installed pricing seam differs: ' + before.slice(0,70));
  source = source.replace(before, after);
}
once('import { retryIdempotentDatabaseOperation }', 'import { applyOcxSolPricing } from "./ocx-sol-pricing.js";\nimport { retryIdempotentDatabaseOperation }');
once('? "reported"\n        : "unpriced";', '? (input.estimated ? "estimated" : "reported")\n        : "unpriced";');
once('costUsd: billedCostUsd,\n            inputTokens,', 'costUsd: billedCostUsd,\n            estimated: parseObject(result.resultJson?.pricing).estimated === true,\n            inputTokens,');
once('const normalizedUsage = sessionUsageResolution.normalizedUsage;', 'const normalizedUsage = sessionUsageResolution.normalizedUsage;\n                adapterResult = applyOcxSolPricing(adapterResult, normalizedUsage, agent.adapterType, parseObject(agent.adapterConfig));');
once('costUsd: cacheAdjustedCostUsd,\n                            inputTokens:', 'costUsd: cacheAdjustedCostUsd,\n                            estimated: parseObject(adapterResult.resultJson?.pricing).estimated === true,\n                            inputTokens:');
const oldConstants = await readFile(constants, 'utf8');
if (!oldConstants.includes('["reported", "unpriced"]')) throw new Error('Installed cost status seam differs');
const backup = path.join(runtime, 'releases', 'ocx-sol-pricing-backup-' + Date.now());
await mkdir(backup, {recursive:true});
await copyFile(heartbeat, path.join(backup, 'heartbeat.js'));
await copyFile(constants, path.join(backup, 'constants.js'));
const helper = path.join(path.dirname(heartbeat), 'ocx-sol-pricing.js');
await build({entryPoints:[path.join(root,'server/src/services/ocx-sol-pricing.ts')],outfile:helper,format:'esm',platform:'node',target:'node24'});
await writeFile(heartbeat+'.next',source);
await writeFile(constants+'.next',oldConstants.replace('["reported", "unpriced"]','["reported", "estimated", "unpriced"]'));
await rename(constants+'.next', constants);
await rename(heartbeat+'.next', heartbeat);
console.log(JSON.stringify({built:true,backup,source:root}));
