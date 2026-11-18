import Foundation
import EventKit
import PlannerCore

@MainActor
extension PlannerModel {
    var historyStore: PlannerHistoryStore {
        PlannerHistoryStore(root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ObsidianPlanner", isDirectory: true))
    }
    func updateSyncPreview() {
        do {
            let result = try PlannerPreviewEngine(history: historyStore).preview(try previewInput())
            entries = result.entries; issues = result.issues
            applyPreviewMatches(result)
        } catch { issues.append("Cannot read sync history: \(error.localizedDescription)") }
    }
    func makeExportBackend() -> EventKitExportBackend {
        EventKitExportBackend(store: store, defaults: defaults, calendarSourceID: calendarSource, reminderSourceID: reminderSource)
    }
    func displaySyncResult(_ result: SyncBatchResult) {
        let counts = result.counts
        syncSummary = "Calendar saved: \(counts.calendarSaved) · Reminders saved: \(counts.remindersSaved) · Skipped: \(counts.skipped) · Failed: \(counts.failed) · Unresolved: \(counts.unresolved)."
        message = result.message
        if counts.calendarSaved + counts.remindersSaved > 0 {
            lastSync = Date(); defaults.set(lastSync, forKey: "lastSync")
        }
        planChoices = [:]; resolutions = [:]
        updateSyncPreview()
        issues += result.items.filter { $0.status == "failed" || $0.status == "unresolved" }.map { "\($0.date) \($0.title): \($0.message)" }
        refreshAccess()
    }
    func sync() async {
        guard !busy else { return }
        guard pendingBridgeRequest == nil else { message = "Confirm or dismiss the vault request from Obsidian before syncing."; return }
        let reviewedEntries = entries
        let reviewedSnapshot = lastSnapshot
        let choices = planChoices
        var selectedResolutions = resolutions
        for match in conflicts where selectedResolutions[match.entry.id] == nil { selectedResolutions[match.entry.id] = "skip" }
        busy = true; defer { busy = false }
        do {
            let input = try previewInput()
            let current = try PlannerPreviewEngine(history: historyStore).preview(input)
            if let reviewedSnapshot, reviewedSnapshot != current.snapshot {
                entries = current.entries; issues = current.issues; applyPreviewMatches(current)
                planChoices = [:]; resolutions = [:]
                message = "Saved notes or sync history changed. Review this fresh preview and choose actions again. Nothing was written."
                return
            }
            if !reviewedEntries.isEmpty && reviewedEntries != current.entries {
                entries = current.entries; issues = current.issues; applyPreviewMatches(current)
                planChoices = [:]; resolutions = [:]
                message = "Schedules changed. Review the fresh preview before syncing. Nothing was written."
                return
            }
            guard !current.entries.isEmpty else { preview(); return }
            defaults.set(calendarSource, forKey: "calendarSource"); defaults.set(reminderSource, forKey: "reminderSource")
            let result = await PlannerSyncExecutor(history: historyStore).execute(input: input, expectedSnapshot: current.snapshot,
                choices: choices, resolutions: selectedResolutions, backend: makeExportBackend())
            displaySyncResult(result)
        } catch { message = error.localizedDescription }
    }
}
