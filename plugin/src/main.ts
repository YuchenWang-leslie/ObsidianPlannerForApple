import { FileSystemAdapter, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { shell } from 'electron';
import { acknowledgeRun, bridgeRoot, defaultSyncOptions, openPlanner, pairPlanner, previewPlanner, readCredential, readRun, removeCredential, runBlocksNewSync, runNeedsAcknowledgement, statusPlanner, syncPlanner, validSourcePath, validSyncOptions, waitForRun } from './bridge-client.ts';
import type { OpenInput, PairingCredential, PreviewEntry, PreviewResult, RunPointer, SyncOptions, SyncResponse } from './bridge-client.ts';
import { initialSelection, selectedCount } from './selection.ts';
import { pairingStatusMessage } from './connection-state.ts';
import type { PlanChoice, PlanSelection } from './selection.ts';
import { dayInZone, resolveRange, validDate, validTimeZone } from './range.ts';
import type { DateRange, RangeMode } from './range.ts';

interface Settings { timeZone: string; options: SyncOptions; rangeMode: RangeMode; customStart: string; customEnd: string }
const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
const commonZones = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];
const copyOptions = (options: SyncOptions): SyncOptions => ({ includeCalendar: options.includeCalendar, notification: { ...options.notification } });
const abortMessage = 'Stopped waiting. A native sync already started may continue. Use Check last sync; do not submit the batch again.';
function actionMessage(response: { message: string; errorCode?: string }): string {
    const hints: Record<string, string> = {
        PERMISSION_REQUIRED: 'Open Mac app and grant the requested Calendar/Reminders access.',
        APP_SETUP_REQUIRED: 'Open Mac app to choose the vault and Apple accounts.',
        SYNC_NOT_ALLOWED: 'Pair again with sync access and explicitly confirm it in the Mac app.',
        VAULT_NOT_PAIRED: 'Pair this vault again in the Mac app.',
        SOURCE_CHANGED: 'Nothing was written. Save your notes and request a fresh preview.',
        PREVIEW_EXPIRED: 'Request a fresh preview before syncing.',
        PREVIEW_USED: 'Check last sync, then request a fresh preview. Do not resend the batch.',
    };
    return `${response.message}${response.errorCode && hints[response.errorCode] ? ` ${hints[response.errorCode]}` : ''}`;
}

export default class AppleSyncPlugin extends Plugin {
    settings: Settings = { timeZone: systemZone(), options: defaultSyncOptions(), rangeMode: 'thisWeek', customStart: dayInZone(new Date(), systemZone()), customEnd: dayInZone(new Date(), systemZone()) };
    lastVerified: Date | null = null;
    connection: { version: string; capabilities: string[] } | null = null;
    private aborter = new AbortController();
    private requesting = false;
    async onload(): Promise<void> {
        const saved: Partial<Settings> | null = await this.loadData();
        if (typeof saved?.timeZone === 'string' && validTimeZone(saved.timeZone)) this.settings.timeZone = saved.timeZone;
        if (validSyncOptions(saved?.options)) this.settings.options = copyOptions(saved.options);
        if (saved?.rangeMode && ['thisWeek', 'nextWeek', 'custom'].includes(saved.rangeMode)) this.settings.rangeMode = saved.rangeMode;
        if (typeof saved?.customStart === 'string' && validDate(saved.customStart)) this.settings.customStart = saved.customStart;
        if (typeof saved?.customEnd === 'string' && validDate(saved.customEnd)) this.settings.customEnd = saved.customEnd;
        this.addRibbonIcon('calendar-clock', 'Open Apple sync', () => this.openModal());
        this.addCommand({ id: 'open-apple-sync', name: 'Open Apple sync', callback: () => this.openModal() });
        this.addCommand({ id: 'preview-this-week', name: 'Preview this week', callback: () => this.openModal('thisWeek', true) });
        this.addCommand({ id: 'preview-next-week', name: 'Preview next week', callback: () => this.openModal('nextWeek', true) });
        this.addCommand({ id: 'choose-sync-range', name: 'Choose sync range', callback: () => this.openModal('custom') });
        this.addCommand({ id: 'open-mac-app', name: 'Open Mac app', callback: () => {
            void this.openRange(resolveRange('thisWeek', this.settings.timeZone), this.settings.timeZone).then(message => new Notice(message)).catch(error => this.report(error));
        } });
        this.addCommand({ id: 'check-last-sync', name: 'Check last sync', callback: () => this.openModal(undefined, false, true) });
        this.addSettingTab(new AppleSyncSettings(this));
    }
    onunload(): void { this.aborter.abort(); }
    private supported(): boolean {
        if (Platform.isMacOS && Platform.isDesktopApp) return true;
        new Notice('Day Planner Apple Sync requires Obsidian on macOS and the companion Mac app.'); return false;
    }
    openModal(mode = this.settings.rangeMode, preview = false, check = false): void {
        if (this.supported()) new PlannerModal(this, mode, preview, check).open();
    }
    vaultPath(): string {
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) throw new Error('This plugin requires a local filesystem vault.');
        return adapter.getBasePath();
    }
    async savePreferences(settings: Settings): Promise<void> {
        if (!validTimeZone(settings.timeZone) || !validSyncOptions(settings.options)) throw new Error('Choose a valid IANA time zone and notification settings.');
        resolveRange(settings.rangeMode, settings.timeZone, new Date(), { startDate: settings.customStart, endDate: settings.customEnd });
        this.settings = { ...settings, options: copyOptions(settings.options) };
        // Explicit whitelist: no credentials, preview payloads or run pointers enter the vault.
        await this.saveData({ timeZone: settings.timeZone, rangeMode: settings.rangeMode, customStart: settings.customStart, customEnd: settings.customEnd, options: copyOptions(settings.options) });
    }
    private input(range: DateRange, timeZone: string): OpenInput { return { startDate: range.startDate, endDate: range.endDate, timeZone, vaultPath: this.vaultPath(), vaultName: this.app.vault.getName() }; }
    private async request<T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
        if (!this.supported()) throw new Error('This feature requires macOS.');
        if (this.requesting) throw new Error('Another request is waiting. Check the Mac app before trying again.');
        const controller = new AbortController(), abort = () => controller.abort();
        for (const source of [this.aborter.signal, signal]) { if (source?.aborted) controller.abort(); source?.addEventListener('abort', abort, { once: true }); }
        this.requesting = true;
        try { controller.signal.throwIfAborted(); return await operation(controller.signal); }
        finally { this.requesting = false; this.aborter.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', abort); }
    }
    private bridgeOptions(signal: AbortSignal) { return { launch: (url: string) => shell.openExternal(url, { activate: true }), signal }; }
    private connected(response: { appVersion: string; capabilities?: string[] }): void { this.connection = { version: response.appVersion, capabilities: response.capabilities ?? [] }; }
    async openRange(range: DateRange, timeZone: string, signal?: AbortSignal): Promise<string> {
        return this.request(signal, async signal => {
            const response = await openPlanner(this.input(range, timeZone), this.bridgeOptions(signal)); this.connected(response);
            return response.status === 'opened' ? 'Mac app opened. Review its setup or sync there.' : actionMessage(response);
        });
    }
    async pairRange(range: DateRange, timeZone: string, allowSync: boolean, signal: AbortSignal, onPending: () => void): Promise<string> {
        return this.request(signal, async signal => {
            const response = await pairPlanner(this.input(range, timeZone), { ...this.bridgeOptions(signal), onPending }, allowSync); this.connected(response);
            if (response.status === 'paired') { this.lastVerified = null; return pairingStatusMessage(response, allowSync); }
            return actionMessage(response);
        });
    }
    async previewRange(range: DateRange, timeZone: string, options: SyncOptions, signal: AbortSignal): Promise<PreviewResult> {
        return this.request(signal, async signal => {
            const input = this.input(range, timeZone), credential = await this.credential();
            const response = await previewPlanner(input, credential, options, this.bridgeOptions(signal)); this.connected(response);
            if (response.status !== 'previewReady' || !response.preview) { if (response.errorCode === 'VAULT_NOT_PAIRED') this.lastVerified = null; throw new Error(actionMessage(response)); }
            this.lastVerified = new Date(); return response.preview;
        });
    }
    private async credential(): Promise<PairingCredential> {
        const credential = await readCredential(this.vaultPath());
        if (!credential) throw new Error('Pair this vault in the Mac app before continuing.');
        return credential;
    }
    async syncReviewed(preview: PreviewResult, selection: PlanSelection, signal: AbortSignal, onUpdate: (response: SyncResponse) => void): Promise<SyncResponse> {
        return this.request(signal, async signal => {
            const credential = await this.credential(), options = this.bridgeOptions(signal);
            let response = await syncPlanner(this.input(preview, preview.timeZone), credential, preview.options, preview, selection, options);
            this.connected(response); onUpdate(response);
            if (response.status === 'running') {
                const run = await readRun(this.vaultPath(), bridgeRoot());
                if (run) response = await waitForRun(run, credential, { ...options, onUpdate: response => { this.connected(response); onUpdate(response); } }) ?? response;
            }
            return response;
        });
    }
    async checkLast(signal: AbortSignal, onUpdate: (response: SyncResponse) => void): Promise<SyncResponse> {
        return this.request(signal, async signal => {
            const run = await readRun(this.vaultPath(), bridgeRoot());
            if (!run) throw new Error('There is no saved sync request for this vault on this Mac.');
            const credential = await this.credential(), options = this.bridgeOptions(signal);
            let response = await statusPlanner(run.input, credential, run.requestId, options); this.connected(response); onUpdate(response);
            if (response.status === 'running') response = await waitForRun(run, credential, { ...options, onUpdate: response => { this.connected(response); onUpdate(response); } }) ?? response;
            return response;
        });
    }
    async forgetCredential(): Promise<void> { await removeCredential(this.vaultPath()); this.lastVerified = null; }
    report(error: unknown): string {
        if (this.aborter.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return abortMessage;
        const description = error instanceof Error ? error.message : 'The companion Mac app request failed. Open Mac app to inspect its setup.';
        new Notice(description, 10000); return description;
    }
}

class PlannerModal extends Modal {
    private timeZone: string; private customTimeZone = ''; private startDate: string; private endDate: string; private options: SyncOptions;
    private busy = false; private closed = false; private operation: 'open' | 'pair' | 'preview' | 'sync' | 'check' | null = null;
    private poller: AbortController | null = null; private credential: PairingCredential | null = null; private checked = false;
    private run: RunPointer | null = null; private preview: PreviewResult | null = null;
    private planSelection: PlanSelection = { choices: {}, resolutions: {} }; private allowSyncRequest = true;
    private statusMessage = ''; private statusEl!: HTMLElement; private resultsEl!: HTMLElement; private syncButton: HTMLButtonElement | null = null;
    constructor(private plugin: AppleSyncPlugin, private mode: RangeMode, private autoPreview: boolean, private autoCheck: boolean) {
        super(plugin.app); this.timeZone = plugin.settings.timeZone; this.options = copyOptions(plugin.settings.options);
        this.startDate = plugin.settings.customStart; this.endDate = plugin.settings.customEnd;
    }
    async onOpen(): Promise<void> {
        this.modalEl.addClass('apple-sync-modal'); this.render(); await this.refreshContext();
        if (this.closed) return; this.render();
        if (this.autoCheck && this.run) await this.perform('check');
        else if (this.autoPreview && this.credential) await this.perform('preview');
    }
    onClose(): void {
        this.closed = true; this.poller?.abort(); this.contentEl.empty();
        if (this.busy && ['sync', 'check'].includes(this.operation ?? '')) new Notice(abortMessage, 10000);
    }
    private async refreshContext(): Promise<void> {
        try { this.credential = await readCredential(this.plugin.vaultPath()); this.run = await readRun(this.plugin.vaultPath(), bridgeRoot()); }
        catch (error) { this.statusMessage = this.plugin.report(error); }
        this.checked = true;
    }
    private invalidate(render = true): void {
        this.preview = null; this.planSelection = { choices: {}, resolutions: {} };
        this.statusMessage = 'Settings changed. Request a fresh preview.';
        this.persistValidPreferences();
        if (render) this.render(); else { this.resultsEl?.empty(); this.statusEl?.setText(this.statusMessage); this.updateSyncButton(); }
    }
    private persistValidPreferences(): void {
        const timeZone = this.customTimeZone.trim() || this.timeZone;
        if (!validTimeZone(timeZone) || !validDate(this.startDate) || !validDate(this.endDate) || this.endDate < this.startDate) return;
        void this.savePreferences().catch(error => this.plugin.report(error));
    }
    private input(): { range: DateRange; timeZone: string } {
        const timeZone = this.customTimeZone.trim() || this.timeZone;
        return { timeZone, range: resolveRange(this.mode, timeZone, new Date(), { startDate: this.startDate, endDate: this.endDate }) };
    }
    private async savePreferences(): Promise<void> {
        await this.plugin.savePreferences({ timeZone: this.customTimeZone.trim() || this.timeZone, options: this.options, rangeMode: this.mode, customStart: this.startDate, customEnd: this.endDate });
    }
    private updateSyncButton(): void {
        if (!this.syncButton) return;
        const count = this.preview ? selectedCount(this.preview, this.planSelection) : 0;
        this.syncButton.textContent = count ? `Sync selected (${count})` : 'Sync selected';
        this.syncButton.disabled = this.busy || !this.preview?.syncAllowed || !this.credential?.allowSync || count === 0 || !!this.run && runBlocksNewSync(this.run);
    }
    private async perform(kind: 'open' | 'pair' | 'preview' | 'sync' | 'check'): Promise<void> {
        if (this.busy) return;
        const reviewed = this.preview, selection = structuredClone(this.planSelection);
        if (kind === 'sync' && !reviewed) return;
        this.busy = true; this.operation = kind; this.poller = new AbortController();
        this.statusMessage = kind === 'pair' ? 'Review the exact vault path and access scope in the Mac app, then click Pair this vault (up to 120 seconds).'
            : kind === 'sync' ? 'Submitting this reviewed batch once. Waiting for its native result…'
                : kind === 'check' ? 'Checking the saved request. No batch is being submitted…' : kind === 'preview' ? 'Previewing saved notes…' : 'Opening the Mac app…';
        if (kind === 'sync' || kind === 'preview') { this.preview = null; this.planSelection = { choices: {}, resolutions: {} }; }
        this.render();
        try {
            const signal = this.poller.signal;
            if (kind === 'check') this.statusMessage = actionMessage(await this.plugin.checkLast(signal, response => this.showProgress(response)));
            else if (kind === 'sync' && reviewed) this.statusMessage = actionMessage(await this.plugin.syncReviewed(reviewed, selection, signal, response => this.showProgress(response)));
            else {
                const { range, timeZone } = this.input(); await this.savePreferences();
                if (kind === 'open') this.statusMessage = await this.plugin.openRange(range, timeZone, signal);
                else if (kind === 'pair') this.statusMessage = await this.plugin.pairRange(range, timeZone, this.allowSyncRequest, signal, () => {
                    this.statusMessage = 'Waiting for explicit approval in the Mac app. Choosing a folder alone does not pair it.';
                    if (!this.closed) this.statusEl.setText(this.statusMessage);
                });
                else {
                    this.preview = await this.plugin.previewRange(range, timeZone, copyOptions(this.options), signal);
                    this.planSelection = initialSelection(this.preview);
                    this.statusMessage = `Preview ready · ${this.preview.entries.length} plans · ${this.preview.issues.length} issues. Review each choice, then Sync selected.`;
                }
            }
        } catch (error) { this.statusMessage = this.plugin.report(error); }
        finally { this.busy = false; this.operation = null; this.poller = null; await this.refreshContext(); if (!this.closed) this.render(); }
    }
    private showProgress(response: SyncResponse): void {
        this.statusMessage = response.status === 'running' ? 'Native sync is running. Closing or stopping this window only stops polling.' : actionMessage(response);
        if (!this.closed) this.statusEl.setText(this.statusMessage);
    }
    private render(): void {
        const { contentEl } = this; contentEl.empty(); contentEl.addClass('apple-sync-planner'); this.syncButton = null;
        const header = contentEl.createDiv({ cls: 'apple-sync-header' });
        header.createEl('h2', { text: 'Day Planner → Apple' });
        header.createEl('p', { text: this.app.vault.getName(), cls: 'apple-sync-context' });
        const flags = header.createDiv({ cls: 'apple-sync-summary' });
        flags.createEl('span', { text: !this.checked ? 'Checking setup…' : !this.credential ? 'Pairing needed' : this.credential.allowSync ? 'Local preview + sync credential' : 'Local preview-only credential', cls: 'apple-sync-badge' });
        flags.createEl('span', { text: this.plugin.connection ? `Mac app ${this.plugin.connection.version}` : 'Mac app not verified this session', cls: 'apple-sync-badge' });
        if (this.plugin.lastVerified) flags.createEl('span', { text: `Preview verified ${this.plugin.lastVerified.toLocaleTimeString()}`, cls: 'apple-sync-badge' });
        this.renderRecovery(contentEl);
        const range = contentEl.createDiv({ cls: 'apple-sync-range-bar' });
        new Setting(range).setName('Range').addDropdown(dropdown => dropdown.addOptions({ thisWeek: 'This week', nextWeek: 'Next week', custom: 'Custom' }).setValue(this.mode).setDisabled(this.busy)
            .onChange(value => { this.mode = value as RangeMode; this.invalidate(); }));
        if (this.mode === 'custom') {
            const custom = range.createDiv({ cls: 'apple-sync-custom-dates' });
            for (const [label, value, setter] of [['From', this.startDate, (value: string) => this.startDate = value], ['To', this.endDate, (value: string) => this.endDate = value]] as const) {
                new Setting(custom).setName(label).addText(text => { text.inputEl.type = 'date'; text.setValue(value).setDisabled(this.busy).onChange(value => { setter(value); this.invalidate(false); }); });
            }
        }
        const detail = contentEl.createEl('details', { cls: 'apple-sync-options' });
        detail.createEl('summary', { text: `${this.options.includeCalendar ? 'Reminders + Calendar' : 'Reminders'} · ${this.customTimeZone.trim() || this.timeZone} · ${this.options.notification.channel === 'None' ? 'No notifications' : `${this.options.notification.minutes} min before`}` });
        this.renderOptions(detail);
        const setup = contentEl.createEl('details', { cls: 'apple-sync-setup' });
        setup.open = this.checked && (!this.credential || !this.credential.allowSync);
        setup.createEl('summary', { text: 'Connection & access' });
        setup.createEl('p', { text: this.plugin.vaultPath(), cls: 'apple-sync-path' });
        setup.createEl('p', { text: this.plugin.connection ? `Reported capabilities: ${this.plugin.connection.capabilities.join(', ') || 'not reported'}.${this.plugin.connection.capabilities.includes('sync') ? '' : ' Sync support is not reported. Install the matching ObsidianPlanner 0.5.0 app for selective sync.'}` : 'Requires ObsidianPlanner 0.5.0 or a compatible Mac app. Open the app once after installing.', cls: 'apple-sync-description' });
        new Setting(setup).setName('Request sync access').setDesc('Existing preview-only tokens need a new explicit native confirmation.').addToggle(toggle => toggle.setValue(this.allowSyncRequest).setDisabled(this.busy).onChange(value => { this.allowSyncRequest = value; this.render(); }));
        new Setting(setup).addButton(button => button.setButtonText(this.allowSyncRequest ? 'Pair for preview + sync…' : 'Pair for preview only…').setDisabled(this.busy).onClick(() => { void this.perform('pair'); }));
        contentEl.createEl('p', { text: 'Save edits first. Preview reads notes from disk; source links never change them.', cls: 'apple-sync-description' });
        const actions = contentEl.createDiv({ cls: 'apple-sync-actions' });
        new Setting(actions)
            .addButton(button => button.setButtonText('Preview saved plans').setCta().setDisabled(this.busy || !this.credential).onClick(() => { void this.perform('preview'); }))
            .addButton(button => { button.setButtonText('Sync selected').setCta().onClick(() => { void this.perform('sync'); }); this.syncButton = button.buttonEl; })
            .addButton(button => button.setButtonText('Open Mac app').setDisabled(this.busy).onClick(() => { void this.perform('open'); }));
        if (this.busy) new Setting(contentEl).addButton(button => button.setButtonText('Stop waiting').onClick(() => this.poller?.abort()));
        this.statusEl = contentEl.createEl('p', { text: this.statusMessage, cls: 'apple-sync-status', attr: { role: 'status', 'aria-live': 'polite' } });
        this.resultsEl = contentEl.createDiv({ cls: 'apple-sync-results' });
        if (this.preview) this.renderPreview(this.preview);
        this.updateSyncButton();
        if (this.run?.response?.job?.result) this.renderLastResult(contentEl, this.run.response);
        contentEl.createEl('p', { text: 'Closing or disabling stops polling, not a native sync already running. Use Check last sync to recover.', cls: 'apple-sync-footnote' });
    }
    private renderOptions(parent: HTMLElement): void {
        new Setting(parent).setName('Time zone').addDropdown(dropdown => {
            for (const zone of new Set([this.timeZone, systemZone(), ...commonZones])) dropdown.addOption(zone, zone.replaceAll('_', ' '));
            dropdown.setValue(this.timeZone).setDisabled(this.busy).onChange(value => { this.timeZone = value; this.customTimeZone = ''; this.invalidate(); });
        });
        new Setting(parent).setName('Other IANA zone').addText(text => text.setPlaceholder('e.g. Australia/Sydney').setValue(this.customTimeZone).setDisabled(this.busy).onChange(value => { this.customTimeZone = value; this.invalidate(false); }));
        new Setting(parent).setName('Also create Calendar events').addToggle(toggle => toggle.setValue(this.options.includeCalendar).setDisabled(this.busy).onChange(value => {
            this.options.includeCalendar = value;
            if (!value && ['Calendar', 'Both'].includes(this.options.notification.channel)) this.options.notification.channel = 'Reminders'; this.invalidate();
        }));
        new Setting(parent).setName('Notify via').addDropdown(dropdown => {
            dropdown.addOptions({ Reminders: 'Reminders', None: 'No notifications' }); if (this.options.includeCalendar) dropdown.addOptions({ Calendar: 'Calendar', Both: 'Both' });
            dropdown.setValue(this.options.notification.channel).setDisabled(this.busy).onChange(value => { this.options.notification.channel = value as SyncOptions['notification']['channel']; this.invalidate(); });
        });
        new Setting(parent).setName('Minutes before').addDropdown(dropdown => {
            for (let value = 0; value <= 60; value += 5) dropdown.addOption(String(value), value === 0 ? 'At start' : `${value} minutes`);
            dropdown.setValue(String(this.options.notification.minutes)).setDisabled(this.busy || this.options.notification.channel === 'None').onChange(value => { this.options.notification.minutes = Number(value); this.invalidate(); });
        });
    }
    private renderRecovery(parent: HTMLElement): void {
        if (!this.run) return;
        const needsCheck = runBlocksNewSync(this.run), recovery = parent.createDiv({ cls: `apple-sync-recovery${needsCheck ? ' apple-sync-attention' : ''}` });
        recovery.createEl('strong', { text: `Last sync: ${this.run.status}${this.run.acknowledged ? ' · acknowledged' : ''}` });
        if (needsCheck) recovery.createEl('p', { text: 'Do not resend this batch. Check its native result first. If unknown or interrupted, inspect Apple items before starting a fresh preview.', cls: 'apple-sync-description' });
        new Setting(recovery).addButton(button => button.setButtonText('Check last sync').setDisabled(this.busy || !this.credential).onClick(() => { void this.perform('check'); }));
        if (runNeedsAcknowledgement(this.run)) new Setting(recovery).addButton(button => button.setButtonText('I checked Apple items — start fresh').setDisabled(this.busy).onClick(async () => {
            try { this.run = await acknowledgeRun(this.plugin.vaultPath(), bridgeRoot()); this.invalidate(); this.statusMessage = 'Previous run acknowledged. Request a fresh preview; nothing was submitted.'; this.render(); }
            catch (error) { this.statusMessage = this.plugin.report(error); this.render(); }
        }));
    }
    private renderPreview(preview: PreviewResult): void {
        const summary = this.resultsEl.createDiv({ cls: 'apple-sync-summary' });
        for (const [name, value] of Object.entries(preview.counts)) summary.createEl('span', { text: `${name === 'skipped' ? 'Default skipped' : name[0].toUpperCase() + name.slice(1)} ${value}`, cls: `apple-sync-badge apple-sync-${name}` });
        if (!preview.syncAllowed || !this.credential?.allowSync) this.resultsEl.createEl('p', { text: this.plugin.connection && !this.plugin.connection.capabilities.includes('sync') ? 'This App does not report sync support. Install ObsidianPlanner 0.5.0, then pair for preview + sync.' : 'Preview-only access. Pair for preview + sync and approve the new scope in the Mac app.', cls: 'apple-sync-notice' });
        if (!preview.entries.length) this.resultsEl.createEl('p', { text: 'No supported plans in this date range.' });
        const groups = new Map<string, PreviewEntry[]>();
        for (const entry of preview.entries) groups.set(entry.date, [...(groups.get(entry.date) ?? []), entry]);
        for (const [date, entries] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
            const day = this.resultsEl.createDiv({ cls: 'apple-sync-day' }); day.createEl('h3', { text: date });
            for (const entry of entries.sort((a, b) => a.start.localeCompare(b.start))) {
                const row = day.createDiv({ cls: 'apple-sync-plan' }); row.createEl('div', { text: `${entry.startTime}–${entry.endTime}`, cls: 'apple-sync-plan-time' });
                const body = row.createDiv({ cls: 'apple-sync-plan-body' }); body.createEl('strong', { text: entry.title });
                const badges = body.createDiv({ cls: 'apple-sync-plan-badges' });
                badges.createEl('span', { text: `${entry.action[0].toUpperCase()}${entry.action.slice(1)}`, cls: `apple-sync-badge apple-sync-${entry.action}` });
                const skipped = badges.createEl('span', { text: 'Skipped', cls: 'apple-sync-badge' });
                const refreshSkipped = () => { skipped.hidden = entry.action === 'conflict' ? this.planSelection.resolutions[entry.id] !== 'skip' : this.planSelection.choices[entry.id] !== 'skip'; };
                refreshSkipped();
                if (entry.incomplete) badges.createEl('span', { text: 'Incomplete · choose Update existing to retry', cls: 'apple-sync-badge apple-sync-conflict' });
                if (entry.completed) badges.createEl('span', { text: 'Completed in note', cls: 'apple-sync-badge' });
                body.createEl('p', { text: entry.reason, cls: 'apple-sync-reason' });
                const link = body.createEl('button', { text: `${entry.filePath}:${entry.line}`, cls: 'apple-sync-source' });
                link.addEventListener('click', () => { void this.openSource(entry).catch(error => this.plugin.report(error)); });
                new Setting(body).addDropdown(dropdown => {
                    if (entry.action === 'conflict') {
                        dropdown.addOptions({ skip: 'Skip conflict', new: 'New — add as a new plan' });
                        for (const candidate of preview.linkCandidates) dropdown.addOption(candidate.id, `Link — ${candidate.date} ${candidate.startTime} ${candidate.title}`);
                        dropdown.setValue(this.planSelection.resolutions[entry.id]).onChange(value => { this.planSelection.resolutions[entry.id] = value; refreshSkipped(); this.updateSyncButton(); });
                    } else {
                        dropdown.addOption('skip', 'Skip');
                        if (entry.action === 'create') dropdown.addOption('add', 'Add');
                        else dropdown.addOptions({ update: 'Update existing', addAgain: 'Add again — keep previous copy' });
                        dropdown.setValue(this.planSelection.choices[entry.id]).onChange(value => { this.planSelection.choices[entry.id] = value as PlanChoice; refreshSkipped(); this.updateSyncButton(); });
                    }
                    dropdown.setDisabled(this.busy);
                });
            }
        }
        if (preview.issues.length) { const issues = this.resultsEl.createEl('details', { cls: 'apple-sync-issues' }); issues.createEl('summary', { text: `Parser issues · ${preview.issues.length}` }); const list = issues.createEl('ul'); for (const issue of preview.issues) list.createEl('li', { text: issue }); }
    }
    private renderLastResult(parent: HTMLElement, response: SyncResponse): void {
        const result = response.job?.result; if (!result) return;
        const detail = parent.createEl('details', { cls: 'apple-sync-last-result' }); detail.open = ['partial', 'failed'].includes(result.status);
        detail.createEl('summary', { text: `Last result · ${result.status} · Reminders ${result.counts.remindersSaved} · Calendar ${result.counts.calendarSaved} · Skipped ${result.counts.skipped} · Failed ${result.counts.failed} · Unresolved ${result.counts.unresolved}` });
        detail.createEl('p', { text: `${result.message} Counts confirm local saves, not iPhone delivery.`, cls: 'apple-sync-description' });
        for (const item of result.items) {
            const row = detail.createDiv({ cls: 'apple-sync-result-item' }); row.createEl('strong', { text: `${item.date} · ${item.title}` });
            row.createEl('p', { text: `${item.status} · ${item.action} · Reminders ${item.reminderSaved ? 'saved' : 'not saved'} · Calendar ${item.calendarSaved ? 'saved' : 'not saved'} · ${item.message}`, cls: 'apple-sync-description' });
        }
    }
    private async openSource(entry: PreviewEntry): Promise<void> {
        if (!validSourcePath(entry.filePath)) throw new Error('The preview source path is not vault-relative.');
        const file = this.app.vault.getAbstractFileByPath(entry.filePath);
        if (!(file instanceof TFile)) throw new Error('The source note is no longer available. Request a fresh preview.');
        await this.app.workspace.getLeaf(false).openFile(file, { active: true, eState: { line: entry.line - 1 } }); this.close();
    }
}

class AppleSyncSettings extends PluginSettingTab {
    constructor(private plugin: AppleSyncPlugin) { super(plugin.app, plugin); }
    display(): void {
        this.containerEl.empty(); this.containerEl.createEl('h2', { text: 'Day Planner Apple Sync' });
        this.containerEl.createEl('p', { text: 'Requires ObsidianPlanner 0.5.0 or a compatible Mac app. Pairing scope and Apple permissions are confirmed there. Existing preview-only pairings must be explicitly upgraded.' });
        new Setting(this.containerEl).setName('Open planner').setDesc('Range, time zone, Calendar and notification preferences are in the planner’s Options.').addButton(button => button.setButtonText('Open Apple sync').onClick(() => this.plugin.openModal()));
        new Setting(this.containerEl).setName('Use system time zone').addButton(button => button.setButtonText('Use system').onClick(async () => { await this.plugin.savePreferences({ ...this.plugin.settings, timeZone: systemZone() }); this.display(); }));
        new Setting(this.containerEl).setName('Forget local credential').setDesc('Removes only the private client credential. Revoke in the Mac app to remove native access too. Existing items, history and the last-run record stay.').addButton(button => button.setButtonText('Forget on this Mac').onClick(async () => {
            try { await this.plugin.forgetCredential(); new Notice('Local credential removed. Pair again before previewing or checking sync status.'); } catch (error) { this.plugin.report(error); }
        }));
    }
}
