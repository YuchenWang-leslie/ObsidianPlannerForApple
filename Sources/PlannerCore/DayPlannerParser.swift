import Foundation

public struct ScheduleEntry: Identifiable, Codable, Equatable, Sendable {
    public var id: String
    public var date: String
    public var line: Int
    public var title: String
    public var start: Date
    public var end: Date
    public var completed: Bool

    public init(id: String, date: String, line: Int, title: String, start: Date, end: Date, completed: Bool) {
        self.id = id; self.date = date; self.line = line; self.title = title
        self.start = start; self.end = end; self.completed = completed
    }
}

public struct ParseResult: Sendable {
    public var entries: [ScheduleEntry]
    public var issues: [String]
    public init(entries: [ScheduleEntry], issues: [String]) { self.entries = entries; self.issues = issues }
}

public enum DayPlannerParser {
    public static func parse(text: String, date: String, timeZone: TimeZone,
                             heading: String = "Day planner", headingLevel: Int = 1) -> ParseResult {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        guard let day = PlannerDates.day(date, timeZone: timeZone) else {
            return ParseResult(entries: [], issues: ["\(date): Invalid date."])
        }
        var entries: [ScheduleEntry] = []
        var issues: [String] = []
        var inSection = false
        var sectionCount = 0
        var fence: (Character, Int)?
        var inComment = false
        let taskPattern = #"^-\s+\[([ xX])\]\s+(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})\s+(.+?)\s*$"#
        let taskRegex = try! NSRegularExpression(pattern: taskPattern)
        let headingRegex = try! NSRegularExpression(pattern: #"^(#{1,6})\s+(.+?)\s*#*\s*$"#)
        for (offset, rawLine) in text.components(separatedBy: .newlines).enumerated() {
            let lineNumber = offset + 1
            // Fenced code wins over comment syntax inside it.
            let trimmedRaw = rawLine.trimmingCharacters(in: .whitespaces)
            if let activeFence = fence {
                if trimmedRaw.first == activeFence.0,
                   trimmedRaw.prefix(while: { $0 == activeFence.0 }).count >= activeFence.1,
                   trimmedRaw.drop(while: { $0 == activeFence.0 }).trimmingCharacters(in: .whitespaces).isEmpty {
                    fence = nil
                }
                continue
            }
            var line = ""
            var rest = rawLine[...]
            while !rest.isEmpty {
                if inComment {
                    guard let close = rest.range(of: "-->") else { break }
                    rest = rest[close.upperBound...]; inComment = false
                } else if let open = rest.range(of: "<!--") {
                    line += rest[..<open.lowerBound]
                    rest = rest[open.upperBound...]; inComment = true
                } else { line += rest; break }
            }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if let char = trimmed.first, char == "`" || char == "~" {
                let count = trimmed.prefix(while: { $0 == char }).count
                if count >= 3 { fence = (char, count); continue }
            }
            let nsLine = line as NSString
            let range = NSRange(location: 0, length: nsLine.length)
            if let match = headingRegex.firstMatch(in: line, range: range) {
                let level = nsLine.substring(with: match.range(at: 1)).count
                let title = nsLine.substring(with: match.range(at: 2))
                if level == headingLevel && title == heading {
                    sectionCount += 1; inSection = true
                } else if level <= headingLevel { inSection = false }
                continue
            }
            guard inSection, !trimmed.isEmpty else { continue }
            guard trimmed.hasPrefix("- [") || trimmed.hasPrefix("* [") || trimmed.hasPrefix("+ [") else { continue }
            guard line == line.drop(while: { $0 == " " || $0 == "\t" }),
                  let match = taskRegex.firstMatch(in: line, range: range) else {
                issues.append("\(date):\(lineNumber): Unsupported task; use - [ ] HH:mm - HH:mm Title.")
                continue
            }
            func group(_ i: Int) -> String { nsLine.substring(with: match.range(at: i)) }
            guard let start = time(hour: Int(group(2))!, minute: Int(group(3))!, day: day, calendar: calendar),
                  let end = time(hour: Int(group(4))!, minute: Int(group(5))!, day: day, calendar: calendar), end > start else {
                issues.append("\(date):\(lineNumber): Invalid, ambiguous, or overnight time range.")
                continue
            }
            let title = group(6).trimmingCharacters(in: .whitespaces)
            guard !title.isEmpty else {
                issues.append("\(date):\(lineNumber): Missing title."); continue
            }
            // This ID is for preview identity only. Persistent sync identity belongs to the sync layer.
            entries.append(ScheduleEntry(id: "\(date):\(lineNumber)", date: date, line: lineNumber,
                                         title: title, start: start, end: end, completed: group(1).lowercased() == "x"))
        }
        if sectionCount > 1 {
            return ParseResult(entries: [], issues: ["\(date): Multiple '\(heading)' sections; resolve before syncing."])
        }
        let sorted = entries.sorted { $0.start < $1.start }
        for (index, entry) in sorted.enumerated() {
            if sorted.prefix(index).contains(where: { $0.end > entry.start }) {
                issues.append("\(date):\(entry.line): Overlapping schedule; retained for export.")
            }
        }
        return ParseResult(entries: entries, issues: issues)
    }

    private static func time(hour: Int, minute: Int, day: Date, calendar: Calendar) -> Date? {
        guard (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        let components = DateComponents(hour: hour, minute: minute, second: 0)
        let before = day.addingTimeInterval(-1)
        guard let first = calendar.nextDate(after: before, matching: components, matchingPolicy: .strict, repeatedTimePolicy: .first),
              let last = calendar.nextDate(after: before, matching: components, matchingPolicy: .strict, repeatedTimePolicy: .last),
              first == last, calendar.isDate(first, inSameDayAs: day) else { return nil }
        return first
    }
}

public enum PlannerDates {
    public static func day(_ value: String, timeZone: TimeZone) -> Date? {
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return nil }
        return date
    }

    public static func string(_ date: Date, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    public static func week(containing date: Date, offset: Int = 0, timeZone: TimeZone) -> (start: Date, end: Date) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let day = calendar.startOfDay(for: date)
        let daysSinceMonday = (calendar.component(.weekday, from: day) + 5) % 7
        let start = calendar.date(byAdding: .day, value: -daysSinceMonday + offset * 7, to: day)!
        return (start, calendar.date(byAdding: .day, value: 6, to: start)!)
    }

    public static func days(from start: Date, through end: Date, timeZone: TimeZone) -> [Date] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        var day = calendar.startOfDay(for: start)
        let last = calendar.startOfDay(for: end)
        var days: [Date] = []
        while day <= last {
            days.append(day)
            day = calendar.date(byAdding: .day, value: 1, to: day)!
        }
        return days
    }
}
