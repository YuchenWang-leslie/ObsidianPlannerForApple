import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir, release } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { BridgeError, sendBridgeRequest } from './bridge-client.ts';
import type { BaseResponse, BridgeOptions, OpenInput, PairingCredential } from './bridge-client.ts';

export const HELPER_VERSION = '0.4.0';
const bundleName = 'DayPlannerAppleSyncHelper.app';
const executableName = 'DayPlannerAppleSyncHelper';
export const pluginBridgeRoot = (home = homedir()): string => join(home, 'Library', 'Application Support', 'ObsidianPlanner', 'PluginBridge');
export const helperRuntimePath = (home = homedir()): string => join(home, 'Library', 'Application Support', 'ObsidianPlanner', 'PluginRuntime', HELPER_VERSION, bundleName);
export type PermissionState = 'notDetermined' | 'denied' | 'restricted' | 'fullAccess' | 'writeOnly';
export interface HelperState {
    remindersPermission: PermissionState; calendarPermission: PermissionState;
    reminderSources: { id: string; title: string }[]; calendarSources: { id: string; title: string }[];
    reminderSourceID: string; calendarSourceID: string;
}
export interface SetupResponse extends BaseResponse { status: 'ready' | 'needsSetup' | 'failed' | 'busy'; state?: HelperState }
export type RunFile = (file: string, args: string[]) => Promise<void>;
const exec = promisify(execFile);
const defaultRunFile: RunFile = async (file, args) => { await exec(file, args); };
export interface HelperRuntimeOptions {
    home?: string; root?: string; signal?: AbortSignal; runFile?: RunFile;
    platform?: string; arch?: string; osRelease?: string;
}
export function unsupportedReason(environment: Pick<HelperRuntimeOptions, 'platform' | 'arch' | 'osRelease'> = {}): string | null {
    if ((environment.platform ?? process.platform) !== 'darwin' || (environment.arch ?? process.arch) !== 'arm64' || Number((environment.osRelease ?? release()).split('.')[0]) < 23)
        return 'Plugin 0.4.0 requires Apple silicon, macOS 14 or later, and desktop Obsidian for Apple silicon. Install the complete plugin ZIP; a separate ObsidianPlanner App is not used.';
    return null;
}
async function fingerprint(bundle: string): Promise<string> {
    const hash = createHash('sha256');
    for (const file of ['Info.plist', join('MacOS', executableName)]) hash.update(await readFile(join(bundle, 'Contents', file)));
    return hash.digest('hex');
}
export async function ensureHelperRuntime(pluginDirectory: string, options: HelperRuntimeOptions = {}): Promise<string> {
    const unsupported = unsupportedReason(options); if (unsupported) throw new BridgeError('UNSUPPORTED_PLATFORM', unsupported);
    if (!isAbsolute(pluginDirectory)) throw new BridgeError('HELPER_MISSING', 'The plugin folder is unavailable. Reinstall the complete plugin 0.4.0 ZIP, including native/.');
    options.signal?.throwIfAborted();
    const source = join(pluginDirectory, 'native', bundleName), target = helperRuntimePath(options.home);
    let sourceHash: string;
    try { sourceHash = await fingerprint(source); }
    catch { throw new BridgeError('HELPER_MISSING', 'The bundled macOS helper is missing or incomplete. Reinstall the complete plugin 0.4.0 ZIP, including native/DayPlannerAppleSyncHelper.app. No separate App is required.'); }
    let installed = false;
    try { installed = (await stat(target)).isDirectory(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (installed) {
        let targetHash: string | null = null;
        try { targetHash = await fingerprint(target); } catch { /* An incomplete existing bundle must not be overwritten. */ }
        if (targetHash !== sourceHash) throw new BridgeError('RUNTIME_MISMATCH', `The installed helper differs from this plugin build. Let any sync finish, quit Obsidian and the helper, then remove only ${target} and reopen the complete plugin to reinstall it. Keep PluginBridge and sync history. No running job was stopped.`);
        return target;
    }
    const parent = join(options.home ?? homedir(), 'Library', 'Application Support', 'ObsidianPlanner', 'PluginRuntime', HELPER_VERSION);
    await mkdir(parent, { recursive: true, mode: 0o700 }); await chmod(parent, 0o700);
    const temporary = join(parent, `.${randomUUID()}.install.app`);
    try {
        // ditto preserves the app signature and macOS extended attributes during installation.
        await (options.runFile ?? defaultRunFile)('/usr/bin/ditto', [source, temporary]);
        options.signal?.throwIfAborted();
        try { await rename(temporary, target); }
        catch (error) {
            // Another vault may have completed the same immutable-version install.
            if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '') || await fingerprint(target) !== sourceHash) throw error;
        }
    } finally { await rm(temporary, { force: true, recursive: true }); }
    return target;
}
export function helperBridgeOptions(pluginDirectory: string, options: HelperRuntimeOptions = {}): BridgeOptions {
    return { root: options.root ?? pluginBridgeRoot(options.home), scheme: 'obsidianplanner-helper', signal: options.signal, launch: async url => {
        const parsed = new URL(url);
        if (parsed.protocol !== 'obsidianplanner-helper:' || parsed.hostname !== 'bridge') throw new BridgeError('INVALID_RESPONSE', 'Refusing a non-helper launch URL.');
        const target = await ensureHelperRuntime(pluginDirectory, options);
        options.signal?.throwIfAborted();
        await (options.runFile ?? defaultRunFile)('/usr/bin/open', ['-g', '-a', target, url]);
    } };
}
function validState(value: unknown): value is HelperState {
    const state = value as HelperState | null, permissions = ['notDetermined', 'denied', 'restricted', 'fullAccess', 'writeOnly'];
    const sources = (value: unknown): boolean => Array.isArray(value) && value.every(item => item && typeof item.id === 'string' && !!item.id && typeof item.title === 'string') && new Set(value.map(item => item.id)).size === value.length;
    return !!state && permissions.includes(state.remindersPermission) && permissions.includes(state.calendarPermission) &&
        sources(state.reminderSources) && sources(state.calendarSources) && typeof state.reminderSourceID === 'string' && typeof state.calendarSourceID === 'string' &&
        (!state.reminderSourceID || state.reminderSources.some(source => source.id === state.reminderSourceID)) &&
        (!state.calendarSourceID || state.calendarSources.some(source => source.id === state.calendarSourceID));
}
function auth(credential: PairingCredential): { vaultKey: string; pairingToken: string } {
    if (!/^[a-f0-9]{64}$/.test(credential.vaultKey) || typeof credential.pairingToken !== 'string' || !credential.pairingToken.trim()) throw new BridgeError('INVALID_CREDENTIAL', 'Connect this vault before changing permissions or accounts.');
    return { vaultKey: credential.vaultKey, pairingToken: credential.pairingToken };
}
async function setup(input: OpenInput, action: 'info' | 'authorize' | 'configure' | 'unpair', extra: object, options: BridgeOptions): Promise<SetupResponse> {
    if (options.scheme !== 'obsidianplanner-helper' || !options.root) throw new BridgeError('INVALID_RESPONSE', 'The independent plugin requires its private helper transport.');
    const response = await sendBridgeRequest(input, action, extra, ['ready', 'needsSetup', 'failed', 'busy'], options) as SetupResponse;
    if (response.appVersion !== HELPER_VERSION || (response.state !== undefined && !validState(response.state)) ||
        (((response.status === 'ready' && action !== 'unpair') || (response.status === 'needsSetup' && action === 'authorize')) && !validState(response.state))) throw new BridgeError('INVALID_RESPONSE', 'The bundled helper returned incompatible setup information. Reinstall the complete matching plugin 0.4.0 package.');
    return response;
}
export const helperInfo = (input: OpenInput, options: BridgeOptions): Promise<SetupResponse> => setup(input, 'info', {}, options);
export function helperAuthorize(input: OpenInput, credential: PairingCredential, entity: 'reminders' | 'calendar', options: BridgeOptions): Promise<SetupResponse> {
    if (!['reminders', 'calendar'].includes(entity)) throw new Error('Choose Reminders or Calendar access.');
    return setup(input, 'authorize', { ...auth(credential), entity }, { timeoutMs: 120000, ...options });
}
export function helperConfigure(input: OpenInput, credential: PairingCredential, sourceIDs: { reminderSourceID?: string; calendarSourceID?: string }, options: BridgeOptions): Promise<SetupResponse> {
    if (Object.keys(sourceIDs).some(key => !['reminderSourceID', 'calendarSourceID'].includes(key)) || Object.values(sourceIDs).some(value => typeof value !== 'string' || !value.trim())) throw new Error('Choose an eligible account for the correct service.');
    return setup(input, 'configure', { ...auth(credential), ...sourceIDs }, options);
}
export const helperUnpair = (input: OpenInput, credential: PairingCredential, options: BridgeOptions): Promise<SetupResponse> => setup(input, 'unpair', auth(credential), options);
