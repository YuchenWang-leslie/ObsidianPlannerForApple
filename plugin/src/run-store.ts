import { mkdir, chmod, writeFile, rename, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validDate, validTimeZone } from './range.ts';
import type { OpenInput, SyncOptions, SyncResponse } from './bridge-client.ts';
export type RunState = 'unconfirmed' | 'running' | 'completed' | 'partial' | 'failed' | 'interrupted' | 'notFound';
export interface RunPointer {
    version: 1; vaultPath: string; input: OpenInput; options: SyncOptions;
    requestId: string; previewId: string; vaultKey: string; createdAt: string;
    status: RunState; acknowledged: boolean; response?: SyncResponse;
}
const runPath = (vaultPath: string, root: string) => join(root, 'runs', `${createHash('sha256').update(vaultPath).digest('hex')}.json`);
const invalid = () => new Error('The saved sync record is unreadable. Inspect Apple items before starting another batch.');
function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function oneOf(value: unknown, values: readonly string[]): boolean { return typeof value === 'string' && values.includes(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string'); }
function timestamp(value: unknown): boolean { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function validInput(value: unknown): value is OpenInput {
    return record(value) && typeof value.vaultPath === 'string' && typeof value.vaultName === 'string' &&
        typeof value.startDate === 'string' && validDate(value.startDate) && typeof value.endDate === 'string' && validDate(value.endDate) &&
        value.startDate <= value.endDate && typeof value.timeZone === 'string' && validTimeZone(value.timeZone);
}
function validOptions(value: unknown): value is SyncOptions {
    if (!record(value) || typeof value.includeCalendar !== 'boolean' || !record(value.notification)) return false;
    const notice = value.notification;
    return oneOf(notice.channel, ['Reminders', 'Calendar', 'Both', 'None']) && typeof notice.minutes === 'number' &&
        Number.isInteger(notice.minutes) && notice.minutes >= 0 && notice.minutes <= 60 && notice.minutes % 5 === 0 &&
        (value.includeCalendar || (notice.channel !== 'Calendar' && notice.channel !== 'Both'));
}
const runStates = ['unconfirmed', 'running', 'completed', 'partial', 'failed', 'interrupted', 'notFound'];
const responseStates = ['running', 'completed', 'partial', 'failed', 'interrupted', 'notFound', 'busy', 'needsSetup'];
function validResponse(value: unknown, run: Record<string, unknown>): value is SyncResponse {
    if (!record(value) || value.protocolVersion !== 1 || typeof value.requestId !== 'string' || typeof value.appVersion !== 'string' ||
        typeof value.message !== 'string' || !oneOf(value.status, responseStates) ||
        (value.errorCode !== undefined && typeof value.errorCode !== 'string') || (value.capabilities !== undefined && !strings(value.capabilities))) return false;
    const expectedStatus = value.job === undefined && oneOf(value.status, ['busy', 'needsSetup']) ? 'failed' : value.status;
    if (run.status !== expectedStatus) return false;
    if (value.job === undefined) return !oneOf(value.status, ['running', 'completed', 'partial', 'interrupted']);
    const job = value.job;
    if (!record(job) || job.requestId !== run.requestId || job.previewId !== run.previewId || job.vaultKey !== run.vaultKey ||
        job.status !== value.status || !timestamp(job.createdAt) || !timestamp(job.updatedAt)) return false;
    if (job.result === undefined) return !oneOf(value.status, ['completed', 'partial']);
    const result = job.result;
    if (!record(result) || !oneOf(result.status, ['completed', 'partial', 'failed']) || typeof result.message !== 'string' ||
        (result.errorCode !== undefined && typeof result.errorCode !== 'string') || !record(result.counts) || !Array.isArray(result.items)) return false;
    const counts = result.counts;
    if (!['calendarSaved', 'remindersSaved', 'skipped', 'failed', 'unresolved'].every(key => typeof counts[key] === 'number' && Number.isInteger(counts[key]) && counts[key] >= 0)) return false;
    return result.items.every((item: unknown) => record(item) && typeof item.entryId === 'string' && typeof item.title === 'string' &&
        typeof item.date === 'string' && validDate(item.date) && oneOf(item.action, ['create', 'update', 'addAgain', 'skip', 'conflict']) &&
        oneOf(item.status, ['saved', 'skipped', 'failed', 'unresolved']) && typeof item.calendarSaved === 'boolean' &&
        typeof item.reminderSaved === 'boolean' && typeof item.message === 'string');
}
function validRun(value: unknown, vaultPath: string): value is RunPointer {
    return record(value) && value.version === 1 && value.vaultPath === vaultPath && validInput(value.input) && value.input.vaultPath === vaultPath &&
        validOptions(value.options) && typeof value.requestId === 'string' && /^[a-f0-9-]{36}$/.test(value.requestId) &&
        typeof value.previewId === 'string' && typeof value.vaultKey === 'string' && timestamp(value.createdAt) &&
        typeof value.acknowledged === 'boolean' && oneOf(value.status, runStates) && (value.response === undefined || validResponse(value.response, value));
}
export async function readRun(vaultPath: string, root: string): Promise<RunPointer | null> {
    let text: string;
    try { text = await readFile(runPath(vaultPath, root), 'utf8'); }
    catch (error) { if (record(error) && error.code === 'ENOENT') return null; throw error; }
    try {
        const value: unknown = JSON.parse(text);
        if (!validRun(value, vaultPath)) throw invalid();
        return value;
    } catch { throw invalid(); }
}
export async function writeRun(run: RunPointer, root: string): Promise<void> {
    for (const path of [root, join(root, 'runs')]) { await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o700); }
    const path = runPath(run.vaultPath, root), temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(run), { mode: 0o600, flag: 'wx' }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
}
export const runNeedsAcknowledgement = (run: RunPointer): boolean => ['unconfirmed', 'interrupted', 'notFound'].includes(run.status) && !run.acknowledged;
export const runBlocksNewSync = (run: RunPointer): boolean => run.status === 'running' || runNeedsAcknowledgement(run);
export async function acknowledgeRun(vaultPath: string, root: string): Promise<RunPointer> {
    const run = await readRun(vaultPath, root);
    if (!run || run.status === 'running') throw new Error('Check the running sync before starting another batch.');
    run.acknowledged = true; await writeRun(run, root); return run;
}
