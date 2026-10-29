# Development checkpoints

## Public beta preparation — 2026-10-29

The user subsequently authorized a public GitHub repository named ObsidianPlannerForApple and an initial beta release. This supersedes the earlier decision to defer publication. Added licensing, Chinese usage and installation instructions with an English quick start, and a reproducible local packaging script. The initial artifact is Apple silicon only, ad-hoc signed and not notarized. All existing standalone core tests and the Release build passed; ZIP extraction, signature verification and SHA-256 verification also passed. Cross-machine installation and macOS 14–26 compatibility remain unverified.

## Local development outcome (before public beta preparation)

The user chose to finish a local-use build and defer public release. M1 connectivity is accepted on Mac and iPhone. M2 parsing and real-vault preview are verified. The ordinary M3 sync flow and M4 manual linking are tested on this Mac. Advanced failure recovery and deletion remain outside the first local build; details below.

The app is available at `dist/ObsidianPlanner.app`. The final UI is open with the user's original Vault restored, This Week selected and Reminders / 10 minutes as defaults. Real schedules have only been previewed, not exported by the developer agent.

A disposable test pair remains in DayPlanner, titled **ObsidianPlanner disposable sync test — revised**, on 2026-10-30 at 16:30–17:15; its reminder is completed. The separate DayPlanner Test items came from connection testing. These can be deleted manually after checking.

## 2026-10-29 — M1 / M2 and initial M3

### M1: native app and system connection

Implemented a SwiftUI macOS app, EventKit permission requests, account selection, and a button that creates a test event and reminder in dedicated **DayPlanner Test** containers. Local accounts are rejected for export. Account selection is explicit: a CalDAV source is not automatically treated as iCloud.

Verified on this Mac:

- Release build with macOS 14 deployment target using the installed Swift 6.4 Command Line Tools.
- Local ad-hoc signing and `codesign --verify --strict`.
- App launch and native accessibility inspection: English setup, date range, notification controls and disabled test button before authorization are present.

**Human verification completed:** the user granted both permissions and confirmed the connection test appeared in both iPhone apps. Original test procedure: grant both permissions; choose iCloud for both destinations; click Create Test Event & Reminder once; confirm the event and reminder arrive on iPhone. The test starts 20 minutes after creation, lasts 15 minutes, and defaults to a reminder 10 minutes beforehand. Each click creates a new test pair. Delete these disposable items manually afterward if desired.

M1 connection testing passed end-to-end. The user granted permissions and reported `That account does not support events.` on test creation. The account picker incorrectly mixed EventKit sources for events and reminders, which can both be named iCloud. Fixed by deriving each picker from its entity's writable nonlocal calendars and discarding saved selections not in that list. The updated app was rebuilt and relaunched. After the fix, the running app displayed `Saved one event and one reminder in DayPlanner Test`; the user-triggered local write succeeded. The user subsequently confirmed both items appeared on iPhone. Local ad-hoc signatures can cause macOS to request permission again after rebuilding.

Only accounts with an existing writable calendar/list are shown. If one list is empty, enable the service and create a calendar/list in the corresponding Apple app, then refresh accounts.

### M2: parser and preview

Implemented strict Day Planner parsing, configured heading support, read-only daily-file scanning, this/next/custom date ranges, time-zone selection, preview rows and per-line diagnostics.

**Passed:** 9 standalone parser/date tests covering valid/completed tasks, Unicode, section boundaries, fenced code/comments, unsupported/invalid entries, duplicate sections, overlapping schedules, leap dates, custom headings, DST gaps/repeated times, Monday weeks across year boundaries and inclusive dates across DST.

The compiled preview UI was exercised against the real Vault: two schedules were shown for This Week, with zero parsing issues. The original Vault selection was restored after disposable testing. Source Markdown is never written.

### M3: initial sync implementation

Implemented pure matching and a first EventKit sync path:

- One event and one reminder per entry in **DayPlanner** containers.
- Local atomic JSON history, separate IDs for each target and remote ownership markers.
- Exact matching ignores line changes; unambiguous title/time/completion edits update existing records.
- Identical duplicates pair one-to-one; ambiguous edits are skipped with a reason.
- Unchanged sources preserve phone-side edits; changes conflicting with external edits are skipped.
- Save after each target, report partial success, and retry by pressing Sync again.
- Date-range filtering prevents unrelated history outside the selected range from blocking new exports.
- Source is re-read on Sync. Notifications and future alarm times are handled separately from entry creation.

**Passed:** standalone matching assertions for create, repeat, inserted lines, title/time/completion updates, update plus new entry, duplicate pairing, ambiguous/competing matches and JSON encoding/decoding.

**Integration checks passed on this Mac:**

- First disposable export: Calendar saved 1; Reminders saved 1.
- Second export: Calendar saved 0; Reminders saved 0; Unchanged 1.
- Time edit: updated both targets; local history retained the same task/event/reminder IDs, with exactly one mapped task.
- Completion edit: saved successfully and persisted completed status.
- Title and time changed together: preview showed conflict; selecting the old record updated the existing pair. IDs remained unchanged.

**Still unverified:** injected partial-save failures/crashes, concurrent phone-side edits, and exact notification delivery time. Connection-test cross-device arrival was confirmed by the user; the later disposable update sequence was verified locally.

### Intentional simplifications

Per the user's request to keep this lightweight, the first implementation uses Swift Package Manager and JSON state rather than an Xcode project, SQLite or a generalized operation-journal framework. It is a local, non-sandboxed, ad-hoc-signed development build. The normal macOS Calendar and Reminders permission prompts still apply.

No deletion feature, automatic background sync, full state-loss recovery, or release automation yet. Ambiguous source edits can be manually linked or explicitly created as new in the preview. Conflicting outside edits are skipped; an overwrite UI is not yet implemented. History is keyed by the selected Vault's path; moving the Vault is not supported as a transparent migration. Do not delete its Application Support state to resolve an error.

### Commands

```sh
./scripts/test-core.sh
./scripts/build-app.sh
open dist/ObsidianPlanner.app
```

`swift test` currently fails because this machine's Command Line Tools installation lacks XCTest. Standard XCTest tests remain in the repository for a full Xcode environment; the standalone script compiles the same production core with `swiftc` and executes tests without external dependencies.

### M4: daily-use interface

Implemented separate source/destinations, date range and notification sections, primary Sync button, preview action labels, last-run timestamp, issue summaries and a collapsed connection-test section. Manual resolution supports linking an existing record, creating a new record or skipping. Reusing a record for multiple resolutions is rejected by tested core logic.

Verified the compiled UI, manual-link workflow, restored real Vault, and repeat preview. The app stays read-only toward source Markdown. Configuration controls are disabled during async sync, and preview state clears before parsing so failed input cannot export an old preview.

### M5: deferred by user

Public GitHub Release, licensing and Developer ID signing are deferred. Local ad-hoc signing is sufficient for the current development build, but recompilation may require granting the same macOS permissions again. No remote repository or release was created.

### Follow-up verification

Use real daily schedules normally; report any sync error with the displayed message. Further work should prioritize actual failures and common formatting needs. Crash injection, outside-edit conflict UI, deletion previews, Vault-move migration and public-release packaging are not prerequisites for this first local-use build.
