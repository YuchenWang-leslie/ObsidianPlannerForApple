import Foundation

public enum PlanSyncChoice: String, CaseIterable, Sendable {
    case skip, add, update, addAgain
}

public enum SelectedSyncAction: String, Sendable {
    case skip, create, update, addAgain, conflict
}

public struct SelectedSyncPlan: Sendable {
    public let entry: ScheduleEntry
    public let record: SyncRecord?
    public let action: SelectedSyncAction
    public let reason: String

    public init(entry: ScheduleEntry, record: SyncRecord?, action: SelectedSyncAction, reason: String) {
        self.entry = entry; self.record = record; self.action = action; self.reason = reason
    }
}

public enum SyncSelection {
    public static func plan(matches: [SyncMatch], records: [SyncRecord], choices: [String: PlanSyncChoice],
                            resolutions: [String: String]) -> [SelectedSyncPlan] {
        func isSkipped(_ id: String) -> Bool { choices[id] == .skip || resolutions[id] == "skip" }
        let activeResolutions = resolutions.filter { !isSkipped($0.key) }
        let resolved = SyncMatcher.resolve(matches: matches, records: records, choices: activeResolutions)
        return zip(matches, resolved).map { original, match in
            func result(_ action: SelectedSyncAction, _ reason: String) -> SelectedSyncPlan {
                SelectedSyncPlan(entry: match.entry, record: match.record, action: action, reason: reason)
            }
            if isSkipped(match.entry.id) { return result(.skip, "Skipped, as selected.") }
            if match.action == .conflict { return result(.conflict, match.reason) }
            if let choice = choices[match.entry.id] {
                switch choice {
                case .skip: return result(.skip, "Skipped, as selected.")
                case .add:
                    return match.record == nil
                        ? result(.create, "Add this new task.")
                        : result(.conflict, "This task already has an export. Choose Update or Add Again.")
                case .update:
                    return match.record != nil
                        ? result(.update, "Update the existing export, as selected.")
                        : result(.conflict, "There is no existing export to update. Choose Add.")
                case .addAgain:
                    return match.record != nil
                        ? result(.addAgain, "Add a new copy and keep the previous export.")
                        : result(.conflict, "There is no previous export to copy. Choose Add.")
                }
            }
            if original.action == .conflict {
                return result(match.record == nil ? .create : .update, match.reason)
            }
            return match.record == nil
                ? result(.create, "New task; ready to add.")
                : result(.skip, "Already exported; choose Update or Add Again to sync it.")
        }
    }

    /// Call only for actionable plans, and persist the resulting records before writing to EventKit.
    public static func prepareRecord(for plan: SelectedSyncPlan, records: inout [SyncRecord]) -> SyncRecord {
        switch plan.action {
        case .create:
            let record = SyncRecord(entry: plan.entry, notification: "None:10")
            records.append(record)
            return record
        case .update:
            // Selection ensures update targets an existing record.
            return records.first { $0.id == plan.record!.id }!
        case .addAgain:
            let record = SyncRecord(entry: plan.entry, notification: "None:10")
            let previous = records.firstIndex { $0.id == plan.record!.id }!
            records[previous].supersededBy = record.id
            records.append(record)
            return record
        case .skip, .conflict:
            preconditionFailure("Only actionable sync plans can prepare a record.")
        }
    }
}
