import { mkdir, writeFile, rename, readFile, rm, chmod } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { validDate, validTimeZone } from './range.ts';
import type { DateRange } from './range.ts';

export interface OpenRequest extends DateRange {
    protocolVersion: 1;
    requestId: string;
    action: 'open';
    vaultPath: string;
    vaultName: string;
    timeZone: string;
}
export interface OpenResponse {
    protocolVersion: 1;
    requestId: string;
    status: 'opened' | 'needsVault' | 'busy' | 'failed';
    appVersion: string;
    message: string;
}
export interface OpenInput extends DateRange { vaultPath: string; vaultName: string; timeZone: string }
export interface BridgeOptions {
    root?: string;
    launch: (url: string) => Promise<void>;
    timeoutMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
}
export class BridgeError extends Error {
    readonly code: 'APP_NOT_FOUND' | 'NO_CONFIRMATION' | 'INVALID_RESPONSE';
    constructor(code: 'APP_NOT_FOUND' | 'NO_CONFIRMATION' | 'INVALID_RESPONSE', message: string) { super(message); this.code = code; }
}
export const bridgeRoot = () => join(homedir(), 'Library', 'Application Support', 'ObsidianPlanner', 'Bridge');

function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function validateResponse(raw: unknown, id: string): OpenResponse {
    const response = raw as Partial<OpenResponse> | null;
    if (!response || response.protocolVersion !== 1 || typeof response.requestId !== 'string' || response.requestId.toLowerCase() !== id ||
        !['opened', 'needsVault', 'busy', 'failed'].includes(response.status ?? '') ||
        typeof response.appVersion !== 'string' || typeof response.message !== 'string') {
        throw new BridgeError('INVALID_RESPONSE', 'The Mac app returned an incompatible response. Install a matching P1 companion app.');
    }
    return response as OpenResponse;
}

export async function openPlanner(input: OpenInput, options: BridgeOptions): Promise<OpenResponse> {
    if (!isAbsolute(input.vaultPath) || !input.vaultName.trim()) throw new Error('This plugin requires a local filesystem vault.');
    if (!validTimeZone(input.timeZone) || !validDate(input.startDate) || !validDate(input.endDate) || input.endDate < input.startDate) throw new Error('Choose a valid date range and time zone.');
    options.signal?.throwIfAborted();
    const root = options.root ?? bridgeRoot();
    const id = randomUUID().toLowerCase();
    const requestPath = join(root, 'inbox', `${id}.json`);
    const temporaryPath = `${requestPath}.tmp`;
    const responsePath = join(root, 'outbox', `${id}.json`);
    const request: OpenRequest = { protocolVersion: 1, requestId: id, action: 'open', ...input };
    for (const dir of [root, join(root, 'inbox'), join(root, 'outbox')]) {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await chmod(dir, 0o700);
    }
    try {
        await writeFile(temporaryPath, JSON.stringify(request), { mode: 0o600, flag: 'wx' });
        await rename(temporaryPath, requestPath);
        options.signal?.throwIfAborted();
        try { await options.launch(`obsidianplanner://bridge/open?protocol=1&requestId=${id}`); }
        catch (error) {
            options.signal?.throwIfAborted();
            throw new BridgeError('APP_NOT_FOUND', 'Could not open ObsidianPlanner. Install and open the P1 Mac companion app first.');
        }
        const deadline = Date.now() + (options.timeoutMs ?? 8000);
        while (Date.now() < deadline) {
            options.signal?.throwIfAborted();
            try { return validateResponse(JSON.parse(await readFile(responsePath, 'utf8')), id); }
            catch (error) { if (!isMissing(error)) throw error; }
            await delay(options.pollMs ?? 150, undefined, { signal: options.signal });
        }
        throw new BridgeError('NO_CONFIRMATION', 'The Mac app did not confirm opening. It may be missing, still starting, or too old. Install the matching P1 app and check its window. Nothing was reported as synced.');
    } finally {
        // Only this request's files are removed; sync history is never touched.
        await Promise.all([requestPath, temporaryPath, responsePath].map(path => rm(path, { force: true })));
    }
}
