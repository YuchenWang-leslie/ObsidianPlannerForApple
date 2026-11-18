import Foundation

func runSelectionTests() {
    let zone = TimeZone(identifier: "Asia/Shanghai")!
    let entries = DayPlannerParser.parse(text: """
    # Day planner
    - [ ] 09:00 - 10:00 Previously exported
    - [ ] 11:00 - 12:00 New work
    """, date: "2026-11-18", timeZone: zone).entries
    let old = SyncRecord(entry: entries[0], eventID: "old-event", reminderID: "old-reminder")
    let matches = SyncMatcher.match(entries: entries, records: [old])
    func select(_ choices: [String: PlanSyncChoice] = [:]) -> [SelectedSyncPlan] {
        SyncSelection.plan(matches: matches, records: [old], choices: choices, resolutions: [:])
    }
    XCTAssertEqual(select().map(\.action), [.skip, .create])
    XCTAssertEqual(select([entries[1].id: .skip]).map(\.action), [.skip, .skip])
    XCTAssertEqual(select([entries[0].id: .update]).map(\.action), [.update, .create])
    XCTAssertEqual(select([entries[0].id: .addAgain, entries[1].id: .skip]).map(\.action), [.addAgain, .skip])
    XCTAssertEqual(select([entries[1].id: .update]).map(\.action), [.skip, .conflict])
    XCTAssertEqual(select([entries[1].id: .addAgain]).map(\.action), [.skip, .conflict])
    XCTAssertEqual(select([entries[0].id: .add]).map(\.action), [.conflict, .create])

    var records = [old]
    let updated = SyncSelection.prepareRecord(for: select([entries[0].id: .update])[0], records: &records)
    XCTAssertEqual(updated.id, old.id)
    XCTAssertEqual(records.count, 1)
    let copyPlan = select([entries[0].id: .addAgain])[0]
    let copy = SyncSelection.prepareRecord(for: copyPlan, records: &records)
    XCTAssertNotEqual(copy.id, old.id)
    XCTAssertEqual(copy.eventID, nil)
    XCTAssertEqual(copy.reminderID, nil)
    XCTAssertEqual(copy.notification, "None:10")
    XCTAssertEqual(records[0].supersededBy, copy.id)
    XCTAssertEqual(records[0].eventID, "old-event")
    XCTAssertEqual(records[0].reminderID, "old-reminder")
    XCTAssertEqual(records[0].entry, old.entry)
    XCTAssertEqual(records.count, 2)
    // Even before either target is saved, a retry finds the prepared latest copy.
    let latest = SyncMatcher.match(entries: [entries[0]], records: records)
    XCTAssertEqual(latest.first?.record?.id, copy.id)
    XCTAssertEqual(latest.first?.action, .unchanged)
    var changed = entries[0]
    changed.title = "Renamed work"
    let latestEdit = SyncMatcher.match(entries: [changed], records: records)
    XCTAssertEqual(latestEdit.first?.action, .update)
    XCTAssertEqual(latestEdit.first?.record?.id, copy.id)
    let secondCopyPlan = SyncSelection.plan(matches: latest, records: records, choices: [entries[0].id: .addAgain], resolutions: [:])[0]
    let secondCopy = SyncSelection.prepareRecord(for: secondCopyPlan, records: &records)
    XCTAssertEqual(records[0].supersededBy, copy.id)
    XCTAssertEqual(records[1].supersededBy, secondCopy.id)
    XCTAssertEqual(SyncMatcher.match(entries: [entries[0]], records: records).first?.record?.id, secondCopy.id)
    let created = SyncSelection.prepareRecord(for: select()[1], records: &records)
    XCTAssertEqual(created.entry, entries[1])
    XCTAssertEqual(records.last?.id, created.id)

    // Old persisted files have no supersededBy key.
    let oldData = try! JSONEncoder().encode(old)
    var json = try! JSONSerialization.jsonObject(with: oldData) as! [String: Any]
    json.removeValue(forKey: "supersededBy")
    let restored = try! JSONDecoder().decode(SyncRecord.self, from: JSONSerialization.data(withJSONObject: json))
    XCTAssertEqual(restored, old)

    changed.start = changed.start.addingTimeInterval(3600)
    changed.end = changed.end.addingTimeInterval(3600)
    let conflict = SyncMatcher.match(entries: [changed], records: [old])
    func resolve(_ choice: PlanSyncChoice? = nil, to target: String? = nil) -> [SelectedSyncPlan] {
        SyncSelection.plan(matches: conflict, records: [old], choices: choice.map { [changed.id: $0] } ?? [:], resolutions: target.map { [changed.id: $0] } ?? [:])
    }
    XCTAssertEqual(resolve().first?.action, .conflict)
    XCTAssertEqual(resolve(.skip).first?.action, .skip)
    XCTAssertEqual(resolve(to: "skip").first?.action, .skip)
    XCTAssertEqual(resolve(to: old.id).first?.action, .update)
    XCTAssertEqual(resolve(to: "new").first?.action, .create)
    XCTAssertEqual(resolve(.update, to: "new").first?.action, .conflict)
    XCTAssertEqual(resolve(.skip, to: old.id).first?.action, .skip)
    let duplicateConflict = SyncMatch(entry: entries[1], record: nil, action: .conflict, reason: "Manual choice needed")
    let duplicateLinks = SyncSelection.plan(matches: conflict + [duplicateConflict], records: [old], choices: [:], resolutions: [changed.id: old.id, entries[1].id: old.id])
    XCTAssertEqual(duplicateLinks.map(\.action), [.conflict, .conflict])
    let skippedLink = SyncSelection.plan(matches: conflict + [duplicateConflict], records: [old], choices: [entries[1].id: .skip], resolutions: [changed.id: old.id, entries[1].id: old.id])
    XCTAssertEqual(skippedLink.map(\.action), [.update, .skip])
    let retiredLink = SyncSelection.plan(matches: conflict, records: records, choices: [:], resolutions: [changed.id: old.id])
    XCTAssertEqual(retiredLink.first?.action, .conflict)
    let reserved = SyncSelection.plan(matches: [matches[0], duplicateConflict], records: [old], choices: [:], resolutions: [entries[1].id: old.id])
    XCTAssertEqual(reserved.map(\.action), [.skip, .conflict])
    print("PASS per-plan selection: defaults, skip/update/add again, latest-copy retry matching, legacy JSON, manual links, reuse rejection")
}
