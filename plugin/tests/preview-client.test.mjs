import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { BridgeError, pairPlanner, previewPlanner, readCredential, removeCredential, defaultSyncOptions, validSyncOptions, validSourcePath } from '../src/bridge-client.ts';

const input = { vaultPath: '/Example/P2 Vault', vaultName: 'Example vault', startDate: '2026-11-16', endDate: '2026-11-22', timeZone: 'Asia/Shanghai' };
const credential = { vaultKey: 'a'.repeat(64), pairingToken: 'fake-test-token-not-a-real-credential', allowSync: false };
const clientPath = (root, path = input.vaultPath) => join(root, 'clients', `${createHash('sha256').update(path).digest('hex')}.json`);
async function fixture(callback) {
    const root = await mkdtemp(join(tmpdir(), 'apple-sync-p2-'));
    try { await callback(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function requestFor(root, url, action) {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, `/${action}`);
    assert.deepEqual([...parsed.searchParams.keys()].sort(), ['protocol', 'requestId']);
    assert.ok(!url.includes(input.vaultName) && !url.includes(credential.pairingToken));
    const id = parsed.searchParams.get('requestId');
    const request = JSON.parse(await readFile(join(root, 'inbox', `${id}.json`), 'utf8'));
    assert.equal(request.action, action);
    assert.equal(request.requestId, id);
    assert.equal(request.protocolVersion, 1);
    assert.equal((await stat(join(root, 'inbox', `${id}.json`))).mode & 0o777, 0o600);
    return request;
}
async function respond(root, request, status, fields = {}) {
    const path = join(root, 'outbox', `${request.requestId}.json`);
    await writeFile(`${path}.tmp`, JSON.stringify({ protocolVersion: 1, requestId: request.requestId, status, appVersion: '0.4.0', message: 'Read-only test response.', ...fields }));
    await rename(`${path}.tmp`, path);
}
async function pair(root, value = credential, pairInput = input) {
    return pairPlanner(pairInput, { root, launch: async url => {
        const request = await requestFor(root, url, 'pair');
        assert.deepEqual(request, { protocolVersion: 1, requestId: request.requestId, action: 'pair', ...pairInput });
        await respond(root, request, 'paired', { pairing: value });
    } });
}
function result(options = defaultSyncOptions()) {
    const entries = ['create', 'update', 'unchanged', 'conflict'].map((action, index) => ({
        id: `plan-${index}`, filePath: '2026-11-18.md', line: index + 4, date: '2026-11-18', title: `Example ${action}`,
        start: `2026-11-18T0${index}:00:00Z`, end: `2026-11-18T0${index}:30:00Z`, startTime: `${String(index + 8).padStart(2, '0')}:00`, endTime: `${String(index + 8).padStart(2, '0')}:30`,
        completed: false, incomplete: false, action, selectedAction: action === 'create' ? 'create' : action === 'conflict' ? 'conflict' : 'skip', reason: `Example ${action} reason`,
    }));
    return { previewId: 'fake-preview-id', vaultKey: credential.vaultKey, vaultName: input.vaultName, startDate: input.startDate, endDate: input.endDate, timeZone: input.timeZone,
        options, entries, syncAllowed: false, linkCandidates: [], issues: ['2026-11-18.md:12 unsupported example'], counts: { create: 1, update: 1, unchanged: 1, conflict: 1, skipped: 2 } };
}
async function preview(root, value = result(), fields = {}, options = defaultSyncOptions()) {
    return previewPlanner(input, credential, options, { root, launch: async url => {
        const request = await requestFor(root, url, 'preview');
        assert.deepEqual(request, { protocolVersion: 1, requestId: request.requestId, action: 'preview', ...input, vaultKey: credential.vaultKey, pairingToken: credential.pairingToken, options });
        await respond(root, request, 'previewReady', { preview: value, ...fields });
    } });
}

test('pair waits for explicit pending confirmation and stores a private credential outside the vault', () => fixture(async root => {
    let pending = 0, request;
    const response = await pairPlanner(input, { root, pollMs: 3, launch: async url => {
        request = await requestFor(root, url, 'pair');
        assert.equal(request.pairingToken, undefined);
        await respond(root, request, 'pending');
    }, onPending: () => {
        pending++;
        void respond(root, request, 'paired', { pairing: credential });
    } });
    assert.equal(response.status, 'paired'); assert.equal(pending, 1);
    assert.deepEqual(await readCredential(input.vaultPath, root), credential);
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, 'clients'))).mode & 0o777, 0o700);
    assert.equal((await stat(clientPath(root))).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(clientPath(root), 'utf8')).vaultPath, input.vaultPath);
    assert.deepEqual(await readdir(join(root, 'inbox')), []); assert.deepEqual(await readdir(join(root, 'outbox')), []);
}));
test('same display name in different paths has separate credentials; rotation updates only the requested path', () => fixture(async root => {
    const second = { ...input, vaultPath: '/Example/Other Vault' };
    const otherCredential = { vaultKey: 'b'.repeat(64), pairingToken: 'second-fake-token', allowSync: false };
    await pair(root); await pair(root, otherCredential, second);
    await pair(root, { ...credential, pairingToken: 'rotated-fake-token' });
    assert.equal((await readCredential(input.vaultPath, root)).pairingToken, 'rotated-fake-token');
    assert.deepEqual(await readCredential(second.vaultPath, root), otherCredential);
    await removeCredential(input.vaultPath, root);
    assert.equal(await readCredential(input.vaultPath, root), null);
    assert.deepEqual(await readCredential(second.vaultPath, root), otherCredential);
}));
test('cancelled pairing does not replace an existing credential', () => fixture(async root => {
    await pair(root);
    const response = await pairPlanner(input, { root, launch: async url => respond(root, await requestFor(root, url, 'pair'), 'failed', { errorCode: 'PAIRING_CANCELLED' }) });
    assert.equal(response.errorCode, 'PAIRING_CANCELLED');
    assert.deepEqual(await readCredential(input.vaultPath, root), credential);
}));
test('pending pairing expires without resending or saving a credential', () => fixture(async root => {
    let calls = 0;
    await assert.rejects(pairPlanner(input, { root, timeoutMs: 20, pollMs: 3, launch: async url => {
        calls++; await respond(root, await requestFor(root, url, 'pair'), 'pending');
    } }), error => error instanceof BridgeError && error.code === 'NO_CONFIRMATION');
    assert.equal(calls, 1); assert.equal(await readCredential(input.vaultPath, root), null);
}));
test('preview preserves match states and independent skipped defaults, exact options and source locations', () => fixture(async root => {
    const response = await preview(root);
    assert.deepEqual(response.preview, result());
    assert.equal(response.preview.entries[1].action, 'update');
    assert.equal(response.preview.entries[1].selectedAction, 'skip');
    assert.equal(response.preview.entries[1].line, 5);
    assert.equal(response.preview.counts.skipped, 2);
    assert.deepEqual(await readdir(join(root, 'inbox')), []);
    assert.deepEqual(await readdir(join(root, 'outbox')), []);
    assert.equal(await readCredential(input.vaultPath, root), null);
}));
test('native token mismatch removes the stale local credential and returns the failure', () => fixture(async root => {
    await pair(root);
    const response = await preview(root, undefined, { status: 'failed', errorCode: 'VAULT_NOT_PAIRED', preview: undefined });
    assert.equal(response.errorCode, 'VAULT_NOT_PAIRED');
    assert.equal(await readCredential(input.vaultPath, root), null);
}));
test('preview refuses identity, settings, counts and source DTO mismatches', () => fixture(async root => {
    const invalid = [];
    let value = result(); value.vaultKey = 'b'.repeat(64); invalid.push(value);
    value = result(); value.startDate = '2026-11-17'; invalid.push(value);
    value = result(); value.options.includeCalendar = true; invalid.push(value);
    value = result(); value.options.notification.minutes = 15; invalid.push(value);
    value = result(); value.counts.skipped = 0; invalid.push(value);
    value = result(); value.counts.update = 2; invalid.push(value);
    value = result(); value.entries[0].filePath = '../outside.md'; invalid.push(value);
    value = result(); value.entries[0].line = 0; invalid.push(value);
    value = result(); value.entries[0].selectedAction = 'update'; invalid.push(value);
    value = result(); value.entries[0].date = '2026-11-23'; invalid.push(value);
    value = result(); value.entries[1].id = value.entries[0].id; invalid.push(value);
    for (const bad of invalid) await assert.rejects(preview(root, bad), error => error instanceof BridgeError && error.code === 'INVALID_RESPONSE');
}));
test('options mirror native notification constraints before any app launch', () => fixture(async root => {
    assert.deepEqual(defaultSyncOptions(), { includeCalendar: false, notification: { channel: 'Reminders', minutes: 10 } });
    for (const channel of ['Reminders', 'None']) assert.ok(validSyncOptions({ includeCalendar: false, notification: { channel, minutes: 0 } }));
    for (const channel of ['Reminders', 'Calendar', 'Both', 'None']) assert.ok(validSyncOptions({ includeCalendar: true, notification: { channel, minutes: 60 } }));
    const bad = [
        { includeCalendar: false, notification: { channel: 'Both', minutes: 10 } },
        { includeCalendar: false, notification: { channel: 'Calendar', minutes: 10 } },
        ...[-5, 1, 61, 3.5].map(minutes => ({ includeCalendar: true, notification: { channel: 'Reminders', minutes } })),
    ];
    let calls = 0;
    for (const options of bad) {
        assert.equal(validSyncOptions(options), false);
        await assert.rejects(previewPlanner(input, credential, options, { root, launch: async () => { calls++; } }));
    }
    await assert.rejects(previewPlanner(input, { ...credential, pairingToken: '' }, defaultSyncOptions(), { root, launch: async () => { calls++; } }));
    assert.equal(calls, 0); assert.deepEqual(await readdir(root), []);
}));
test('source links accept only vault-relative paths', () => {
    for (const path of ['2026-11-18.md', 'Daily notes/2026-11-18.md']) assert.equal(validSourcePath(path), true);
    for (const path of ['', '/outside.md', '../outside.md', 'a/../outside.md', 'a\\note.md', './note.md', 'a//note.md', 'a\0note.md']) assert.equal(validSourcePath(path), false);
});
test('unload cancels both pairing and preview polling and cleans only own requests', () => fixture(async root => {
    for (const action of ['pair', 'preview']) {
        const controller = new AbortController();
        const options = { root, signal: controller.signal, pollMs: 3, launch: async url => {
            await requestFor(root, url, action);
            await writeFile(join(root, 'inbox', 'keep.json'), 'unrelated');
            setTimeout(() => controller.abort(), 5);
        } };
        const pending = action === 'pair' ? pairPlanner(input, options) : previewPlanner(input, credential, defaultSyncOptions(), options);
        await assert.rejects(pending, error => error.name === 'AbortError');
        assert.deepEqual(await readdir(join(root, 'inbox')), ['keep.json']);
        assert.deepEqual(await readdir(join(root, 'outbox')), []);
    }
}));
test('malformed private JSON and app responses never expose token text in errors', () => fixture(async root => {
    await pair(root);
    await writeFile(clientPath(root), `{"pairingToken":"${credential.pairingToken}`);
    await assert.rejects(readCredential(input.vaultPath, root), error => error.code === 'INVALID_CREDENTIAL' && !error.message.includes(credential.pairingToken));
    await assert.rejects(pairPlanner(input, { root, launch: async url => {
        const request = await requestFor(root, url, 'pair');
        await writeFile(join(root, 'outbox', `${request.requestId}.json`), `{"pairingToken":"${credential.pairingToken}`);
    } }), error => error.code === 'INVALID_RESPONSE' && !error.message.includes(credential.pairingToken));
}));
test('pair rejects incomplete credentials and preview rejects unknown response status', () => fixture(async root => {
    await assert.rejects(pair(root, { vaultKey: credential.vaultKey }), error => error.code === 'INVALID_RESPONSE');
    assert.equal(await readCredential(input.vaultPath, root), null);
    await assert.rejects(preview(root, result(), { status: 'synced' }), error => error.code === 'INVALID_RESPONSE');
}));
