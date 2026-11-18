import Foundation

func runNotificationHistoryTests() {
    let start = Date(timeIntervalSince1970: 1_800_000_000)
    let entry = ScheduleEntry(id: "test", date: "2026-11-18", line: 2, title: "Work", start: start, end: start.addingTimeInterval(3600), completed: false)
    var record = SyncRecord(entry: entry, notification: "Both:10")
    XCTAssertEqual(record.notification(forCalendar: true), "Both:10")
    XCTAssertEqual(record.notification(forCalendar: false), "Both:10")
    // Calendar is disabled; saving Reminders with no alarm must retain the calendar alarm's state.
    record.recordNotification("None:10", forCalendar: false)
    XCTAssertEqual(record.notification(forCalendar: true), "Both:10")
    XCTAssertEqual(record.notification(forCalendar: false), "None:10")
    XCTAssertEqual(record.notification, "None:10")
    // When Calendar is enabled again, its previous Both:10 alarm can be found and removed.
    record.recordNotification("None:10", forCalendar: true)
    XCTAssertEqual(record.notification(forCalendar: true), "None:10")
    XCTAssertEqual(record.notification(forCalendar: false), "None:10")

    // Partial success: only Calendar's settings advance until the reminder write succeeds.
    record.recordNotification("Both:20", forCalendar: true)
    XCTAssertEqual(record.notification(forCalendar: true), "Both:20")
    XCTAssertEqual(record.notification(forCalendar: false), "None:10")
    record.recordNotification("Both:20", forCalendar: false)
    XCTAssertEqual(record.notification(forCalendar: false), "Both:20")
    let roundTrip = try! JSONDecoder().decode(SyncRecord.self, from: JSONEncoder().encode(record))
    XCTAssertEqual(roundTrip, record)

    // Files written before per-target bookkeeping omit both fields.
    var json = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) as! [String: Any]
    json.removeValue(forKey: "calendarNotification")
    json.removeValue(forKey: "reminderNotification")
    json["notification"] = "Calendar:15"
    var legacy = try! JSONDecoder().decode(SyncRecord.self, from: JSONSerialization.data(withJSONObject: json))
    XCTAssertEqual(legacy.calendarNotification, nil)
    XCTAssertEqual(legacy.reminderNotification, nil)
    XCTAssertEqual(legacy.notification(forCalendar: true), "Calendar:15")
    XCTAssertEqual(legacy.notification(forCalendar: false), "Calendar:15")
    legacy.recordNotification("Reminders:5", forCalendar: false)
    XCTAssertEqual(legacy.notification(forCalendar: true), "Calendar:15")
    XCTAssertEqual(legacy.notification(forCalendar: false), "Reminders:5")
    print("PASS notification history: independent targets, calendar off/on, partial saves, legacy JSON")
}
