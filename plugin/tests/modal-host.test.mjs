import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import * as nodePath from 'node:path';

test('modal can preview and sync while Obsidian retains its editor selection for restoration', async () => {
    const modals = [];
    class HostModal {
        constructor(app) {
            this.app = app;
            this.modalEl = { addClass() {} };
            // Rendering is outside this lifecycle regression; real-host layout is checked separately.
            this.render = () => {};
        }
        open() {
            // Obsidian Modal.open() writes its own selection snapshot, containing a Window.
            this.selection = { win: { restoreSelection() {} }, range: null, focusEl: null };
            modals.push(this);
            this.opened = this.onOpen();
        }
    }
    class HostPlugin { constructor(app) { this.app = app; } }
    const credential = { vaultKey: 'a'.repeat(64), pairingToken: 'fake-host-test-token', allowSync: true };
    const bridge = {
        defaultSyncOptions: () => ({ includeCalendar: false, notification: { channel: 'Reminders', minutes: 10 } }),
        readCredential: async () => credential, readRun: async () => null, bridgeRoot: () => '/Fake/Bridge',
        runBlocksNewSync: () => false,
    };
    const helper = { pluginBridgeRoot: () => '/Fake/PluginBridge', unsupportedReason: () => null };
    const output = await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'node', target: 'es2022',
        external: ['obsidian', './bridge-client.ts', './helper-client.ts'], write: false });
    const module = { exports: {} };
    runInNewContext(output.outputFiles[0].text, { exports: module.exports, module, structuredClone, AbortController, Intl, Date,
        require: name => {
            if (name === 'obsidian') return { Modal: HostModal, Plugin: HostPlugin, PluginSettingTab: class {}, Platform: { isMacOS: true, isDesktopApp: true } };
            if (name === 'node:path') return nodePath;
            if (name === './helper-client.ts') return helper;
            if (name === './bridge-client.ts') return bridge;
            throw new Error(`Unexpected import: ${name}`);
        } });
    const plugin = new module.exports.default({});
    plugin.vaultPath = () => '/Fake/Vault';
    plugin.savePreferences = async () => {};
    plugin.refreshRange = async () => 'Installed helper ready.';
    const preview = {
        startDate: '2026-11-18', endDate: '2026-11-18', timeZone: 'Asia/Shanghai', syncAllowed: true,
        entries: [{ id: 'new', action: 'create' }, { id: 'old', action: 'unchanged' }], issues: [],
    };
    let submitted;
    plugin.previewRange = async () => preview;
    plugin.syncReviewed = async (reviewed, choices) => { submitted = { reviewed, choices }; return { status: 'completed', message: 'Saved locally.' }; };
    plugin.openModal();
    const modal = modals[0];
    await modal.opened;
    const hostSelection = modal.selection;
    await modal.perform('preview');
    assert.equal(modal.preview, preview);
    await modal.perform('sync');
    assert.equal(submitted.reviewed, preview);
    assert.deepEqual(submitted.choices, { choices: { new: 'add', old: 'skip' }, resolutions: {} });
    assert.equal(modal.selection, hostSelection, 'plan choices must not replace the host editor selection');
    assert.equal(modal.preview, null, 'executing a batch requires a fresh preview');
    await modal.perform('preview');
    let changedAccount;
    plugin.setupRange = async (_range, _zone, action, entity, sourceID) => { changedAccount = { action, entity, sourceID }; return 'Account chosen.'; };
    await modal.perform('configureReminders', 'entity-specific-reminder-id');
    assert.deepEqual(changedAccount, { action: 'configure', entity: 'reminders', sourceID: 'entity-specific-reminder-id' });
    assert.equal(modal.preview, null, 'account changes require a new preview');
    assert.deepEqual(Object.keys(modal.planSelection.choices), []);
    assert.deepEqual(Object.keys(modal.planSelection.resolutions), []);
    assert.equal(modal.selection, hostSelection, 'setup must preserve the host selection too');
});
