import Foundation

public struct SyncRecord: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var entry: ScheduleEntry
    public var eventID: String?
    public var reminderID: String?
    public var notification: String

    public init(id: String = UUID().uuidString, entry: ScheduleEntry, eventID: String? = nil,
                reminderID: String? = nil, notification: String = "Reminders:10") {
        self.id = id; self.entry = entry; self.eventID = eventID
        self.reminderID = reminderID; self.notification = notification
    }
}

public enum MatchAction: String, Codable, Sendable {
    case create, update, unchanged, conflict
}

public struct SyncMatch: Identifiable, Sendable {
    public let entry: ScheduleEntry
    public let record: SyncRecord?
    public let action: MatchAction
    public let reason: String
    public var id: String { entry.id }

    public init(entry: ScheduleEntry, record: SyncRecord?, action: MatchAction, reason: String) {
        self.entry = entry; self.record = record; self.action = action; self.reason = reason
    }
}

public enum SyncMatcher {
    public static func match(entries: [ScheduleEntry], records: [SyncRecord]) -> [SyncMatch] {
        var matches: [Int: SyncMatch] = [:]
        var remainingRecords = Set(records.indices)
        var remainingEntries = Set(entries.indices)

        // Exact schedule matches are paired in source order. Line numbers are never persistent identities.
        for index in entries.indices {
            let entry = entries[index]
            let candidates = remainingRecords.sorted().filter { sameSchedule(entry, records[$0].entry) }
            guard !candidates.isEmpty else { continue }
            // Prefer the same completion state when otherwise identical duplicate tasks change order.
            let chosen = candidates.first { records[$0].entry.completed == entry.completed } ?? candidates[0]
            let record = records[chosen]
            let changed = entry.completed != record.entry.completed
            let duplicateChanged = changed && records.filter { sameSchedule($0.entry, record.entry) }.count > 1
            matches[index] = SyncMatch(entry: entry, record: duplicateChanged ? nil : record,
                                   action: duplicateChanged ? .conflict : (changed ? .update : .unchanged),
                                   reason: duplicateChanged ? "Completion changed on indistinguishable duplicates." : (changed ? "Completion changed." : "Already synced."))
            remainingEntries.remove(index)
            remainingRecords.remove(chosen)
        }

        // Compute candidates before assigning any, so processing order cannot turn an ambiguous match into a unique one.
        var candidates: [Int: [Int]] = [:]
        for index in remainingEntries {
            candidates[index] = remainingRecords.sorted().filter { recordIndex in
                let old = records[recordIndex].entry
                let entry = entries[index]
                return entry.date == old.date && (entry.title == old.title || (entry.start == old.start && entry.end == old.end))
            }
        }
        for index in remainingEntries.sorted() {
            let entry = entries[index]
            let options = candidates[index] ?? []
            if options.count == 1 {
                let recordIndex = options[0]
                let record = records[recordIndex]
                let reverseCount = candidates.values.filter { $0.contains(recordIndex) }.count
                let wasDuplicate = records.filter { sameSchedule($0.entry, record.entry) }.count > 1
                if reverseCount == 1 && !wasDuplicate {
                    matches[index] = SyncMatch(entry: entry, record: record, action: .update, reason: "Title or time changed.")
                    remainingRecords.remove(recordIndex)
                    continue
                }
            }
        }
        for index in remainingEntries.sorted() where matches[index] == nil {
            let entry = entries[index]
            if !remainingRecords.isEmpty {
                matches[index] = SyncMatch(entry: entry, record: nil, action: .conflict,
                                       reason: "Cannot uniquely link this task to previous exports. Choose an existing task or create a new one.")
            } else {
                matches[index] = SyncMatch(entry: entry, record: nil, action: .create, reason: "New task.")
            }
        }
        return entries.indices.compactMap { matches[$0] }
    }

    public static func resolve(matches: [SyncMatch], records: [SyncRecord], choices: [String: String]) -> [SyncMatch] {
        let alreadyUsed = Set(matches.filter { $0.action != .conflict }.compactMap { $0.record?.id })
        let linkChoices = matches.filter { $0.action == .conflict }.compactMap { choices[$0.entry.id] }.filter { $0 != "new" }
        return matches.map { match in
            guard match.action == .conflict, let choice = choices[match.entry.id] else { return match }
            if choice == "new" {
                return SyncMatch(entry: match.entry, record: nil, action: .create, reason: "Create as a new task, as selected.")
            }
            guard let record = records.first(where: { $0.id == choice }) else {
                return SyncMatch(entry: match.entry, record: nil, action: .conflict, reason: "The selected previous task is unavailable. Choose again.")
            }
            guard !alreadyUsed.contains(choice), linkChoices.filter({ $0 == choice }).count == 1 else {
                return SyncMatch(entry: match.entry, record: nil, action: .conflict, reason: "This previous task is linked to more than one entry. Choose a different task.")
            }
            return SyncMatch(entry: match.entry, record: record, action: .update, reason: "Linked to the previous task you selected.")
        }
    }

    private static func sameSchedule(_ lhs: ScheduleEntry, _ rhs: ScheduleEntry) -> Bool {
        lhs.date == rhs.date && lhs.title == rhs.title && lhs.start == rhs.start && lhs.end == rhs.end
    }
}
