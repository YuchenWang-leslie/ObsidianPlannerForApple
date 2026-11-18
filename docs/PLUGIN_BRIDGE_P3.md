# Plugin sync protocol (P3–P5)

Implementation contract, 2026-11-18. App 0.5.0 / build 6, plugin 0.3.0, GitHub tag v0.5.0-beta.1. This extends protocol 1 and keeps open/pair/preview compatible. GitHub manual installation is the distribution target; community-directory submission is a separate future decision.

## Access and routes

URL: `obsidianplanner://bridge/{open|pair|preview|sync|status}?protocol=1&requestId=<UUID>`. Credentials and paths never appear in the URL. Existing `obsidianplanner://sync/...` item references remain inert.

Pair requests add `allowSync: true` only when the user requests preview-and-sync access. Native confirmation states that scope. Pairing records and credential responses add `allowSync` (missing means false). P2 read-only credentials keep working for preview and status but cannot sync; upgrading requires explicit new native pairing. Native access checks always use the stored scope, token and actual vault path.

Preview adds `syncAllowed: boolean`, `linkCandidates: [{id,date,title,startTime,endTime}]`; each entry adds `incomplete: boolean`. Candidates contain only the selected range's eligible history and no Apple identifiers. Match states/default choices retain P2 behavior. P3 preview IDs refer to an in-memory native snapshot, expire after 30 minutes or App restart, and cannot authorize a different vault/range/options. An expired snapshot requires a fresh preview.

## Sync request and result

A sync request retains the common P2 fields, credential and options, plus:

```text
previewId: UUID
choices: { <entryId>: "add" | "skip" | "update" | "addAgain" }
resolutions: { <conflictEntryId>: "skip" | "new" | <eligibleRecordId> }
```

The plugin creates one sync UUID, saves a private local run pointer before launch, and submits it once. Default new plans are Add, old plans Skip; conflicts default explicitly to Skip until the user chooses New or Link. Unsupported/unselected entries do not silently write. Choices clear after an executed batch or source/range/options changes. Add again deliberately preserves previous Apple items and targets the new copy on future updates.

The Mac app serializes native and plugin writes with one busy gate and one executor. A claimed sync UUID and preview ID are persisted before execution. Reusing a UUID with different input is rejected. Reusing the same claimed preview under a new UUID is rejected. Source files, Day Planner configuration, and history are rechecked before writing; stale source/history returns SOURCE_CHANGED with zero EventKit/history writes. Request dates/options must exactly match the reviewed preview.

Responses extend P2 with `running`, `completed`, `partial`, `interrupted`, `notFound`. Common response fields remain, plus optional `job`:

```text
{requestId,previewId,vaultKey,status,createdAt,updatedAt,result?}
result: {
  status: "completed" | "partial" | "failed", message, errorCode?,
  counts: {calendarSaved,remindersSaved,skipped,failed,unresolved},
  items: [{entryId,title,date,action,status,calendarSaved,reminderSaved,message}]
}
```

Item status: saved/skipped/failed/unresolved. Item action: create/update/addAgain/skip/conflict. Counts describe local saves, not iPhone delivery. Partial event/reminder saves are reported separately and persisted to the existing history. Retry incomplete entries with Update existing; never automatically Add again. Setup failures include PERMISSION_REQUIRED or APP_SETUP_REQUIRED. Old scope uses SYNC_NOT_ALLOWED; missing/expired/consumed previews use PREVIEW_EXPIRED/PREVIEW_USED. Unknown selection/request fields use INVALID_REQUEST. Request-ID payload collisions use REQUEST_ID_REUSED.

## Status, lifecycle and recovery

A status request has a new transport UUID, common vault/range/time-zone fields and credentials, plus `syncRequestId` for the original job. It never writes EventKit. Native job lookup verifies the vault identity and returns a persisted result. A running receipt with no active in-process operation is marked interrupted; no automatic recovery write occurs.

The plugin polls status for a bounded time, preserving the same original sync UUID. Timeout/closing/disable stops polling, not a native write already underway. The local run pointer survives reload; Check last sync queries status without submitting again. Unconfirmed/interrupted runs tell the user to inspect Apple items and request a fresh preview. No new request is automatically submitted. A user may acknowledge an interrupted/not-found run before starting a fresh reviewed batch.

Receipts live under private Bridge/jobs (0700/0600), contain no token or full note text, and are separate from deduplication history. Completed old receipts can be pruned after 14 days / beyond 200 entries; running receipts are retained. In-memory preview snapshots are bounded to 20 recent entries. Transport cleanup only removes that request's files. No exactly-once promise across process crashes or independent Apple transactions is made.

## Shared execution contract

PlannerCore adds value-only snapshot/input/result types, a Foundation-only `PlannerSyncExecutor`, and `PlannerExportBackend` protocol. Snapshot fingerprints cover the exact source/configuration bytes used for parsing, missing files and history. The executor plans with existing SyncMatcher/SyncSelection, rechecks after backend read preparation, persists prepared/copy records before writes and records each target save independently. Native EventKit implementation has no SwiftUI dependency; backend preparation reads/validates accounts and existing items without creating lists. Lists are created lazily during actual save after freshness checks. All-skipped batches return before backend setup.

Both native Sync and plugin Sync call this executor with immutable inputs. EventKit permissions/accounts remain native UI concerns. Fake-backend tests cover create/repeat/update/completion/copy/link/partial failure/retry/source and history changes without live account access; real test-Vault writes and iPhone arrival are validated separately.
