import { mkdir, chmod, writeFile, rename, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { OpenInput, SyncOptions, SyncResponse } from './bridge-client.ts';
export type RunState = 'unconfirmed' | 'running' | 'completed' | 'partial' | 'failed' | 'interrupted' | 'notFound';
export interface RunPointer {
    version: 1; vaultPath: string; input: OpenInput; options: SyncOptions;
    requestId: string; previewId: string; vaultKey: string; createdAt: string;
    status: RunState; acknowledged: boolean; response?: SyncResponse;
}
const runPath = (vaultPath: string, root: string) => join(root, 'runs', `${createHash('sha256').update(vaultPath).digest('hex')}.json`);
const invalid = () => new Error('The saved sync record is unreadable. Inspect the Mac app before starting another batch.');
export async function readRun(vaultPath: string, root: string): Promise<RunPointer | null> {
    try {
        let value: RunPointer;
        try { value = JSON.parse(await readFile(runPath(vaultPath, root), 'utf8')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw invalid(); }
        if (!value || value.version !== 1 || value.vaultPath !== vaultPath || value.input?.vaultPath !== vaultPath ||
            typeof value.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.requestId) ||
            typeof value.previewId !== 'string' || typeof value.vaultKey !== 'string' ||
            typeof value.createdAt !== 'string' || typeof value.acknowledged !== 'boolean' ||
            !['unconfirmed', 'running', 'completed', 'partial', 'failed', 'interrupted', 'notFound'].includes(value.status)) throw invalid();
        return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
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
