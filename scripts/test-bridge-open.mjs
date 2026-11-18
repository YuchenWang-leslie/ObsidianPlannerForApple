// Open-only native integration check. Does not grant permissions or click Sync.
// Run with Node 24+: node --experimental-strip-types scripts/test-bridge-open.mjs ...
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { openPlanner } from '../plugin/src/bridge-client.ts';

const values = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
    if (index % 2 === 0) pairs.push([value.replace(/^--/, ''), args[index + 1]]);
    return pairs;
}, []));
if (!values.vault || !values.start || !values.end) {
    console.error('Usage: node --experimental-strip-types scripts/test-bridge-open.mjs --vault /absolute/vault --start YYYY-MM-DD --end YYYY-MM-DD [--zone Asia/Shanghai] [--expect opened|needsVault]');
    process.exit(1);
}
const execute = promisify(execFile);
const response = await openPlanner({
    vaultPath: values.vault,
    vaultName: basename(values.vault),
    startDate: values.start,
    endDate: values.end,
    timeZone: values.zone ?? 'Asia/Shanghai',
}, { launch: url => execute('/usr/bin/open', [url]).then(() => undefined) });
assert.equal(response.status, values.expect ?? 'opened', response.message);
assert.equal(response.appVersion, '0.3.0');
console.log(`PASS native bridge: status=${response.status}; app=${response.appVersion}; range=${values.start}..${values.end}. No automatic sync requested.`);
