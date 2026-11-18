import Foundation

public struct PlannerNotification: Codable, Equatable, Sendable {
    public var channel: String
    public var minutes: Int
    public init(channel: String = "Reminders", minutes: Int = 10) { self.channel = channel; self.minutes = minutes }
}

public struct PlannerOptions: Codable, Equatable, Sendable {
    public var includeCalendar: Bool
    public var notification: PlannerNotification
    public init(includeCalendar: Bool = false, notification: PlannerNotification = PlannerNotification()) {
        self.includeCalendar = includeCalendar; self.notification = notification
    }
    public func validate() throws {
        guard ["Reminders", "Calendar", "Both", "None"].contains(notification.channel),
              (0...60).contains(notification.minutes), notification.minutes % 5 == 0,
              includeCalendar || !["Calendar", "Both"].contains(notification.channel) else {
            throw BridgeError("Choose valid notification settings; Calendar and Both require calendar events.")
        }
    }
}

public struct BridgePairing: Codable, Equatable, Sendable {
    public let vaultKey: String
    public let pairingToken: String
    public init(vaultKey: String, pairingToken: String) { self.vaultKey = vaultKey; self.pairingToken = pairingToken }
}

public struct BridgePreviewEntry: Codable, Equatable, Sendable {
    public let id: String
    public let filePath: String
    public let line: Int
    public let date: String
    public let title: String
    public let start: String
    public let end: String
    public let startTime: String
    public let endTime: String
    public let completed: Bool
    public let action: String
    public let selectedAction: String
    public let reason: String
}

public struct BridgePreviewCounts: Codable, Equatable, Sendable {
    public let create: Int
    public let update: Int
    public let unchanged: Int
    public let conflict: Int
    public let skipped: Int
}

public struct BridgePreview: Codable, Equatable, Sendable {
    public let previewId: String
    public let vaultKey: String
    public let vaultName: String
    public let startDate: String
    public let endDate: String
    public let timeZone: String
    public let options: PlannerOptions
    public let entries: [BridgePreviewEntry]
    public let issues: [String]
    public let counts: BridgePreviewCounts
}

public struct PlannerPreviewInput: Sendable {
    public let vaultPath: String
    public let startDate: String
    public let endDate: String
    public let timeZone: String
    public let options: PlannerOptions
    public init(vaultPath: String, startDate: String, endDate: String, timeZone: String,
                options: PlannerOptions = PlannerOptions()) {
        self.vaultPath = vaultPath; self.startDate = startDate; self.endDate = endDate
        self.timeZone = timeZone; self.options = options
    }
}

public struct PlannerPreviewResult: Sendable {
    public let entries: [ScheduleEntry]
    public let issues: [String]
    public let matches: [SyncMatch]
    public let linkCandidates: [SyncRecord]
    public let payload: BridgePreview
}

public struct PlannerPreviewEngine: Sendable {
    public let history: PlannerHistoryStore
    public init(history: PlannerHistoryStore) { self.history = history }

    public func preview(_ input: PlannerPreviewInput) throws -> PlannerPreviewResult {
        let vault = URL(fileURLWithPath: input.vaultPath, isDirectory: true)
        let id = UUID()
        try BridgeOpenRequest(requestId: id.uuidString, vaultPath: input.vaultPath,
                              vaultName: vault.lastPathComponent,
                              startDate: input.startDate, endDate: input.endDate,
                              timeZone: input.timeZone, options: input.options).validate(expectedID: id)
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: vault.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw BridgeError("The selected vault folder is unavailable.")
        }
        let zone = TimeZone(identifier: input.timeZone)!
        let first = PlannerDates.day(input.startDate, timeZone: zone)!
        let last = PlannerDates.day(input.endDate, timeZone: zone)!
        var heading = "Day planner", level = 1
        let config = vault.appendingPathComponent(".obsidian/plugins/obsidian-day-planner/data.json")
        if FileManager.default.fileExists(atPath: config.path) {
            let data = try Data(contentsOf: config)
            if let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                heading = object["plannerHeading"] as? String ?? heading
                level = object["plannerHeadingLevel"] as? Int ?? level
            }
        }
        var entries: [ScheduleEntry] = []
        var issues: [String] = []
        for day in PlannerDates.days(from: first, through: last, timeZone: zone) {
            let key = PlannerDates.string(day, timeZone: zone)
            let file = vault.appendingPathComponent(key + ".md")
            guard FileManager.default.fileExists(atPath: file.path) else { continue }
            do {
                let result = DayPlannerParser.parse(text: try String(contentsOf: file, encoding: .utf8), date: key,
                                                    timeZone: zone, heading: heading, headingLevel: level)
                entries += result.entries; issues += result.issues
            } catch { issues.append("\(key): Could not read this daily note (\(error.localizedDescription)).") }
        }
        let records = try history.load(vault: vault).filter { $0.entry.date >= input.startDate && $0.entry.date <= input.endDate }
        let matches = SyncMatcher.match(entries: entries, records: records)
        let selected = SyncSelection.plan(matches: matches, records: records, choices: [:], resolutions: [:])
        let assigned = Set(matches.filter { $0.action != .conflict }.compactMap { $0.record?.id })
        let linkCandidates = records.filter { $0.supersededBy == nil && !assigned.contains($0.id) }
        let clock = DateFormatter(); clock.locale = Locale(identifier: "en_US_POSIX")
        clock.timeZone = zone; clock.dateFormat = "HH:mm"
        let iso = ISO8601DateFormatter()
        let dtoEntries = zip(matches, selected).map { match, plan in
            BridgePreviewEntry(id: match.entry.id, filePath: match.entry.date + ".md", line: match.entry.line,
                               date: match.entry.date, title: match.entry.title, start: iso.string(from: match.entry.start),
                               end: iso.string(from: match.entry.end), startTime: clock.string(from: match.entry.start),
                               endTime: clock.string(from: match.entry.end), completed: match.entry.completed,
                               action: match.action.rawValue, selectedAction: plan.action.rawValue, reason: match.reason)
        }
        let counts = BridgePreviewCounts(create: matches.filter { $0.action == .create }.count,
                                         update: matches.filter { $0.action == .update }.count,
                                         unchanged: matches.filter { $0.action == .unchanged }.count,
                                         conflict: matches.filter { $0.action == .conflict }.count,
                                         skipped: selected.filter { $0.action == .skip }.count)
        let payload = BridgePreview(previewId: UUID().uuidString.lowercased(), vaultKey: PlannerHistoryStore.vaultKey(for: vault),
                                    vaultName: vault.lastPathComponent, startDate: input.startDate,
                                    endDate: input.endDate, timeZone: input.timeZone, options: input.options,
                                    entries: dtoEntries, issues: issues, counts: counts)
        return PlannerPreviewResult(entries: entries, issues: issues, matches: matches, linkCandidates: linkCandidates, payload: payload)
    }
}
