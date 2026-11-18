import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPlanner, BridgeError } from '../src/bridge-client.ts';

const input = { vaultPath: '/Example/Vault with spaces', vaultName: 'Example vault', startDate: '2026-11-18', endDate: '2026-11-22', timeZone: 'Asia/Shanghai' };
async function fixture(callback) {
    const root = await mkdtemp(join(tmpdir(), 'apple-sync-plugin-'));
    try { await callback(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function responseFor(root, url, status = 'opened', overrides = {}) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'obsidianplanner:');
    assert.equal(parsed.hostname, 'bridge');
    assert.equal(parsed.pathname, '/open');
    assert.deepEqual([...parsed.searchParams.keys()].sort(), ['protocol', 'requestId']);
    assert.ok(!url.includes('Vault'));
    const id = parsed.searchParams.get('requestId');
    const request = JSON.parse(await readFile(join(root, 'inbox', `${id}.json`), 'utf8'));
    assert.deepEqual(request, { protocolVersion: 1, requestId: id, action: 'open', ...input });
    assert.equal((await stat(join(root, 'inbox'))).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, 'inbox', `${id}.json`))).mode & 0o777, 0o600);
    await writeFile(join(root, 'outbox', `${id}.json`), JSON.stringify({ protocolVersion: 1, requestId: id, status, appVersion: '0.3.0', message: 'Open only; no items written.', ...overrides }));
    return request;
}
for (const status of ['opened', 'needsVault', 'busy', 'failed']) {
    test(`open-only response ${status} is returned without a sync claim`, () => fixture(async root => {
        const result = await openPlanner(input, { root, launch: url => responseFor(root, url, status) });
        assert.equal(result.status, status);
        assert.deepEqual(await readdir(join(root, 'inbox')), []);
        assert.deepEqual(await readdir(join(root, 'outbox')), []);
    }));
}
test('uninstalled app gives an install message and cleans this request', () => fixture(async root => {
    await assert.rejects(openPlanner(input, { root, launch: async () => { throw new Error('no URL handler'); } }), error => error instanceof BridgeError && error.code === 'APP_NOT_FOUND');
    assert.deepEqual(await readdir(join(root, 'inbox')), []);
}));
test('old app without response times out with no blind retry', () => fixture(async root => {
    let calls = 0;
    await assert.rejects(openPlanner(input, { root, timeoutMs: 20, pollMs: 5, launch: async () => { calls++; } }), error => error instanceof BridgeError && error.code === 'NO_CONFIRMATION');
    assert.equal(calls, 1);
    assert.deepEqual(await readdir(join(root, 'inbox')), []);
}));
test('mismatched protocol or request identity is rejected', () => fixture(async root => {
    await assert.rejects(openPlanner(input, { root, launch: url => responseFor(root, url, 'opened', { protocolVersion: 2 }) }), error => error instanceof BridgeError && error.code === 'INVALID_RESPONSE');
    await assert.rejects(openPlanner(input, { root, launch: url => responseFor(root, url, 'opened', { requestId: 'another-request' }) }), error => error instanceof BridgeError && error.code === 'INVALID_RESPONSE');
}));
test('plugin unload cancels polling and removes only this request', () => fixture(async root => {
    const controller = new AbortController();
    const promise = openPlanner(input, { root, pollMs: 5, signal: controller.signal, launch: async () => {
        await writeFile(join(root, 'inbox', 'unrelated.json'), 'keep');
        setTimeout(() => controller.abort(), 5);
    } });
    await assert.rejects(promise, error => error.name === 'AbortError');
    assert.deepEqual(await readdir(join(root, 'inbox')), ['unrelated.json']);
}));
test('invalid requests do not open URLs or create files', () => fixture(async root => {
    let launched = false;
    await assert.rejects(openPlanner({ ...input, vaultPath: 'relative/path' }, { root, launch: async () => { launched = true; } }));
    await assert.rejects(openPlanner({ ...input, endDate: '2026-02-29' }, { root, launch: async () => { launched = true; } }));
    assert.equal(launched, false);
    assert.deepEqual(await readdir(root), []);
}));
