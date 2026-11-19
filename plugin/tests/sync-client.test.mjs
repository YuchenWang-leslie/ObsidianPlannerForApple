import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pairPlanner, readCredential, syncPlanner, statusPlanner, waitForRun, readRun, acknowledgeRun, runBlocksNewSync, runNeedsAcknowledgement, defaultSyncOptions } from '../src/bridge-client.ts';
import { initialSelection, validateSelection, selectedCount } from '../src/selection.ts';
import { pairingStatusMessage } from '../src/connection-state.ts';

const input = { vaultPath: '/Example/Sync Vault', vaultName: 'Sync Vault', startDate: '2026-11-16', endDate: '2026-11-22', timeZone: 'Asia/Shanghai' };
const credential = { vaultKey: 'a'.repeat(64), pairingToken: 'fake-sync-test-token', allowSync: true };
const options = defaultSyncOptions();
function preview() {
    return { previewId: 'e330bf2b-21a7-48fb-884a-5566d5f54450', vaultKey: credential.vaultKey, vaultName: input.vaultName, startDate: input.startDate, endDate: input.endDate, timeZone: input.timeZone, options,
        syncAllowed: true, linkCandidates: [{ id: 'eligible-record', date: '2026-11-18', title: 'Earlier title', startTime: '09:00', endTime: '10:00' }], issues: [],
        entries: ['create', 'update', 'unchanged', 'conflict'].map((action, index) => ({ id: `plan-${index}`, filePath: '2026-11-18.md', line: index + 2, date: '2026-11-18', title: `Example ${action}`,
            start: `2026-11-18T0${index}:00:00Z`, end: `2026-11-18T0${index}:30:00Z`, startTime: `${String(index + 8).padStart(2, '0')}:00`, endTime: `${String(index + 8).padStart(2, '0')}:30`,
            completed: false, incomplete: action === 'update', action, selectedAction: action === 'create' ? 'create' : action === 'conflict' ? 'conflict' : 'skip', reason: 'Example reason' })),
        counts: { create: 1, update: 1, unchanged: 1, conflict: 1, skipped: 2 } };
}
async function fixture(callback) {
    const root = await mkdtemp(join(tmpdir(), 'apple-sync-p3-'));
    try { await callback(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function requestFor(root, url, action) {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, `/${action}`);
    assert.deepEqual([...parsed.searchParams.keys()].sort(), ['protocol', 'requestId']);
    assert.ok(!url.includes(credential.pairingToken) && !url.includes(input.vaultPath));
    const request = JSON.parse(await readFile(join(root, 'inbox', `${parsed.searchParams.get('requestId')}.json`), 'utf8'));
    assert.equal(request.protocolVersion, 1); assert.equal(request.action, action);
    return request;
}
function result(status = 'completed', fields = {}) {
    return { status, message: status === 'partial' ? 'One target failed; update the incomplete plan.' : 'Saved locally.',
        counts: { calendarSaved: 0, remindersSaved: 1, skipped: 3, failed: 0, unresolved: 0 },
        items: [{ entryId: 'plan-0', title: 'Example create', date: '2026-11-18', action: 'create', status: 'saved', calendarSaved: false, reminderSaved: true, message: 'Reminder saved.' }], ...fields };
}
function job(requestId, status = 'running', fields = {}) {
    return { requestId, previewId: preview().previewId, vaultKey: credential.vaultKey, status, createdAt: '2026-11-18T02:00:00Z', updatedAt: '2026-11-18T02:00:01Z', ...(status === 'completed' || status === 'partial' || status === 'failed' ? { result: result(status) } : {}), ...fields };
}
async function respond(root, request, status, fields = {}) {
    const path = join(root, 'outbox', `${request.requestId}.json`);
    await writeFile(`${path}.tmp`, JSON.stringify({ protocolVersion: 1, requestId: request.requestId, status, appVersion: '0.5.0', capabilities: ['open', 'pair', 'preview', 'sync', 'status'], message: 'Example response.', ...fields }));
    await rename(`${path}.tmp`, path);
}
async function submit(root, status = 'running', fields = {}, extras = {}) {
    const value = preview();
    return syncPlanner(input, credential, options, value, initialSelection(value), { root, launch: async url => {
        const request = await requestFor(root, url, 'sync');
        await respond(root, request, status, { job: job(request.requestId, status), ...fields });
    }, ...extras });
}

test('new defaults Add, old and incomplete defaults Skip, conflicts explicit Skip without choices override', () => {
    const value = preview(), selection = initialSelection(value);
    assert.deepEqual(selection, { choices: { 'plan-0': 'add', 'plan-1': 'skip', 'plan-2': 'skip' }, resolutions: { 'plan-3': 'skip' } });
    assert.equal(selectedCount(value, selection), 1); validateSelection(value, selection);
    selection.choices['plan-1'] = 'update'; selection.choices['plan-2'] = 'addAgain'; selection.resolutions['plan-3'] = 'eligible-record';
    validateSelection(value, selection); assert.equal(selectedCount(value, selection), 4);
    selection.resolutions['plan-3'] = 'new'; validateSelection(value, selection);
});
test('selection rejects unknown IDs, invalid Add/Update operations and ineligible conflict links', () => {
    const value = preview();
    for (const mutate of [s => s.choices['unknown'] = 'add', s => delete s.choices['plan-0'], s => s.choices['plan-0'] = 'update', s => s.choices['plan-1'] = 'add',
        s => s.choices['plan-3'] = 'skip', s => delete s.resolutions['plan-3'], s => s.resolutions['plan-3'] = 'outside-range-record', s => s.resolutions['plan-1'] = 'new']) {
        const selection = initialSelection(value); mutate(selection); assert.throws(() => validateSelection(value, selection));
    }
});
test('P2 credentials default to read-only; explicit allowSync pairing is carried only inside private request', () => fixture(async root => {
    let requested;
    await pairPlanner(input, { root, launch: async url => {
        requested = await requestFor(root, url, 'pair'); assert.equal(requested.allowSync, undefined);
        await respond(root, requested, 'paired', { pairing: { vaultKey: credential.vaultKey, pairingToken: credential.pairingToken } });
    } });
    assert.equal((await readCredential(input.vaultPath, root)).allowSync, false);
    await pairPlanner(input, { root, launch: async url => {
        requested = await requestFor(root, url, 'pair'); assert.equal(requested.allowSync, true);
        await respond(root, requested, 'paired', { pairing: credential });
    } }, true);
    assert.equal((await readCredential(input.vaultPath, root)).allowSync, true);
}));
test('read-only local or native scope cannot submit sync, and no run file is created', () => fixture(async root => {
    let launches = 0; const value = preview();
    for (const scope of [false, undefined]) await assert.rejects(syncPlanner(input, { ...credential, allowSync: scope }, options, value, initialSelection(value), { root, launch: async () => { launches++; } }), /preview-only/);
    value.syncAllowed = false;
    await assert.rejects(syncPlanner(input, credential, options, value, initialSelection(value), { root, launch: async () => { launches++; } }), /preview-only/);
    assert.equal(launches, 0); assert.deepEqual(await readdir(root), []);
}));
test('one sync UUID and token-free private run pointer are persisted BEFORE URL launch', () => fixture(async root => {
    let calls = 0;
    await submit(root, 'running', {}, { launch: async url => {
        calls++; const request = await requestFor(root, url, 'sync'), run = await readRun(input.vaultPath, root);
        assert.equal(run.status, 'unconfirmed'); assert.equal(run.requestId, request.requestId); assert.equal(run.previewId, request.previewId);
        assert.deepEqual(request, { protocolVersion: 1, requestId: run.requestId, action: 'sync', ...input, vaultKey: credential.vaultKey, pairingToken: credential.pairingToken, options, previewId: preview().previewId, ...initialSelection(preview()) });
        assert.equal((await stat(join(root, 'runs'))).mode & 0o777, 0o700);
        const [filename] = await readdir(join(root, 'runs')); assert.equal((await stat(join(root, 'runs', filename))).mode & 0o777, 0o600);
        assert.ok(!(await readFile(join(root, 'runs', filename), 'utf8')).includes(credential.pairingToken));
        await respond(root, request, 'running', { job: job(run.requestId) });
    } });
    assert.equal(calls, 1); assert.equal((await readRun(input.vaultPath, root)).status, 'running');
    assert.deepEqual(await readdir(join(root, 'inbox')), []);
}));
test('status uses a fresh transport ID and original syncRequestId without submitting another sync', () => fixture(async root => {
    await submit(root); const run = await readRun(input.vaultPath, root); let calls = 0;
    const response = await statusPlanner(run.input, { ...credential, allowSync: false }, run.requestId, { root, launch: async url => {
        calls++; const request = await requestFor(root, url, 'status'); assert.notEqual(request.requestId, run.requestId);
        assert.equal(request.syncRequestId, run.requestId); assert.equal(request.options, undefined); assert.equal(request.allowSync, undefined);
        await respond(root, request, 'completed', { job: job(run.requestId, 'completed') });
    } });
    assert.equal(calls, 1); assert.equal(response.job.result.counts.remindersSaved, 1);
    const recovered = await readRun(input.vaultPath, root); assert.equal(recovered.status, 'completed'); assert.equal(runBlocksNewSync(recovered), false);
}));
test('lost response survives reload, blocks another batch, and can only be queried or explicitly acknowledged', () => fixture(async root => {
    let launches = 0;
    await assert.rejects(submit(root, 'running', {}, { timeoutMs: 15, pollMs: 2, launch: async () => { launches++; } }), error => error.code === 'NO_CONFIRMATION');
    let run = await readRun(input.vaultPath, root); assert.equal(run.status, 'unconfirmed'); assert.ok(runBlocksNewSync(run));
    await assert.rejects(submit(root, 'running', {}, { launch: async () => { launches++; } }), error => error.code === 'RUN_PENDING');
    assert.equal(launches, 1);
    await statusPlanner(run.input, credential, run.requestId, { root, launch: async url => respond(root, await requestFor(root, url, 'status'), 'notFound') });
    run = await readRun(input.vaultPath, root); assert.equal(run.status, 'notFound'); assert.ok(runNeedsAcknowledgement(run));
    await acknowledgeRun(input.vaultPath, root); run = await readRun(input.vaultPath, root); assert.equal(run.acknowledged, true); assert.equal(runBlocksNewSync(run), false);
}));
test('running cannot be acknowledged; interrupted requires explicit acknowledgment and never writes recovery', () => fixture(async root => {
    await submit(root); let run = await readRun(input.vaultPath, root);
    await assert.rejects(acknowledgeRun(input.vaultPath, root), /running/);
    await statusPlanner(run.input, credential, run.requestId, { root, launch: async url => respond(root, await requestFor(root, url, 'status'), 'interrupted', { job: job(run.requestId, 'interrupted') }) });
    run = await readRun(input.vaultPath, root); assert.ok(runNeedsAcknowledgement(run)); assert.ok(runBlocksNewSync(run));
    await acknowledgeRun(input.vaultPath, root); assert.equal(runBlocksNewSync(await readRun(input.vaultPath, root)), false);
}));
test('bounded running polling preserves original pointer and only launches status routes', () => fixture(async root => {
    await submit(root); const run = await readRun(input.vaultPath, root); let count = 0;
    const response = await waitForRun(run, credential, { root, statusTimeoutMs: 14, statusPollMs: 2, launch: async url => {
        count++; const request = await requestFor(root, url, 'status'); assert.equal(request.syncRequestId, run.requestId);
        await respond(root, request, 'running', { job: job(run.requestId) });
    } });
    assert.ok(count >= 1); assert.equal(response.status, 'running'); assert.equal((await readRun(input.vaultPath, root)).requestId, run.requestId);
}));
test('modal-close or unload cancellation keeps the pointer and never submits again', () => fixture(async root => {
    const controller = new AbortController();
    await assert.rejects(submit(root, 'running', {}, { signal: controller.signal, pollMs: 2, launch: async url => {
        await requestFor(root, url, 'sync'); controller.abort();
    } }), error => error.name === 'AbortError');
    const run = await readRun(input.vaultPath, root); assert.equal(run.status, 'unconfirmed');
    assert.deepEqual(await readdir(join(root, 'inbox')), []);
    const nextController = new AbortController();
    await assert.rejects(waitForRun(run, credential, { root, signal: nextController.signal, pollMs: 2, launch: async url => {
        await requestFor(root, url, 'status'); nextController.abort();
    } }), error => error.name === 'AbortError');
    assert.equal((await readRun(input.vaultPath, root)).requestId, run.requestId);
}));
test('cancel before submission creates no pointer or transport and launches nothing', () => fixture(async root => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    await assert.rejects(submit(root, 'running', {}, { signal: controller.signal, launch: async () => { calls++; } }), error => error.name === 'AbortError');
    assert.equal(calls, 0); assert.equal(await readRun(input.vaultPath, root), null); assert.deepEqual(await readdir(root), []);
}));
test('partial result records independent target saves and failure code without retry', () => fixture(async root => {
    const partial = result('partial', { errorCode: 'PREVIEW_FAILED', counts: { calendarSaved: 1, remindersSaved: 0, skipped: 3, failed: 1, unresolved: 0 },
        items: [{ entryId: 'plan-0', title: 'Example create', date: '2026-11-18', action: 'create', status: 'failed', calendarSaved: true, reminderSaved: false, message: 'Reminder failed; calendar saved.' }] });
    let calls = 0;
    await submit(root, 'partial', {}, { launch: async url => { calls++; const request = await requestFor(root, url, 'sync'); await respond(root, request, 'partial', { job: job(request.requestId, 'partial', { result: partial }) }); } });
    const run = await readRun(input.vaultPath, root); assert.equal(calls, 1); assert.equal(run.status, 'partial');
    assert.equal(run.response.job.result.items[0].calendarSaved, true); assert.equal(run.response.job.result.items[0].reminderSaved, false);
}));
test('freshness and setup rejections are confirmed failures without inventing saves', () => fixture(async root => {
    for (const errorCode of ['SOURCE_CHANGED', 'PREVIEW_EXPIRED', 'PREVIEW_USED', 'PERMISSION_REQUIRED', 'APP_SETUP_REQUIRED', 'SYNC_NOT_ALLOWED']) {
        const response = await submit(root, 'failed', { job: undefined, errorCode });
        assert.equal(response.errorCode, errorCode); assert.equal((await readRun(input.vaultPath, root)).status, 'failed');
        assert.equal(response.job, undefined);
    }
}));
test('job identity and invalid DTOs never replace a running result', () => fixture(async root => {
    await submit(root); const run = await readRun(input.vaultPath, root);
    for (const invalidJob of [job('another-id'), job(run.requestId, 'completed', { previewId: 'another-preview' }), job(run.requestId, 'completed', { vaultKey: 'b'.repeat(64) }),
        job(run.requestId, 'completed', { result: result('completed', { counts: { calendarSaved: -1 } }) }), job(run.requestId, 'completed', { requestId: 1 })]) {
        await assert.rejects(statusPlanner(run.input, credential, run.requestId, { root, launch: async url => respond(root, await requestFor(root, url, 'status'), 'completed', { job: invalidJob }) }), error => error.code === 'INVALID_RESPONSE');
    }
    assert.equal((await readRun(input.vaultPath, root)).status, 'running');
}));

test('confirmed busy/setup rejection is failed locally, while preserving its actionable response', () => fixture(async root => {
    for (const status of ['busy', 'needsSetup']) {
        const response = await submit(root, status, { job: undefined, errorCode: status === 'needsSetup' ? 'APP_SETUP_REQUIRED' : undefined });
        const run = await readRun(input.vaultPath, root);
        assert.equal(run.status, 'failed'); assert.equal(run.response.status, status);
        assert.equal(runBlocksNewSync(run), false); assert.equal(runNeedsAcknowledgement(run), false);
        assert.equal(response.job, undefined);
    }
}));
test('a refused status query preserves the running job and blocks another batch', () => fixture(async root => {
    await submit(root); const before = await readRun(input.vaultPath, root);
    for (const status of ['busy', 'needsSetup', 'failed']) {
        const response = await statusPlanner(input, credential, before.requestId, { root, launch: async url => respond(root, await requestFor(root, url, 'status'), status, { errorCode: 'VAULT_NOT_PAIRED' }) });
        assert.equal(response.status, status);
        const after = await readRun(input.vaultPath, root);
        assert.deepEqual(after, before); assert.ok(runBlocksNewSync(after));
        await assert.rejects(submit(root), error => error.code === 'RUN_PENDING');
    }
}));
test('old App sync-pair response says update App rather than endlessly pair again', () => {
    const response = { protocolVersion: 1, requestId: 'test', status: 'paired', appVersion: '0.4.0', message: 'Paired.', pairing: { ...credential, allowSync: false }, capabilities: ['open', 'pair', 'preview'] };
    assert.match(pairingStatusMessage(response, true), /Install ObsidianPlanner 0\.5\.0/);
    assert.match(pairingStatusMessage(response, true), /preview-only/);
    assert.match(pairingStatusMessage({ ...response, capabilities: [...response.capabilities, 'sync'] }, true), /not approved/);
    assert.match(pairingStatusMessage(response, false), /preview only/);
});

test('run record whitelists DTO fields and excludes unexpected credential fields', () => fixture(async root => {
    await submit(root, 'completed', {}, { launch: async url => {
        const request = await requestFor(root, url, 'sync');
        const value = job(request.requestId, 'completed'); value.pairingToken = credential.pairingToken;
        value.result.items[0].pairingToken = credential.pairingToken;
        await respond(root, request, 'completed', { job: value, pairing: credential });
    } });
    const [name] = await readdir(join(root, 'runs'));
    assert.ok(!(await readFile(join(root, 'runs', name), 'utf8')).includes(credential.pairingToken));
}));
test('job and transport statuses must agree before a recovered result is accepted', () => fixture(async root => {
    await submit(root); const run = await readRun(input.vaultPath, root);
    await assert.rejects(statusPlanner(input, credential, run.requestId, { root, launch: async url => respond(root, await requestFor(root, url, 'status'), 'completed', { job: job(run.requestId, 'running') }) }), error => error.code === 'INVALID_RESPONSE');
    assert.equal((await readRun(input.vaultPath, root)).status, 'running');
}));

test('malformed persisted JSON and nested run records cannot bypass the running gate', () => fixture(async root => {
    await submit(root);
    const [name] = await readdir(join(root, 'runs')), file = join(root, 'runs', name);
    const valid = await readFile(file, 'utf8');
    const variants = ['{', 'null', '[]', '42'];
    for (const mutate of [run => run.input = null, run => run.input.timeZone = {}, run => delete run.options,
        run => run.options.notification = null, run => run.options.notification.minutes = '10',
        run => run.response.job = [], run => run.response.job.requestId = 'different-job',
        run => run.response.capabilities = [false], run => run.status = 'completed',
        run => run.response.job.result = { ...result(), items: [null] },
        run => run.response.job.result = { ...result(), counts: { calendarSaved: -1 } }]) {
        const run = JSON.parse(valid); mutate(run); variants.push(JSON.stringify(run));
    }
    for (const contents of variants) {
        await writeFile(file, contents);
        await assert.rejects(readRun(input.vaultPath, root), /unreadable/);
        let launches = 0;
        await assert.rejects(submit(root, 'running', {}, { launch: async () => { launches++; } }), /unreadable/);
        assert.equal(launches, 0);
        assert.equal(await readFile(file, 'utf8'), contents, 'invalid record stays available for inspection');
    }
    await writeFile(file, valid);
    assert.ok(runBlocksNewSync(await readRun(input.vaultPath, root)));
    const legacy = JSON.parse(valid); delete legacy.response;
    await writeFile(file, JSON.stringify(legacy));
    assert.ok(runBlocksNewSync(await readRun(input.vaultPath, root)), 'older pointer without optional response still blocks');
}));
