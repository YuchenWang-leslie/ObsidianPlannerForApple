import { FileSystemAdapter, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { shell } from 'electron';
import { defaultSyncOptions, openPlanner, pairPlanner, previewPlanner, readCredential, removeCredential, validSourcePath, validSyncOptions } from './bridge-client.ts';
import type { OpenInput, PreviewEntry, PreviewResult, SyncOptions } from './bridge-client.ts';
import { dayInZone, resolveRange, validTimeZone } from './range.ts';
import type { DateRange, RangeMode } from './range.ts';

interface Settings { timeZone: string; options: SyncOptions }
const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
const commonZones = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];
const copyOptions = (options: SyncOptions): SyncOptions => ({ includeCalendar: options.includeCalendar, notification: { ...options.notification } });

export default class AppleSyncPlugin extends Plugin {
    settings: Settings = { timeZone: systemZone(), options: defaultSyncOptions() };
    lastVerified: Date | null = null;
    private aborter = new AbortController();
    private requesting = false;

    async onload(): Promise<void> {
        const saved: Partial<Settings> | null = await this.loadData();
        if (typeof saved?.timeZone === 'string' && validTimeZone(saved.timeZone)) this.settings.timeZone = saved.timeZone;
        if (validSyncOptions(saved?.options)) this.settings.options = copyOptions(saved.options);
        this.addRibbonIcon('calendar-clock', 'Open Apple sync', () => this.openModal());
        this.addCommand({ id: 'open-apple-sync', name: 'Open Apple sync', callback: () => this.openModal() });
        this.addCommand({ id: 'preview-this-week', name: 'Preview this week', callback: () => this.openModal('thisWeek', true) });
        this.addCommand({ id: 'preview-next-week', name: 'Preview next week', callback: () => this.openModal('nextWeek', true) });
        this.addCommand({ id: 'choose-sync-range', name: 'Choose sync range', callback: () => this.openModal('custom') });
        this.addCommand({ id: 'open-mac-app', name: 'Open Mac app', callback: () => {
            void this.openRange(resolveRange('thisWeek', this.settings.timeZone), this.settings.timeZone).catch(error => this.report(error));
        } });
        this.addSettingTab(new AppleSyncSettings(this));
    }
    onunload(): void { this.aborter.abort(); }
    private supported(): boolean {
        if (Platform.isMacOS && Platform.isDesktopApp) return true;
        new Notice('Day Planner Apple Sync requires Obsidian on macOS and the companion Mac app.');
        return false;
    }
    openModal(mode: RangeMode = 'thisWeek', preview = false): void {
        if (this.supported()) new PreviewModal(this, mode, preview).open();
    }
    vaultPath(): string {
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) throw new Error('This plugin requires a local filesystem vault.');
        return adapter.getBasePath();
    }
    async savePreferences(timeZone: string, options = this.settings.options): Promise<void> {
        if (!validTimeZone(timeZone)) throw new Error('Choose a valid IANA time zone, for example Asia/Shanghai.');
        if (!validSyncOptions(options)) throw new Error('Choose valid notification settings. Calendar notifications require calendar export.');
        this.settings = { timeZone, options: copyOptions(options) };
        // Credentials belong in the private Mac bridge store, never Obsidian data.json.
        await this.saveData({ timeZone: this.settings.timeZone, options: copyOptions(this.settings.options) });
    }
    private input(range: DateRange, timeZone: string): OpenInput {
        return { ...range, timeZone, vaultPath: this.vaultPath(), vaultName: this.app.vault.getName() };
    }
    private async request<T>(operation: () => Promise<T>): Promise<T> {
        if (!this.supported()) throw new Error('This feature requires macOS.');
        if (this.requesting) throw new Error('Another request is waiting. Check the Mac app before trying again.');
        this.aborter.signal.throwIfAborted();
        this.requesting = true;
        try { return await operation(); } finally { this.requesting = false; }
    }
    private bridgeOptions() { return { launch: (url: string) => shell.openExternal(url, { activate: true }), signal: this.aborter.signal }; }
    async openRange(range: DateRange, timeZone: string): Promise<string> {
        return this.request(async () => {
            await this.savePreferences(timeZone);
            const response = await openPlanner(this.input(range, timeZone), this.bridgeOptions());
            return response.status === 'opened'
                ? 'Mac app opened with your date range. This request did not sync any Apple items.'
                : response.status === 'needsVault'
                    ? 'Mac app opened. Choose the requested source vault there. No Apple items were written.' : response.message;
        });
    }
    async pairRange(range: DateRange, timeZone: string, onPending: () => void): Promise<string> {
        return this.request(async () => {
            await this.savePreferences(timeZone);
            const response = await pairPlanner(this.input(range, timeZone), { ...this.bridgeOptions(), onPending });
            if (response.status === 'paired') {
                this.lastVerified = null;
                return 'Credential saved on this Mac. Request a preview to verify access. Pairing did not sync any Apple items.';
            }
            return response.message;
        });
    }
    async previewRange(range: DateRange, timeZone: string, options: SyncOptions): Promise<PreviewResult> {
        return this.request(async () => {
            const input = this.input(range, timeZone);
            const credential = await readCredential(input.vaultPath);
            if (!credential) throw new Error('Pair this vault in the Mac app before requesting a preview.');
            await this.savePreferences(timeZone, options);
            const response = await previewPlanner(input, credential, options, this.bridgeOptions());
            if (response.status !== 'previewReady' || !response.preview) {
                if (response.errorCode === 'VAULT_NOT_PAIRED') this.lastVerified = null;
                throw new Error(response.message);
            }
            this.lastVerified = new Date();
            return response.preview;
        });
    }
    async forgetCredential(): Promise<void> {
        await removeCredential(this.vaultPath()); this.lastVerified = null;
    }
    report(error: unknown): string {
        if (this.aborter.signal.aborted) return 'Request cancelled because the plugin was disabled.';
        const description = error instanceof Error ? error.message : 'The companion Mac app request failed.';
        new Notice(description, 10000);
        return description;
    }
}

class PreviewModal extends Modal {
    private timeZone: string;
    private startDate: string;
    private endDate: string;
    private customTimeZone = '';
    private options: SyncOptions;
    private busy = false;
    private credentialPresent = false;
    private credentialChecked = false;
    private statusMessage = '';
    private preview: PreviewResult | null = null;
    private resultsEl!: HTMLElement;
    private statusEl!: HTMLElement;
    constructor(private plugin: AppleSyncPlugin, private mode: RangeMode, private autoPreview: boolean) {
        super(plugin.app);
        this.timeZone = plugin.settings.timeZone;
        this.options = copyOptions(plugin.settings.options);
        this.startDate = dayInZone(new Date(), this.timeZone); this.endDate = this.startDate;
    }
    async onOpen(): Promise<void> {
        this.modalEl.addClass('apple-sync-modal');
        this.render();
        await this.refreshCredential(); this.render();
        if (this.autoPreview && this.credentialPresent) await this.perform('preview');
        else if (this.autoPreview) { this.statusMessage = 'Pair this vault first, then request a preview.'; this.render(); }
    }
    onClose(): void { this.contentEl.empty(); }
    private async refreshCredential(): Promise<void> {
        try { this.credentialPresent = !!await readCredential(this.plugin.vaultPath()); }
        catch (error) { this.credentialPresent = false; this.statusMessage = this.plugin.report(error); }
        this.credentialChecked = true;
    }
    private invalidate(): void {
        this.preview = null;
        this.resultsEl?.empty();
        this.statusMessage = 'Settings changed. Request a fresh preview.';
        this.statusEl?.setText(this.statusMessage);
    }
    private change(render = true): void { this.invalidate(); if (render) this.render(); }
    private selectedInput(): { range: DateRange; timeZone: string } {
        const timeZone = this.customTimeZone.trim() || this.timeZone;
        return { timeZone, range: resolveRange(this.mode, timeZone, new Date(), { startDate: this.startDate, endDate: this.endDate }) };
    }
    private async perform(kind: 'open' | 'pair' | 'preview'): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.preview = null;
        this.statusMessage = kind === 'pair' ? 'Opening the Mac app. Confirm the exact vault path with its Pair this vault button (up to 120 seconds)…'
            : kind === 'preview' ? 'Reading saved notes through the Mac app… No Apple items are being written.' : 'Opening the Mac app…';
        this.render();
        try {
            const { range, timeZone } = this.selectedInput();
            if (kind === 'open') this.statusMessage = await this.plugin.openRange(range, timeZone);
            else if (kind === 'pair') this.statusMessage = await this.plugin.pairRange(range, timeZone, () => {
                this.statusMessage = 'Waiting for you: review the vault path in the Mac app, then click Pair this vault. Selecting a folder alone does not approve pairing.';
                this.statusEl.setText(this.statusMessage);
            });
            else {
                this.preview = await this.plugin.previewRange(range, timeZone, this.options);
                this.statusMessage = `Preview ready · ${this.preview.entries.length} plans · ${this.preview.issues.length} issues. No Apple items or sync history were changed.`;
            }
        } catch (error) { this.statusMessage = this.plugin.report(error); }
        finally { this.busy = false; await this.refreshCredential(); this.render(); }
    }
    private render(): void {
        const { contentEl } = this;
        contentEl.empty(); contentEl.addClass('apple-sync-preview');
        const header = contentEl.createDiv({ cls: 'apple-sync-header' });
        header.createEl('span', { text: 'READ-ONLY PREVIEW', cls: 'apple-sync-eyebrow' });
        header.createEl('h2', { text: 'Day Planner → Apple' });
        header.createEl('p', { text: 'Review your saved plans here. Sync remains a separate action in the Mac app.', cls: 'apple-sync-description' });
        const source = contentEl.createDiv({ cls: 'apple-sync-card' });
        source.createEl('h3', { text: this.app.vault.getName() });
        source.createEl('p', { text: this.plugin.vaultPath(), cls: 'apple-sync-path' });
        source.createEl('p', { text: !this.credentialChecked ? 'Checking local credential…' : this.credentialPresent ? 'Credential saved on this Mac' : 'This vault has no local credential', cls: 'apple-sync-context' });
        source.createEl('p', { text: this.plugin.lastVerified ? `Access last verified by preview: ${this.plugin.lastVerified.toLocaleString()}` : 'Access has not been verified by a preview in this session.', cls: 'apple-sync-description' });
        new Setting(source).setName(this.credentialPresent ? 'Pair again' : 'Pair this vault').setDesc('Requires explicit confirmation in the companion Mac app.').setDisabled(this.busy)
            .addButton(button => button.setButtonText(this.credentialPresent ? 'Pair again…' : 'Pair this vault…').onClick(() => { void this.perform('pair'); }));
        const range = contentEl.createDiv({ cls: 'apple-sync-card' });
        range.createEl('h3', { text: 'Preview range' });
        new Setting(range).setName('Date range').setDisabled(this.busy).addDropdown(dropdown => dropdown
            .addOptions({ thisWeek: 'This week', nextWeek: 'Next week', custom: 'Custom' }).setValue(this.mode)
            .onChange(value => { this.mode = value as RangeMode; this.change(); }));
        if (this.mode === 'custom') {
            new Setting(range).setName('From · inclusive').setDisabled(this.busy).addText(text => { text.inputEl.type = 'date'; text.setValue(this.startDate).onChange(value => { this.startDate = value; this.change(false); }); });
            new Setting(range).setName('To · inclusive').setDisabled(this.busy).addText(text => { text.inputEl.type = 'date'; text.setValue(this.endDate).onChange(value => { this.endDate = value; this.change(false); }); });
        }
        new Setting(range).setName('Time zone').setDisabled(this.busy).addDropdown(dropdown => {
            for (const zone of new Set([this.timeZone, systemZone(), ...commonZones])) dropdown.addOption(zone, zone.replaceAll('_', ' '));
            dropdown.setValue(this.timeZone).onChange(value => { this.timeZone = value; this.customTimeZone = ''; this.change(); });
        });
        new Setting(range).setName('Other IANA time zone').setDesc('Optional; overrides the menu.').setDisabled(this.busy)
            .addText(text => text.setPlaceholder('e.g. Australia/Sydney').setValue(this.customTimeZone).onChange(value => { this.customTimeZone = value; this.change(false); }));
        const options = contentEl.createDiv({ cls: 'apple-sync-card' });
        options.createEl('h3', { text: 'Preview options' });
        new Setting(options).setName('Also create calendar events').setDesc('Reminders are the default destination. This only previews the chosen settings.').setDisabled(this.busy)
            .addToggle(toggle => toggle.setValue(this.options.includeCalendar).onChange(value => {
                this.options.includeCalendar = value;
                if (!value && ['Calendar', 'Both'].includes(this.options.notification.channel)) this.options.notification.channel = 'Reminders';
                this.change();
            }));
        new Setting(options).setName('Notify via').setDisabled(this.busy).addDropdown(dropdown => {
            dropdown.addOptions({ Reminders: 'Reminders', None: 'No notifications' });
            if (this.options.includeCalendar) dropdown.addOptions({ Calendar: 'Calendar', Both: 'Both' });
            dropdown.setValue(this.options.notification.channel).onChange(value => { this.options.notification.channel = value as SyncOptions['notification']['channel']; this.change(); });
        });
        new Setting(options).setName('Minutes before').setDisabled(this.busy || this.options.notification.channel === 'None').addDropdown(dropdown => {
            for (let value = 0; value <= 60; value += 5) dropdown.addOption(String(value), value === 0 ? 'At start' : `${value} minutes`);
            dropdown.setValue(String(this.options.notification.minutes)).onChange(value => { this.options.notification.minutes = Number(value); this.change(); });
        });
        contentEl.createEl('p', { text: 'Save editor changes first. Preview reads notes from disk and never edits them.', cls: 'apple-sync-save-note' });
        const actions = new Setting(contentEl).setDisabled(this.busy);
        actions.addButton(button => button.setButtonText(this.busy ? 'Waiting…' : 'Preview saved plans').setCta().setDisabled(this.busy || !this.credentialPresent)
            .onClick(() => { void this.perform('preview'); }));
        actions.addButton(button => button.setButtonText('Open Mac app').setDisabled(this.busy).onClick(() => { void this.perform('open'); }));
        this.statusEl = contentEl.createEl('p', { text: this.statusMessage, cls: 'apple-sync-status', attr: { role: 'status', 'aria-live': 'polite' } });
        this.resultsEl = contentEl.createDiv({ cls: 'apple-sync-results' });
        if (this.preview) this.renderPreview(this.preview);
    }
    private renderPreview(preview: PreviewResult): void {
        const summary = this.resultsEl.createDiv({ cls: 'apple-sync-summary' });
        for (const [name, value] of Object.entries(preview.counts)) summary.createEl('span', { text: `${name[0].toUpperCase()}${name.slice(1)} ${value}`, cls: `apple-sync-badge apple-sync-${name}` });
        this.resultsEl.createEl('p', { text: 'Skipped is the current default choice and overlaps the matching counts. This preview cannot sync or change individual choices.', cls: 'apple-sync-description' });
        if (!preview.entries.length) this.resultsEl.createEl('p', { text: 'No supported Day Planner plans in this date range.' });
        const groups = new Map<string, PreviewEntry[]>();
        for (const entry of preview.entries) groups.set(entry.date, [...(groups.get(entry.date) ?? []), entry]);
        for (const [date, entries] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
            const day = this.resultsEl.createDiv({ cls: 'apple-sync-day' });
            day.createEl('h3', { text: date });
            for (const entry of entries.sort((a, b) => a.start.localeCompare(b.start))) {
                const row = day.createDiv({ cls: 'apple-sync-plan' });
                row.createEl('div', { text: `${entry.startTime}–${entry.endTime}`, cls: 'apple-sync-plan-time' });
                const body = row.createDiv({ cls: 'apple-sync-plan-body' });
                body.createEl('strong', { text: entry.title });
                const badges = body.createDiv({ cls: 'apple-sync-plan-badges' });
                badges.createEl('span', { text: `${entry.action[0].toUpperCase()}${entry.action.slice(1)}`, cls: `apple-sync-badge apple-sync-${entry.action}` });
                if (entry.selectedAction === 'skip') badges.createEl('span', { text: 'Skipped', cls: 'apple-sync-badge apple-sync-skipped' });
                if (entry.completed) badges.createEl('span', { text: 'Completed in note', cls: 'apple-sync-badge' });
                body.createEl('p', { text: entry.reason, cls: 'apple-sync-reason' });
                const link = body.createEl('button', { text: `${entry.filePath}:${entry.line}`, cls: 'apple-sync-source' });
                link.addEventListener('click', () => { void this.openSource(entry).catch(error => this.plugin.report(error)); });
            }
        }
        if (preview.issues.length) {
            const issues = this.resultsEl.createDiv({ cls: 'apple-sync-issues' });
            issues.createEl('h3', { text: `Parser issues · ${preview.issues.length}` });
            const list = issues.createEl('ul');
            for (const issue of preview.issues) list.createEl('li', { text: issue });
        }
    }
    private async openSource(entry: PreviewEntry): Promise<void> {
        if (!validSourcePath(entry.filePath)) throw new Error('The preview source path is not vault-relative.');
        const file = this.app.vault.getAbstractFileByPath(entry.filePath);
        if (!(file instanceof TFile)) throw new Error('The source note is no longer available. Request a fresh preview.');
        await this.app.workspace.getLeaf(false).openFile(file, { active: true, eState: { line: entry.line - 1 } });
        this.close();
    }
}

class AppleSyncSettings extends PluginSettingTab {
    constructor(private plugin: AppleSyncPlugin) { super(plugin.app, plugin); }
    display(): void {
        this.containerEl.empty();
        this.containerEl.createEl('h2', { text: 'Day Planner Apple Sync' });
        this.containerEl.createEl('p', { text: 'Requires local ObsidianPlanner 0.4.0 P2 with bridge protocol 1. Public beta builds do not include this preview protocol. Preview does not write Apple items or sync history.' });
        new Setting(this.containerEl).setName('Time zone').setDesc('Saved as a preference; credentials are stored outside this vault.').addText(text => text.setValue(this.plugin.settings.timeZone).onChange(async value => {
            if (validTimeZone(value.trim())) await this.plugin.savePreferences(value.trim());
        }));
        new Setting(this.containerEl).setName('Use system time zone').addButton(button => button.setButtonText('Use system').onClick(async () => {
            await this.plugin.savePreferences(systemZone()); this.display();
        }));
        new Setting(this.containerEl).setName('Forget local credential').setDesc('Removes this plugin’s local credential. Revoke access in the Mac app to remove the native pairing too. Existing Apple items and history are kept.')
            .addButton(button => button.setButtonText('Forget on this Mac').onClick(async () => {
                try { await this.plugin.forgetCredential(); new Notice('Local credential removed. Pair this vault again before previewing.'); }
                catch (error) { this.plugin.report(error); }
            }));
    }
}
