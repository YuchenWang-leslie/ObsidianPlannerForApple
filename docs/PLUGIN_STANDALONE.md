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
- Independent-helper live acceptance is recorded below. Earlier App/companion results are not counted as this helper's live acceptance. Remote CI has not been counted as passed.
- Actual helper process 18650 exited after idle; a later `info` request started process 18727 and returned ready/0.4.0. This confirms basic idle/cold-launch lifecycle, not yet persisted-preview or sync-result recovery.
- At preflight, the five original App bundle files were byte-identical and all four existing history files unchanged. After live acceptance only the isolated test-vault history changed. The existing App/Core sources, App plist/package and App build script have no diff.

### Independent-helper live acceptance — passed locally

- The user opened the isolated test vault, connected it and granted the new helper Reminders full access. Calendar remained notDetermined. The plugin selected the available iCloud Reminders source independently.
- Real Obsidian Preview showed four plans: three existing records unchanged/default Skip, one new/default Add. Clicking Sync selected created one reminder, zero Calendar events, and skipped the three existing plans with no failures. The full ObsidianPlanner App was not running.
- Re-preview defaulted all four plans to Skip. Native status retrieved the completed create receipt. Exact request UUID replay returned the original result and a changed request using the same UUID was rejected with REQUEST_ID_REUSED; history bytes did not change.
- An unavailable Reminders source returned actionable APP_SETUP_REQUIRED, a bad pairing token returned VAULT_NOT_PAIRED without replacing the saved run, and an unknown request returned notFound. These checks made no additional Apple/history writes.
- Editing the fake note after preview caused SOURCE_CHANGED with zero destination saves and identical history bytes. The fixture was restored and a fresh preview saved for idle/restart testing.
- Helper process 19502 then exited. Cold process 19752 accepted that persisted preview: all four Skip choices completed with zero Apple saves and byte-identical history. The initial completed create receipt was also recovered after restart.
- Real helper writes tested explicit Update on the older completed fake plan (stable record/reminder/event IDs), Add again (a new completed reminder, old record marked superseded), and an ambiguous title/time edit resolved by explicit Link (reused the latest reminder ID). Other plans, including the then-active iPhone-notification fixture, stayed skipped.
- The user granted the helper's separate Calendar permission and both entity-specific sources selected iCloud. The plugin saved the new fake Calendar plan as one event + one reminder, skipping all four older plans. A subsequent explicit quiet Update retained both Apple IDs and disabled its future alarms; the initial phone reminder stayed unchanged.
- The user replied “可以了” to the requested iPhone Reminders arrival/17:20-notification/completion check, and “正确” to the separate iPhone Calendar visibility/time check for 17:45–18:05. These are this independent helper's results.
- Real host checks passed reopening the modal, source-note opening at the requested line, plugin disable/re-enable, test-vault window close/reopen and Check last sync. Pairing, settings and the same completed result persisted; history and fixture note bytes did not change. The two overlap warnings after adding the Calendar fixture were expected.
- The existing work-vault plugin was backed up and updated to 0.4.0. The user explicitly connected it to the helper. Read-only preview returned 11 plans, 10 default Skip and one new default Add; no work-vault sync was submitted. All 56 daily-note hashes, preferences, enabled-plugin set and original sync history were unchanged. Other non-test histories and the original App bundle also remained unchanged.
- Actual environment: Apple silicon, macOS 27.0.1, Obsidian 1.15.1, Node 24.14.1, Apple Swift 6.4. No full App process was running throughout independent-helper acceptance. Test-vault preferences were restored to Reminders-only/no notifications.
- Not exercised: other-machine first launch/Gatekeeper, other system versions or Intel, full Obsidian process restart, deliberate live OS permission denial/revocation and partial EventKit failure. Existing core fake-backend tests cover partial-write paths; no strict crash exactly-once claim is made.
