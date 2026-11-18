# Day Planner Apple Sync

Preview saved Day Planner notes in Obsidian, choose an action per plan, and sync to **Apple Reminders** with optional **Calendar** events. Install this plugin without installing the full ObsidianPlanner App. The ZIP includes a small macOS background native component for Apple permissions and EventKit access; connection, accounts, notifications and results are managed in Obsidian.

**Plugin/helper 0.4.0 · bridge protocol 1 · tag `plugin-v0.4.0-beta.1`.** This independent plugin passed local automated and real-account acceptance, including user-confirmed iPhone checks. Download the complete ZIP from the [plugin release](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/plugin-v0.4.0-beta.1). GitHub manual distribution; no community-directory submission or approval claim.

Source-available under **MIT subject to Commons Clause v1.0**, not OSI open source. The complete [LICENSE](LICENSE) applies to the plugin and bundled helper and must be retained.

## Install the plugin

1. Obtain `day-planner-apple-sync-0.4.0.zip` and `SHA256SUMS-plugin-0.4.0.txt` from the separate plugin release when available. Run `shasum -a 256 -c SHA256SUMS-plugin-0.4.0.txt` in their download folder to verify the ZIP.
2. Disable any previous Day Planner Apple Sync plugin. Extract the ZIP's `day-planner-apple-sync/` folder into `<vault>/.obsidian/plugins/`. It contains `main.js`, `manifest.json`, `styles.css`, `README.md`, `LICENSE` and `native/DayPlannerAppleSyncHelper.app`. Keep the native bundle inside that folder.
3. In Obsidian Settings → Community plugins, enable **Day Planner Apple Sync**. Restart Obsidian if the folder has not been discovered. Start with a disposable local test vault and a few fake plans.
4. The plugin installs the included native bundle into a private, versioned runtime directory on this Mac and launches it on demand. It has no main window or Dock item. It is supplied by the ZIP; the plugin does not download an executable from the network.
5. The native helper has its own Apple permission identity. Prior permission for Obsidian or ObsidianPlanner.app does not grant it access. This beta is ad-hoc signed, without Developer ID signing or Apple notarization. If macOS blocks it, review the source and follow [Apple's guidance](https://support.apple.com/en-us/102445); do not disable Gatekeeper or change Obsidian's Info.plist.

The packaged helper targets **Apple silicon / macOS 14+**. Manifest minimum Obsidian: **1.5.0**. Actual independent-helper acceptance used macOS 27.0.1 / Obsidian 1.15.1; these minimums do not establish compatibility with every version. No Intel, mobile, Windows or Linux release is provided.

Updating replaces the five normal files and `native/` from a trusted plugin package. Keep plugin preferences, private history and credentials. The published standalone App remains a separate option at 0.5.0/build 6; it is not required and its release assets are unchanged.

On macOS, folders beginning with a dot (such as `.obsidian`) are hidden. In Finder or a folder picker, press **⌘⇧G** to enter the complete folder path, or **⌘⇧.** to show hidden folders.

## Connect, permissions and accounts

Open the ribbon button or run **Open Apple sync**.

1. Review the exact current vault path, then click **Connect this vault** to authorize this helper's local preview-and-sync access. This explicit action creates fresh helper credentials and a bookmark for that vault. It does not request Apple permission or write Apple items. Old companion credentials are not copied or silently upgraded.
2. Click **Grant Reminders Access** and approve the helper's system prompt. Select the intended writable **Reminders account**.
3. Calendar export is optional. If enabled, separately click **Grant Calendar Access**, approve its prompt and choose **Calendar account**. Reminders-only use does not need Calendar permission. Accounts with the same display name may have different entity-specific identifiers.
4. **Refresh connection** checks helper state and eligible accounts. A stored credential alone is not proof of current access. Only one available source may be selected automatically; otherwise choose explicitly.
5. **Disconnect this vault** revokes the helper pairing. It preserves exported Apple items, shared history and previous job receipts.

These controls replace the former Open Mac app/pair-in-App flow. No full App window is needed. Account choices are helper-local, outside vault preferences. Changing an account requires a new preview.

## Preview and sync

1. **Save editor changes first.** The helper reads note files on disk; the plugin does not force-save or modify them.
2. Select This week, Next week or an inclusive Custom range and the schedule's IANA time zone. Weeks are Monday–Sunday; past dates are allowed.
3. Set destinations and notifications. Defaults: **Reminders only**, Calendar off, **10-minute Reminders notification**. Calendar/Both notifications require Calendar enabled; None disables notifications created by this tool. Lead time: 0–60 minutes in steps of 5.
4. Click **Preview saved plans**. Review grouped plans, source locations, parser issues and the separate matching/Skipped states. A source link opens the existing note at its one-based line without changing text.
5. Review each decision and click **Sync selected (N)** once.

| Plan state | Default | Decision |
| --- | --- | --- |
| New | Add | Add or Skip |
| Previously exported, including changed/incomplete | Skip | Skip, Update existing or Add again |
| Ambiguous match | Skip | Skip, New or Link to an eligible history record |

**Update existing** reapplies source title, time, completion and selected notification settings, including overwriting those corresponding Apple-side fields. **Add again** preserves previous Apple items and makes the new copy the target for later updates. Use it only to request another copy. **Incomplete** indicates a missing target after a partial save; inspect the Apple items and use Update existing as appropriate.

Only root-level `YYYY-MM-DD.md` notes are supported, under the configured Day Planner heading (default `# Day planner`). Tasks need explicit same-day times, such as `- [ ] 09:00 - 10:00 Read papers` or `- [x] …`. Missing end times, overnight and nested tasks are unsupported and reported. Source deletion does not delete prior exports; Apple-side changes never write back to notes.

A preview expires after 30 minutes and must match the reviewed range/options/accounts. Source, Day Planner configuration or history changes require a fresh preview. Preview contexts persist across the helper's idle exit; no full note text or token is stored in them. Choices clear after a submitted batch or changed range/options. Nothing syncs automatically.

Results report local Reminders and Calendar saves independently, plus skipped, failed and unresolved counts. **A local save does not confirm iPhone arrival.** Use the same Apple account with iCloud enabled and verify delivery/notifications on the device separately.

## Recovery and using the standalone App

The plugin privately saves an original request pointer before submission. **Check last sync** queries that job; it never submits it again. Waiting is bounded. Closing the modal, Stop waiting, disabling/reloading the plugin or quitting Obsidian stops observation and does not guarantee cancellation of a native write already started.

- Running: wait or query again; do not resend.
- Partial/failed: inspect per-target results, correct permissions/accounts in the plugin, then obtain a fresh preview and Update existing for linked incomplete entries.
- Unconfirmed/interrupted/not found: inspect Apple Reminders/Calendar first. **I checked Apple items — start fresh** acknowledges the uncertainty without writing anything; then review a fresh preview.
- Stale source/history/accounts or expired/used preview: request a new preview rather than reusing it.

The helper exits after an idle period, preserving recent previews and job results. It does not exit during an active permission request or sync. A private lock prevents competing helper instances from writing together.

The independent plugin and standalone App use the **same path-derived deduplication history** and existing Apple identities. Use them sequentially with the same vault path. **Use only one sync entry point at a time.** The older App does not participate in the helper's lock. No cross-process or cross-crash exactly-once guarantee is made; Apple targets and local JSON are not one transaction.

## Commands and local files

Commands: Open Apple sync, Preview this week, Preview next week, Choose sync range, Check last sync and Refresh connection. Valid range/time-zone/notification preferences are saved in Obsidian plugin settings. `data.json` contains no pairing token, account IDs, preview contents or job pointer.

Private files stay on the same Mac:

```text
~/Library/Application Support/ObsidianPlanner/
  PluginRuntime/0.4.0/DayPlannerAppleSyncHelper.app
  PluginBridge/
    clients/      # helper-specific local credentials
    runs/         # original sync pointer and confirmed result, no token
    inbox/        # one request per UUID
    outbox/       # corresponding responses
    previews/     # expiring reviewed contexts, no source text/token
    jobs/         # token-free receipts
```

Shared deduplication history remains at the existing ObsidianPlanner root. App `Bridge/` and plugin `PluginBridge/` credentials/settings are separate. Different absolute vault paths remain distinct even with the same display name. Directories are private (0700), data files 0600; requests are written atomically.

Only protocol version and UUID appear in `obsidianplanner-helper://bridge/<action>` URLs. Requests contain the vault path, dates, options and credentials; responses may contain titles and source locations. Entire note text is not copied to transport files. No server, listening port, telemetry or automatic network download of native code is introduced. This local mechanism does not isolate malicious same-user processes. Preserve history when upgrading or disconnecting; changing Mac or vault path has no transparent migration guarantee.

If a development package reports a different helper binary/Info.plist at the existing same-version runtime path, it stops rather than replacing a potentially active helper. First let any job finish, inspect its result and quit Obsidian and the helper (Activity Monitor can show DayPlannerAppleSyncHelper). Remove **only** `PluginRuntime/0.4.0/DayPlannerAppleSyncHelper.app` at the path above, then reopen the trusted updated plugin so it installs its bundled copy. Keep `PluginBridge/`, the standalone App's `Bridge/` and all shared history. Do not use this procedure to retry an unconfirmed write.

## Build and verify

JavaScript development and CI can run on Linux with Node.js 24+:

```sh
cd plugin
npm ci
npm test
npm run build
```

A release ZIP requires an Apple silicon Mac, Apple command-line build tools and the bundled helper. From the repository root:

```sh
./scripts/package-plugin-release.sh 0.4.0-beta.1
```

This runs clean dependency installation, plugin tests/build, `build-plugin-helper.sh`, then `plugin/package.mjs`. Output is `plugin/dist/day-planner-apple-sync-0.4.0.zip` and `plugin/dist/SHA256SUMS-plugin-0.4.0.txt`. It does not build the full App, invoke the old App release script, overwrite old App assets, upload or install anything. `npm run package` packages an already built helper and fails clearly when it is absent; JS-only output is not a complete release.

The packager checks helper identity/version, agent/privacy declarations, arm64 architecture, signature, exact file list, complete license, private build paths, local pairing-token bytes, metadata-free ZIP contents and checksum. Local validation passed 59 plugin tests, type checking/build, shared-core checks, 30 helper checks, signed-bundle startup and packaging. Real helper permissions/accounts, per-plan Apple writes, replay/stale-input handling, persisted preview/result recovery, source-note opening, plugin reload/window reopen and iPhone acceptance also passed without the full App. The [validation record](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/blob/main/docs/PLUGIN_STANDALONE.md) lists the actual environment and untested cases, including other-machine first launch and live partial failures. Remote CI is not counted as passed.
