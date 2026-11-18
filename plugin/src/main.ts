import { FileSystemAdapter, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { shell } from 'electron';
import { openPlanner } from './bridge-client.ts';
import { dayInZone, resolveRange, validTimeZone } from './range.ts';
import type { DateRange, RangeMode } from './range.ts';

interface Settings { timeZone: string }
const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
const commonZones = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];

export default class AppleSyncPlugin extends Plugin {
    settings: Settings = { timeZone: systemZone() };
    private aborter = new AbortController();
    private opening = false;

    async onload(): Promise<void> {
        const saved: Partial<Settings> | null = await this.loadData();
        if (typeof saved?.timeZone === 'string' && validTimeZone(saved.timeZone)) this.settings.timeZone = saved.timeZone;
        this.addRibbonIcon('calendar-clock', 'Open Apple sync', () => this.openModal());
        this.addCommand({ id: 'open-apple-sync', name: 'Open Apple sync', callback: () => this.openModal() });
        this.addCommand({ id: 'preview-this-week', name: 'Preview this week', callback: () => { void this.openPreset('thisWeek'); } });
        this.addCommand({ id: 'preview-next-week', name: 'Preview next week', callback: () => { void this.openPreset('nextWeek'); } });
        this.addCommand({ id: 'choose-sync-range', name: 'Choose sync range', callback: () => this.openModal('custom') });
        this.addSettingTab(new AppleSyncSettings(this));
    }

    onunload(): void { this.aborter.abort(); }

    private supported(): boolean {
        if (Platform.isMacOS && Platform.isDesktopApp) return true;
        new Notice('Day Planner Apple Sync requires Obsidian on macOS and the companion Mac app.');
        return false;
    }

    openModal(mode: RangeMode = 'thisWeek'): void {
        if (this.supported()) new RangeModal(this, mode).open();
    }

    async saveTimeZone(timeZone: string): Promise<void> {
        if (!validTimeZone(timeZone)) throw new Error('Choose a valid time zone, for example Asia/Shanghai.');
        this.settings.timeZone = timeZone;
        await this.saveData(this.settings);
    }

    private async openPreset(mode: RangeMode): Promise<void> {
        try {
            const timeZone = this.settings.timeZone;
            await this.openRange(resolveRange(mode, timeZone), timeZone);
        } catch (error) { this.report(error); }
    }

    async openRange(range: DateRange, timeZone: string): Promise<string> {
        if (!this.supported()) return 'This feature requires macOS.';
        if (this.opening) return 'Another request is opening. Check the Mac app before trying again.';
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) throw new Error('This plugin requires a local filesystem vault.');
        this.opening = true;
        try {
            await this.saveTimeZone(timeZone);
            const response = await openPlanner({ ...range, timeZone, vaultPath: adapter.getBasePath(), vaultName: this.app.vault.getName() }, {
                launch: url => shell.openExternal(url, { activate: true }),
                signal: this.aborter.signal,
            });
            const description = response.status === 'opened'
                ? 'ObsidianPlanner opened with your date range. Review the plans and sync in the Mac app. No Apple items were written by this request.'
                : response.status === 'needsVault'
                    ? 'ObsidianPlanner opened. Confirm this vault in the Mac app before previewing or syncing.'
                    : response.message;
            new Notice(description, 9000);
            return description;
        } finally { this.opening = false; }
    }

    report(error: unknown): string {
        if (this.aborter.signal.aborted) return 'Request cancelled because the plugin was disabled.';
        const description = error instanceof Error ? error.message : 'Could not open the companion Mac app.';
        new Notice(description, 12000);
        return description;
    }
}

class RangeModal extends Modal {
    private mode: RangeMode;
    private timeZone: string;
    private startDate: string;
    private endDate: string;
    private customTimeZone = '';
    constructor(private plugin: AppleSyncPlugin, mode: RangeMode) {
        super(plugin.app);
        this.mode = mode;
        this.timeZone = plugin.settings.timeZone;
        this.startDate = dayInZone(new Date(), this.timeZone);
        this.endDate = this.startDate;
    }
    onOpen(): void { this.render(); }
    onClose(): void { this.contentEl.empty(); }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('apple-sync-range');
        contentEl.createEl('h2', { text: 'Open Apple sync' });
        contentEl.createEl('p', { text: `Source vault: ${this.app.vault.getName()}`, cls: 'apple-sync-context' });
        contentEl.createEl('p', { text: 'P1 preview handoff: opens ObsidianPlanner with this range. Review and sync in the Mac app. Save your note changes first.', cls: 'apple-sync-description' });
        new Setting(contentEl).setName('Date range').addDropdown(dropdown => dropdown
            .addOptions({ thisWeek: 'This week', nextWeek: 'Next week', custom: 'Custom' })
            .setValue(this.mode).onChange(value => { this.mode = value as RangeMode; this.render(); }));
        if (this.mode === 'custom') {
            new Setting(contentEl).setName('From').addText(text => { text.inputEl.type = 'date'; text.setValue(this.startDate).onChange(value => this.startDate = value); });
            new Setting(contentEl).setName('To').addText(text => { text.inputEl.type = 'date'; text.setValue(this.endDate).onChange(value => this.endDate = value); });
        }
        new Setting(contentEl).setName('Time zone').setDesc('Use an IANA identifier. Dates are interpreted in this zone.').addDropdown(dropdown => {
            const zones = [...new Set([this.timeZone, systemZone(), ...commonZones])];
            for (const zone of zones) dropdown.addOption(zone, zone.replaceAll('_', ' '));
            dropdown.setValue(this.timeZone).onChange(value => { this.timeZone = value; this.customTimeZone = ''; this.render(); });
        });
        new Setting(contentEl).setName('Other time zone').setDesc('Optional; overrides the menu above.').addText(text => text.setPlaceholder('e.g. Australia/Sydney').setValue(this.customTimeZone).onChange(value => {
            this.customTimeZone = value;
        }));
        const status = contentEl.createEl('p', { cls: 'apple-sync-status', attr: { role: 'status' } });
        new Setting(contentEl).addButton(button => button.setButtonText('Open ObsidianPlanner').setCta().onClick(async () => {
            button.setDisabled(true);
            status.setText('Opening the companion app…');
            try {
                const timeZone = this.customTimeZone.trim() || this.timeZone;
                const range = resolveRange(this.mode, timeZone, new Date(), { startDate: this.startDate, endDate: this.endDate });
                const message = await this.plugin.openRange(range, timeZone);
                status.setText(message);
            } catch (error) { status.setText(this.plugin.report(error)); }
            finally { button.setDisabled(false); }
        }));
    }
}

class AppleSyncSettings extends PluginSettingTab {
    constructor(private plugin: AppleSyncPlugin) { super(plugin.app, plugin); }
    display(): void {
        this.containerEl.empty();
        this.containerEl.createEl('h2', { text: 'Day Planner Apple Sync' });
        this.containerEl.createEl('p', { text: 'Requires the matching P1 companion Mac app (0.3.0 or later with protocol 1). Public v0.2.0-beta.1 does not include this bridge. This plugin opens the app; it does not sync directly.' });
        new Setting(this.containerEl).setName('Time zone').setDesc('Saved locally in this plugin’s settings.').addText(text => text.setValue(this.plugin.settings.timeZone).onChange(async value => {
            if (validTimeZone(value.trim())) await this.plugin.saveTimeZone(value.trim());
        }));
        new Setting(this.containerEl).setName('Use system time zone').addButton(button => button.setButtonText('Use system').onClick(async () => {
            await this.plugin.saveTimeZone(systemZone()); this.display();
        }));
    }
}
