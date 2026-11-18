# One-time manual helper setup

**Plugin 0.4.1 uses the existing helper 0.4.0.** No full ObsidianPlanner App is required. The plugin only checks and calls a helper that you install yourself; it does not download, copy, install, repair or update native code.

**Already used plugin 0.4.0?** Keep its installed helper, permissions, selected accounts, credentials and history. Upgrade only the plugin files. No helper reinstall or fresh pairing is normally needed.

Requirements: Apple silicon Mac, macOS 14+ and Obsidian 1.15.1+. Obsidian 1.15.1 is the tested minimum host. The unchanged helper's prior acceptance used macOS 27.0.1; macOS 14 is a deployment target, not a claim that every macOS version was tested. Intel, mobile, Windows and Linux are unsupported or untested.

## New installation

1. Download `day-planner-apple-sync-helper-0.4.0-macOS-arm64.zip` from [release 0.4.1](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/0.4.1). It is a separate download from the five-file plugin ZIP.
2. Download `SHA256SUMS-plugin-0.4.1.txt`. For the helper alone, run the following and compare the digest with the line for that exact filename in the checksum file:

   ```sh
   shasum -a 256 day-planner-apple-sync-helper-0.4.0-macOS-arm64.zip
   ```

   The complete checksum file covers five payloads: individual main.js, manifest.json and styles.css, the plugin ZIP and the helper ZIP. `shasum -a 256 -c SHA256SUMS-plugin-0.4.1.txt` checks all five when all are present.
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
6. Install/enable plugin 0.4.1, then use **Refresh connection**. For a new vault connection, review its exact path and click **Connect this vault**. Configure permissions/accounts below, preview a few fake saved plans and sync only after review.

**Do not replace, move or delete the entire `~/Library/Application Support/ObsidianPlanner/` folder.** It also contains deduplication history and private connection data. Do not delete `PluginBridge/`, the App's `Bridge/` or existing history to install a helper. 不要替换整个 ObsidianPlanner 文件夹，也不要清空历史或令牌。

## Permissions and first use

The helper is a background macOS agent, without a main window or Dock item. It has a separate permission identity from Obsidian and the full App. In the plugin:

- Use **Grant Reminders Access**, approve the helper's system prompt and choose **Reminders account**.
- Only if Calendar is enabled, separately use **Grant Calendar Access** and choose **Calendar account**. Reminders-only operation does not require Calendar access.
- **Refresh connection** refreshes setup. Existing helper 0.4.0 permissions/accounts should remain in place during a plugin-only upgrade.
- **Disconnect this vault** revokes the helper pairing while preserving Apple items, history and previous receipts.

Helper 0.4.0 is ad-hoc signed, without Developer ID signing or Apple notarization. If macOS blocks it, verify its source and follow [Apple's official opening guidance](https://support.apple.com/en-us/102445) for that exact helper. Do not disable Gatekeeper globally, remove system protection or modify Obsidian's Info.plist. Managed Macs may restrict opening it.

## Missing or incompatible helper

The plugin displays manual setup guidance and stops attempting that operation; it never installs a replacement. Check the exact path and helper version **0.4.0**, not the plugin version **0.4.1**.

If a sync is already running or unconfirmed, inspect Apple Reminders/Calendar and query **Check last sync** before changing anything. Do not overwrite or remove a running helper, and do not treat reinstalling as a retry. If an existing component must be replaced after inspection, let the job finish, quit Obsidian and the helper, then manually replace **only that `.app`** with the trusted helper 0.4.0 download. Preserve all surrounding data. There is no automatic repair, rollback or blind resubmission.

## Local access and shared history

The plugin accesses files outside the vault to verify the installed helper and maintain private `PluginBridge/` credentials, transport files and result pointers. The helper reads saved daily notes and the existing path-derived history and performs reviewed Apple writes. Account selections are helper-local; credentials, account IDs and run pointers are not stored in vault `data.json`.

The standalone App stays **0.5.0/build 6** with unchanged release assets. It and helper 0.4.0 reuse the same local history for sequential use. **Use only one sync entry point at a time.** The App does not share the helper's execution lock. Local history and Apple destinations are not one transaction; there is no cross-process/crash exactly-once guarantee. A Mac save does not establish iPhone arrival.

## Validation status

Fresh-source npm ci, check:release, 62 tests and root build passed without preexisting node_modules/dist, with all three standard outputs identical to the working build. Packaging passed exact ZIP-content, signature/full-license, private-path/actual-token/metadata and five-payload checksum checks. A three-file directory called real helperInfo without native/ or self-installation; rebuilt helper files match the previously live-tested canonical bundle byte for byte. Details and the [release attachment link](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/0.4.1) are in [0.4.1 notes](releases/0.4.1.md).

Earlier real-account/helper acceptance remains in the [0.4.0 history](PLUGIN_STANDALONE.md). This task has not upgraded existing user-vault plugins or repeated Apple writes/iPhone checks. Community-directory recognition and reviewer approval are separate from local testing.

The helper and plugin retain **MIT + Commons Clause v1.0**, including No Sell; preserve the complete [LICENSE](../LICENSE). Neither this installation guide nor a standard manifest/release tag promises community acceptance.
