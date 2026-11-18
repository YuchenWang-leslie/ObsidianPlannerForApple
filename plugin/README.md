# Day Planner Apple Sync

Preview Day Planner notes inside Obsidian, choose an action for each plan, and sync the reviewed selection to **Apple Reminders** with optional **Calendar** events. The separately installed ObsidianPlanner Mac app handles parsing, history, permissions and Apple writes. iPhone uses iCloud; it does not need this plugin or the whole vault.

**Plugin 0.3.0 · App 0.5.0 / build 6 · bridge protocol 1 · release v0.5.0-beta.1.** GitHub manual-install beta; not listed in the Obsidian community directory. The App can also run by itself.

Source-available under **MIT subject to Commons Clause v1.0**, including its sale restrictions. Read the complete [LICENSE](LICENSE) before redistributing or selling anything based on this code.

## Install

1. Download the matching Mac App and `day-planner-apple-sync-0.3.0.zip` from [GitHub Releases](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases). Use the App from the same release: older public Apps cannot perform this plugin’s sync flow.
2. Put `ObsidianPlanner.app` in Applications and open it once. This beta has no Developer ID signature or Apple notarization; follow the [project’s installation instructions](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple#安装与首次打开). The plugin does not download or include native code.
3. Disable the previous plugin, if installed. Extract the ZIP’s `day-planner-apple-sync/` folder into `<vault>/.obsidian/plugins/`. The result must contain `.obsidian/plugins/day-planner-apple-sync/main.js` alongside `manifest.json`, `styles.css`, `README.md` and `LICENSE`.
4. In Obsidian Settings → Community plugins, enable **Day Planner Apple Sync**. Restart Obsidian if it has not discovered the folder. Start with a disposable test vault and a few fake plans.
5. When updating, replace those five distribution files. Keep Obsidian `data.json` and the Mac App’s Application Support directory. Never copy pairing credentials into the vault.

The released App is for Apple silicon, with a macOS 14 minimum build target. The plugin supports desktop Obsidian on macOS only, requires a filesystem vault, and rejects Windows/Linux at runtime. Manifest minimum Obsidian is 1.5.0; that does not mean every intervening version has been tested. See the parent project’s compatibility and acceptance records.

## First connection

Click the calendar/clock ribbon icon or run **Open Apple sync**.

- Review the current vault’s name and exact path in **Connection & access**. Names alone do not identify vaults.
- Click **Pair for preview + sync…**. In the Mac App, verify the requested vault and scope. If needed, choose the vault with its normal folder chooser, then explicitly click its **Pair this vault** confirmation. Selecting a folder alone does not authorize access.
- The plugin waits up to 120 seconds. **Local preview + sync credential** means a credential was saved on this Mac; a successful preview is the access verification. The last verified preview time is session-specific.
- For read-only use, turn off **Request sync access** and choose **Pair for preview only…**. Existing P2 credentials are preview-only. Sync requires a new, explicit native confirmation; an upgrade does not silently grant write access.
- Open Mac app to grant Reminders access and select the intended writable account, usually iCloud. Calendar permission/account is also needed when Calendar export is enabled. These permissions stay in the Mac App. Pairing alone does not sync anything.

If the App does not report sync support, install the matching App rather than repeatedly pairing an older version. Missing/old App, busy, setup and permission responses include actionable guidance; **Open Mac app** remains available.

## Preview and sync

1. **Save editor changes first.** The App reads daily notes on disk; the plugin does not force-save or edit note text.
2. Select **This week**, **Next week** or an inclusive **Custom** range. Weeks run Monday–Sunday in the selected schedule time zone. Past dates are allowed.
3. Expand Options to choose an IANA time zone, destinations and notifications. Defaults are **Reminders only**, Calendar off, and a **10-minute Reminders notification**. Calendar is optional. Notification channels are Reminders, Calendar, Both or None; Calendar/Both require Calendar enabled. Lead time is 0–60 minutes in 5-minute steps.
4. Click **Preview saved plans**. Plans are grouped by date, with Create/Update/Unchanged/Conflict match badges, separate Skipped state and parser issues. **Incomplete** flags an export with a missing target; use Update existing to retry it after inspecting the Apple items.
5. Review each row’s operation, then click **Sync selected (N)** to submit that exact reviewed batch once.

| Plan state | Default | Available decision |
| --- | --- | --- |
| New | Add | Add or Skip |
| Previously exported, including changed/incomplete | Skip | Skip, Update existing, Add again |
| Ambiguous match | Skip conflict | Skip, New, or Link to an eligible record in the selected range |

**Update existing** applies the note’s title, times, completion state and chosen notification settings to the associated export. **Add again** keeps previous Apple items and makes the new copy the target for future updates. Use it only when you intentionally want another copy. Do not use it as an automatic retry after partial failure.

Click a source label such as `2026-11-18.md:5` to open that note at its one-based line. Source links never change the text. Unsupported tasks appear as parser issues; they do not silently become Apple items.

Results show local Calendar and Reminders saves independently, plus skipped, failed and unresolved counts and per-plan outcomes. A successful local save is **not confirmation of iPhone arrival**. Check iCloud delivery and notifications separately.

Selections and the displayed preview clear after submission or range/options changes. Native previews expire after 30 minutes or App restart, and cannot be used for a different vault, range or options. If source files, Day Planner configuration or history changed, the App returns SOURCE_CHANGED before writing; request a fresh preview. PREVIEW_EXPIRED/PREVIEW_USED also require a fresh review. Nothing syncs automatically.

## Recovery: check rather than resend

The plugin saves one private original request ID **before** launching sync. A timeout, closing the modal, **Stop waiting**, disabling the plugin or restarting Obsidian stops polling; it does **not** guarantee cancellation of a native job that already started.

Use **Check last sync** to query that original request. It never submits the batch again. Status polling is bounded, and the saved run pointer survives reload and timeout.

- **Running:** check again or inspect the App. Do not resend.
- **Completed:** review local-save counts and any skipped plans.
- **Partial/failed:** inspect each target result. Open Mac app to fix account/permission setup if requested. Request a fresh preview and select **Update existing** for incomplete associated plans. Previous successful saves stay recorded.
- **Unconfirmed/interrupted/not found:** inspect Apple Reminders/Calendar before proceeding. The explicit **I checked Apple items — start fresh** button acknowledges the uncertainty; it does not submit anything. Then request and review a fresh preview. A running job cannot be acknowledged as finished.
- **Busy/setup rejection before a job was claimed:** the response is recorded as a confirmed local failure, rather than an unknown write outcome. Correct setup and start from a fresh preview.

There is no automatic resend or promise of exactly-once writes across an App crash and independent Apple transactions. The App persists receipts and per-target history to make the outcome inspectable.

## Commands and saved preferences

| Command | Behavior |
| --- | --- |
| Open Apple sync | Open the planner using saved range preferences |
| Preview this week / Preview next week | Open and preview that week if locally paired |
| Choose sync range | Open Custom mode |
| Open Mac app | Open-only handoff with the current week and time zone |
| Check last sync | Query the saved original run without submitting again |

Options, time zone, range mode and valid custom dates are saved as preferences. Local scope/credential state and last verified preview are shown separately. In Settings, **Forget on this Mac** removes only the client credential. Native access must be revoked in the App; neither action deletes exported items, sync history or the last-run record.

## Private local files

Obsidian plugin `data.json` contains preferences only: time zone, range mode, custom dates and destination/notification options. It contains **no token, preview payload or run pointer**.

Private files live outside the vault under:

```text
~/Library/Application Support/ObsidianPlanner/Bridge/
  clients/<sha256-of-exact-client-vault-path>.json
  runs/<sha256-of-exact-client-vault-path>.json
  inbox/<transport-request-id>.json
  outbox/<transport-request-id>.json
```

Client credentials include the path, opaque vault key, pairing token and explicit sync scope. A run pointer contains the original sync UUID, reviewed preview ID, non-secret request context and confirmed result; it never contains the token. Different paths remain distinct even if display names match. Directories are 0700, files created by the plugin are 0600, and writes are atomic. Re-pairing rotates the native token while preserving the existing native history identity.

The Mac App separately stores bookmark-backed pairings and token-free job receipts. Requests include the path/name, dates and time zone; preview/sync include credentials and options. Sync adds explicit selections and the reviewed preview ID. Status uses a new transport UUID with the original syncRequestId.

Only protocol version and transport UUID appear in `obsidianplanner://bridge/{open|pair|preview|sync|status}` URLs. Tokens, paths and titles do not. Tokens are not displayed or logged. The plugin removes only its own transport files after each attempt; it does not delete job receipts or history. Late responses may remain after timeout. No server, listening port, telemetry or background sync is introduced.

## Build and verify

From `plugin/`, with Node.js 24+ and npm:

```sh
npm ci
npm test
npm run typecheck
npm run package
```

The package is `dist/day-planner-apple-sync-0.3.0.zip`. `npm run build` produces the five unpackaged files in `dist/`. Dependencies are pinned in `package-lock.json`; no third-party runtime library or native binary is bundled. Runtime Obsidian, Electron and Node APIs come from the desktop host.

Automated tests use temporary directories and fake URL launches. They cover year/DST/date boundaries, pairing scope, private file modes, exact matching/options, per-row choices, conflict links, persistent pre-launch run IDs, token-safe results, status identity, lost-response recovery, bounded polling and cancellation without resubmission. They do not exercise real Apple permissions, actual Obsidian UI or iPhone delivery.

The parent project records native/host acceptance and release validation. Before using real plans, verify explicit human pairing, a small create/update/copy/conflict batch, partial-result recovery and iPhone arrival in a test vault.
