# Changelog / 更新记录

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
