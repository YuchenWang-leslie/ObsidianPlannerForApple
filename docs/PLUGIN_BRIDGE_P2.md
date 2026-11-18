# P2 local preview protocol

Implementation contract, 2026-11-18. P2 is read-only: pairing and preview never save EventKit items or sync history. P3 write actions remain unsupported.

## Transport and versions

The P1 fixed inbox/outbox transport and `protocolVersion: 1` remain. URL routes are `obsidianplanner://bridge/{open|pair|preview}?protocol=1&requestId=<UUID>`; no other query fields. P1 `open` behavior remains compatible. The local P2 App is 0.4.0 / build 5; companion plugin is 0.2.0. These are not public releases.

All requests contain the existing fields `protocolVersion`, `requestId`, `action`, `vaultPath`, `vaultName`, `startDate`, `endDate`, `timeZone`. Dates are inclusive YYYY-MM-DD. Preview additionally requires `vaultKey`, `pairingToken` and `options`:

```json
{"includeCalendar":false,"notification":{"channel":"Reminders","minutes":10}}
```

Channels are Reminders, Calendar, Both, None. Minutes are 0–60 in steps of 5, matching the native UI. Calendar/Both require includeCalendar=true. The Swift implementation validates all inputs; TypeScript does not parse Day Planner Markdown.

## Pairing

`pair` responds `pending` while the Mac app displays the exact vault path and asks the user to confirm. A different source must first be selected through its normal folder chooser. Selecting a folder alone does not approve pairing. The explicit **Pair this vault** button creates/rotates one local random credential for that vault and responds `paired`, with `pairing: {vaultKey, pairingToken}`. Dismissal is `failed / PAIRING_CANCELLED`. The plugin waits up to 120 seconds, can cancel on unload, and never silently retries. An expired request cannot be approved later.

The native store is `Bridge/pairings.json`, including an opaque security-scoped bookmark. The client stores credentials outside the vault under `Bridge/clients/<hash-of-client-vault-path>.json`; directories are 0700 and credential files 0600. Obsidian data.json contains preferences only. Re-pairing rotates the token without changing the existing path-derived sync identity. Native revocation removes only pairing, never history or exported items. No token appears in a URL, UI, source-control file or log.

`preview` verifies the token and actual requested vault path. Native code resolves the paired bookmark, preserves the confirmed path used by existing history, activates that source in the App and applies the supplied dates/options. A moved vault is not silently assigned a new history identity. Names alone never identify vaults.

Repeating a completed P2 request ID requires identical request input. A preview still verifies current pairing before returning its cached result; a reused ID with changed input is rejected with INVALID_REQUEST. A cached pairing response is not returned merely because an ID-only URL is opened after its request file was removed.

## Responses

Common fields: `protocolVersion`, `requestId`, `status`, `appVersion`, `message`; optional `errorCode`, `pairing`, `preview`, `capabilities`. Capabilities are `open`, `pair`, `preview`. Statuses extend P1 with `pending`, `paired`, `previewReady`, `needsSetup`. Failures use `VAULT_NOT_PAIRED`, `APP_SETUP_REQUIRED`, `PAIRING_CANCELLED`, `INVALID_REQUEST`, `PREVIEW_FAILED` where appropriate. Busy requests return `busy` without changing the source.

A successful `previewReady` includes `preview`:

```text
previewId, vaultKey, vaultName, startDate, endDate, timeZone, options,
entries: [{id, filePath, line, date, title, start, end, startTime, endTime,
           completed, action, selectedAction, reason}],
issues: [string],
counts: {create, update, unchanged, conflict, skipped}
```

`start`/`end` are ISO-8601 instants; `startTime`/`endTime` are HH:mm in the explicit schedule time zone. `filePath` is vault-relative and `line` is one-based. `action` is the match state create/update/unchanged/conflict; `selectedAction` is the default create/skip/conflict. The UI shows matching state and Skipped separately so existing changed schedules remain visibly changed while defaulting to Skip. Counts of skipped overlap match-state counts.

The preview ID identifies this read-only result, not a P3 authorization. Source text is read from disk; save editor changes first. Clicking a result opens the source note at its line without modifying it. Preview returns parser issues for unsupported tasks. It does not return full history, bookmark data or credentials.

## Shared native execution

A Foundation-only preview entry point in PlannerCore reads root daily notes and Day Planner heading configuration, loads the existing history, parses with DayPlannerParser, matches with SyncMatcher and derives defaults with SyncSelection. Both the native Preview button and bridge preview use it. History path hashing and JSON format remain unchanged. EventKit execution stays native and is not exposed by this protocol.
