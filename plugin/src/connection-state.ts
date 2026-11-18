import type { PairResponse } from './bridge-client.ts';
export function pairingStatusMessage(response: PairResponse, requestedSync: boolean): string {
    if (response.status !== 'paired') return response.message;
    if (requestedSync && !response.pairing?.allowSync) {
        return response.capabilities?.includes('sync')
            ? 'A preview-only credential was saved. Sync access was not approved. Pair again with sync access and confirm that scope in the Mac app.'
            : 'This Mac app does not report sync pairing support. Install ObsidianPlanner 0.5.0 or a compatible app, then pair for preview + sync. The saved credential is preview-only.';
    }
    return `Credential saved on this Mac (${response.pairing?.allowSync ? 'preview + sync' : 'preview only'}). Request a preview to verify access.`;
}
