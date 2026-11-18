# Changelog / 更新记录

## v0.5.0-beta.1 — Release candidate / 待实机验收

App 0.5.0 / build 6; companion plugin 0.3.0; bridge protocol 1. Prepared on 2026-11-18 with separate App and plugin ZIPs. Automated checks and read-only native acceptance passed; live sync acceptance and public release are pending test-vault pairing and macOS permissions.

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

### Validation and limits / 验证与限制

Version-specific commands, host acceptance and unverified cases are tracked in [plugin phase records](docs/PLUGINIZATION_PROGRESS.md). Fake-backend tests cannot establish actual Apple-account writes, iPhone arrival or notification timing. Those require separate live checks; earlier P0 results are not a claim that every P3 path has been tested on an iPhone.

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
