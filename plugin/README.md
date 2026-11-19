# Day Planner Apple Sync

Preview saved Day Planner notes in Obsidian, choose an action per plan, and sync to **Apple Reminders** with optional **Calendar** events. No full ObsidianPlanner App is required. Apple access uses a small, separately downloaded **helper 0.4.0 that you install once by hand**. Plugin 0.4.2 only checks and calls that installed helper; it does not download, copy, install or update it.

**Plugin 0.4.2 · helper 0.4.0 · bridge protocol 1.** Clean-source checks, official lint, 69 tests and read-only host QA passed locally. The [community release 0.4.2](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/0.4.2) contains only main.js, manifest.json and styles.css; [manual-v0.4.2](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/manual-v0.4.2) provides the ZIPs. Final attachment verification is separate; neither local checks nor release layout establish community approval or availability in Browse.

Source-available under **MIT subject to Commons Clause v1.0**, including its No Sell condition; not OSI open source. Preserve the complete [LICENSE](LICENSE). The separately distributed helper uses the same unchanged terms. A community scanner may report a [custom-license warning](https://docs.obsidian.md/community-directory/faq); reviewer acceptance is not guaranteed.

## Install the plugin

1. **Existing 0.4.0 user:** keep the already installed helper, its permissions, accounts, credentials and history. Upgrade only the plugin; no helper reinstall or new connection is normally required.
2. **New user:** obtain `day-planner-apple-sync-helper-0.4.0-macOS-arm64.zip` from [manual-v0.4.2](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/manual-v0.4.2) and follow the [one-time manual helper setup](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/blob/main/docs/HELPER_SETUP.md). Place only `DayPlannerAppleSyncHelper.app` at `~/Library/Application Support/ObsidianPlanner/PluginRuntime/0.4.0/DayPlannerAppleSyncHelper.app`. The plugin never performs this installation.
3. Until directory approval, download `day-planner-apple-sync-0.4.2.zip` from that same [manual release](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/manual-v0.4.2), disable the previous plugin and extract its `day-planner-apple-sync/` folder into `<vault>/.obsidian/plugins/`. The ZIP contains exactly `main.js`, `manifest.json`, `styles.css`, `README.md` and `LICENSE`; it contains no native bundle.
4. In Settings → Community plugins, enable **Day Planner Apple Sync**. Restart Obsidian if the folder is not discovered. Once a directory entry is actually reviewed and published, Obsidian can install the standard JS/manifest/style attachments; the same manual helper setup remains necessary.
5. The helper is a background agent without a main window or Dock item. It has its own Apple permission identity; prior access for Obsidian or the full App does not grant access. Helper 0.4.0 is ad-hoc signed, without Developer ID signing or notarization. Review [Apple's guidance](https://support.apple.com/en-us/102445) if blocked; do not disable Gatekeeper or change Obsidian's Info.plist.

Requirements: **Apple silicon, macOS 14+, Obsidian 1.15.1+**. Obsidian 1.15.1 is the tested minimum host; macOS 14 is the helper's deployment target, with actual prior helper acceptance on macOS 27.0.1. Other version combinations, Intel, mobile, Windows and Linux are untested or unsupported. This task has not upgraded a user's vault plugin or repeated Apple writes.

Updating replaces the five plugin files. Keep preferences, `PluginBridge/`, installed helper 0.4.0 and all shared history. An old plugin-local `native/` folder is no longer used by 0.4.2. **Never replace the whole Application Support/ObsidianPlanner folder:** it contains history and credentials. The standalone App stays 0.5.0/build 6; it and all earlier release assets remain unchanged.

`SHA256SUMS-manual-0.4.2.txt` is attached only to manual-v0.4.2 and covers **only the plugin ZIP and helper ZIP**. Put those two ZIPs beside it before running `shasum -a 256 -c SHA256SUMS-manual-0.4.2.txt`. The community release has exactly three standard attachments, with no ZIP or checksum extras.

On macOS, folders beginning with a dot (such as `.obsidian`) are hidden. In Finder or a folder picker, press **⌘⇧G** to enter the complete folder path, or **⌘⇧.** to show hidden folders.

## Connect, permissions and accounts

Open the ribbon button or run **Open Apple sync**.

1. For a new connection, review the exact current vault path, then click **Connect this vault** to authorize this helper's local preview-and-sync access. It creates credentials and a bookmark without requesting Apple permission or writing items. Existing 0.4.0 helper connections remain in place; old full-App companion credentials are not copied or silently upgraded.
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

The plugin's `fs` and `child_process` capabilities are necessary and security-relevant; they are disclosed rather than hidden or treated as automatically approved. It accesses files outside the vault to verify the manually installed helper and maintain private connection/request/result files. The helper reads saved notes and shared history and writes Apple items only on explicit sync. Private files stay on the same Mac:

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

The exact shared-history file is `~/Library/Application Support/ObsidianPlanner/<vaultKey>.json`. Helper account preferences use `~/Library/Preferences/com.obsidianplanner.pluginhelper.plist`. PluginBridge includes `clients/<client-path-sha256>.json`, `runs/<client-path-sha256>.json`, `inbox/<UUID>.json`, `outbox/<UUID>.json`, native `pairings.json`, `previews/<UUID>.json`, `jobs/<UUID>.json` and `helper-write.lock`.

Only fixed `/usr/bin/plutil`, `/usr/bin/codesign` and `/usr/bin/open` programs are invoked with `execFile` argv arrays: read the fixed helper plist to stdout, verify its bundle ID/signature, then launch that exact helper with a validated request URL. No `shell: true`, eval, download, installer or update command is used. Exact argv and scope are in [Helper setup](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/blob/main/docs/HELPER_SETUP.md#local-access-and-shared-history). The remaining capability warnings require review; documenting them does not dismiss them.

Only protocol version and UUID appear in `obsidianplanner-helper://bridge/<action>` URLs. Requests contain the vault path, dates, options and credentials; responses may contain titles and source locations. Entire note text is not copied to transport files. No server, listening port, telemetry or automatic network download of native code is introduced. This local mechanism does not isolate malicious same-user processes. Preserve history when upgrading or disconnecting; changing Mac or vault path has no transparent migration guarantee.

If the helper is missing or incompatible, the plugin stops with manual setup guidance. It never repairs, replaces or installs it. Inspect any unconfirmed job first; do not overwrite a running helper or delete history. For the exact installation/recovery scope, use [Helper setup](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/blob/main/docs/HELPER_SETUP.md).

## Build and verify

From the repository root, JavaScript checks/builds can run with Node.js 24+:

```sh
npm ci
npm run lint
npm test
npm run build
npm run check:release
```

A release is prepared with the root workspace and standard version tag:

```sh
./scripts/package-plugin-release.sh 0.4.2
```

Root manifest.version and community tag both use `0.4.2`, with Obsidian 1.15.1 as the minimum. That release has only the three standard files. The separate manual tag contains the five-file plugin ZIP, unchanged helper 0.4.0 ZIP and a checksum for those two ZIPs only. The full App is not rebuilt or installed; old releases remain unchanged.

**0.4.2 local evidence:** a clean git archive export passed npm ci, official ESLint (zero errors/warnings), all 69 tests, build and metadata checks. Its main.js, manifest.json and styles.css match the current working outputs byte for byte; npm audit reported zero findings. Real Obsidian 1.15.1 test-vault QA verified declarative settings/guide/Use system, saved refresh and global setting search. Existing helper credentials and a completed run loaded; read-only preview returned five Unchanged/Skipped plans and retained two preexisting overlap warnings. Test-note/shared-history bytes stayed unchanged; one completed run pointer refreshed, so not every run file was unchanged.

Release attachment checks are recorded in the release notes. Remote run [44439328478](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/actions/runs/44439328478) had no job steps because of a GitHub account billing lock. The release rebuild/exact-byte-check/attestation workflow must be retried after the billing lock is resolved; no genuine Actions/OIDC attestation is claimed. Details are in [0.4.2 notes](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/blob/main/docs/releases/0.4.2.md) and the [response matrix](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/blob/main/docs/COMMUNITY_REVIEW.md).

The unchanged helper has [prior real-account acceptance](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/blob/main/docs/PLUGIN_STANDALONE.md), including iPhone checks. This round used the isolated test vault read-only; the work vault/App/native sources were unchanged, and no Apple sync or new iPhone acceptance occurred. Historical real-write results do not establish a new write test. Local lint's zero warnings do not clear separate community capability/license warnings; remote CI is not counted as passed.

Community submission and policy references are in the [root README](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple#社区目录与许可). Root metadata/release compatibility does not guarantee approval of the external helper or current license.
