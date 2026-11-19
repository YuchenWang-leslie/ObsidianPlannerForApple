import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import * as nodePath from 'node:path';
import { defaultSyncOptions, validSyncOptions } from '../src/bridge-client.ts';

const setupURL = 'https://example.test/helper-setup';
const output = await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'node', target: 'es2022',
    external: ['obsidian', './bridge-client.ts', './helper-client.ts'], write: false });
class HostElement {
    constructor(tag = 'div', options = {}) { this.tag = tag; this.children = []; this.textContent = options.text ?? ''; this.attributes = options.attr ?? {}; }
    createEl(tag, options) { const element = new HostElement(tag, options); this.children.push(element); return element; }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    addClass() {}
    empty() { this.children = []; }
    setText(text) { this.textContent = text; }
    addEventListener() {}
}
class HostButton {
    constructor() { this.buttonEl = {}; }
    setButtonText(value) { this.text = value; return this; }
    setCta() { return this; }
    setDisabled(value) { this.buttonEl.disabled = value; return this; }
    onClick(callback) { this.click = callback; return this; }
}
class HostSetting {
    constructor(element) { this.element = element; this.descEl = element.createDiv(); this.buttons = []; }
    setName(name) { this.name = name; return this; }
    setDesc(desc) { this.desc = desc; return this; }
    setHeading() { this.heading = true; return this; }
    addButton(callback) { const button = new HostButton(); this.buttons.push(button); callback(button); return this; }
}
async function host(saved) {
    const tabs = [], commands = [], data = [], notices = [], io = { reads: 0, native: 0 };
    class MainPluginMock {
        constructor(app) { this.app = app; }
        loadData() { io.reads++; return Promise.resolve(saved); }
        saveData(value) { data.push(structuredClone(value)); return Promise.resolve(); }
        addRibbonIcon() {}
        addCommand(command) { commands.push(command); }
        addSettingTab(tab) { tabs.push(tab); tab.update(); }
    }
    class HostSettingsTab {
        constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new HostElement(); this.updates = 0; }
        update() { this.updates++; this.settingItems = this.getSettingDefinitions(); }
    }
    const module = { exports: {} };
    const helper = { HELPER_SETUP_URL: setupURL, pluginBridgeRoot: () => '/Fake/PluginBridge', unsupportedReason: () => null,
        helperInfo: () => { io.native++; throw new Error('Settings indexing must not start the helper'); } };
    runInNewContext(output.outputFiles[0].text, { exports: module.exports, module, structuredClone, AbortController, Intl, Date, Error,
        require: name => {
            if (name === 'obsidian') return { Plugin: MainPluginMock, Modal: class {}, PluginSettingTab: HostSettingsTab, Setting: HostSetting,
                Notice: class { constructor(message) { notices.push(message); } }, Platform: { isMacOS: true, isDesktopApp: true } };
            if (name === 'node:path') return nodePath;
            if (name === './helper-client.ts') return helper;
            if (name === './bridge-client.ts') return { defaultSyncOptions, validSyncOptions };
            throw new Error(`Unexpected import: ${name}`);
        } });
    const plugin = new module.exports.default({});
    const defaults = structuredClone(plugin.settings);
    await plugin.onload();
    return { plugin, defaults, tab: tabs[0], commands, data, notices, io };
}
function render(definition) {
    const row = new HostSetting(new HostElement()); definition.render?.(row); return row;
}

test('declarative settings register searchable metadata cheaply and retain title, guide and planner action', async () => {
    const { plugin, tab, io, data } = await host(null);
    assert.equal(Object.hasOwn(Object.getPrototypeOf(tab), 'display'), false, 'no deprecated display override');
    assert.equal(io.reads, 1); assert.equal(io.native, 0); assert.equal(data.length, 0);
    const first = tab.getSettingDefinitions(), second = tab.getSettingDefinitions();
    assert.equal(first.length, 5); assert.equal(second.length, first.length);
    for (const definition of first) { assert.ok(definition.name.length); assert.ok(definition.desc.length); assert.ok(definition.aliases.length); }
    assert.ok(first.some(def => def.aliases.includes('calendar') && def.aliases.includes('reminders')));
    assert.ok(first.some(def => def.aliases.includes('revoke') && def.desc.includes('history stay')));
    const heading = render(first[0]); assert.equal(heading.heading, true);
    const guide = render(first.find(def => def.name === 'Helper setup guide'));
    const link = guide.descEl.children.find(child => child.tag === 'a');
    assert.equal(link.attributes.href, setupURL); assert.equal(guide.descEl.children[0].tag, 'span');
    let opened = 0; plugin.openModal = () => { opened++; };
    const planner = render(first.find(def => def.name === 'Planner, connection & permissions'));
    planner.buttons[0].click(); assert.equal(opened, 1);
    assert.equal(io.reads, 1); assert.equal(io.native, 0); assert.equal(data.length, 0, 'indexing/rendering cannot save settings');
});
test('system-zone action persists all preferences through savePreferences before update()', async () => {
    const value = { timeZone: 'Asia/Tokyo', rangeMode: 'custom', customStart: '2026-11-18', customEnd: '2026-11-22', options: { includeCalendar: true, notification: { channel: 'Both', minutes: 15 } } };
    const { plugin, tab } = await host(value);
    const currentUpdates = tab.updates, saved = [];
    let finishSave;
    plugin.saveData = data => { saved.push(structuredClone(data)); return new Promise(resolve => { finishSave = resolve; }); };
    const action = render(tab.getSettingDefinitions().find(def => def.name === 'Use system time zone'));
    const pending = action.buttons[0].click();
    assert.equal(tab.updates, currentUpdates, 'refresh must wait until save succeeds');
    assert.equal(saved.length, 1); assert.equal(saved[0].timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(saved[0].rangeMode, 'custom'); assert.deepEqual(saved[0].options, value.options);
    assert.deepEqual(Object.keys(saved[0]).sort(), ['customEnd', 'customStart', 'options', 'rangeMode', 'timeZone']);
    finishSave(); await pending; assert.equal(tab.updates, currentUpdates + 1);
});
test('failed settings persistence reports the error without falsely updating the tab', async () => {
    const { plugin, tab, notices } = await host(null); const updates = tab.updates;
    plugin.saveData = () => Promise.reject(new Error('Fake storage failure'));
    await render(tab.getSettingDefinitions().find(def => def.name === 'Use system time zone')).buttons[0].click();
    assert.equal(tab.updates, updates); assert.deepEqual(notices, ['Fake storage failure']);
});
test('malformed saved data keeps valid defaults and never imports credentials or account IDs', async () => {
    for (const saved of [null, false, 12, 'settings', [], { timeZone: [], rangeMode: 'unknown', customStart: '2026-02-30', customEnd: {}, options: null },
        { timeZone: 'Invalid/Nowhere', rangeMode: false, options: { includeCalendar: false, notification: { channel: 'Calendar', minutes: 10 } } },
        { customStart: '2026-11-22', customEnd: '2026-11-18', options: { includeCalendar: true, notification: { channel: 'Reminders', minutes: '10' } } }]) {
        const { plugin, defaults, data } = await host(saved);
        assert.deepEqual(structuredClone(plugin.settings), defaults); assert.equal(data.length, 0);
    }
    const preferences = { timeZone: 'Asia/Tokyo', rangeMode: 'custom', customStart: '2026-11-18', customEnd: '2026-11-22', options: { includeCalendar: false, notification: { channel: 'Reminders', minutes: 10 } } };
    const { plugin, data } = await host({ ...preferences, pairingToken: 'do-not-copy', reminderSourceID: 'private-account', options: { ...preferences.options, pairingToken: 'also-do-not-copy' } });
    assert.deepEqual(structuredClone(plugin.settings), preferences);
    await plugin.savePreferences(plugin.settings);
    assert.deepEqual(data, [preferences]);
});
