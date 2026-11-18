import Foundation
import EventKit
import PlannerCore

@MainActor
final class EventKitExportBackend: PlannerExportBackend {
    private let store: EKEventStore
    private let defaults: UserDefaults
    private let calendarSourceID: String
    private let reminderSourceID: String
    private var input: PlannerPreviewInput!
    private var vaultKey = ""
    private var calendar = Calendar(identifier: .gregorian)
    private var eventCalendar: EKCalendar?
    private var reminderCalendar: EKCalendar?
    private var events: [EKEvent] = []
    private var reminders: [EKReminder] = []

    init(store: EKEventStore, defaults: UserDefaults, calendarSourceID: String, reminderSourceID: String) {
        self.store = store; self.defaults = defaults
        self.calendarSourceID = calendarSourceID; self.reminderSourceID = reminderSourceID
    }

    func prepare(records: [SyncRecord], input: PlannerPreviewInput) async throws {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
            throw SyncExecutionError(code: "PERMISSION_REQUIRED", message: "Grant Reminders access in the Mac app, then preview again before syncing.")
        }
        if input.options.includeCalendar && EKEventStore.authorizationStatus(for: .event) != .fullAccess {
            throw SyncExecutionError(code: "PERMISSION_REQUIRED", message: "Grant Calendar access in the Mac app or turn calendar events off, then preview again.")
        }
        self.input = input
        vaultKey = PlannerHistoryStore.vaultKey(for: URL(fileURLWithPath: input.vaultPath, isDirectory: true))
        calendar.timeZone = TimeZone(identifier: input.timeZone)!
        // This phase only reads. New lists are created lazily after the executor's final freshness check.
        eventCalendar = input.options.includeCalendar ? try findDestination(.event, sourceID: calendarSourceID) : nil
        reminderCalendar = try findDestination(.reminder, sourceID: reminderSourceID)
        let first = PlannerDates.day(input.startDate, timeZone: calendar.timeZone)!
        let last = PlannerDates.day(input.endDate, timeZone: calendar.timeZone)!
        let afterLast = calendar.date(byAdding: .day, value: 1, to: last)!
        events = eventCalendar.map { store.events(matching: store.predicateForEvents(withStart: first, end: afterLast, calendars: [$0])) } ?? []
        if let reminderCalendar {
            reminders = await withCheckedContinuation { continuation in
                store.fetchReminders(matching: store.predicateForReminders(in: [reminderCalendar])) { items in
                    continuation.resume(returning: items ?? [])
                }
            }
        } else { reminders = [] }
        let known = Set(records.map { marker($0) })
        let knownURLs = Set(records.map { managedURL($0) })
        let prefix = "ObsidianPlanner:v1:\(vaultKey):"
        for item in (events as [EKCalendarItem]) + (reminders as [EKCalendarItem]) {
            if let url = item.url, url.scheme == "obsidianplanner", url.host == "sync",
               url.pathComponents.dropFirst().first == vaultKey, !knownURLs.contains(url) {
                throw setup("Existing exports have no matching local history. Restore your sync history before exporting again.")
            }
            if let mark = item.notes?.components(separatedBy: .newlines).first(where: { $0.hasPrefix(prefix) }), !known.contains(mark) {
                throw setup("Existing exports have no matching local history. Restore your sync history before exporting again.")
            }
        }
    }

    func saveCalendar(entry: ScheduleEntry, record: SyncRecord) throws -> String {
        let existing = record.eventID.flatMap { store.calendarItem(withIdentifier: $0) as? EKEvent }
            ?? events.first(where: { hasMarker($0, record) })
        if record.eventID != nil && existing == nil { throw setup("An exported calendar event was removed. Restore it before updating this plan.") }
        try validateOwnership(existing, record: record, destination: eventCalendar, savedID: record.eventID)
        if eventCalendar == nil { eventCalendar = try createDestination(.event, sourceID: calendarSourceID) }
        let target = existing ?? EKEvent(eventStore: store)
        target.calendar = eventCalendar; target.title = entry.title
        target.startDate = entry.start; target.endDate = entry.end; target.timeZone = calendar.timeZone
        setNotes(target, record: record, entry: entry)
        setAlarm(target, entry: entry, old: record, isEvent: true)
        try store.save(target, span: .thisEvent, commit: true)
        defaults.set(target.calendar.calendarIdentifier, forKey: "eventCalendarID")
        return target.calendarItemIdentifier
    }

    func saveReminder(entry: ScheduleEntry, record: SyncRecord) throws -> String {
        let existing = record.reminderID.flatMap { store.calendarItem(withIdentifier: $0) as? EKReminder }
            ?? reminders.first(where: { hasMarker($0, record) })
        if record.reminderID != nil && existing == nil { throw setup("An exported reminder was removed. Restore it before updating this plan.") }
        try validateOwnership(existing, record: record, destination: reminderCalendar, savedID: record.reminderID)
        if reminderCalendar == nil { reminderCalendar = try createDestination(.reminder, sourceID: reminderSourceID) }
        let target = existing ?? EKReminder(eventStore: store)
        target.calendar = reminderCalendar; target.title = entry.title
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .timeZone], from: entry.start)
        target.startDateComponents = parts; target.dueDateComponents = parts; target.isCompleted = entry.completed
        setNotes(target, record: record, entry: entry)
        setAlarm(target, entry: entry, old: record, isEvent: false)
        try store.save(target, commit: true)
        defaults.set(target.calendar.calendarIdentifier, forKey: "reminderCalendarID")
        return target.calendarItemIdentifier
    }

    private func validateOwnership(_ item: EKCalendarItem?, record: SyncRecord, destination: EKCalendar?, savedID: String?) throws {
        guard let item else { return }
        guard let destination, item.calendar.calendarIdentifier == destination.calendarIdentifier,
              savedID == item.calendarItemIdentifier || hasMarker(item, record) else {
            throw setup("The exported item's destination or ownership changed. Restore its original DayPlanner list before updating.")
        }
    }
    private func findDestination(_ type: EKEntityType, sourceID: String) throws -> EKCalendar? {
        guard let source = store.source(withIdentifier: sourceID), source.sourceType != .local else {
            throw setup("Choose your iCloud account for the required destinations in the Mac app.")
        }
        let key = type == .event ? "eventCalendarID" : "reminderCalendarID"
        if let id = defaults.string(forKey: key) {
            guard let value = store.calendar(withIdentifier: id), value.source.sourceIdentifier == sourceID, value.allowsContentModifications else {
                throw setup("The saved DayPlanner destination is unavailable or the selected account changed. Restore the original destination/account before syncing.")
            }
            return value
        }
        let matches = store.calendars(for: type).filter { $0.source.sourceIdentifier == sourceID && $0.title == "DayPlanner" && $0.allowsContentModifications }
        guard matches.count <= 1 else { throw setup("Multiple DayPlanner destinations found in this account. Rename duplicates first.") }
        return matches.first
    }
    private func createDestination(_ type: EKEntityType, sourceID: String) throws -> EKCalendar {
        guard let source = store.source(withIdentifier: sourceID), source.sourceType != .local else { throw setup("Choose an iCloud account in the Mac app.") }
        let value = EKCalendar(for: type, eventStore: store)
        value.title = "DayPlanner"; value.source = source
        try store.saveCalendar(value, commit: true)
        defaults.set(value.calendarIdentifier, forKey: type == .event ? "eventCalendarID" : "reminderCalendarID")
        return value
    }
    private func setup(_ text: String) -> SyncExecutionError { SyncExecutionError(code: "APP_SETUP_REQUIRED", message: text) }
    private func marker(_ record: SyncRecord) -> String { "ObsidianPlanner:v1:\(vaultKey):\(record.id)" }
    private func managedURL(_ record: SyncRecord) -> URL { URL(string: "obsidianplanner://sync/\(vaultKey)/\(record.id)")! }
    private func hasMarker(_ item: EKCalendarItem, _ record: SyncRecord) -> Bool {
        item.url == managedURL(record) || item.notes?.components(separatedBy: .newlines).contains(marker(record)) == true
    }
    private func setNotes(_ item: EKCalendarItem, record: SyncRecord, entry: ScheduleEntry) {
        let old = (item.notes ?? "").components(separatedBy: .newlines)
            .filter { !$0.hasPrefix("ObsidianPlanner:v1:") && !$0.hasPrefix("ObsidianPlanner source:") && !$0.hasPrefix("Time: ") }
            .joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        let clock = DateFormatter(); clock.locale = Locale(identifier: "en_US_POSIX")
        clock.timeZone = calendar.timeZone; clock.dateFormat = "HH:mm"
        item.notes = ["Time: \(clock.string(from: entry.start)) – \(clock.string(from: entry.end))", old].filter { !$0.isEmpty }.joined(separator: "\n")
        if item.url == nil || item.url?.scheme == "obsidianplanner" { item.url = managedURL(record) }
    }
    private func setAlarm(_ item: EKCalendarItem, entry: ScheduleEntry, old: SyncRecord, isEvent: Bool) {
        let parts = old.notification(forCalendar: isEvent).split(separator: ":")
        let oldChannel = parts.first.map(String.init) ?? "None", oldMinutes = parts.last.flatMap { Int($0) } ?? 10
        let channel = isEvent ? "Calendar" : "Reminders"
        if oldChannel == channel || oldChannel == "Both" {
            for alarm in item.alarms ?? [] {
                if isEvent && alarm.absoluteDate == nil && alarm.relativeOffset == -Double(oldMinutes * 60) { item.removeAlarm(alarm) }
                else if !isEvent && alarm.absoluteDate == old.entry.start.addingTimeInterval(-Double(oldMinutes * 60)) { item.removeAlarm(alarm) }
            }
        }
        let settings = input.options.notification
        let fire = entry.start.addingTimeInterval(-Double(settings.minutes * 60))
        if (settings.channel == channel || settings.channel == "Both") && fire > Date() && !entry.completed {
            if isEvent {
                if !(item.alarms ?? []).contains(where: { $0.absoluteDate == nil && $0.relativeOffset == -Double(settings.minutes * 60) }) {
                    item.addAlarm(EKAlarm(relativeOffset: -Double(settings.minutes * 60)))
                }
            } else if !(item.alarms ?? []).contains(where: { $0.absoluteDate == fire }) { item.addAlarm(EKAlarm(absoluteDate: fire)) }
        }
    }
}
