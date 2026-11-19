# One-time manual helper setup

**Plugin 0.4.2 uses the existing helper 0.4.0.** No full ObsidianPlanner App is required. The plugin only checks and calls a helper that you install yourself; it does not download, copy, install, repair or update native code.

**Already used plugin 0.4.0?** Keep its installed helper, permissions, selected accounts, credentials and history. Upgrade only the plugin files. No helper reinstall or fresh pairing is normally needed.

Requirements: Apple silicon Mac, macOS 14+ and Obsidian 1.15.1+. Obsidian 1.15.1 is the tested minimum host. The unchanged helper's prior acceptance used macOS 27.0.1; macOS 14 is a deployment target, not a claim that every macOS version was tested. Intel, mobile, Windows and Linux are unsupported or untested.

## New installation

1. Download `day-planner-apple-sync-helper-0.4.0-macOS-arm64.zip` from [manual-v0.4.2](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/manual-v0.4.2). That manual release also contains the five-file plugin ZIP; the community tag `0.4.2` contains only main.js, manifest.json and styles.css.
2. Download `SHA256SUMS-manual-0.4.2.txt`. For the helper alone, run the following and compare the digest with the line for that exact filename in the checksum file:

   ```sh
   shasum -a 256 day-planner-apple-sync-helper-0.4.0-macOS-arm64.zip
   ```

   The checksum file covers **only two ZIPs**: `day-planner-apple-sync-0.4.2.zip` and `day-planner-apple-sync-helper-0.4.0-macOS-arm64.zip`. `shasum -a 256 -c SHA256SUMS-manual-0.4.2.txt` checks both when they are beside it. The community release has no ZIP/checksum attachments.
3. Unzip the helper archive and find **DayPlannerAppleSyncHelper.app**.
4. Open Terminal and run these two commands. They only create/open the exact version folder in Finder; they do not download, install or launch the helper:

   ```sh
   mkdir -p "$HOME/Library/Application Support/ObsidianPlanner/PluginRuntime/0.4.0"
   open "$HOME/Library/Application Support/ObsidianPlanner/PluginRuntime/0.4.0"
   ```

5. In Finder, **manually drag only DayPlannerAppleSyncHelper.app** from the extracted archive into that opened folder. The final path must be:

   ```text
   ~/Library/Application Support/ObsidianPlanner/PluginRuntime/0.4.0/DayPlannerAppleSyncHelper.app
   ```

   If that exact helper is already installed, use the existing installation rather than replacing a running component. Installing it only in Applications or in the plugin folder does not satisfy this path.
6. Install/enable plugin 0.4.2, then use **Refresh connection**. For a new vault connection, review its exact path and click **Connect this vault**. Configure permissions/accounts below, preview a few fake saved plans and sync only after review.

**Do not replace, move or delete the entire `~/Library/Application Support/ObsidianPlanner/` folder.** It also contains deduplication history and private connection data. Do not delete `PluginBridge/`, the App's `Bridge/` or existing history to install a helper. 不要替换整个 ObsidianPlanner 文件夹，也不要清空历史或令牌。

## Permissions and first use

The helper is a background macOS agent, without a main window or Dock item. It has a separate permission identity from Obsidian and the full App. In the plugin:

- Use **Grant Reminders Access**, approve the helper's system prompt and choose **Reminders account**.
- Only if Calendar is enabled, separately use **Grant Calendar Access** and choose **Calendar account**. Reminders-only operation does not require Calendar access.
- **Refresh connection** refreshes setup. Existing helper 0.4.0 permissions/accounts should remain in place during a plugin-only upgrade.
- **Disconnect this vault** revokes the helper pairing while preserving Apple items, history and previous receipts.

Helper 0.4.0 is ad-hoc signed, without Developer ID signing or Apple notarization. If macOS blocks it, verify its source and follow [Apple's official opening guidance](https://support.apple.com/en-us/102445) for that exact helper. Do not disable Gatekeeper globally, remove system protection or modify Obsidian's Info.plist. Managed Macs may restrict opening it.

## Missing or incompatible helper

The plugin displays manual setup guidance and stops attempting that operation; it never installs a replacement. Check the exact path and helper version **0.4.0**, not the plugin version **0.4.2**.

If a sync is already running or unconfirmed, inspect Apple Reminders/Calendar and query **Check last sync** before changing anything. Do not overwrite or remove a running helper, and do not treat reinstalling as a retry. If an existing component must be replaced after inspection, let the job finish, quit Obsidian and the helper, then manually replace **only that `.app`** with the trusted helper 0.4.0 download. Preserve all surrounding data. There is no automatic repair, rollback or blind resubmission.

## Local access and shared history

The plugin accesses files outside the vault to verify the installed helper and maintain private `PluginBridge/` credentials, transport files and result pointers. The helper reads saved daily notes and the existing path-derived history and performs reviewed Apple writes. Account selections are helper-local; credentials, account IDs and run pointers are not stored in vault `data.json`.

These `fs` and `child_process` capabilities are necessary to this design and remain explicit review items. With `base = ~/Library/Application Support/ObsidianPlanner`, the external paths are:

| Path | Access and purpose |
| --- | --- |
| `base/PluginRuntime/0.4.0/DayPlannerAppleSyncHelper.app/Contents/Info.plist` | Read installed identity/version and agent metadata |
| `base/PluginRuntime/0.4.0/DayPlannerAppleSyncHelper.app/Contents/MacOS/DayPlannerAppleSyncHelper` | Check readability/executability; signature-check the bundle, then launch the fixed app |
| `base/PluginBridge/clients/<client-path-sha256>.json` | Private local vault credential; connect/read/revoke |
| `base/PluginBridge/runs/<client-path-sha256>.json` | Original sync pointer and confirmed result for recovery |
| `base/PluginBridge/inbox/<UUID>.json`, `outbox/<UUID>.json` | Atomic request/response transport; only this attempt's transport files are cleaned |
| `base/PluginBridge/pairings.json` | Helper's token/bookmark pairing records |
| `base/PluginBridge/previews/<UUID>.json`, `jobs/<UUID>.json`, `helper-write.lock` | Helper's expiring reviewed contexts, receipts and nonblocking execution lock |
| `base/<vaultKey>.json` | Shared path-derived history, read during preview and updated by the helper during explicit sync |
| `~/Library/Preferences/com.obsidianplanner.pluginhelper.plist` | Helper-local account preferences |

`client-path-sha256` identifies the exact client vault path; `vaultKey` is based on the standardized absolute vault path. No real paths, tokens or account IDs are printed in this guide. The old full App's `base/Bridge/` is separate and is not the independent plugin's transport root.

Only these fixed executable/argv combinations are used by the plugin; `helper` below is the canonical bundle path above, not an arbitrary caller-supplied executable:

```js
execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', helper + '/Contents/Info.plist'])
execFile('/usr/bin/codesign', ['--verify', '--strict', '-R=identifier "com.obsidianplanner.pluginhelper"', helper])
execFile('/usr/bin/open', ['-g', '-a', helper, validatedRequestURL])
```

`plutil` emits JSON on stdout without rewriting the plist; `codesign` verifies signed-bundle integrity and the fixed identifier, not notarization; `open` starts that verified app in the background with an `obsidianplanner-helper://bridge/...` request URL containing only protocol version and UUID. Commands use argv arrays through `execFile`, without `shell: true` or eval. There are no download, installation or update commands. Clicking the setup-documentation link can open a user-visible HTTPS page; it does not download or install the helper. No plugin server, telemetry or automatic sync is introduced. Disclosure does not mean these capability warnings have been cleared by reviewers.

The standalone App stays **0.5.0/build 6** with unchanged release assets. It and helper 0.4.0 reuse the same local history for sequential use. **Use only one sync entry point at a time.** The App does not share the helper's execution lock. Local history and Apple destinations are not one transaction; there is no cross-process/crash exactly-once guarantee. A Mac save does not establish iPhone arrival.

## Validation status

Version 0.4.2 passed clean tracked-source npm ci, official lint (zero errors/warnings), 69 tests, build and metadata checks; the three standard files match the working outputs, and npm audit reported zero findings. Real Obsidian 1.15.1 read-only test-vault QA verified settings/search, old helper credentials/completed state and a five-plan preview. Notes/shared history did not change; one completed run pointer refreshed. Final attachment verification is still separate.

Remote [run 44439328478](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/actions/runs/44439328478) had no job steps because of a GitHub account billing lock. Retry the rebuild/byte-check/attestation workflow after resolving the billing lock; no actual Actions/OIDC attestation is claimed. See [0.4.2 notes](releases/0.4.2.md), the [review-response matrix](COMMUNITY_REVIEW.md) and [manual downloads](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/manual-v0.4.2).

The 62-test results belong to 0.4.1; earlier real-account/helper acceptance remains in the [0.4.0 history](PLUGIN_STANDALONE.md). They are historical evidence only. This round did not alter the work vault/App/native code or submit Apple sync/iPhone tests. Community recognition, local validation and reviewer approval are separate outcomes.

The helper and plugin retain **MIT + Commons Clause v1.0**, including No Sell; preserve the complete [LICENSE](../LICENSE). Neither this installation guide nor a standard manifest/release tag promises community acceptance.
