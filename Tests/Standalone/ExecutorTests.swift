import Foundation

@MainActor
final class FakeExportBackend: PlannerExportBackend {
    var prepareCount = 0
    var eventSaves = 0
    var reminderSaves = 0
    var events: [String: ScheduleEntry] = [:]
    var reminders: [String: ScheduleEntry] = [:]
    var eventIDs: [String: String] = [:]
    var reminderIDs: [String: String] = [:]
    var failReminder = false
    var prepareError: SyncExecutionError?
    var duringPrepare: (() throws -> Void)?

    func prepare(records: [SyncRecord], input: PlannerPreviewInput) async throws {
        prepareCount += 1
        try duringPrepare?()
        if let prepareError { throw prepareError }
    }
    func saveCalendar(entry: ScheduleEntry, record: SyncRecord) throws -> String {
        eventSaves += 1
        let id = eventIDs[record.id] ?? record.eventID ?? UUID().uuidString
        eventIDs[record.id] = id; events[record.id] = entry
        return id
    }
    func saveReminder(entry: ScheduleEntry, record: SyncRecord) throws -> String {
        if failReminder { throw SyncExecutionError(code: "APP_SETUP_REQUIRED", message: "Simulated reminder failure") }
        reminderSaves += 1
        let id = reminderIDs[record.id] ?? record.reminderID ?? UUID().uuidString
        reminderIDs[record.id] = id; reminders[record.id] = entry
        return id
    }
}

@MainActor
func runExecutorTests() async {
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("PlannerExecutor-" + UUID().uuidString)
    try! fm.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: root) }
    let vault = root.appendingPathComponent("Vault")
    try! fm.createDirectory(at: vault, withIntermediateDirectories: true)
    let note = vault.appendingPathComponent("2026-11-18.md")
    func write(_ line: String) { try! Data(("# Day planner\n" + line + "\n").utf8).write(to: note) }
    write("- [ ] 09:00 - 10:00 Work")
    let history = PlannerHistoryStore(root: root.appendingPathComponent("History"))
    let historyFile = history.root.appendingPathComponent(PlannerHistoryStore.vaultKey(for: vault) + ".json")
    let input = PlannerPreviewInput(vaultPath: vault.path, startDate: "2026-11-18", endDate: "2026-11-19", timeZone: "Asia/Shanghai", options: PlannerOptions(includeCalendar: true))
    let engine = PlannerPreviewEngine(history: history)
    let executor = PlannerSyncExecutor(history: history)
    let backend = FakeExportBackend()
    func current() -> PlannerPreviewResult { try! engine.preview(input) }
    func execute(_ choice: PlanSyncChoice? = nil, link: String? = nil) async -> SyncBatchResult {
        let p = current(), id = current().entries[0].id
        return await executor.execute(input: input, expectedSnapshot: p.snapshot, choices: choice.map { [id: $0] } ?? [:],
                                      resolutions: link.map { [id: $0] } ?? [:], backend: backend)
    }
    let created = await execute()
    XCTAssertEqual(created.status, "completed")
    XCTAssertEqual(created.counts.calendarSaved, 1)
    XCTAssertEqual(created.counts.remindersSaved, 1)
    XCTAssertEqual(created.items.first?.action, "create")
    let original = try! history.load(vault: vault)[0]
    let beforeSkip = try! Data(contentsOf: historyFile)
    let beforeSkipDate = try! fm.attributesOfItem(atPath: historyFile.path)[.modificationDate] as! Date
    let prepareCount = backend.prepareCount
    let repeated = await execute()
    XCTAssertEqual(repeated.counts.skipped, 1)
    XCTAssertEqual(backend.prepareCount, prepareCount)
    XCTAssertEqual(try! Data(contentsOf: historyFile), beforeSkip)
    XCTAssertEqual(try! fm.attributesOfItem(atPath: historyFile.path)[.modificationDate] as! Date, beforeSkipDate)
    write("- [ ] 09:00 - 10:00 Renamed")
    XCTAssertEqual(current().matches[0].action, .update)
    XCTAssertEqual((await execute(.update)).status, "completed")
    write("- [ ] 11:00 - 12:00 Renamed")
    XCTAssertEqual((await execute(.update)).status, "completed")
    write("- [x] 11:00 - 12:00 Renamed")
    XCTAssertEqual((await execute(.update)).status, "completed")
    let afterUpdates = try! history.load(vault: vault)[0]
    XCTAssertEqual(afterUpdates.id, original.id)
    XCTAssertEqual(afterUpdates.eventID, original.eventID)
    XCTAssertEqual(afterUpdates.reminderID, original.reminderID)
    XCTAssertEqual(backend.reminders[original.id]?.completed, true)
    XCTAssertEqual((await execute(.addAgain)).status, "completed")
    let copies = try! history.load(vault: vault)
    let copy = copies.last!
    XCTAssertEqual(copies.count, 2)
    XCTAssertEqual(copies[0].supersededBy, copy.id)
    XCTAssertNotEqual(copy.id, original.id)
    XCTAssertEqual(backend.events.count, 2)
    XCTAssertEqual(backend.reminders.count, 2)
    write("- [ ] 15:00 - 16:00 Entirely changed")
    XCTAssertEqual(current().matches[0].action, .conflict)
    let linked = await execute(link: copy.id)
    XCTAssertEqual(linked.status, "completed")
    XCTAssertEqual(try! history.load(vault: vault).last?.id, copy.id)
    backend.failReminder = true
    write("- [ ] 17:00 - 18:00 Entirely changed")
    let partial = await execute(.update)
    XCTAssertEqual(partial.status, "partial")
    XCTAssertEqual(partial.counts.calendarSaved, 1)
    XCTAssertEqual(partial.counts.remindersSaved, 0)
    XCTAssertEqual(partial.counts.failed, 1)
    XCTAssertEqual(partial.items[0].calendarSaved, true)
    XCTAssertEqual(partial.items[0].reminderSaved, false)
    let partialRecord = try! history.load(vault: vault).last!
    XCTAssertEqual(partialRecord.eventID, copy.eventID)
    backend.failReminder = false
    let retry = await execute(.update)
    XCTAssertEqual(retry.status, "completed")
    XCTAssertEqual(backend.events.count, 2)
    XCTAssertEqual(backend.reminders.count, 2)
    XCTAssertEqual(try! history.load(vault: vault).last?.reminderID, copy.reminderID)

    // New copy partial save also reuses the prepared new identity on Update retry.
    backend.failReminder = true
    let partialCopy = await execute(.addAgain)
    XCTAssertEqual(partialCopy.status, "partial")
    let pendingCopy = try! history.load(vault: vault).last!
    XCTAssertEqual(pendingCopy.reminderID, nil)
    XCTAssertTrue(current().payload.entries[0].incomplete)
    backend.failReminder = false
    XCTAssertEqual((await execute(.update)).status, "completed")
    XCTAssertEqual(try! history.load(vault: vault).last?.id, pendingCopy.id)
    XCTAssertEqual(backend.events.count, 3)
    XCTAssertEqual(backend.reminders.count, 3)

    let fresh = current()
    let invalid = await executor.execute(input: input, expectedSnapshot: fresh.snapshot, choices: ["not-in-preview": .add], resolutions: [:], backend: backend)
    XCTAssertEqual(invalid.errorCode, "INVALID_REQUEST")
    backend.prepareError = SyncExecutionError(code: "PERMISSION_REQUIRED", message: "Grant reminders access")
    let denied = await execute(.update)
    XCTAssertEqual(denied.errorCode, "PERMISSION_REQUIRED")
    backend.prepareError = nil

    // Fingerprint exact bytes rather than parsed equivalence, both before and after async preparation.
    let config = vault.appendingPathComponent(".obsidian/plugins/obsidian-day-planner/data.json")
    try! fm.createDirectory(at: config.deletingLastPathComponent(), withIntermediateDirectories: true)
    for afterPrepare in [false, true] {
        for mutation in ["note", "config", "missing", "history"] {
            let preview = current()
            let countBefore = backend.eventSaves + backend.reminderSaves
            let prepareBefore = backend.prepareCount
            var historyAfterMutation: Data?
            let change = {
                switch mutation {
                case "note":
                    var data = try Data(contentsOf: note); data.append(Data("\n".utf8)); try data.write(to: note)
                case "config":
                    let existing = (try? String(contentsOf: config, encoding: .utf8)) ?? "{}"
                    try Data((existing + "\n").utf8).write(to: config)
                case "missing":
                    let file = vault.appendingPathComponent("2026-11-19.md")
                    if fm.fileExists(atPath: file.path) { try fm.removeItem(at: file) }
                    else { try Data("# Empty day".utf8).write(to: file) }
                default:
                    var data = try Data(contentsOf: historyFile); data.append(Data("\n".utf8)); try data.write(to: historyFile)
                }
                historyAfterMutation = try Data(contentsOf: historyFile)
            }
            if afterPrepare { backend.duringPrepare = change } else { try! change() }
            let outcome = await executor.execute(input: input, expectedSnapshot: preview.snapshot,
                                                  choices: [preview.entries[0].id: .update], resolutions: [:], backend: backend)
            backend.duringPrepare = nil
            XCTAssertEqual(outcome.errorCode, "SOURCE_CHANGED")
            XCTAssertEqual(backend.eventSaves + backend.reminderSaves, countBefore)
            XCTAssertEqual(backend.prepareCount, prepareBefore + (afterPrepare ? 1 : 0))
            XCTAssertEqual(try! Data(contentsOf: historyFile), historyAfterMutation!)
        }
    }
    let differentOptions = PlannerPreviewInput(vaultPath: input.vaultPath, startDate: input.startDate, endDate: input.endDate,
                                               timeZone: input.timeZone, options: PlannerOptions(notification: PlannerNotification(channel: "None")))
    XCTAssertEqual(try! engine.preview(differentOptions).snapshot, current().snapshot)
    XCTAssertEqual(try! JSONDecoder().decode(PlannerPreviewInput.self, from: JSONEncoder().encode(input)), input)
    XCTAssertEqual(try! JSONDecoder().decode(SyncBatchResult.self, from: JSONEncoder().encode(partial)), partial)
    print("PASS executor: create/repeat/update/completion/copy/link, skipped no writes, partial save/retry identity, input validation, source/config/missing/history changes before and after prepare")
}
