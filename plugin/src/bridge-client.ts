import { mkdir, writeFile, rename, readFile, rm, chmod } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { validDate, validTimeZone } from './range.ts';
import type { DateRange } from './range.ts';
import { readRun, writeRun, runBlocksNewSync } from './run-store.ts';
import type { RunPointer } from './run-store.ts';
import { validateSelection } from './selection.ts';
import type { PlanSelection } from './selection.ts';
export { readRun, acknowledgeRun, runBlocksNewSync, runNeedsAcknowledgement } from './run-store.ts';
export type { RunPointer } from './run-store.ts';

export interface OpenInput extends DateRange { vaultPath: string; vaultName: string; timeZone: string }
export interface OpenRequest extends OpenInput { protocolVersion: 1; requestId: string; action: 'open' }
export type NotificationChannel = 'Reminders' | 'Calendar' | 'Both' | 'None';
export interface SyncOptions { includeCalendar: boolean; notification: { channel: NotificationChannel; minutes: number } }
export const defaultSyncOptions = (): SyncOptions => ({ includeCalendar: false, notification: { channel: 'Reminders', minutes: 10 } });
export interface PairingCredential { vaultKey: string; pairingToken: string; allowSync?: boolean }
export interface PreviewEntry {
    id: string; filePath: string; line: number; date: string; title: string;
    start: string; end: string; startTime: string; endTime: string; completed: boolean;
    action: 'create' | 'update' | 'unchanged' | 'conflict';
    selectedAction: 'create' | 'skip' | 'conflict'; reason: string; incomplete: boolean;
}
export interface PreviewResult extends DateRange {
    previewId: string; vaultKey: string; vaultName: string; timeZone: string; options: SyncOptions;
    entries: PreviewEntry[]; issues: string[]; syncAllowed: boolean;
    linkCandidates: { id: string; date: string; title: string; startTime: string; endTime: string }[];
    counts: { create: number; update: number; unchanged: number; conflict: number; skipped: number };
}
export interface BaseResponse { protocolVersion: 1; requestId: string; appVersion: string; message: string; errorCode?: string; capabilities?: string[] }
export interface OpenResponse extends BaseResponse { status: 'opened' | 'needsVault' | 'busy' | 'failed' }
export interface PairResponse extends BaseResponse { status: 'pending' | 'paired' | 'failed' | 'busy' | 'needsSetup'; pairing?: PairingCredential }
export interface PreviewResponse extends BaseResponse { status: 'previewReady' | 'failed' | 'busy' | 'needsSetup'; preview?: PreviewResult }
export interface SyncResult {
    status: 'completed' | 'partial' | 'failed'; message: string; errorCode?: string;
    counts: { calendarSaved: number; remindersSaved: number; skipped: number; failed: number; unresolved: number };
    items: { entryId: string; title: string; date: string; action: 'create' | 'update' | 'addAgain' | 'skip' | 'conflict'; status: 'saved' | 'skipped' | 'failed' | 'unresolved'; calendarSaved: boolean; reminderSaved: boolean; message: string }[];
}
export interface SyncJob { requestId: string; previewId: string; vaultKey: string; status: string; createdAt: string; updatedAt: string; result?: SyncResult }
export interface SyncResponse extends BaseResponse { status: 'running' | 'completed' | 'partial' | 'interrupted' | 'notFound' | 'failed' | 'busy' | 'needsSetup'; job?: SyncJob }
export type WireResponse = BaseResponse & { status: string; pairing?: PairingCredential; preview?: PreviewResult; job?: SyncJob };
export interface BridgeOptions {
    root?: string;
    scheme?: 'obsidianplanner' | 'obsidianplanner-helper';
    launch: (url: string) => Promise<void>;
    timeoutMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
    onPending?: () => void;
    onUpdate?: (response: SyncResponse) => void;
    statusPollMs?: number;
    statusTimeoutMs?: number;
}
export class BridgeError extends Error {
    readonly code: 'APP_NOT_FOUND' | 'NO_CONFIRMATION' | 'INVALID_RESPONSE' | 'INVALID_CREDENTIAL' | 'RUN_PENDING' | 'HELPER_MISSING' | 'RUNTIME_MISMATCH' | 'UNSUPPORTED_PLATFORM';
    constructor(code: BridgeError['code'], message: string) { super(message); this.code = code; }
}
export const bridgeRoot = () => join(homedir(), 'Library', 'Application Support', 'ObsidianPlanner', 'Bridge');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const invalidResponse = () => new BridgeError('INVALID_RESPONSE', 'The native sync service returned an incompatible response. Reinstall the matching complete plugin or App package.');
const credentialValid = (value: unknown): value is PairingCredential => {
    const candidate = value as Partial<PairingCredential> | null;
    return !!candidate && typeof candidate.vaultKey === 'string' && /^[a-f0-9]{64}$/.test(candidate.vaultKey) &&
        typeof candidate.pairingToken === 'string' && candidate.pairingToken.length > 0 && candidate.pairingToken.trim() === candidate.pairingToken && (candidate.allowSync === undefined || typeof candidate.allowSync === 'boolean');
};

export function validSyncOptions(value: unknown): value is SyncOptions {
    const options = value as Partial<SyncOptions> | null;
    const notice = options?.notification;
    return !!options && typeof options.includeCalendar === 'boolean' && !!notice &&
        ['Reminders', 'Calendar', 'Both', 'None'].includes(notice.channel) &&
        Number.isInteger(notice.minutes) && notice.minutes >= 0 && notice.minutes <= 60 && notice.minutes % 5 === 0 &&
        (options.includeCalendar || (notice.channel !== 'Calendar' && notice.channel !== 'Both'));
}
function sameOptions(a: SyncOptions, b: SyncOptions): boolean {
    return a.includeCalendar === b.includeCalendar && a.notification.channel === b.notification.channel && a.notification.minutes === b.notification.minutes;
}
export function validSourcePath(path: string): boolean {
    return path.length > 0 && !isAbsolute(path) && !path.includes('\\') && !path.includes('\0') && !path.split('/').some(part => part === '..' || part === '.' || part === '');
}
function validEntry(value: unknown): value is PreviewEntry {
    const entry = value as PreviewEntry | null;
    return !!entry && typeof entry.id === 'string' && !!entry.id && typeof entry.filePath === 'string' && validSourcePath(entry.filePath) &&
        Number.isInteger(entry.line) && entry.line > 0 && typeof entry.date === 'string' && validDate(entry.date) &&
        typeof entry.title === 'string' && typeof entry.start === 'string' && typeof entry.end === 'string' &&
        Number.isFinite(Date.parse(entry.start)) && Date.parse(entry.end) > Date.parse(entry.start) &&
        typeof entry.startTime === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(entry.startTime) &&
        typeof entry.endTime === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(entry.endTime) &&
        typeof entry.completed === 'boolean' && ['create', 'update', 'unchanged', 'conflict'].includes(entry.action) &&
        ['create', 'skip', 'conflict'].includes(entry.selectedAction) && typeof entry.reason === 'string' && (entry.incomplete === undefined || typeof entry.incomplete === 'boolean');
}
function validatePreview(value: unknown, input: OpenInput, credential: PairingCredential, options: SyncOptions): asserts value is PreviewResult {
    const result = value as PreviewResult | null;
    if (!result || typeof result.previewId !== 'string' || !result.previewId || result.vaultKey !== credential.vaultKey ||
        typeof result.vaultName !== 'string' || result.startDate !== input.startDate || result.endDate !== input.endDate ||
        result.timeZone !== input.timeZone || !validSyncOptions(result.options) || !sameOptions(result.options, options) ||
        !Array.isArray(result.entries) || !result.entries.every(validEntry) ||
        new Set(result.entries.map(entry => entry.id)).size !== result.entries.length ||
        result.entries.some(entry => entry.date < input.startDate || entry.date > input.endDate) ||
        !Array.isArray(result.issues) || !result.issues.every(issue => typeof issue === 'string') || !result.counts ||
        !['create', 'update', 'unchanged', 'conflict', 'skipped'].every(key => Number.isInteger(result.counts[key as keyof PreviewResult['counts']]) && result.counts[key as keyof PreviewResult['counts']] >= 0)) throw invalidResponse();
    for (const action of ['create', 'update', 'unchanged', 'conflict'] as const) {
        if (result.counts[action] !== result.entries.filter(entry => entry.action === action).length) throw invalidResponse();
    }
    if (result.counts.skipped !== result.entries.filter(entry => entry.selectedAction === 'skip').length) throw invalidResponse();
    if (result.syncAllowed !== undefined && typeof result.syncAllowed !== 'boolean') throw invalidResponse();
    const candidates = result.linkCandidates ?? [];
    if (!Array.isArray(candidates) || !candidates.every(candidate => candidate && typeof candidate.id === 'string' && !!candidate.id &&
        typeof candidate.date === 'string' && validDate(candidate.date) && typeof candidate.title === 'string' &&
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate.startTime) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate.endTime)) ||
        new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) throw invalidResponse();
    result.syncAllowed = result.syncAllowed === true;
    result.linkCandidates = candidates;
    for (const entry of result.entries) entry.incomplete = entry.incomplete === true;
}
function validateResponse(raw: unknown, id: string, allowed: string[]): WireResponse {
    const response = raw as Partial<WireResponse> | null;
    if (!response || response.protocolVersion !== 1 || typeof response.requestId !== 'string' || response.requestId.toLowerCase() !== id ||
        !allowed.includes(response.status ?? '') || typeof response.appVersion !== 'string' || typeof response.message !== 'string' ||
        (response.errorCode !== undefined && typeof response.errorCode !== 'string') ||
        (response.capabilities !== undefined && (!Array.isArray(response.capabilities) || !response.capabilities.every(value => typeof value === 'string')))) throw invalidResponse();
    return response as WireResponse;
}
function validateInput(input: OpenInput): void {
    if (!isAbsolute(input.vaultPath) || !input.vaultName.trim()) throw new Error('This plugin requires a local filesystem vault.');
    if (!validTimeZone(input.timeZone) || !validDate(input.startDate) || !validDate(input.endDate) || input.endDate < input.startDate) throw new Error('Choose a valid date range and time zone.');
}
async function privateDir(path: string): Promise<void> { await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700); }
const credentialPath = (vaultPath: string, root: string) => join(root, 'clients', `${createHash('sha256').update(vaultPath).digest('hex')}.json`);

export async function readCredential(vaultPath: string, root = bridgeRoot()): Promise<PairingCredential | null> {
    try {
        const text = await readFile(credentialPath(vaultPath, root), 'utf8');
        let saved: unknown;
        try { saved = JSON.parse(text); }
        catch { throw new BridgeError('INVALID_CREDENTIAL', 'The local vault credential is unavailable. Pair this vault again.'); }
        if (!credentialValid(saved) || (saved as PairingCredential & { vaultPath?: string }).vaultPath !== vaultPath) throw new BridgeError('INVALID_CREDENTIAL', 'The local vault credential is unavailable. Pair this vault again.');
        return { vaultKey: saved.vaultKey, pairingToken: saved.pairingToken, allowSync: saved.allowSync === true };
    } catch (error) { if (missing(error)) return null; throw error; }
}
export async function removeCredential(vaultPath: string, root = bridgeRoot()): Promise<void> { await rm(credentialPath(vaultPath, root), { force: true }); }
async function saveCredential(vaultPath: string, credential: PairingCredential, root: string): Promise<void> {
    await privateDir(root); await privateDir(join(root, 'clients'));
    const target = credentialPath(vaultPath, root), temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify({ vaultPath, ...credential }), { mode: 0o600, flag: 'wx' }); await rename(temporary, target); }
    finally { await rm(temporary, { force: true }); }
}
export async function sendBridgeRequest(input: OpenInput, action: 'open' | 'pair' | 'preview' | 'sync' | 'status' | 'info' | 'authorize' | 'configure' | 'unpair', extra: object, allowed: string[], options: BridgeOptions, requestId?: string): Promise<WireResponse> {
    validateInput(input); options.signal?.throwIfAborted();
    const root = options.root ?? bridgeRoot(), id = requestId ?? randomUUID().toLowerCase();
    const requestPath = join(root, 'inbox', `${id}.json`), temporaryPath = `${requestPath}.tmp`, responsePath = join(root, 'outbox', `${id}.json`);
    const request = { protocolVersion: 1, requestId: id, action, ...input, ...extra };
    for (const dir of [root, join(root, 'inbox'), join(root, 'outbox')]) await privateDir(dir);
    try {
        await writeFile(temporaryPath, JSON.stringify(request), { mode: 0o600, flag: 'wx' }); await rename(temporaryPath, requestPath);
        options.signal?.throwIfAborted();
        try { await options.launch(`${options.scheme ?? 'obsidianplanner'}://bridge/${action}?protocol=1&requestId=${id}`); }
        catch (error) { options.signal?.throwIfAborted(); if (error instanceof BridgeError) throw error; throw new BridgeError('APP_NOT_FOUND', options.scheme === 'obsidianplanner-helper' ? 'Could not start the bundled helper. Install the complete plugin 0.4.0 ZIP, including native/. No standalone App is required.' : 'Could not open ObsidianPlanner. Install and open the matching companion Mac app first.'); }
        const deadline = Date.now() + (options.timeoutMs ?? (action === 'pair' ? 120000 : 8000));
        let reportedPending = false;
        while (Date.now() < deadline) {
            options.signal?.throwIfAborted();
            try {
                const text = await readFile(responsePath, 'utf8');
                let raw: unknown;
                try { raw = JSON.parse(text); } catch { throw invalidResponse(); }
                const response = validateResponse(raw, id, allowed);
                if (response.status !== 'pending') return response;
                if (!reportedPending) { options.onPending?.(); reportedPending = true; }
            } catch (error) { if (!missing(error)) throw error; }
            await delay(options.pollMs ?? 150, undefined, { signal: options.signal });
        }
        throw new BridgeError('NO_CONFIRMATION', action === 'sync' || action === 'status'
            ? 'No confirmed sync result. The native job may still be running. Use Check last sync; do not submit the batch again.'
            : action === 'pair'
            ? options.scheme === 'obsidianplanner-helper' ? 'The helper did not confirm this connection. Refresh connection and try Connect this vault manually. No sync was performed.' : 'Pairing was not confirmed before the timeout. Check the Mac app and pair again manually. No sync was performed.'
            : options.scheme === 'obsidianplanner-helper' ? 'The bundled helper did not confirm the request. Reinstall the complete plugin 0.4.0 package and check macOS permission settings. No sync was reported.'
                : 'The Mac app did not confirm the request. It may be missing, still starting, or too old. Install the matching companion app and check its window. No sync was reported.');
    } finally { await Promise.all([requestPath, temporaryPath, responsePath].map(path => rm(path, { force: true }))); }
}
export async function openPlanner(input: OpenInput, options: BridgeOptions): Promise<OpenResponse> {
    return await sendBridgeRequest(input, 'open', {}, ['opened', 'needsVault', 'busy', 'failed'], options) as OpenResponse;
}
export async function pairPlanner(input: OpenInput, options: BridgeOptions, allowSync = false): Promise<PairResponse> {
    const response = await sendBridgeRequest(input, 'pair', allowSync ? { allowSync: true } : {}, ['pending', 'paired', 'failed', 'busy', 'needsSetup'], options) as PairResponse;
    if (response.status === 'paired') {
        if (!credentialValid(response.pairing)) throw invalidResponse();
        response.pairing.allowSync = response.pairing.allowSync === true;
        await saveCredential(input.vaultPath, response.pairing, options.root ?? bridgeRoot());
    }
    return response;
}
export async function previewPlanner(input: OpenInput, credential: PairingCredential, syncOptions: SyncOptions, options: BridgeOptions): Promise<PreviewResponse> {
    if (!credentialValid(credential)) throw new BridgeError('INVALID_CREDENTIAL', options.scheme === 'obsidianplanner-helper' ? 'Connect this vault before requesting a preview.' : 'Pair this vault before requesting a preview.');
    if (!validSyncOptions(syncOptions)) throw new Error('Choose valid destination and notification settings. Calendar notifications require calendar export.');
    const response = await sendBridgeRequest(input, 'preview', { vaultKey: credential.vaultKey, pairingToken: credential.pairingToken, options: syncOptions }, ['previewReady', 'failed', 'busy', 'needsSetup'], options) as PreviewResponse;
    if (response.status === 'previewReady') validatePreview(response.preview, input, credential, syncOptions);
    if (response.errorCode === 'VAULT_NOT_PAIRED') await removeCredential(input.vaultPath, options.root ?? bridgeRoot());
    return response;
}

const syncStatuses = ['running', 'completed', 'partial', 'interrupted', 'notFound', 'failed', 'busy', 'needsSetup'];
function validateJob(response: SyncResponse, requestId: string, vaultKey: string, previewId?: string): void {
    const job = response.job;
    if (!job) {
        if (['running', 'completed', 'partial', 'interrupted'].includes(response.status)) throw invalidResponse();
        return;
    }
    if (typeof job.requestId !== 'string' || job.requestId.toLowerCase() !== requestId || job.vaultKey !== vaultKey || (previewId && job.previewId !== previewId) ||
        typeof job.previewId !== 'string' || job.status !== response.status || !syncStatuses.includes(job.status) || typeof job.createdAt !== 'string' || typeof job.updatedAt !== 'string' || !Number.isFinite(Date.parse(job.createdAt)) || !Number.isFinite(Date.parse(job.updatedAt))) throw invalidResponse();
    const result = job.result;
    if (!result) { if (['completed', 'partial'].includes(response.status)) throw invalidResponse(); return; }
    if (!['completed', 'partial', 'failed'].includes(result.status) || typeof result.message !== 'string' ||
        (result.errorCode !== undefined && typeof result.errorCode !== 'string') || !result.counts ||
        !['calendarSaved', 'remindersSaved', 'skipped', 'failed', 'unresolved'].every(key => Number.isInteger(result.counts[key as keyof SyncResult['counts']]) && result.counts[key as keyof SyncResult['counts']] >= 0) ||
        !Array.isArray(result.items) || !result.items.every(item => item && typeof item.entryId === 'string' && typeof item.title === 'string' &&
            typeof item.date === 'string' && validDate(item.date) && ['create', 'update', 'addAgain', 'skip', 'conflict'].includes(item.action) &&
            ['saved', 'skipped', 'failed', 'unresolved'].includes(item.status) && typeof item.calendarSaved === 'boolean' && typeof item.reminderSaved === 'boolean' && typeof item.message === 'string')) throw invalidResponse();
}
async function recordResponse(run: RunPointer, response: SyncResponse, root: string): Promise<RunPointer> {
    run.status = !response.job && ['busy', 'needsSetup'].includes(response.status) ? 'failed'
        : ['running', 'completed', 'partial', 'failed', 'interrupted', 'notFound'].includes(response.status) ? response.status as RunPointer['status'] : 'unconfirmed';
    // Persist only the job DTO, never unexpected transport fields or credentials.
    const safe: SyncResponse = { protocolVersion: 1, requestId: response.requestId, status: response.status, appVersion: response.appVersion, message: response.message };
    if (response.errorCode !== undefined) safe.errorCode = response.errorCode;
    if (response.capabilities) safe.capabilities = [...response.capabilities];
    if (response.job) {
        const job = response.job;
        safe.job = { requestId: job.requestId, previewId: job.previewId, vaultKey: job.vaultKey, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt };
        if (job.result) {
            const result = job.result;
            safe.job.result = { status: result.status, message: result.message, ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
                counts: { calendarSaved: result.counts.calendarSaved, remindersSaved: result.counts.remindersSaved, skipped: result.counts.skipped, failed: result.counts.failed, unresolved: result.counts.unresolved },
                items: result.items.map(item => ({ entryId: item.entryId, title: item.title, date: item.date, action: item.action, status: item.status, calendarSaved: item.calendarSaved, reminderSaved: item.reminderSaved, message: item.message })) };
        }
    }
    run.response = safe;
    await writeRun(run, root);
    return run;
}
export async function syncPlanner(input: OpenInput, credential: PairingCredential, syncOptions: SyncOptions, preview: PreviewResult, selection: PlanSelection, options: BridgeOptions): Promise<SyncResponse> {
    validateInput(input);
    if (!credentialValid(credential) || credential.allowSync !== true || !preview.syncAllowed) throw new Error(options.scheme === 'obsidianplanner-helper' ? 'This connection is preview-only. Use Connect this vault to approve preview + sync for this independent plugin.' : 'This pairing is preview-only. Pair again with sync access and confirm it in the Mac app.');
    validatePreview(preview, input, credential, syncOptions); validateSelection(preview, selection);
    options.signal?.throwIfAborted();
    const root = options.root ?? bridgeRoot(), previous = await readRun(input.vaultPath, root);
    if (previous && runBlocksNewSync(previous)) throw new BridgeError('RUN_PENDING', 'A previous sync is unconfirmed or still running. Check last sync; do not submit it again.');
    const run: RunPointer = { version: 1, vaultPath: input.vaultPath, input: { ...input }, options: syncOptions, requestId: randomUUID().toLowerCase(), previewId: preview.previewId,
        vaultKey: credential.vaultKey, createdAt: new Date().toISOString(), status: 'unconfirmed', acknowledged: false };
    // Persist before even opening the App: a lost response must never cause resubmission.
    await writeRun(run, root);
    const response = await sendBridgeRequest(input, 'sync', { vaultKey: credential.vaultKey, pairingToken: credential.pairingToken, options: syncOptions, previewId: preview.previewId,
        choices: selection.choices, resolutions: selection.resolutions }, syncStatuses, options, run.requestId) as SyncResponse;
    validateJob(response, run.requestId, credential.vaultKey, preview.previewId);
    await recordResponse(run, response, root);
    return response;
}
export async function statusPlanner(input: OpenInput, credential: PairingCredential, syncRequestId: string, options: BridgeOptions): Promise<SyncResponse> {
    if (!credentialValid(credential) || !/^[a-f0-9-]{36}$/.test(syncRequestId)) throw new Error(options.scheme === 'obsidianplanner-helper' ? 'Connect this vault and choose a valid saved sync record before checking status.' : 'Pair this vault and choose a valid saved sync record before checking status.');
    const response = await sendBridgeRequest(input, 'status', { vaultKey: credential.vaultKey, pairingToken: credential.pairingToken, syncRequestId }, syncStatuses, options) as SyncResponse;
    const root = options.root ?? bridgeRoot(), run = await readRun(input.vaultPath, root);
    validateJob(response, syncRequestId, credential.vaultKey, run?.requestId === syncRequestId ? run.previewId : undefined);
    // A refused query says nothing about the original write; keep its recovery gate.
    if (run?.requestId === syncRequestId && (response.job || response.status === 'notFound')) await recordResponse(run, response, root);
    return response;
}
export async function waitForRun(run: RunPointer, credential: PairingCredential, options: BridgeOptions): Promise<SyncResponse | null> {
    const deadline = Date.now() + (options.statusTimeoutMs ?? 60000);
    let response: SyncResponse | null = null;
    do {
        options.signal?.throwIfAborted();
        response = await statusPlanner(run.input, credential, run.requestId, options);
        options.onUpdate?.(response);
        if (response.status !== 'running') return response;
        await delay(options.statusPollMs ?? 1200, undefined, { signal: options.signal });
    } while (Date.now() < deadline);
    return response;
}
