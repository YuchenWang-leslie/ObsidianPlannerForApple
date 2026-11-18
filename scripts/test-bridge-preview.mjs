// Read-only native P2 integration check. Pair from Obsidian first; this never clicks Sync.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { previewPlanner, readCredential, defaultSyncOptions } from '../plugin/src/bridge-client.ts';

const args = process.argv.slice(2);
const values = Object.fromEntries(args.filter((_, i) => i % 2 === 0).map((key, i) => [key.replace(/^--/, ''), args[i * 2 + 1]]));
if (!values.vault || !values.start || !values.end) throw new Error('Use --vault /absolute/TestVault --start YYYY-MM-DD --end YYYY-MM-DD [--zone Asia/Shanghai] [--expect previewReady|needsSetup] [--credential-vault /absolute/TestVault] [--output /private/result.json]');
const credential = await readCredential(values['credential-vault'] ?? values.vault);
assert.ok(credential, 'Pair this vault from the Obsidian plugin first.');
const historyRoot = join(homedir(), 'Library', 'Application Support', 'ObsidianPlanner');
async function histories() {
    const names = (await readdir(historyRoot)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort();
    return Object.fromEntries(await Promise.all(names.map(async name => [name, createHash('sha256').update(await readFile(join(historyRoot, name))).digest('hex')])));
}
const before = await histories();
const execute = promisify(execFile);
const response = await previewPlanner({ vaultPath: values.vault, vaultName: basename(values.vault), startDate: values.start, endDate: values.end, timeZone: values.zone ?? 'Asia/Shanghai' }, credential, defaultSyncOptions(), {
    launch: url => execute('/usr/bin/open', [url]).then(() => undefined),
});
assert.equal(response.status, values.expect ?? 'previewReady', response.message);
assert.equal(response.appVersion, '0.5.0');
assert.deepEqual(await histories(), before, 'Read-only preview changed a sync-history file.');
if (response.preview) {
    if (values.output) await writeFile(values.output, JSON.stringify(response.preview, null, 2), { mode: 0o600 });
    console.log(`PASS native P2: ${response.preview.entries.length} entries, ${response.preview.issues.length} issues; history unchanged; no sync requested.`);
} else {
    assert.equal(response.errorCode, 'VAULT_NOT_PAIRED');
    console.log('PASS native P2: unauthorized vault rejected; history unchanged.');
}
