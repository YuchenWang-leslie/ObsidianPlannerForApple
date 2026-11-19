# Changelog / 更新记录

## 0.4.2 — Review revisions / 本地验证通过

Plugin 0.4.2 addresses community review feedback; helper 0.4.0, App 0.5.0/build 6, native sources and MIT + Commons Clause/No Sell remain unchanged. Clean-source checks, official lint, 69 tests and read-only host QA passed. Final attachment verification and real remote attestation remain separate; community approval is not confirmed.

### Review scope / 审核处理范围

- Updated UI headings and settings definitions/update API, and validated external JSON as unknown before typed use. Real Obsidian settings, guide, Use system/save/refresh and global setting search passed; details are in the [response matrix](docs/COMMUNITY_REVIEW.md).
- Reproduced the DOM-helper preference with official lint and used the specific createDiv/createSpan helpers; the complete official lint run has zero errors and warnings.
- Keep necessary `fs`/`child_process` capabilities visible. Document exact external files and fixed plutil/codesign/open argv, with no shell/eval, automatic download, installation or update.
- Community tag `0.4.2` contains only main.js, manifest.json and styles.css. The separate `manual-v0.4.2` tag contains the five-file plugin ZIP, unchanged helper ZIP and `SHA256SUMS-manual-0.4.2.txt`, covering only those two ZIPs. Earlier releases stay unchanged.
- Configured release rebuild/exact-byte-check/attestation verification. Remote run 44439328478 had no job steps because of a GitHub account billing lock; retry after the billing lock is resolved. No generated Actions/OIDC attestation is claimed.

An exported clean tracked-source tree passed npm ci, official lint (0 errors/0 warnings), all 69 tests, build and metadata checks; three standard outputs match the working build byte for byte, and npm audit is zero. In the Obsidian 1.15.1 test vault, old helper credentials/completed state loaded and read-only preview returned five Unchanged/Skipped plans, retaining two preexisting overlap warnings. Fake-note/shared-history bytes stayed unchanged; one completed run pointer refreshed. The work vault/App/native/plists/LICENSE were unchanged and no Apple sync occurred.

The earlier 62-test and helper/iPhone results remain historical. Local lint does not declare community license/capability warnings resolved. Final attachment checks, community approval and actual attestation are tracked separately in [0.4.2 notes](docs/releases/0.4.2.md).

## 0.4.1 — Standard plugin release / 本地验证通过

Plugin 0.4.1 uses the existing helper 0.4.0. The standalone App remains 0.5.0/build 6; earlier versions and release assets are unchanged. Fresh-source build/metadata checks, 62 tests and packaging passed. [Release 0.4.1](https://github.com/YuchenWang-leslie/ObsidianPlannerForApple/releases/tag/0.4.1) uses standard assets; community approval is not confirmed.

### Changed / 调整

- Added a root manifest, root workspace/build entry and versions.json for default-branch recognition. Standard tag `0.4.1` matches manifest.version; versions.json declares only 0.4.1 → Obsidian 1.15.1, the tested minimum host.
- Releases provide individual main.js, manifest.json and styles.css, plus a manual plugin ZIP containing only those files, README and LICENSE. The plugin ZIP contains no native component.
- Helper 0.4.0 is a separate download, `day-planner-apple-sync-helper-0.4.0-macOS-arm64.zip`, installed once by the user at the existing private versioned runtime path. Plugin code only detects/calls it; no automatic helper downloading, copying, installation or updating.
- Existing 0.4.0 users only upgrade the plugin and retain helper permissions, accounts, credentials, receipts and shared history. New users follow [manual helper setup](docs/HELPER_SETUP.md); the full App is not required.
- `SHA256SUMS-plugin-0.4.1.txt` covers five payloads: the three standard files, five-file plugin ZIP and separate helper ZIP.

### Policy and validation / 政策与验证

MIT + Commons Clause v1.0, including No Sell, remains unchanged. Root metadata and release-format alignment do not establish community approval of the external dependency or custom license. Follow official portal feedback rather than treating recognition as acceptance; see [release notes and validation](docs/releases/0.4.1.md).

Fresh-source npm ci, check:release, 62 tests and root build passed without preexisting node_modules/dist; all three standard outputs match the working build byte for byte. Packaging passed exact plugin-ZIP (five normal files/no native) and helper-ZIP (four bundle files) checks, signatures, complete license, private-path/actual-token/metadata guards and all five payload checksums. Real helperInfo succeeded from a fresh three-file directory without self-installation. Rebuilt helper 0.4.0 files match the previously live-tested canonical bundle. App/Core/helper Swift/plist/LICENSE were not changed.

Prior helper 0.4.0 real-account acceptance remains historical evidence. This task has not upgraded existing user-vault plugins or repeated Apple writes/iPhone acceptance. Apple silicon/macOS 14+ only; minimum host now Obsidian 1.15.1. Other systems/Intel and cross-process/crash exactly-once behavior remain unverified. The App/helper share history for sequential use; use one sync entry point at a time.

## plugin-v0.4.0-beta.1 — 2026-11-18

Plugin/helper 0.4.0, bridge protocol 1. Independent plugin release; the published App remains 0.5.0/build 6 and its assets are unchanged.

### Added / 新增

- A small bundled macOS agent supplies EventKit access without requiring the full ObsidianPlanner App. It has no main window or Dock item, launches from its exact private versioned runtime path, and is supplied in the local plugin ZIP rather than downloaded automatically.
- Connect/disconnect, independent Reminders/Calendar permission controls, eligible account choices and connection refresh inside Obsidian.
- Helper-specific credentials, settings, expiring persisted previews and job receipts under PluginBridge, separate from the standalone App's Bridge.
- A plugin-only packaging script, native bundle/signature/privacy checks, exact distribution-file allowlist and `SHA256SUMS-plugin-0.4.0.txt`. JavaScript builds remain usable on Linux; packaging requires the native helper on an Apple silicon Mac.

### Retained behavior and limits / 保留行为与边界

- Reuses PlannerCore and the existing EventKit backend without changing or rebuilding the standalone App. Saved-note parsing, per-plan choices, partial results and status-based recovery retain their existing contracts.
- Shares existing path-derived history and Apple identities for sequential use. Use only one sync entry point at a time; the older App does not share the helper's lock. No cross-process or cross-crash exactly-once guarantee is made.
- Existing companion credentials and App permissions do not become helper authorization. Connect explicitly and grant the helper's own entity-specific permissions. Preserve old history and credentials.
- Plugin ZIP contains the five normal files plus `native/DayPlannerAppleSyncHelper.app`. Manual GitHub distribution uses a separate `plugin-v0.4.0-beta.1` tag and does not replace v0.5.0-beta.1 assets.

### Validation status / 验证状态

59 plugin tests, TypeScript checking, production build, shared Swift core checks, 30 helper protocol/storage checks, signed-agent startup and plugin-only packaging passed locally. Actual helper communication and cold launch after idle exit passed without opening the full App. Regression tests cover setup errors without state and preserving a running job when its status query is refused. A signed-bundle smoke also covers the helper defaults-domain startup crash found during integration.

This helper's real-account acceptance passed with the full App quit: entity-specific permissions/iCloud accounts, create, default Skip, explicit Update/copy/Link, request replay/collision and stale-source rejection, cold persisted-preview/result recovery, source-note opening, plugin disable/re-enable and test-window reopen. The user confirmed the requested iPhone Reminders check and Calendar arrival/time. Work-vault upgrade/connection and read-only preview passed with daily notes, preferences and sync history unchanged; no work-vault sync was submitted.

Actual environment: Apple silicon, macOS 27.0.1, Obsidian 1.15.1. Remote CI did not start and is not counted as passed; local validation follows the maintainer's choice. Other-machine first launch, a full Obsidian process restart, live OS permission denial/revocation and live partial destination failures were not exercised.

Apple silicon/macOS 14+ target; other system versions and Intel are untested. Ad-hoc signed, not Developer ID signed or Apple-notarized. Community-directory submission has not occurred and acceptance is not guaranteed. MIT + Commons Clause v1.0 remains unchanged, source-available and not OSI open source. See [release notes](docs/releases/plugin-v0.4.0-beta.1.md) and [implementation record](docs/PLUGIN_STANDALONE.md).

## v0.5.0-beta.1 — 2026-11-18

App 0.5.0 / build 6; companion plugin 0.3.0; bridge protocol 1. Separate App and plugin ZIPs with SHA-256 checksums. Core local daily-use checks, test-vault sync and user-confirmed iPhone delivery/notification checks passed. The final rebuilt bundle files match the live-tested installations byte for byte.

### Added / 新增

- Preview and sync saved Day Planner plans inside Obsidian, with per-plan Add, Skip, Update existing and Add again choices and explicit conflict linking/new/skip decisions.
- Shared native/plugin sync executor, preserving existing Swift parsing, matching, vault identity and local deduplication history.
- Explicit preview-and-sync pairing approval. Existing P2 credentials retain read-only access until the user approves the broader scope in the Mac App.
- Per-item local-save results and persisted request status. Check last sync queries the original job after a timeout/reload without submitting another write.
- Combined release packaging: a clean Apple silicon App ZIP, a folder-based plugin ZIP including README/LICENSE, and SHA256SUMS.txt covering both.

### Changed / 行为调整

- Sync rechecks saved notes, Day Planner configuration and history against the reviewed preview; stale or expired previews require another review before writing.
- New plans default to Add; previously exported plans default to Skip; unresolved conflicts default to Skip. Add again deliberately creates a new copy and leaves old Apple items intact.
- Native and plugin writes share a serialized execution gate. Claimed request/preview identities reject duplicate or mismatched submissions; there is no automatic retry after an unconfirmed result.
- Closing/disable stops plugin polling, while an already running native write may finish. Interrupted/not-found runs require inspection and a fresh preview before another batch.
- Partial destination saves remain visible and recorded. Retry linked incomplete entries with Update existing; Add again explicitly creates an extra copy.
- Account selection and independent Reminders/Calendar permissions remain in the companion Mac App. Reminders-only sync does not require Calendar access.

### Fixed / 修复

- Renamed the plugin's plan selection field to avoid Obsidian Modal's internal editor-selection field. The collision caused `structuredClone` to receive a Window and reject Sync; a host-lifecycle regression test reproduced the failure before the fix and now passes.
- Removed a badge display rule that overrode the hidden state and incorrectly showed Skipped. After the final stylesheet reload, the real host correctly shows the selected Update row without a Skipped badge.

### Validation and limits / 验证与限制

45 local plugin tests, TypeScript checking and production build passed. Real Apple-account checks in the isolated fake-plan vault covered create, Update/Skip, title/time/completion changes, Add again, linking, optional Calendar, request replay/collision protection, stale source/history rejection, cold-start status lookup and independent native sync. Stable Apple identities and history checks verified the expected reuse or deliberate copy. The user confirmed this version's iPhone Reminders arrival, the 15:31 notification and the correctly timed Calendar event. Details are in [plugin phase records](docs/PLUGINIZATION_PROGRESS.md).

Closing/reopening the test-vault window and disabling/re-enabling the plugin preserved pairing, preferences and the previous result; Check last sync retrieved that result without resubmitting. A full Obsidian process restart, extra light-theme/600px-window checks and a new source-link host check were not completed; P2 source-link testing is recorded separately.

Remote CI did not start because of platform/account configuration limits and is not counted as passed; this release uses local validation, as approved by the maintainer. Live partial failures and permission denial/revocation were not deliberately induced; fake-backend tests cover those paths. These local results do not establish other-machine compatibility or strict exactly-once crash recovery.

Apple silicon only; minimum macOS 14 and manifest minimum Obsidian 1.5.0. Actual test environment: macOS 27.0.1 / Obsidian 1.15.1. Other supported-version combinations and cross-crash recovery remain limited. Ad-hoc signed, not Developer ID signed or notarized. MIT + Commons Clause v1.0, source-available and not OSI open source. Manual GitHub installation; no community-directory submission.

See [release notes](docs/releases/v0.5.0-beta.1.md) for installation, upgrading P2 pairs and recovery guidance.

### P2 preview foundation

- Added explicit per-vault local pairing, token rotation and native revocation. Credentials stay outside the vault in private Mac storage.
- Added read-only preview results inside Obsidian: grouped dates, matching and default-skip states, parser issues, counts and source-note links.
- Extracted one Swift preview entry point and shared history store; native and plugin previews use the existing path-derived identities and history format.
- P2 preview requests validated pairing and vault path without exposing a sync route or writing EventKit items/history.
- Implemented locally with App 0.4.0 / build 5 and plugin 0.2.0 before this release; P2 itself did not expose a sync route.

### P1 foundation

- Added a macOS-only Obsidian companion plugin with a ribbon button, four commands, date-range selection and time-zone settings.
- Added open-only bridge protocol 1 and native URL handling. Cold launch, a closed main window and a minimized window restore the App with the requested dates.
- Different vaults require explicit folder confirmation. App sync history and the Swift parser remain authoritative; exported item URLs never start a sync.
- Implemented locally with App 0.3.0 / build 4. The P1 plugin did not sync directly, and public v0.2.0-beta.1 does not support it.
- P1 automated checks, Obsidian host handoff tests and P0 iCloud account regression passed, including user-confirmed iPhone arrival and a 10-minute notification. See [phase records](docs/PLUGINIZATION_PROGRESS.md) for that earlier tested scope.

## v0.2.0-beta.1 — 2026-11-18

### Added / 新增

- Per-plan actions in Preview: Add, Skip, Update existing, and Add again (new copy).
- New schedules default to Add; recognized schedules default to Skip, including changed sources.
- Deliberate copies preserve previous Apple items; later matching and updates use the latest copy.
- 本周／下周／自定义范围内，每条安排可以独立决定同步方式，检测基于本机同步历史。

### Changed / 行为调整

- Update existing explicitly reapplies source title, time, completion and notification settings to the linked export, including overriding corresponding phone-side edits.
- Unchanged re-preview keeps choices. Source/range/time-zone changes clear choices; a changed source detected at Sync requires another review before writing.
- Choices reset after an executed batch; retries of incomplete plans use Update existing.
- Sync results distinguish deliberate skips from failures and unresolved matches.

### Fixed / 修复

- Explicitly skipping a matching conflict is reported as skipped, rather than an invalid match.
- Older copies are excluded from future automatic matching and manual-link candidates.
- Calendar and Reminders keep separate notification history when only one destination is updated.
- Existing JSON history remains readable; all-skipped runs return before destination creation.

### Validation / 验证

Standalone parser, matching, selection, copy-history, legacy-JSON and notification-history tests pass. Release build and local ad-hoc signature verification pass. Native UI checks cover per-plan defaults, independent choices, re-preview persistence and reset on source edits. Actual per-plan EventKit writes, failure recovery and iPhone arrival were not re-tested for this version.

### Distribution / 分发

Apple silicon only. Deployment target macOS 14+, with broad runtime compatibility still unverified. Ad-hoc signed, not Developer ID signed or Apple-notarized. MIT subject to Commons Clause v1.0. Obsidian plugin work is a plan only; no plugin is shipped.

## v0.1.0-beta.2 — 2026-10-29

- Published under MIT subject to Commons Clause v1.0.
- Included the complete combined license in the app bundle.
- See [release notes](docs/releases/v0.1.0-beta.2.md).
