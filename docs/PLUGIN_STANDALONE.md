# Independent plugin implementation

2026-11-18. Plugin 0.4.0; existing standalone App stays 0.5.0/build 6 and its source/bundle are unchanged. This supersedes the companion-only product scope for the new plugin. GitHub manual ZIP distribution remains the target.

## Product and ownership

Install either the plugin or the existing App. The plugin includes a small macOS agent bundle (`LSUIElement`, no main window or Dock item); users do not separately install ObsidianPlanner.app. Apple permission prompts still require consent. Accounts, notifications, preview, per-plan choices and results are managed in Obsidian. No automatic sync or note writes.

Reuse PlannerCore and compile the existing `Sources/ObsidianPlanner/EventKitExportBackend.swift` into the helper without editing that file or rebuilding the standalone App. A plugin-specific build script can compile PlannerCore as a static module, then link the helper and existing backend. Existing App build/package scripts remain for the older App release.

Plugin bundle: five normal distribution files plus `native/DayPlannerAppleSyncHelper.app`. Install the helper at a canonical private runtime path shared by vaults: `~/Library/Application Support/ObsidianPlanner/PluginRuntime/0.4.0/DayPlannerAppleSyncHelper.app`. Launch this exact path using `/usr/bin/open -g -a <bundle> <requestURL>`; never open the standalone App's scheme or use Electron's foreground openExternal.

Helper bundle ID `com.obsidianplanner.pluginhelper`, executable `DayPlannerAppleSyncHelper`, URL scheme `obsidianplanner-helper`. Version 0.4.0. New code/signature permissions need separate real-device acceptance before publication. Do not change Obsidian's Info.plist, weaken Gatekeeper globally, or delete old credentials/history.

## Wire contract

Private transport root: `~/Library/Application Support/ObsidianPlanner/PluginBridge` (0700; files 0600). Inbox/outbox by UUID. URL: `obsidianplanner-helper://bridge/<action>?protocol=1&requestId=<UUID>`. Only version and UUID are in URLs. JSON common input is unchanged from P3: protocolVersion, requestId, action, vaultPath, vaultName, startDate, endDate, timeZone. Keep the existing preview, pairing and sync/job DTOs, including the legacy `appVersion` response field (reports helper version here).

Actions:

- `info`: no credentials required; returns `status: ready` and `state` below. No permission request or Apple writes.
- `pair`: explicit Connect this vault click; uses P3 allowSync and returns `paired` + pairing credential. Approval is within the plugin rather than another App window. Native helper stores a bookmark for that exact local vault. No Apple writes. Fresh credentials are stored in PluginBridge/clients, never copied from the App's Bridge.
- `authorize`: paired input plus `entity: reminders | calendar`; only requests that entity's system access. Returns ready/state if granted, needsSetup/state if denied.
- `configure`: paired input plus optional `reminderSourceID`, `calendarSourceID`; verifies against current eligible entity-specific sources and saves helper-local settings. Returns ready/state. Account IDs are not written to vault data.json.
- `unpair`: paired input; revokes helper pairing and returns ready. Keeps all Apple objects, history and job receipts.
- `preview`, `sync`, `status`: preserve P3 required fields, choices/resolutions, original sync UUID and result formats. Existing TypeScript client can reuse these using an injected helper scheme/root/launcher. No standalone App fallback.

`state` has `remindersPermission`, `calendarPermission` (notDetermined/denied/restricted/fullAccess/writeOnly), `reminderSources`, `calendarSources` (arrays of `{id,title}`), `reminderSourceID`, `calendarSourceID` (strings, empty when unselected). Only enumerate an entity after its access is granted. Only one available source may be auto-selected; do not conflate event/reminder iCloud IDs.

Setup actions use the same response identity/version/message fields, `capabilities` and optional errorCode as P3, plus state. The helper handles only known UUID actions from private request files; size/identity validation remains bounded and errors never echo tokens. This local credential mechanism does not isolate malicious same-user processes.

## Reuse and lifecycle

Shared deduplication history stays at the existing ObsidianPlanner root and retains the same standardized absolute-path SHA-256 keys and SyncRecord schema. Preview, parsing/matching/choices and writes use PlannerPreviewEngine/PlannerSyncExecutor. Destination settings use the helper's own standard defaults domain. Preserve existing Apple identities and independent notification history.

Preview contexts persist under PluginBridge/previews: previewId, PlannerPreviewInput, PlannerPreviewSnapshot, createdAt, reminderSourceID, calendarSourceID. They expire after 30 minutes; no source text/token is stored. On sync verify current accounts and exact input, then let the executor recheck source/config/history. Changing accounts requires a fresh preview.

Reuse PairingStore and SyncJobLedger under PluginBridge, separate from the App's Bridge. Persist running receipts before writes; repeat UUIDs return their result, mismatched input and preview reuse fail. Preserve a private token-free run pointer before submission; query after timeout/reload, never blind retry. Partial/interrupted results require inspection and Update existing as appropriate.

The helper is a no-window AppKit agent, launches on demand, and can terminate after 60 seconds idle, never during an active permission request or sync. Persisted previews/results survive idle exit. Use a small nonblocking helper write lock to prevent multiple helper instances writing the shared history simultaneously. The existing App does not participate in that lock; do not execute App and plugin sync concurrently. No strict cross-crash exactly-once guarantee.

## Acceptance and delivery

1. Build bundled helper without touching/rebuilding the App; verify signature, LSUIElement, privacy strings, no private build paths.
2. Validate info/pair/preview lifecycle with App quit; obtain explicit OS permission for the new helper and test entity-specific source selection from the plugin.
3. Use a fresh fake-plan vault for create/repeat/Update/Skip/copy/link, stale input and status after idle/restart. Existing history reuse is read-only in the main vault until the user requests actual writes.
4. Test plugin reload and isolated-vault host UI; preserve work-vault notes and existing settings. Do not develop against the main vault.
5. Package only the new plugin + checksum. Keep the published App ZIP and App release untouched. Update README/changelog/release notes and push after checks. Publish a separate plugin release; do not replace v0.5.0-beta.1 assets.

Other system versions, Intel, community-directory submission and Apple notarization are outside this iteration.

## Validation record — 2026-11-18

- Shared Swift core checks passed, including legacy history, matching/copy/link, real input snapshot checks and job receipts.
- 30 helper protocol/storage checks and a signed `.app` startup smoke passed. The actual LaunchServices helper `info` route returned 0.4.0/ready, independently of the full App, with both Apple permissions initially notDetermined.
- 59 plugin tests, TypeScript checking and production build passed. Regression tests first reproduced, then verified fixes for setup errors lacking a state DTO and refused status queries wrongly clearing the previous job's recovery gate.
- Plugin-only packaging passed the native signature/metadata/version, precise nine-file inventory, private path/credential, license and archive/checksum checks. Installation from this ZIP retained the native executable's permission and valid signature.
- The first actual helper launch exposed a constructor crash: Foundation rejects using an application's own bundle ID as a suite name. The helper now uses its own `UserDefaults.standard` domain. A real signed-bundle startup smoke covers the cause; a CLI protocol test alone did not detect it.
- New-helper test-vault permissions and real EventKit/iPhone acceptance are pending. Earlier App/companion results are not counted as independent-plugin live acceptance. Remote CI has not been counted as passed.
- Actual helper process 18650 exited after idle; a later `info` request started process 18727 and returned ready/0.4.0. This confirms basic idle/cold-launch lifecycle, not yet persisted-preview or sync-result recovery.
- The five original App bundle files remain byte-identical and all four existing history files are unchanged. The existing App/Core sources, App plist/package and App build script have no diff.
