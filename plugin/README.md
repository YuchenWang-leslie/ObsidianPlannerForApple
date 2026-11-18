# Day Planner Apple Sync — local companion plugin

**Plugin 0.2.0 for Obsidian on macOS, paired with the local ObsidianPlanner 0.4.0 P2 app.** Pair a vault once, select dates, and inspect the Mac app’s Day Planner preview inside Obsidian. Pairing and preview do not write Apple Calendar events, Reminders, or sync history.

Source-available under **MIT subject to Commons Clause v1.0**. See the complete [LICENSE](LICENSE). This is a local development build, not a community-directory release.

## Requirements and build

- Obsidian desktop on macOS. Manifest minimum: 1.5.0. Actual host/manual acceptance results are recorded in the parent project.
- The separately installed **ObsidianPlanner 0.4.0 P2 companion Mac app with bridge protocol 1**. Public beta builds and the P1 open-only app do not support this preview flow. The plugin never downloads native code.
- A local filesystem vault with saved Day Planner daily notes. Parsing and matching use the existing native shared core, rather than a second TypeScript parser.
- Apple permissions and actual sync stay in the Mac app. This plugin has no Sync command or EventKit write path. iPhone continues to use Apple Reminders/Calendar through iCloud.

From this directory with Node.js 24+ and npm:

```sh
npm ci
npm test
npm run typecheck
npm run package
```

`dist/day-planner-apple-sync-0.2.0-P2.zip` contains a `day-planner-apple-sync/` folder with `main.js`, `manifest.json`, `styles.css`, this README and the combined license. It includes no native executable, Node modules, credentials or vault files. `npm run build` produces the unpackaged files in `dist/`.

Dependencies are pinned in `package-lock.json`. The bundle relies on host Obsidian, Node and Electron APIs with no bundled third-party runtime libraries. Windows/Linux are rejected at runtime.

## Manual installation in a test vault

1. Build and open the matching local P2 Mac app from the parent repository. Keep existing history; do not clear Application Support.
2. Choose a disposable Obsidian test vault. Save fake daily notes such as `2026-11-18.md` with a few supported plans.
3. Disable any previous copy of this plugin. Extract the ZIP into `<test-vault>/.obsidian/plugins/`, producing `.obsidian/plugins/day-planner-apple-sync/main.js` and `manifest.json`.
4. In Settings → Community plugins, enable **Day Planner Apple Sync**. Reload Obsidian if it has not discovered the files. Review the test-vault scope before enabling desktop code.
5. Start with the test vault. The plugin does not install itself into a vault or reload Obsidian automatically.

## Pair and preview

Click the calendar/clock ribbon icon or run **Open Apple sync**.

1. **Save editor changes first.** The App reads note files on disk. The plugin does not force-save or modify notes.
2. Check the vault name and exact path shown in the modal. Choose This week, Next week or an inclusive Custom range and the schedule’s IANA time zone. Weeks are Monday–Sunday in that zone.
3. Click **Pair this vault…**. In the Mac app, review the requested path. If necessary, select that vault using its normal folder chooser, then explicitly click **Pair this vault**. Choosing a folder by itself does not approve pairing.
4. The plugin waits up to 120 seconds for approval. **Credential saved on this Mac** means local storage; it does not claim access is still valid or any sync occurred.
5. Click **Preview saved plans**. A successful response records this session’s last verified preview time and displays date-grouped plans, parser issues and counts.
6. Matching badges are **Create**, **Update**, **Unchanged** or **Conflict**. **Skipped** separately shows the default choice for previously added plans, so skipped counts overlap matching counts.
7. Click a source label such as `2026-11-18.md:5` to open that existing note at its one-based source line without changing the text.

Defaults: **Reminders**, Calendar off, **10-minute Reminders notification**. Calendar is optional. Notification channels are Reminders/Calendar/Both/None; Calendar/Both require Calendar enabled. Lead time is 0–60 minutes in steps of 5. These options describe a native preview and do not authorize writes.

Changing a range or option clears the displayed result. Preview is a snapshot of saved notes and native history. Individual add/update choices and actual Sync remain App features until a later stage.

| Command | Behavior |
| --- | --- |
| Open Apple sync | Open pairing/range/preview modal |
| Preview this week | Open modal and preview Monday–Sunday if a local credential exists |
| Preview next week | Open modal and preview the next week if paired |
| Choose sync range | Open modal in Custom mode |
| Open Mac app | Keep the P1 open-only handoff with the current week/time zone |

**Open Mac app** also appears in the modal. It passes selected dates and context without syncing or silently switching the source.

## Failure and revocation

- Missing/old/slow App: open and preview wait about eight seconds. A timeout means **no confirmed result**, even if an old app opened. Check its window, install the matching build and retry manually. Requests are never blindly resent.
- Pair dismissed/expired: no new credential is saved. An expired request cannot be approved later; initiate another pair manually.
- Busy/setup incomplete: follow the App’s response and check its window.
- Revoked/rotated token: `VAULT_NOT_PAIRED` removes the stale local credential. Pair again explicitly. Successful preview verifies access; merely finding a credential file does not.
- Plugin disable/unload cancels polling and removes its own transport files.
- **Settings → Forget on this Mac** removes only the client credential. Use the Mac app’s revoke action to remove native pairing. Neither operation deletes exported items or history.

## Local data and privacy

Obsidian plugin `data.json` contains preferences only: `timeZone` and destination/notification `options`. It never contains a pairing token. Credentials live **outside the vault**, so ordinary vault sync does not copy them:

```text
~/Library/Application Support/ObsidianPlanner/Bridge/clients/<sha256-of-exact-client-vault-path>.json
```

A client file contains its exact vault path, opaque `vaultKey` and pairing token. Directories use 0700 and files use 0600. Different paths remain distinct even if display names match. Re-pairing rotates the native token while preserving native history identity. The App separately stores its pairing record and security-scoped bookmark.

A user-initiated request is atomically written to `Bridge/inbox/<request-id>.json`; the matching response is read from `Bridge/outbox/<request-id>.json`. Requests contain the absolute path/name, inclusive dates and time zone. Preview also carries its private credential and options. Its response contains plan titles, source locations, times, matching states and issues. The plugin does not transmit note text; the native App reads the paired local vault.

The `obsidianplanner://bridge/{open|pair|preview}` URL contains only protocol version and UUID—never tokens, paths or titles. Tokens are not displayed or logged. The client deletes only its own transport files after completion/error/cancellation, preserving sync history. A late response may remain after a timeout. No network server, listening port, telemetry or background sync is introduced.

## Verification

`npm test` uses temporary files and a fake launcher. Coverage includes year/DST/date boundaries, custom validation, identity/version, private modes, pending pairing, cancellation, token rotation/rejection, matching versus Skipped counts, safe source paths, options and invalid responses. Tests do not launch the App or write Apple items.

Manual acceptance still requires the matching App:

- Human confirmation is required to pair; merely choosing a folder is insufficient.
- Same-name/different-path vaults remain distinct and native history identity is preserved.
- Preview matches the native preview, including conflicts, skipped defaults and parser issues.
- Source links open the expected note/line without text changes.
- Hidden/minimized/closed windows reopen; missing/old App messages are clear.
- Revoke/re-pair and disable-while-waiting work as described.
- Pair and preview leave EventKit and sync history unchanged, and no response claims successful sync.

The parent project records actual host and native end-to-end results. No plugin writes, automatic sync, mobile bridge, conflict editor or community-directory publication are included in this stage.
