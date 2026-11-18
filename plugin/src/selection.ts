import type { PreviewResult } from './bridge-client.ts';
export type PlanChoice = 'add' | 'skip' | 'update' | 'addAgain';
export interface PlanSelection { choices: Record<string, PlanChoice>; resolutions: Record<string, string> }
export function initialSelection(preview: PreviewResult): PlanSelection {
    const choices: PlanSelection['choices'] = {}, resolutions: PlanSelection['resolutions'] = {};
    for (const entry of preview.entries) {
        if (entry.action === 'conflict') resolutions[entry.id] = 'skip';
        else choices[entry.id] = entry.action === 'create' ? 'add' : 'skip';
    }
    return { choices, resolutions };
}
export function validateSelection(preview: PreviewResult, selection: PlanSelection): void {
    const entries = new Map(preview.entries.map(entry => [entry.id, entry]));
    for (const [id, choice] of Object.entries(selection.choices)) {
        const entry = entries.get(id);
        if (!entry || entry.action === 'conflict' || !['add', 'skip', 'update', 'addAgain'].includes(choice) ||
            (entry.action === 'create' && !['add', 'skip'].includes(choice)) ||
            (entry.action !== 'create' && choice === 'add')) throw new Error('Review the choices in a fresh preview before syncing.');
    }
    const candidates = new Set(preview.linkCandidates.map(candidate => candidate.id));
    for (const [id, resolution] of Object.entries(selection.resolutions)) {
        if (entries.get(id)?.action !== 'conflict' || !['skip', 'new'].includes(resolution) && !candidates.has(resolution)) throw new Error('Choose Skip, New, or an eligible link for each conflict.');
    }
    for (const entry of preview.entries) {
        if (entry.action === 'conflict' ? selection.resolutions[entry.id] === undefined : selection.choices[entry.id] === undefined) throw new Error('Every plan needs an explicit choice before syncing.');
    }
}
export function selectedCount(preview: PreviewResult, selection: PlanSelection): number {
    return preview.entries.filter(entry => entry.action === 'conflict' ? selection.resolutions[entry.id] !== 'skip' : selection.choices[entry.id] !== 'skip').length;
}
