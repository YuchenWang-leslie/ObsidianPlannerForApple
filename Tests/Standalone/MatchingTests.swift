import Foundation

func runMatchingTests() {
    let zone = TimeZone(identifier: "Asia/Shanghai")!
    func task(_ title: String = "Work", _ start: String = "09:00", _ end: String = "10:00", completed: Bool = false, line: Int = 2) -> ScheduleEntry {
        var entry = DayPlannerParser.parse(text: "# Day planner\n- [\(completed ? "x" : " ")] \(start) - \(end) \(title)", date: "2026-10-29", timeZone: zone).entries[0]
        entry.line = line; entry.id = "2026-10-29:\(line)"
        return entry
    }
    let original = task()
    let record = SyncRecord(entry: original, eventID: "event", reminderID: "reminder")
    XCTAssertEqual(SyncMatcher.match(entries: [original], records: []).map(\.action), [.create])
    XCTAssertEqual(SyncMatcher.match(entries: [original], records: [record]).map(\.action), [.unchanged])
    XCTAssertEqual(SyncMatcher.match(entries: [task(line: 12)], records: [record]).map(\.action), [.unchanged])
    XCTAssertEqual(SyncMatcher.match(entries: [task("Rename")], records: [record]).map(\.action), [.update])
    XCTAssertEqual(SyncMatcher.match(entries: [task("Work", "11:00", "12:00")], records: [record]).map(\.action), [.update])
    XCTAssertEqual(SyncMatcher.match(entries: [task(completed: true)], records: [record]).map(\.action), [.update])
    XCTAssertEqual(SyncMatcher.match(entries: [task("Rename", "11:00", "12:00")], records: [record]).map(\.action), [.conflict])
    let secondRecord = SyncRecord(entry: task(line: 3))
    let duplicateMatches = SyncMatcher.match(entries: [original, task(line: 3)], records: [record, secondRecord])
    XCTAssertEqual(duplicateMatches.map(\.action), [.unchanged, .unchanged])
    XCTAssertEqual(Set(duplicateMatches.compactMap { $0.record?.id }).count, 2)
    XCTAssertEqual(SyncMatcher.match(entries: [original, task("Work", "11:00", "12:00", line: 3)], records: [record, secondRecord]).map(\.action), [.unchanged, .conflict])
    XCTAssertEqual(SyncMatcher.match(entries: [task("Rename", line: 3), task("Work", "11:00", "12:00", line: 4)], records: [record]).map(\.action), [.conflict, .conflict])
    let other = task("Other", "11:00", "12:00", line: 3)
    XCTAssertEqual(SyncMatcher.match(entries: [original, other], records: [record]).map(\.action), [.unchanged, .create])
    XCTAssertEqual(SyncMatcher.match(entries: [task("Rename"), other], records: [record]).map(\.action), [.update, .create])
    let edited = task("Rename", "11:00", "12:00")
    let conflict = SyncMatcher.match(entries: [edited], records: [record])
    let linked = SyncMatcher.resolve(matches: conflict, records: [record], choices: [edited.id: record.id])
    XCTAssertEqual(linked.map(\.action), [.update])
    XCTAssertEqual(linked.first?.record?.id, record.id)
    XCTAssertEqual(SyncMatcher.resolve(matches: conflict, records: [record], choices: [edited.id: "new"]).map(\.action), [.create])
    XCTAssertEqual(SyncMatcher.resolve(matches: conflict, records: [record], choices: [:]).map(\.action), [.conflict])
    XCTAssertEqual(SyncMatcher.resolve(matches: conflict, records: [record], choices: [edited.id: "missing"]).map(\.action), [.conflict])
    let secondEdit = task("Other edit", "13:00", "14:00", line: 3)
    let competing = SyncMatcher.match(entries: [edited, secondEdit], records: [record])
    XCTAssertEqual(SyncMatcher.resolve(matches: competing, records: [record], choices: [edited.id: record.id, secondEdit.id: record.id]).map(\.action), [.conflict, .conflict])
    let unchanged = SyncMatcher.match(entries: [original], records: [record])[0]
    let stillConflict = SyncMatch(entry: secondEdit, record: nil, action: .conflict, reason: "Needs choice")
    XCTAssertEqual(SyncMatcher.resolve(matches: [unchanged, stillConflict], records: [record], choices: [original.id: "new", secondEdit.id: record.id]).map(\.action), [.unchanged, .conflict])
    print("PASS manual resolution: link, new, skip, invalid choice, repeated link rejection, nonconflict preservation")
    let restored = try! JSONDecoder().decode(SyncRecord.self, from: JSONEncoder().encode(record))
    XCTAssertEqual(restored, record)
    print("PASS matching: create, repeat, line insert, title/time/completion updates, conflicts, duplicate pairing, Codable")
}
