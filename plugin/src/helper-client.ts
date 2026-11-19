import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { homedir, release } from 'node:os';
import { BridgeError, sendBridgeRequest } from './bridge-client.ts';
import type { BaseResponse, BridgeOptions, OpenInput, PairingCredential } from './bridge-client.ts';

export const HELPER_VERSION = '0.4.0';
const bundleName = 'DayPlannerAppleSyncHelper.app';
const executableName = 'DayPlannerAppleSyncHelper';
export const HELPER_BUNDLE_ID = 'com.obsidianplanner.pluginhelper';
export const HELPER_SETUP_URL = 'https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/blob/main/docs/HELPER_SETUP.md';
export const pluginBridgeRoot = (home = homedir()): string => join(home, 'Library', 'Application Support', 'ObsidianPlanner', 'PluginBridge');
export const helperRuntimePath = (home = homedir()): string => join(home, 'Library', 'Application Support', 'ObsidianPlanner', 'PluginRuntime', HELPER_VERSION, bundleName);
export type PermissionState = 'notDetermined' | 'denied' | 'restricted' | 'fullAccess' | 'writeOnly';
export interface HelperState {
    remindersPermission: PermissionState; calendarPermission: PermissionState;
    reminderSources: { id: string; title: string }[]; calendarSources: { id: string; title: string }[];
    reminderSourceID: string; calendarSourceID: string;
}
export interface SetupResponse extends BaseResponse { status: 'ready' | 'needsSetup' | 'failed' | 'busy'; state?: HelperState }
export type RunFile = (file: string, args: string[]) => Promise<{ stdout?: string } | void>;
const exec = promisify(execFile);
const defaultRunFile: RunFile = async (file, args) => { const { stdout } = await exec(file, args); return { stdout }; };
export interface HelperRuntimeOptions {
    home?: string; root?: string; signal?: AbortSignal; runFile?: RunFile;
    platform?: string; arch?: string; osRelease?: string;
}
export function unsupportedReason(environment: Pick<HelperRuntimeOptions, 'platform' | 'arch' | 'osRelease'> = {}): string | null {
    if ((environment.platform ?? process.platform) !== 'darwin' || (environment.arch ?? process.arch) !== 'arm64' || Number((environment.osRelease ?? release()).split('.')[0]) < 23)
        return `Day Planner Apple Sync requires Apple silicon, macOS 14 or later, and desktop Obsidian for Apple silicon. Helper setup: ${HELPER_SETUP_URL}`;
    return null;
}
/** Locate and validate a manually installed helper. This never installs or updates native code. */
export async function ensureHelperRuntime(_pluginDirectory: string, options: HelperRuntimeOptions = {}): Promise<string> {
    const unsupported = unsupportedReason(options); if (unsupported) throw new BridgeError('UNSUPPORTED_PLATFORM', unsupported);
    options.signal?.throwIfAborted();
    const target = helperRuntimePath(options.home), contents = join(target, 'Contents');
    const info = join(contents, 'Info.plist'), executable = join(contents, 'MacOS', executableName);
    const invalid = (reason: string) => new BridgeError('RUNTIME_MISMATCH', `${reason} Install the official helper ${HELPER_VERSION} manually using ${HELPER_SETUP_URL}. No native files were installed or changed.`);
    try {
        if (!(await stat(target)).isDirectory()) throw invalid('The installed helper bundle is not a directory.');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BridgeError('HELPER_MISSING', `The macOS helper ${HELPER_VERSION} is not installed. Existing 0.4.0 helper installations are supported; the community plugin does not download or install native code. Follow ${HELPER_SETUP_URL}`);
        throw error;
    }
    try {
        if (!(await stat(info)).isFile() || !(await stat(executable)).isFile()) throw invalid('The installed helper is incomplete.');
        await access(info, constants.R_OK); await access(executable, constants.R_OK | constants.X_OK);
    } catch { throw invalid('The installed helper metadata or executable is missing or unreadable.'); }
    const run = options.runFile ?? defaultRunFile;
    try {
        // -o - reads XML/binary plists as JSON on stdout without changing the file.
        const output = await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', info]);
        if (!output || typeof output.stdout !== 'string') throw invalid('The helper metadata could not be read.');
        const metadata: unknown = JSON.parse(output.stdout);
        if (!isRecord(metadata) || metadata.CFBundleIdentifier !== HELPER_BUNDLE_ID || metadata.CFBundleShortVersionString !== HELPER_VERSION ||
            metadata.CFBundleExecutable !== executableName || metadata.LSUIElement !== true || metadata.CFBundlePackageType !== 'APPL' ||
            !Array.isArray(metadata.CFBundleURLTypes) || !metadata.CFBundleURLTypes.some((value: unknown) => isRecord(value) && Array.isArray(value.CFBundleURLSchemes) && value.CFBundleURLSchemes.every((scheme: unknown) => typeof scheme === 'string') && value.CFBundleURLSchemes.includes('obsidianplanner-helper'))) throw invalid('The installed helper identity or version does not match.');
    } catch { throw invalid('The installed helper metadata is invalid or its identity/version does not match.'); }
    options.signal?.throwIfAborted();
    try {
        // This checks signed-bundle integrity/identity; it does not claim Apple notarization.
        await run('/usr/bin/codesign', ['--verify', '--strict', `-R=identifier "${HELPER_BUNDLE_ID}"`, target]);
    } catch { throw invalid('The installed helper signature could not be verified.'); }
    options.signal?.throwIfAborted();
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
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validSources(value: unknown): value is HelperState['reminderSources'] {
    if (!Array.isArray(value)) return false;
    const sources: unknown[] = value;
    const ids = new Set<string>();
    for (const source of sources) {
        if (!isRecord(source) || typeof source.id !== 'string' || !source.id || typeof source.title !== 'string' || ids.has(source.id)) return false;
        ids.add(source.id);
    }
    return true;
}
function validState(state: unknown): state is HelperState {
    const permissions = ['notDetermined', 'denied', 'restricted', 'fullAccess', 'writeOnly'];
    return isRecord(state) && typeof state.remindersPermission === 'string' && permissions.includes(state.remindersPermission) &&
        typeof state.calendarPermission === 'string' && permissions.includes(state.calendarPermission) &&
        validSources(state.reminderSources) && validSources(state.calendarSources) && typeof state.reminderSourceID === 'string' && typeof state.calendarSourceID === 'string' &&
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
        (((response.status === 'ready' && action !== 'unpair') || (response.status === 'needsSetup' && action === 'authorize')) && !validState(response.state))) throw new BridgeError('INVALID_RESPONSE', `The installed helper returned incompatible setup information. Check helper ${HELPER_VERSION} using ${HELPER_SETUP_URL}`);
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
