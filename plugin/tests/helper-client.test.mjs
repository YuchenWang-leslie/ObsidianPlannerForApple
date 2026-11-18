import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HELPER_VERSION, helperBridgeOptions, ensureHelperRuntime, helperRuntimePath, pluginBridgeRoot, helperInfo, helperAuthorize, helperConfigure, helperUnpair, unsupportedReason } from '../src/helper-client.ts';
import { pairPlanner, previewPlanner, readCredential, defaultSyncOptions, syncPlanner, readRun, statusPlanner } from '../src/bridge-client.ts';
import { initialSelection } from '../src/selection.ts';

const input = { vaultPath: '/Example/Independent Vault', vaultName: 'Independent Vault', startDate: '2026-11-16', endDate: '2026-11-22', timeZone: 'Asia/Shanghai' };
const credential = { vaultKey: 'a'.repeat(64), pairingToken: 'fake-independent-token', allowSync: true };
const state = () => ({ remindersPermission: 'notDetermined', calendarPermission: 'notDetermined', reminderSources: [], calendarSources: [], reminderSourceID: '', calendarSourceID: '' });
const allowed = { platform: 'darwin', arch: 'arm64', osRelease: '23.0.0' };
async function fixture(callback) {
    const home = await mkdtemp(join(tmpdir(), 'independent-plugin-'));
    const plugin = join(home, 'test-plugin'), bundle = join(plugin, 'native', 'DayPlannerAppleSyncHelper.app');
    await mkdir(join(bundle, 'Contents', 'MacOS'), { recursive: true });
    await writeFile(join(bundle, 'Contents', 'Info.plist'), '<plist>fake helper 0.4.0</plist>');
    await writeFile(join(bundle, 'Contents', 'MacOS', 'DayPlannerAppleSyncHelper'), 'fake signed executable', { mode: 0o755 });
    try { await callback({ home, plugin, bundle, root: pluginBridgeRoot(home) }); } finally { await rm(home, { recursive: true, force: true }); }
}
async function envelope(root, url, action) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'obsidianplanner-helper:'); assert.equal(parsed.hostname, 'bridge'); assert.equal(parsed.pathname, `/${action}`);
    assert.deepEqual([...parsed.searchParams.keys()].sort(), ['protocol', 'requestId']);
    assert.ok(!url.includes(input.vaultPath) && !url.includes(credential.pairingToken));
    return JSON.parse(await readFile(join(root, 'inbox', `${parsed.searchParams.get('requestId')}.json`), 'utf8'));
}
async function respond(root, request, status = 'ready', extra = {}) {
    const path = join(root, 'outbox', `${request.requestId}.json`);
    await writeFile(`${path}.tmp`, JSON.stringify({ protocolVersion: 1, requestId: request.requestId, status, appVersion: HELPER_VERSION, message: 'Fake helper response.', capabilities: ['info', 'pair', 'authorize', 'configure', 'unpair', 'preview', 'sync', 'status'], state: state(), ...extra }));
    await rename(`${path}.tmp`, path);
}
const fakeInstaller = (calls, callback = async () => {}) => async (file, args) => {
    calls.push([file, args]);
    if (file === '/usr/bin/ditto') await cp(args[0], args[1], { recursive: true });
    else { assert.equal(file, '/usr/bin/open'); await callback(args.at(-1)); }
};

test('independent runtime uses fixed private roots, native bundle, and exact background open path', () => fixture(async fixture => {
    const calls = [], { home, plugin, root } = fixture;
    const options = helperBridgeOptions(plugin, { ...allowed, home, runFile: fakeInstaller(calls, async url => respond(root, await envelope(root, url, 'info'))) });
    const response = await helperInfo(input, options);
    assert.equal(response.status, 'ready'); assert.equal(options.root, root);
    assert.ok(root.endsWith('/ObsidianPlanner/PluginBridge')); assert.ok(!root.endsWith('/ObsidianPlanner/Bridge'));
    const [installer, launcher] = calls; assert.equal(installer[0], '/usr/bin/ditto');
    assert.deepEqual(launcher[1].slice(0, 3), ['-g', '-a', helperRuntimePath(home)]);
    assert.equal((await stat(join(home, 'Library', 'Application Support', 'ObsidianPlanner', 'PluginRuntime', HELPER_VERSION))).mode & 0o777, 0o700);
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.deepEqual(await readdir(join(root, 'inbox')), []);
    assert.deepEqual(await readdir(join(root, 'outbox')), []);
}));
test('unchanged immutable-version runtime is reused without copying, and stale same-version runtime is not replaced', () => fixture(async ({ home, plugin, bundle }) => {
    const calls = [], options = { ...allowed, home, runFile: fakeInstaller(calls) };
    const target = await ensureHelperRuntime(plugin, options); assert.equal(calls.length, 1);
    await ensureHelperRuntime(plugin, options); assert.equal(calls.length, 1);
    await writeFile(join(bundle, 'Contents', 'MacOS', 'DayPlannerAppleSyncHelper'), 'new build');
    await assert.rejects(ensureHelperRuntime(plugin, options), error => error.code === 'RUNTIME_MISMATCH' && /Let any sync finish/.test(error.message));
    assert.equal(calls.length, 1); assert.equal(await readFile(join(target, 'Contents', 'MacOS', 'DayPlannerAppleSyncHelper'), 'utf8'), 'fake signed executable');
}));
test('missing bundled helper and incomplete installed helper give complete-package instructions without fallback', () => fixture(async ({ home, plugin }) => {
    const calls = [], options = { ...allowed, home, runFile: fakeInstaller(calls) };
    await assert.rejects(ensureHelperRuntime(join(home, 'incomplete-plugin'), options), error => error.code === 'HELPER_MISSING' && /complete plugin 0.4.0/.test(error.message));
    await mkdir(helperRuntimePath(home), { recursive: true });
    await assert.rejects(ensureHelperRuntime(plugin, options), error => error.code === 'RUNTIME_MISMATCH');
    assert.equal(calls.length, 0);
}));
test('platform boundary rejects Intel, non-macOS and older macOS before file installation', () => fixture(async ({ home, plugin }) => {
    let calls = 0;
    for (const environment of [{ ...allowed, arch: 'x64' }, { ...allowed, platform: 'linux' }, { ...allowed, osRelease: '22.6.0' }]) {
        assert.match(unsupportedReason(environment), /Apple silicon/);
        await assert.rejects(ensureHelperRuntime(plugin, { ...environment, home, runFile: async () => { calls++; } }), error => error.code === 'UNSUPPORTED_PLATFORM');
    }
    assert.equal(unsupportedReason(allowed), null); assert.equal(calls, 0);
}));
test('cancelled install wait launches nothing and preserves an existing helper', () => fixture(async ({ home, plugin }) => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    await assert.rejects(ensureHelperRuntime(plugin, { ...allowed, home, signal: controller.signal, runFile: async () => { calls++; } }), error => error.name === 'AbortError');
    assert.equal(calls, 0);
}));
test('info never carries credentials; authorize requests only the chosen entity; source IDs stay in setup envelopes', () => fixture(async ({ root }) => {
    const requests = [];
    const options = { root, scheme: 'obsidianplanner-helper', launch: async url => {
        const action = new URL(url).pathname.slice(1), request = await envelope(root, url, action); requests.push(request);
        await respond(root, request);
    } };
    await helperInfo(input, options); await helperAuthorize(input, credential, 'reminders', options); await helperAuthorize(input, credential, 'calendar', options);
    await helperConfigure(input, credential, { reminderSourceID: 'reminder-icloud' }, options);
    await helperConfigure(input, credential, { calendarSourceID: 'calendar-icloud' }, options);
    assert.equal(requests[0].pairingToken, undefined); assert.equal(requests[0].allowSync, undefined);
    assert.equal(requests[1].entity, 'reminders'); assert.equal(requests[2].entity, 'calendar');
    assert.equal(requests[3].reminderSourceID, 'reminder-icloud'); assert.equal(requests[3].calendarSourceID, undefined);
    assert.equal(requests[4].calendarSourceID, 'calendar-icloud'); assert.equal(requests[4].reminderSourceID, undefined);
    assert.ok(requests.slice(1).every(request => request.pairingToken === credential.pairingToken && request.allowSync === undefined));
}));
test('unpair revokes via helper without requiring state or deleting history client-side', () => fixture(async ({ root }) => {
    const response = await helperUnpair(input, credential, { root, scheme: 'obsidianplanner-helper', launch: async url => respond(root, await envelope(root, url, 'unpair'), 'ready', { state: undefined }) });
    assert.equal(response.status, 'ready'); assert.equal(response.state, undefined);
}));
test('setup rejects wrong transport, version, selected account identity and malformed permission/source DTOs', () => fixture(async ({ root }) => {
    await assert.rejects(helperInfo(input, { root, launch: async () => {} }), error => error.code === 'INVALID_RESPONSE');
    const invalid = [{ appVersion: '0.3.0' }, { state: undefined }, { state: { ...state(), remindersPermission: 'authorized' } },
        { state: { ...state(), reminderSourceID: 'calendar-only', reminderSources: [{ id: 'reminder-only', title: 'iCloud' }] } },
        { state: { ...state(), calendarSources: [{ id: 'one', title: 'iCloud' }, { id: 'one', title: 'duplicate' }] } }];
    for (const extra of invalid) await assert.rejects(helperInfo(input, { root, scheme: 'obsidianplanner-helper', launch: async url => respond(root, await envelope(root, url, 'info'), 'ready', extra) }), error => error.code === 'INVALID_RESPONSE');
}));
test('denied permission is displayed as needsSetup and validates returned state rather than pretending success', () => fixture(async ({ root }) => {
    const response = await helperAuthorize(input, credential, 'reminders', { root, scheme: 'obsidianplanner-helper', launch: async url => respond(root, await envelope(root, url, 'authorize'), 'needsSetup', { state: { ...state(), remindersPermission: 'denied' }, errorCode: 'PERMISSION_REQUIRED' }) });
    assert.equal(response.status, 'needsSetup'); assert.equal(response.state.remindersPermission, 'denied');
}));
test('a configure setup error without state keeps its actionable code and message', () => fixture(async ({ root }) => {
    const response = await helperConfigure(input, credential, { reminderSourceID: 'removed-account' }, { root, scheme: 'obsidianplanner-helper', launch: async url => respond(root, await envelope(root, url, 'configure'), 'needsSetup', { state: undefined, errorCode: 'APP_SETUP_REQUIRED', message: 'Choose an available Reminders account.' }) });
    assert.equal(response.status, 'needsSetup'); assert.equal(response.errorCode, 'APP_SETUP_REQUIRED');
    assert.equal(response.message, 'Choose an available Reminders account.');
}));
test('helper pair writes only NEW PluginBridge credentials and never copies App tokens', () => fixture(async ({ root, home }) => {
    const oldRoot = join(home, 'Library', 'Application Support', 'ObsidianPlanner', 'Bridge');
    await mkdir(oldRoot, { recursive: true }); await writeFile(join(oldRoot, 'old-credential-fixture.json'), 'old-app-token');
    await pairPlanner(input, { root, scheme: 'obsidianplanner-helper', launch: async url => {
        const request = await envelope(root, url, 'pair'); assert.equal(request.allowSync, true); assert.equal(request.pairingToken, undefined);
        await respond(root, request, 'paired', { pairing: credential });
    } }, true);
    assert.deepEqual(await readCredential(input.vaultPath, root), credential);
    assert.equal(await readCredential(input.vaultPath, oldRoot), null);
    assert.equal(await readFile(join(oldRoot, 'old-credential-fixture.json'), 'utf8'), 'old-app-token');
}));
test('helper preview and sync reuse existing validators and persist unknown outcomes only in PluginBridge', () => fixture(async ({ root, home }) => {
    const options = defaultSyncOptions();
    const value = { previewId: 'e330bf2b-21a7-48fb-884a-5566d5f54450', vaultKey: credential.vaultKey, vaultName: input.vaultName, startDate: input.startDate, endDate: input.endDate, timeZone: input.timeZone, options,
        syncAllowed: true, linkCandidates: [], issues: [], entries: [{ id: 'one', filePath: '2026-11-18.md', line: 3, date: '2026-11-18', title: 'Fake plan', start: '2026-11-18T01:00:00Z', end: '2026-11-18T02:00:00Z', startTime: '09:00', endTime: '10:00', completed: false, incomplete: false, action: 'create', selectedAction: 'create', reason: 'New plan' }], counts: { create: 1, update: 0, unchanged: 0, conflict: 0, skipped: 0 } };
    const response = await previewPlanner(input, credential, options, { root, scheme: 'obsidianplanner-helper', launch: async url => respond(root, await envelope(root, url, 'preview'), 'previewReady', { preview: value }) });
    assert.deepEqual(response.preview, value);
    let syncCalls = 0;
    await assert.rejects(syncPlanner(input, credential, options, value, initialSelection(value), { root, scheme: 'obsidianplanner-helper', timeoutMs: 12, pollMs: 2, launch: async url => {
        syncCalls++; const request = await envelope(root, url, 'sync'); assert.equal((await readRun(input.vaultPath, root)).requestId, request.requestId);
    } }), error => error.code === 'NO_CONFIRMATION');
    const run = await readRun(input.vaultPath, root); assert.equal(run.status, 'unconfirmed'); assert.equal(syncCalls, 1);
    await statusPlanner(input, credential, run.requestId, { root, scheme: 'obsidianplanner-helper', launch: async url => respond(root, await envelope(root, url, 'status'), 'notFound', { state: undefined }) });
    assert.equal((await readRun(input.vaultPath, root)).status, 'notFound');
    assert.equal(await readRun(input.vaultPath, join(home, 'Library', 'Application Support', 'ObsidianPlanner', 'Bridge')), null);
}));

test('configuration never sends blank, unknown or cross-service option fields', () => fixture(async ({ root }) => {
    let calls = 0;
    const options = { root, scheme: 'obsidianplanner-helper', launch: async () => { calls++; } };
    for (const ids of [{ reminderSourceID: '' }, { calendarSourceID: ' ' }, { sourceID: 'unknown-field' }])
        assert.throws(() => helperConfigure(input, credential, ids, options), /eligible account/);
    assert.equal(calls, 0);
}));
