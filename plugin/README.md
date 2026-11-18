# Day Planner Apple Sync — P1 companion plugin

**Local P1 prototype for Obsidian on macOS.** This plugin opens the companion Mac app with the current vault context and selected dates. It does not write Calendar events or Reminders, and it does not report a successful sync.

This is source-available software under **MIT subject to Commons Clause v1.0**. See the complete [LICENSE](LICENSE).

## Requirements

- macOS desktop Obsidian. The manifest minimum is 1.5.0; the implemented API surface uses the desktop plugin API and still needs the host-version checks recorded by the parent project.
- A matching local **ObsidianPlanner 0.3.0 P1 app with bridge protocol 1**. Published v0.2.0-beta.1 and older versions do not support this handoff.
- A local filesystem vault, and the separately installed companion app. The plugin never downloads or installs native code.
- Apple account permissions are handled in the Mac app when the user chooses to sync there. P1 handoff does not request those permissions.

The iPhone continues to use Apple Reminders or Calendar through iCloud. This plugin is desktop-only, and explicitly rejects Windows/Linux at runtime.

## Build

From this directory, with Node.js 24+ and npm:

```sh
npm ci
npm test
npm run build
npm run package
```

`dist/` contains `main.js`, `manifest.json`, optional styles, the combined license and this README. The package command creates `dist/day-planner-apple-sync-0.1.0-P1.zip` containing a `day-planner-apple-sync/` folder. No Node modules, native executable or personal vault files are included.

`npm run typecheck` can be run separately. Dev dependencies are pinned and recorded in `package-lock.json`; there are no bundled third-party runtime libraries. The built plugin relies on Obsidian, Electron and Node APIs provided by the desktop host.

## Manual installation in a test vault

1. Build the matching P1 Mac app from the parent project and open it once. Keep the existing App sync history; do not clear Application Support.
2. Create or choose a disposable Obsidian test vault. Save a few fake daily notes such as `2026-11-18.md`; no real schedule data is needed.
3. Close or disable any previous copy of this test plugin. Extract the plugin ZIP into `<test-vault>/.obsidian/plugins/`, producing `<test-vault>/.obsidian/plugins/day-planner-apple-sync/main.js` and `manifest.json`.
4. In Obsidian Settings → Community plugins, enable community plugins for this test vault, then enable **Day Planner Apple Sync**. Reload Obsidian if it has not discovered the new files.
5. This is a manual development install, not a community-directory release. Do not install it into the real work vault until the P1 flow is accepted.

Installing and enabling a plugin grants it Obsidian desktop access. The user should perform that enable step after reviewing the plugin and test-vault scope.

## Use

Click the calendar/clock ribbon button or use the command palette:

| Command | Behavior |
| --- | --- |
| Open Apple sync | Open the date-range modal |
| Preview this week | Ask the Mac app to open this Monday–Sunday range |
| Preview next week | Ask the Mac app to open next Monday–Sunday |
| Choose sync range | Open the modal in Custom mode |

The modal shows the source vault and supports This week, Next week, Custom, a common time-zone dropdown and an optional IANA time-zone field. Dates include both endpoints. If a saved time zone is unavailable, the plugin starts with the system time zone. Settings also offers **Use system**.

Before opening the app, save any note edits. P1 does not transmit note text or guarantee that an unsaved editor state is already on disk. The App remains the authority for reading and parsing supported Day Planner notes.

When the app responds:

- **opened:** the App accepted the range; review plans and click Sync there if desired.
- **needsVault:** confirm the requested source in the App’s vault chooser first. The plugin does not silently replace the App’s selected source.
- **busy:** the App is already doing work; check its window before retrying.
- **failed:** read the App’s message and correct the setup or request.

A timeout is **not** a sync success. An old app might open without understanding the request. Install the matching P1 build, inspect its window and retry manually; the plugin does not blindly resend.

## P1 manual acceptance checklist

Use fake notes and avoid clicking Sync; these checks only verify the handoff.

- App closed: This week command launches the app and fills the intended dates/time zone.
- App running, hidden/minimized or main window closed: it opens the correct window rather than requiring a full quit.
- Same vault: the App preserves the existing history and recognizes its source.
- Different vault with the same display name: the App asks for source confirmation; names alone do not identify a vault.
- Next week across a year boundary and Custom date range: dates match the modal.
- Invalid custom dates or time zone: a readable error appears before launching.
- Older/missing companion App: a clear install/update or confirmation-timeout message appears.
- Disable the plugin while waiting: polling is cancelled and no unsolicited retry occurs.
- No request says “synced”; no Apple item is created by the URL itself.

The parent project records actual host/manual results. Automated tests cover protocol and date behavior with a temporary filesystem and fake launcher, not native permission or iCloud delivery.

## Local data and protocol

The only persisted plugin preference is `timeZone`, in the plugin’s Obsidian `data.json`. P1 is not paired/authenticated for automated sync; P2 will add the per-vault pairing workflow before write-capable requests are introduced.

For a user-initiated handoff, a private JSON request is atomically written under:

```text
~/Library/Application Support/ObsidianPlanner/Bridge/inbox/<request-id>.json
```

It contains protocol version, UUID, `action: open`, vault path/name, inclusive dates and time-zone identifier. **No note titles, note contents, Apple-account information or credentials are included.** Only the UUID and protocol version are in the `obsidianplanner://bridge/open` URL. The App responds in the sibling `outbox/` directory.

Request directories use mode 0700 and the request file uses 0600. The client removes only its own request/response after the bounded handoff attempt; it never touches the App’s sync-history JSON. A late native response may remain after a timeout. No server, listening network port, telemetry or background job is introduced.

## Known boundaries

No plugin-side preview results, direct sync, conflict editor, Vault pairing, mobile bridge or community-directory publication yet. Selecting a range in Obsidian does not authorize automatic EventKit writes. The App must still show/confirm a source and the user operates Sync in the App. Native macOS permissions, signing/notarization and iCloud behavior remain properties of the companion app.

Official API references: [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin), [desktop/mobile constraints](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development), [Electron shell.openExternal](https://www.electronjs.org/docs/latest/api/shell).
