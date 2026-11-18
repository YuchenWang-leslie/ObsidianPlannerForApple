import Foundation

public struct SyncExecutionError: LocalizedError, Equatable, Sendable {
    public let code: String
    public let message: String
    public init(code: String, message: String) { self.code = code; self.message = message }
    public var errorDescription: String? { message }
}

public struct SyncBatchCounts: Codable, Equatable, Sendable {
    public var calendarSaved: Int
    public var remindersSaved: Int
    public var skipped: Int
    public var failed: Int
    public var unresolved: Int
    public init(calendarSaved: Int = 0, remindersSaved: Int = 0, skipped: Int = 0, failed: Int = 0, unresolved: Int = 0) {
        self.calendarSaved = calendarSaved; self.remindersSaved = remindersSaved; self.skipped = skipped
        self.failed = failed; self.unresolved = unresolved
    }
}

public struct SyncItemResult: Codable, Equatable, Sendable {
    public let entryId: String
    public let title: String
    public let date: String
    public let action: String
    public let status: String
    public let calendarSaved: Bool
    public let reminderSaved: Bool
    public let message: String
    public init(entryId: String, title: String, date: String, action: String, status: String,
                calendarSaved: Bool = false, reminderSaved: Bool = false, message: String) {
        self.entryId = entryId; self.title = title; self.date = date; self.action = action; self.status = status
        self.calendarSaved = calendarSaved; self.reminderSaved = reminderSaved; self.message = message
    }
}

public struct SyncBatchResult: Codable, Equatable, Sendable {
    public let status: String
    public let message: String
    public let errorCode: String?
    public let counts: SyncBatchCounts
    public let items: [SyncItemResult]
    public init(status: String, message: String, errorCode: String? = nil,
                counts: SyncBatchCounts = SyncBatchCounts(), items: [SyncItemResult] = []) {
        self.status = status; self.message = message; self.errorCode = errorCode; self.counts = counts; self.items = items
    }
}

@MainActor
public protocol PlannerExportBackend {
    /// Read and validate only. Targets may be created lazily by a save method after the freshness check.
    func prepare(records: [SyncRecord], input: PlannerPreviewInput) async throws
    func saveCalendar(entry: ScheduleEntry, record: SyncRecord) throws -> String
    func saveReminder(entry: ScheduleEntry, record: SyncRecord) throws -> String
}

@MainActor
public struct PlannerSyncExecutor {
    public let history: PlannerHistoryStore
    public init(history: PlannerHistoryStore) { self.history = history }

    public func execute(input: PlannerPreviewInput, expectedSnapshot: PlannerPreviewSnapshot,
                        choices: [String: PlanSyncChoice], resolutions: [String: String],
                        backend: any PlannerExportBackend) async -> SyncBatchResult {
        do {
            let engine = PlannerPreviewEngine(history: history)
            let preview = try freshPreview(engine: engine, input: input, expected: expectedSnapshot)
            let entryIDs = Set(preview.entries.map(\.id))
            let conflicts = Set(preview.matches.filter { $0.action == .conflict }.map { $0.entry.id })
            let links = Set(preview.linkCandidates.map(\.id))
            guard Set(choices.keys).isSubset(of: entryIDs), Set(resolutions.keys).isSubset(of: conflicts),
                  resolutions.values.allSatisfy({ $0 == "skip" || $0 == "new" || links.contains($0) }) else {
                throw SyncExecutionError(code: "INVALID_REQUEST", message: "Sync choices must refer to entries and links in this preview.")
            }
            let plans = SyncSelection.plan(matches: preview.matches, records: preview.records, choices: choices, resolutions: resolutions)
            if plans.contains(where: { $0.action != .skip && $0.action != .conflict }) {
                try await backend.prepare(records: preview.records, input: input)
                _ = try freshPreview(engine: engine, input: input, expected: expectedSnapshot)
            }
            var records = preview.records
            let vault = URL(fileURLWithPath: input.vaultPath, isDirectory: true)
            let notification = "\(input.options.notification.channel):\(input.options.notification.minutes)"
            var counts = SyncBatchCounts()
            var items: [SyncItemResult] = []
            for plan in plans {
                let entry = plan.entry
                func item(_ status: String, _ message: String, calendar: Bool = false, reminder: Bool = false) -> SyncItemResult {
                    SyncItemResult(entryId: entry.id, title: entry.title, date: entry.date, action: plan.action.rawValue,
                                   status: status, calendarSaved: calendar, reminderSaved: reminder, message: message)
                }
                if plan.action == .skip { counts.skipped += 1; items.append(item("skipped", plan.reason)); continue }
                if plan.action == .conflict { counts.unresolved += 1; items.append(item("unresolved", plan.reason)); continue }
                var calendarSaved = false, reminderSaved = false
                do {
                    var record = SyncSelection.prepareRecord(for: plan, records: &records)
                    try history.save(records, vault: vault)
                    let index = records.firstIndex { $0.id == record.id }!
                    if input.options.includeCalendar {
                        record.eventID = try backend.saveCalendar(entry: entry, record: record)
                        calendarSaved = true; counts.calendarSaved += 1
                        record.recordNotification(notification, forCalendar: true)
                        records[index] = record
                        try history.save(records, vault: vault)
                    }
                    record.reminderID = try backend.saveReminder(entry: entry, record: record)
                    reminderSaved = true; counts.remindersSaved += 1
                    record.entry = entry
                    record.recordNotification(notification, forCalendar: false)
                    records[index] = record
                    try history.save(records, vault: vault)
                    items.append(item("saved", "Saved on this Mac.", calendar: calendarSaved, reminder: reminderSaved))
                } catch {
                    counts.failed += 1
                    items.append(item("failed", error.localizedDescription, calendar: calendarSaved, reminder: reminderSaved))
                }
            }
            let hasErrors = counts.failed + counts.unresolved > 0
            let hasSuccess = counts.calendarSaved + counts.remindersSaved + counts.skipped > 0
            let status = hasErrors ? (hasSuccess ? "partial" : "failed") : "completed"
            return SyncBatchResult(status: status, message: "Local sync finished. iPhone delivery depends on iCloud. Retry incomplete entries with Update existing.", counts: counts, items: items)
        } catch {
            let error = error as? SyncExecutionError ?? SyncExecutionError(code: "APP_SETUP_REQUIRED", message: error.localizedDescription)
            return SyncBatchResult(status: "failed", message: error.message, errorCode: error.code)
        }
    }

    private func freshPreview(engine: PlannerPreviewEngine, input: PlannerPreviewInput,
                              expected: PlannerPreviewSnapshot) throws -> PlannerPreviewResult {
        let preview: PlannerPreviewResult
        do { preview = try engine.preview(input) }
        catch { throw SyncExecutionError(code: "SOURCE_CHANGED", message: "Source or sync history is no longer readable. Refresh the preview before syncing.") }
        guard preview.snapshot == expected else {
            throw SyncExecutionError(code: "SOURCE_CHANGED", message: "Source or sync history changed. Refresh the preview before syncing.")
        }
        return preview
    }
}
