import { FileSystemAdapter, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { join } from 'node:path';
import { acknowledgeRun, defaultSyncOptions, pairPlanner, previewPlanner, readCredential, readRun, removeCredential, runBlocksNewSync, runNeedsAcknowledgement, statusPlanner, syncPlanner, validSourcePath, validSyncOptions, waitForRun } from './bridge-client.ts';
import type { OpenInput, PairingCredential, PreviewEntry, PreviewResult, RunPointer, SyncOptions, SyncResponse } from './bridge-client.ts';
import { initialSelection, selectedCount } from './selection.ts';
import { helperAuthorize, helperBridgeOptions, helperConfigure, helperInfo, helperUnpair, HELPER_SETUP_URL, pluginBridgeRoot, unsupportedReason } from './helper-client.ts';
import type { HelperState, SetupResponse } from './helper-client.ts';
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
        PERMISSION_REQUIRED: 'Grant the requested access in Connection & permissions. If denied, enable the helper in macOS System Settings → Privacy & Security.',
        APP_SETUP_REQUIRED: 'Connect this vault, grant access and choose the correct service accounts below.',
        SYNC_NOT_ALLOWED: 'Use Connect this vault to grant this independent plugin preview + sync access.',
        VAULT_NOT_PAIRED: 'Use Connect this vault. Old standalone App credentials are separate and are not reused.',
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
    nativeState: HelperState | null = null;
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
        this.addCommand({ id: 'refresh-connection', name: 'Refresh connection', callback: () => this.openModal() });
        this.addCommand({ id: 'check-last-sync', name: 'Check last sync', callback: () => this.openModal(undefined, false, true) });
        this.addSettingTab(new AppleSyncSettings(this));
    }
    onunload(): void { this.aborter.abort(); }
    private supported(): boolean {
        const reason = unsupportedReason();
        if (Platform.isMacOS && Platform.isDesktopApp && !reason) return true;
        new Notice(reason ?? 'This plugin requires desktop Obsidian on Apple silicon macOS 14 or later.'); return false;
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
        if (this.requesting) throw new Error('Another helper request is waiting. Stop waiting or let it finish before trying again.');
        const controller = new AbortController(), abort = () => controller.abort();
        for (const source of [this.aborter.signal, signal]) { if (source?.aborted) controller.abort(); source?.addEventListener('abort', abort, { once: true }); }
        this.requesting = true;
        try { controller.signal.throwIfAborted(); return await operation(controller.signal); }
        finally { this.requesting = false; this.aborter.signal.removeEventListener('abort', abort); signal?.removeEventListener('abort', abort); }
    }
    private bridgeOptions(signal: AbortSignal) {
        const directory = join(this.vaultPath(), this.manifest.dir ?? join(this.app.vault.configDir, 'plugins', this.manifest.id));
        return helperBridgeOptions(directory, { signal });
    }
    private connected(response: { appVersion: string; capabilities?: string[]; state?: HelperState }): void {
        this.connection = { version: response.appVersion, capabilities: response.capabilities ?? [] };
        if (response.state) this.nativeState = response.state;
    }
    async refreshRange(range: DateRange, timeZone: string, signal: AbortSignal): Promise<string> {
        return this.request(signal, async signal => {
            const response = await helperInfo(this.input(range, timeZone), this.bridgeOptions(signal)); this.connected(response);
            return actionMessage(response);
        });
    }
    async connectRange(range: DateRange, timeZone: string, signal: AbortSignal): Promise<string> {
        return this.request(signal, async signal => {
            const response = await pairPlanner(this.input(range, timeZone), this.bridgeOptions(signal), true); this.connected(response);
            if (response.status === 'paired') {
                this.lastVerified = null;
                return response.pairing?.allowSync ? 'This vault is connected for preview + sync. Grant Apple access and choose accounts below. Nothing was synced.' : 'The helper did not grant sync access. Check the manually installed helper and reconnect using the Helper setup guide.';
            }
            return actionMessage(response);
        });
    }
    async setupRange(range: DateRange, timeZone: string, action: 'authorize' | 'configure' | 'disconnect', entity: 'reminders' | 'calendar', sourceID: string | undefined, signal: AbortSignal): Promise<string> {
        return this.request(signal, async signal => {
            const input = this.input(range, timeZone), credential = await this.credential(), options = this.bridgeOptions(signal);
            let response: SetupResponse;
            if (action === 'authorize') response = await helperAuthorize(input, credential, entity, options);
            else if (action === 'configure') response = await helperConfigure(input, credential, entity === 'reminders' ? { reminderSourceID: sourceID ?? '' } : { calendarSourceID: sourceID ?? '' }, options);
            else response = await helperUnpair(input, credential, options);
            this.connected(response);
            if (action === 'disconnect' && response.status === 'ready') {
                await removeCredential(this.vaultPath(), pluginBridgeRoot()); this.lastVerified = null;
                return 'Vault connection removed. Apple items, shared history and job receipts were kept.';
            }
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
        const credential = await readCredential(this.vaultPath(), pluginBridgeRoot());
        if (!credential) throw new Error('Use Connect this vault before continuing. The standalone App’s credentials are not used.');
        return credential;
    }
    async syncReviewed(preview: PreviewResult, selection: PlanSelection, signal: AbortSignal, onUpdate: (response: SyncResponse) => void): Promise<SyncResponse> {
        return this.request(signal, async signal => {
            const credential = await this.credential(), options = this.bridgeOptions(signal);
            let response = await syncPlanner(this.input(preview, preview.timeZone), credential, preview.options, preview, selection, options);
            this.connected(response); onUpdate(response);
            if (response.status === 'running') {
                const run = await readRun(this.vaultPath(), pluginBridgeRoot());
                if (run) response = await waitForRun(run, credential, { ...options, onUpdate: response => { this.connected(response); onUpdate(response); } }) ?? response;
            }
            return response;
        });
    }
    async checkLast(signal: AbortSignal, onUpdate: (response: SyncResponse) => void): Promise<SyncResponse> {
        return this.request(signal, async signal => {
            const run = await readRun(this.vaultPath(), pluginBridgeRoot());
            if (!run) throw new Error('There is no saved sync request for this vault on this Mac.');
            const credential = await this.credential(), options = this.bridgeOptions(signal);
            let response = await statusPlanner(run.input, credential, run.requestId, options); this.connected(response); onUpdate(response);
            if (response.status === 'running') response = await waitForRun(run, credential, { ...options, onUpdate: response => { this.connected(response); onUpdate(response); } }) ?? response;
            return response;
        });
    }
    report(error: unknown): string {
        if (this.aborter.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return abortMessage;
        const description = error instanceof Error ? error.message : 'The installed helper request failed. Refresh connection or follow the Helper setup guide.';
        new Notice(description, 10000); return description;
    }
}

type PlannerAction = 'refresh' | 'connect' | 'disconnect' | 'authorizeReminders' | 'authorizeCalendar' | 'configureReminders' | 'configureCalendar' | 'preview' | 'sync' | 'check';

class PlannerModal extends Modal {
    private timeZone: string; private customTimeZone = ''; private startDate: string; private endDate: string; private options: SyncOptions;
    private busy = false; private closed = false; private operation: PlannerAction | null = null;
    private poller: AbortController | null = null; private credential: PairingCredential | null = null; private checked = false;
    private run: RunPointer | null = null; private preview: PreviewResult | null = null;
    private planSelection: PlanSelection = { choices: {}, resolutions: {} };
    private statusMessage = ''; private statusEl!: HTMLElement; private resultsEl!: HTMLElement; private syncButton: HTMLButtonElement | null = null;
    constructor(private plugin: AppleSyncPlugin, private mode: RangeMode, private autoPreview: boolean, private autoCheck: boolean) {
        super(plugin.app); this.timeZone = plugin.settings.timeZone; this.options = copyOptions(plugin.settings.options);
        this.startDate = plugin.settings.customStart; this.endDate = plugin.settings.customEnd;
    }
    async onOpen(): Promise<void> {
        this.modalEl.addClass('apple-sync-modal'); this.render(); await this.refreshContext();
        if (this.closed) return; this.render();
        await this.perform('refresh');
        if (this.closed) return;
        if (this.autoCheck && this.run && this.plugin.nativeState) await this.perform('check');
        else if (this.autoPreview && this.credential && this.plugin.nativeState) await this.perform('preview');
    }
    onClose(): void {
        this.closed = true; this.poller?.abort(); this.contentEl.empty();
        if (this.busy && ['sync', 'check'].includes(this.operation ?? '')) new Notice(abortMessage, 10000);
    }
    private async refreshContext(): Promise<void> {
        try { this.credential = await readCredential(this.plugin.vaultPath(), pluginBridgeRoot()); this.run = await readRun(this.plugin.vaultPath(), pluginBridgeRoot()); }
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
    private async perform(kind: PlannerAction, sourceID?: string): Promise<void> {
        if (this.busy) return;
        const reviewed = this.preview, selection = structuredClone(this.planSelection);
        if (kind === 'sync' && !reviewed) return;
        this.busy = true; this.operation = kind; this.poller = new AbortController();
        this.statusMessage = kind === 'connect' ? 'Connecting this exact vault for user-initiated preview + sync… No Apple items are being written.'
            : kind.startsWith('authorize') ? 'macOS may ask for access for the installed helper. Approve or deny the system prompt…'
                : kind === 'sync' ? 'Submitting this reviewed batch once. Waiting for its native result…'
                    : kind === 'check' ? 'Checking the saved request. No batch is being submitted…'
                        : kind === 'preview' ? 'Previewing saved notes…' : 'Refreshing the installed helper and connection…';
        this.preview = null; this.planSelection = { choices: {}, resolutions: {} };
        this.render();
        try {
            const signal = this.poller.signal;
            if (kind === 'check') this.statusMessage = actionMessage(await this.plugin.checkLast(signal, response => this.showProgress(response)));
            else if (kind === 'sync' && reviewed) this.statusMessage = actionMessage(await this.plugin.syncReviewed(reviewed, selection, signal, response => this.showProgress(response)));
            else {
                const { range, timeZone } = this.input(); await this.savePreferences();
                if (kind === 'refresh') this.statusMessage = await this.plugin.refreshRange(range, timeZone, signal);
                else if (kind === 'connect') this.statusMessage = await this.plugin.connectRange(range, timeZone, signal);
                else if (kind === 'disconnect') this.statusMessage = await this.plugin.setupRange(range, timeZone, 'disconnect', 'reminders', undefined, signal);
                else if (kind.startsWith('authorize') || kind.startsWith('configure')) this.statusMessage = await this.plugin.setupRange(range, timeZone, kind.startsWith('authorize') ? 'authorize' : 'configure', kind.endsWith('Reminders') ? 'reminders' : 'calendar', sourceID, signal);
                else {
                    this.preview = await this.plugin.previewRange(range, timeZone, copyOptions(this.options), signal);
                    this.planSelection = initialSelection(this.preview);
                    this.statusMessage = `Preview ready · ${this.preview.entries.length} plans · ${this.preview.issues.length} issues. Review each choice, then Sync selected.`;
                }
            }
            if (['connect', 'disconnect'].includes(kind)) {
                const { range, timeZone } = this.input(); await this.plugin.refreshRange(range, timeZone, signal);
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
        flags.createEl('span', { text: !this.checked ? 'Checking setup…' : !this.credential ? 'Connect this vault' : this.credential.allowSync ? 'Vault credential saved · preview + sync' : 'Vault credential saved · preview only', cls: 'apple-sync-badge' });
        flags.createEl('span', { text: this.plugin.connection ? `Installed helper ${this.plugin.connection.version}` : 'Helper not verified this session', cls: 'apple-sync-badge' });
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
        this.renderConnection(contentEl);
        contentEl.createEl('p', { text: 'Save edits first. Preview reads notes from disk; source links never change them.', cls: 'apple-sync-description' });
        const actions = contentEl.createDiv({ cls: 'apple-sync-actions' });
        new Setting(actions)
            .addButton(button => button.setButtonText('Preview saved plans').setCta().setDisabled(this.busy || !this.credential).onClick(() => { void this.perform('preview'); }))
            .addButton(button => { button.setButtonText('Sync selected').setCta().onClick(() => { void this.perform('sync'); }); this.syncButton = button.buttonEl; })
            .addButton(button => button.setButtonText('Refresh connection').setDisabled(this.busy).onClick(() => { void this.perform('refresh'); }));
        if (this.busy) new Setting(contentEl).addButton(button => button.setButtonText('Stop waiting').onClick(() => this.poller?.abort()));
        this.statusEl = contentEl.createEl('p', { text: this.statusMessage, cls: 'apple-sync-status', attr: { role: 'status', 'aria-live': 'polite' } });
        this.resultsEl = contentEl.createDiv({ cls: 'apple-sync-results' });
        if (this.preview) this.renderPreview(this.preview);
        this.updateSyncButton();
        if (this.run?.response?.job?.result) this.renderLastResult(contentEl, this.run.response);
        contentEl.createEl('p', { text: 'Closing or disabling stops polling, not a native sync already running. Use Check last sync to recover.', cls: 'apple-sync-footnote' });
    }
    private renderConnection(parent: HTMLElement): void {
        const state = this.plugin.nativeState;
        const setup = parent.createEl('details', { cls: 'apple-sync-setup' });
        setup.open = this.checked && (!this.credential || state?.remindersPermission !== 'fullAccess' || !state?.reminderSourceID || this.options.includeCalendar && (state?.calendarPermission !== 'fullAccess' || !state?.calendarSourceID));
        setup.createEl('summary', { text: 'Connection & permissions' });
        setup.createEl('a', { text: 'Helper setup guide', attr: { href: HELPER_SETUP_URL, target: '_blank', rel: 'noopener noreferrer' } });
        setup.createEl('p', { text: this.plugin.vaultPath(), cls: 'apple-sync-path' });
        setup.createEl('p', { text: 'Connect grants this plugin access to preview and sync this exact vault only when you request it. Apple system permissions are separate. No standalone App is used.', cls: 'apple-sync-description' });
        new Setting(setup).addButton(button => button.setButtonText('Connect this vault').setDisabled(this.busy).onClick(() => { void this.perform('connect'); }));
        if (this.credential) new Setting(setup).addButton(button => button.setButtonText('Disconnect this vault').setDisabled(this.busy).onClick(() => { void this.perform('disconnect'); }));
        const services = this.options.includeCalendar || state?.calendarPermission !== undefined && state.calendarPermission !== 'notDetermined' ? ['reminders', 'calendar'] as const : ['reminders'] as const;
        for (const entity of services) {
            const reminders = entity === 'reminders', permission = reminders ? state?.remindersPermission : state?.calendarPermission;
            const sources = (reminders ? state?.reminderSources : state?.calendarSources) ?? [];
            const selected = (reminders ? state?.reminderSourceID : state?.calendarSourceID) ?? '';
            new Setting(setup).setName(reminders ? 'Reminders access' : 'Calendar access').setDesc(permission ? ({ notDetermined: 'Not requested', denied: 'Denied in system settings', restricted: 'Restricted by macOS', fullAccess: 'Access granted', writeOnly: 'Full access needed' }[permission]) : 'Refresh connection to check access.').addButton(button => button
                .setButtonText(reminders ? 'Grant Reminders Access' : 'Grant Calendar Access').setDisabled(this.busy || !this.credential || permission === 'fullAccess')
                .onClick(() => { void this.perform(reminders ? 'authorizeReminders' : 'authorizeCalendar'); }));
            new Setting(setup).setName(reminders ? 'Reminders account' : 'Calendar account').addDropdown(dropdown => {
                dropdown.addOption('', permission === 'fullAccess' ? 'Choose account…' : 'Grant access first');
                for (const source of sources) dropdown.addOption(source.id, source.title);
                dropdown.selectEl.options[0].disabled = true;
                dropdown.setValue(selected).setDisabled(this.busy || !this.credential || permission !== 'fullAccess').onChange(value => { void this.perform(reminders ? 'configureReminders' : 'configureCalendar', value); });
            });
            if (permission === 'denied' || permission === 'restricted' || permission === 'writeOnly') setup.createEl('p', { text: `Full ${reminders ? 'Reminders' : 'Calendar'} access is needed. Check macOS System Settings → Privacy & Security for the Day Planner Apple Sync helper, then Refresh connection.`, cls: 'apple-sync-notice' });
        }
        if (this.plugin.connection) setup.createEl('p', { text: `Installed helper ${this.plugin.connection.version} · ${this.plugin.connection.capabilities.includes('sync') ? 'Selective sync available' : 'Sync support not reported. Follow the Helper setup guide.'}`, cls: 'apple-sync-description' });
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
            try { this.run = await acknowledgeRun(this.plugin.vaultPath(), pluginBridgeRoot()); this.invalidate(); this.statusMessage = 'Previous run acknowledged. Request a fresh preview; nothing was submitted.'; this.render(); }
            catch (error) { this.statusMessage = this.plugin.report(error); this.render(); }
        }));
    }
    private renderPreview(preview: PreviewResult): void {
        const summary = this.resultsEl.createDiv({ cls: 'apple-sync-summary' });
        for (const [name, value] of Object.entries(preview.counts)) summary.createEl('span', { text: `${name === 'skipped' ? 'Default skipped' : name[0].toUpperCase() + name.slice(1)} ${value}`, cls: `apple-sync-badge apple-sync-${name}` });
        if (!preview.syncAllowed || !this.credential?.allowSync) this.resultsEl.createEl('p', { text: this.plugin.connection && !this.plugin.connection.capabilities.includes('sync') ? 'This helper does not report sync support. Follow the Helper setup guide to install helper 0.4.0 manually.' : 'Use Connect this vault to allow preview + sync for the independent plugin.', cls: 'apple-sync-notice' });
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
        this.containerEl.createEl('p', { text: 'This plugin connects to a manually installed macOS helper 0.4.0. Requires Apple silicon and macOS 14 or later. It never downloads or installs native code, and does not use the standalone ObsidianPlanner App.' });
        this.containerEl.createEl('a', { text: 'Helper setup guide', attr: { href: HELPER_SETUP_URL, target: '_blank', rel: 'noopener noreferrer' } });
        new Setting(this.containerEl).setName('Planner, connection & permissions').setDesc('Connect this vault, grant Apple access, choose accounts and manage range/notification preferences in Obsidian.').addButton(button => button.setButtonText('Open Apple sync').onClick(() => this.plugin.openModal()));
        new Setting(this.containerEl).setName('Use system time zone').addButton(button => button.setButtonText('Use system').onClick(async () => { await this.plugin.savePreferences({ ...this.plugin.settings, timeZone: systemZone() }); this.display(); }));
        this.containerEl.createEl('p', { text: 'Disconnect this vault in the planner to revoke helper access and remove its local credential. Existing Apple items and history stay. Do not run standalone App and plugin sync at the same time.', cls: 'apple-sync-description' });
    }
}
