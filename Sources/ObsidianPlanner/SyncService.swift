import Foundation
import EventKit
import CryptoKit
import PlannerCore

@MainActor
extension PlannerModel {
    private var vaultKey: String {
        SHA256.hash(data: Data((vault?.standardizedFileURL.path ?? "").utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private var stateURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ObsidianPlanner").appendingPathComponent(vaultKey + ".json")
    }
    private func loadRecords() throws -> [SyncRecord] {
        guard FileManager.default.fileExists(atPath: stateURL.path) else { return [] }
        return try JSONDecoder().decode([SyncRecord].self, from: Data(contentsOf: stateURL))
    }
    private func saveRecords(_ records: [SyncRecord]) throws {
        try FileManager.default.createDirectory(at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(records).write(to: stateURL, options: .atomic)
    }
    private func selectedRecords(_ records: [SyncRecord]) throws -> [SyncRecord] {
        let (first, last, cal) = try bounds()
        let firstKey = PlannerDates.string(first, timeZone: cal.timeZone)
        let lastKey = PlannerDates.string(last, timeZone: cal.timeZone)
        return records.filter { $0.entry.date >= firstKey && $0.entry.date <= lastKey }
    }
    func updateSyncPreview() {
        do {
            let matches = SyncMatcher.match(entries: entries, records: try selectedRecords(loadRecords()))
            conflicts = matches.filter { $0.action == .conflict }
            let assigned = Set(matches.filter { $0.action != .conflict }.compactMap { $0.record?.id })
            linkCandidates = try selectedRecords(loadRecords()).filter { !assigned.contains($0.id) }
            syncActions = Dictionary(uniqueKeysWithValues: matches.map { ($0.entry.id, $0.action.rawValue) })
        } catch { issues.append("Cannot read sync history: \(error.localizedDescription)") }
    }
    private func destination(_ type: EKEntityType, sourceID: String) throws -> EKCalendar {
        guard let source = store.source(withIdentifier: sourceID), source.sourceType != .local else {
            throw AppError("Choose your iCloud account for both destinations.")
        }
        let key = type == .event ? "eventCalendarID" : "reminderCalendarID"
        if let id = defaults.string(forKey: key) {
            guard let calendar = store.calendar(withIdentifier: id), calendar.source.sourceIdentifier == sourceID, calendar.allowsContentModifications else {
                throw AppError("The saved DayPlanner destination is unavailable or the selected account changed. Restore the original destination/account before syncing.")
            }
            return calendar
        }
        let matches = store.calendars(for: type).filter { $0.source.sourceIdentifier == sourceID && $0.title == "DayPlanner" && $0.allowsContentModifications }
        guard matches.count <= 1 else { throw AppError("Multiple DayPlanner destinations found in this account. Rename duplicates first.") }
        let result: EKCalendar
        if let existing = matches.first { result = existing }
        else {
            result = EKCalendar(for: type, eventStore: store); result.title = "DayPlanner"; result.source = source
            try store.saveCalendar(result, commit: true)
        }
        defaults.set(result.calendarIdentifier, forKey: key)
        return result
    }
    private func fetchReminders(_ calendar: EKCalendar) async -> [EKReminder] {
        await withCheckedContinuation { continuation in
            store.fetchReminders(matching: store.predicateForReminders(in: [calendar])) { items in
                continuation.resume(returning: items ?? [])
            }
        }
    }
    private func marker(_ record: SyncRecord) -> String { "ObsidianPlanner:v1:\(vaultKey):\(record.id)" }
    private func managedURL(_ record: SyncRecord) -> URL {
        URL(string: "obsidianplanner://sync/\(vaultKey)/\(record.id)")!
    }
    private func hasMarker(_ item: EKCalendarItem, _ record: SyncRecord) -> Bool {
        item.url == managedURL(record) || item.notes?.components(separatedBy: .newlines).contains(marker(record)) == true
    }
    private func setNotes(_ item: EKCalendarItem, record: SyncRecord, entry: ScheduleEntry, calendar: Calendar) {
        let old = (item.notes ?? "").components(separatedBy: .newlines)
            .filter { !$0.hasPrefix("ObsidianPlanner:v1:") && !$0.hasPrefix("ObsidianPlanner source:") && !$0.hasPrefix("Time: ") }
            .joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        let format = DateFormatter(); format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = calendar.timeZone; format.dateFormat = "HH:mm"
        let time = "Time: \(format.string(from: entry.start)) – \(format.string(from: entry.end))"
        item.notes = [time, old].filter { !$0.isEmpty }.joined(separator: "\n")
        if item.url == nil || item.url?.scheme == "obsidianplanner" { item.url = managedURL(record) }
    }
    private func notesNeedUpdate(_ item: EKCalendarItem, record: SyncRecord) -> Bool {
        (item.notes ?? "").contains("ObsidianPlanner:v1:") ||
        (item.notes ?? "").contains("ObsidianPlanner source:") ||
        (!(item.notes ?? "").contains("Time: ")) || (item.url == nil)
    }
    private func setAlarm(_ item: EKCalendarItem, entry: ScheduleEntry, old: SyncRecord, isEvent: Bool) {
        let parts = old.notification.split(separator: ":")
        let oldChannel = parts.first.map(String.init) ?? "None"
        let oldMinutes = parts.last.flatMap { Int($0) } ?? 10
        let channel = isEvent ? "Calendar" : "Reminders"
        if oldChannel == channel || oldChannel == "Both" {
            for alarm in item.alarms ?? [] {
                if isEvent && alarm.absoluteDate == nil && alarm.relativeOffset == -Double(oldMinutes * 60) {
                    item.removeAlarm(alarm)
                } else if !isEvent && alarm.absoluteDate == old.entry.start.addingTimeInterval(-Double(oldMinutes * 60)) {
                    item.removeAlarm(alarm)
                }
            }
        }
        let fire = entry.start.addingTimeInterval(-Double(minutes * 60))
        if (notice == channel || notice == "Both") && fire > Date() && !entry.completed {
            if isEvent {
                if !(item.alarms ?? []).contains(where: { $0.absoluteDate == nil && $0.relativeOffset == -Double(minutes * 60) }) {
                    item.addAlarm(EKAlarm(relativeOffset: -Double(minutes * 60)))
                }
            } else if !(item.alarms ?? []).contains(where: { $0.absoluteDate == fire }) {
                item.addAlarm(EKAlarm(absoluteDate: fire))
            }
        }
    }
    private func eventMatches(_ event: EKEvent, _ entry: ScheduleEntry) -> Bool {
        event.title == entry.title && event.startDate == entry.start && event.endDate == entry.end
    }
    private func reminderMatches(_ reminder: EKReminder, _ entry: ScheduleEntry, calendar: Calendar) -> Bool {
        guard let components = reminder.dueDateComponents, let due = calendar.date(from: components) else { return false }
        return reminder.title == entry.title && abs(due.timeIntervalSince(entry.start)) < 1 && reminder.isCompleted == entry.completed
    }
    func sync() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        // Read current source again instead of writing an old preview.
        preview()
        guard !entries.isEmpty else { return }
        var calendarCount = 0, reminderCount = 0, unchanged = 0
        var failures: [String] = []
        do {
            guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { throw AppError("Reminders access is required.") }
            if includeCalendar && EKEventStore.authorizationStatus(for: .event) != .fullAccess { throw AppError("Calendar access is required when calendar events are enabled.") }
            var records = try loadRecords()
            let candidates = try selectedRecords(records)
            let plans = SyncMatcher.resolve(matches: SyncMatcher.match(entries: entries, records: candidates), records: candidates, choices: resolutions)
            let eventCalendar = includeCalendar ? try destination(.event, sourceID: calendarSource) : nil
            let reminderCalendar = try destination(.reminder, sourceID: reminderSource)
            defaults.set(calendarSource, forKey: "calendarSource"); defaults.set(reminderSource, forKey: "reminderSource")
            let (first, last, cal) = try bounds()
            let afterLast = cal.date(byAdding: .day, value: 1, to: last)!
            let events = eventCalendar.map { store.events(matching: store.predicateForEvents(withStart: first, end: afterLast, calendars: [$0])) } ?? []
            let reminders = await fetchReminders(reminderCalendar)
            let knownMarkers = Set(records.map { marker($0) })
            let prefix = "ObsidianPlanner:v1:\(vaultKey):"
            for item in (events as [EKCalendarItem]) + (reminders as [EKCalendarItem]) {
                if let url = item.url, url.scheme == "obsidianplanner", url.host == "sync", url.pathComponents.dropFirst().first == vaultKey,
                   !records.contains(where: { managedURL($0) == url }) {
                    throw AppError("Existing exports have no matching local history. Restore your sync history before exporting again.")
                }
                if let mark = item.notes?.components(separatedBy: .newlines).first(where: { $0.hasPrefix(prefix) }), !knownMarkers.contains(mark) {
                    throw AppError("Existing exports have no matching local history. Restore your sync history before exporting again.")
                }
            }
            for plan in plans {
                let entry = plan.entry
                if plan.action == .conflict { failures.append("\(entry.date):\(entry.line) \(plan.reason)"); continue }
                var record = plan.record ?? SyncRecord(entry: entry)
                let event = record.eventID.flatMap { store.calendarItem(withIdentifier: $0) as? EKEvent }
                    ?? events.first(where: { hasMarker($0, record) })
                let reminder = record.reminderID.flatMap { store.calendarItem(withIdentifier: $0) as? EKReminder }
                    ?? reminders.first(where: { hasMarker($0, record) })
                do {
                    if (includeCalendar && record.eventID != nil && event == nil) || (record.reminderID != nil && reminder == nil) {
                        throw AppError("An exported item was removed. Restore it before syncing this entry.")
                    }
                    if includeCalendar, let event, (event.calendar.calendarIdentifier != eventCalendar?.calendarIdentifier || (record.eventID != event.calendarItemIdentifier && !hasMarker(event, record))) { throw AppError("Calendar ownership changed; skipped.") }
                    if let reminder, (reminder.calendar.calendarIdentifier != reminderCalendar.calendarIdentifier || (record.reminderID != reminder.calendarItemIdentifier && !hasMarker(reminder, record))) { throw AppError("Reminder ownership changed; skipped.") }
                    let notification = "\(notice):\(minutes)"
                    let changed = plan.action != .unchanged || record.notification != notification
                    let migrationNeeded = (reminder.map { notesNeedUpdate($0, record: record) } ?? true) || (includeCalendar && (event.map { notesNeedUpdate($0, record: record) } ?? true))
                    if !changed && !migrationNeeded && reminder != nil && (!includeCalendar || event != nil) { unchanged += 1; continue }
                    if includeCalendar, let event, !eventMatches(event, record.entry) && !eventMatches(event, entry) { throw AppError("Calendar was edited outside the app; skipped to preserve that edit.") }
                    if let reminder, !reminderMatches(reminder, record.entry, calendar: cal) && !reminderMatches(reminder, entry, calendar: cal) { throw AppError("Reminder was edited outside the app; skipped to preserve that edit.") }
                    let index: Int
                    if let existing = records.firstIndex(where: { $0.id == record.id }) { index = existing }
                    else { records.append(record); index = records.count - 1; try saveRecords(records) }
                    if let eventCalendar {
                        let targetEvent = event ?? EKEvent(eventStore: store)
                        targetEvent.calendar = eventCalendar; targetEvent.title = entry.title
                        targetEvent.startDate = entry.start; targetEvent.endDate = entry.end; targetEvent.timeZone = cal.timeZone
                        setNotes(targetEvent, record: record, entry: entry, calendar: cal); setAlarm(targetEvent, entry: entry, old: record, isEvent: true)
                        try store.save(targetEvent, span: .thisEvent, commit: true)
                        calendarCount += 1
                        record.eventID = targetEvent.calendarItemIdentifier; records[index] = record; try saveRecords(records)
                    }
                    let targetReminder = reminder ?? EKReminder(eventStore: store)
                    targetReminder.calendar = reminderCalendar; targetReminder.title = entry.title
                    let components = cal.dateComponents([.year, .month, .day, .hour, .minute, .timeZone], from: entry.start)
                    targetReminder.startDateComponents = components; targetReminder.dueDateComponents = components
                    targetReminder.isCompleted = entry.completed
                    setNotes(targetReminder, record: record, entry: entry, calendar: cal); setAlarm(targetReminder, entry: entry, old: record, isEvent: false)
                    try store.save(targetReminder, commit: true)
                    reminderCount += 1
                    record.reminderID = targetReminder.calendarItemIdentifier; record.entry = entry; record.notification = notification
                    records[index] = record; try saveRecords(records)
                } catch { failures.append("\(entry.date):\(entry.line) \(error.localizedDescription)") }
            }
            lastSync = Date(); defaults.set(lastSync, forKey: "lastSync")
            updateSyncPreview()
            syncSummary = "Calendar saved: \(calendarCount) · Reminders saved: \(reminderCount) · Unchanged: \(unchanged) · Skipped/failed: \(failures.count)."
            issues += failures
            message = "Sync finished on this Mac. Check your iPhone after iCloud sync. Run Sync again to retry incomplete entries."
        } catch { message = error.localizedDescription }
    }
}
