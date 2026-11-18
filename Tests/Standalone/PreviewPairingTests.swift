import Foundation

func runPreviewPairingTests() {
    let fm = FileManager.default
    XCTAssertEqual(PlannerHistoryStore.vaultKey(for: URL(fileURLWithPath: "/tmp/PlannerLegacy")), "77b96bdca9b31579cfdc0aab61bc29ebf3e38637a1801825a47456ca3c60bfdb")
    let root = fm.temporaryDirectory.appendingPathComponent("PlannerP2-" + UUID().uuidString, isDirectory: true)
    try! fm.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: root) }
    let vault = root.appendingPathComponent("one/Research", isDirectory: true)
    let other = root.appendingPathComponent("two/Research", isDirectory: true)
    try! fm.createDirectory(at: vault, withIntermediateDirectories: true)
    try! fm.createDirectory(at: other, withIntermediateDirectories: true)
    let history = PlannerHistoryStore(root: root.appendingPathComponent("History"))
    let engine = PlannerPreviewEngine(history: history)
    let zone = TimeZone(identifier: "Asia/Shanghai")!
    let note = """
    # Day planner
    - [ ] 09:00 - 10:00 Original
    - [ ] 10:00 - 11:00 Renamed
    - [x] 15:00 - 16:00 New title and time
    - [ ] Unsupported task
    """
    try! Data(note.utf8).write(to: vault.appendingPathComponent("2026-11-18.md"))
    let oldEntries = DayPlannerParser.parse(text: """
    # Day planner
    - [ ] 09:00 - 10:00 Original
    - [ ] 10:00 - 11:00 Old title
    - [x] 13:00 - 14:00 Old schedule
    """, date: "2026-11-18", timeZone: zone).entries
    let records = oldEntries.map { SyncRecord(entry: $0, eventID: "event-" + $0.id, reminderID: "reminder-" + $0.id) }
    // Write the old raw [SyncRecord] layout, not a new envelope or renamed history key.
    try! fm.createDirectory(at: history.root, withIntermediateDirectories: true)
    let historyURL = history.root.appendingPathComponent(PlannerHistoryStore.vaultKey(for: vault) + ".json")
    var legacy = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(records)) as! [[String: Any]]
    for index in legacy.indices {
        for key in ["supersededBy", "calendarNotification", "reminderNotification"] { legacy[index].removeValue(forKey: key) }
    }
    try! JSONSerialization.data(withJSONObject: legacy).write(to: historyURL)
    XCTAssertEqual(try! history.load(vault: vault), records)
    XCTAssertEqual(try! history.load(vault: other), [])
    let roundTripHistory = PlannerHistoryStore(root: root.appendingPathComponent("RoundTripHistory"))
    try! roundTripHistory.save(records, vault: vault)
    XCTAssertEqual(try! roundTripHistory.load(vault: vault), records)
    let input = PlannerPreviewInput(vaultPath: vault.path, startDate: "2026-11-18", endDate: "2026-11-19", timeZone: "Asia/Shanghai")
    func snapshot() -> [String: String] {
        var result: [String: String] = [:]
        let files = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey])!
        for case let file as URL in files {
            guard (try! file.resourceValues(forKeys: [.isRegularFileKey])).isRegularFile == true else { continue }
            let modified = (try! fm.attributesOfItem(atPath: file.path)[.modificationDate]) as! Date
            result[file.path] = (try! Data(contentsOf: file)).base64EncodedString() + ":" + String(modified.timeIntervalSince1970)
        }
        return result
    }
    let before = snapshot()
    let result = try! engine.preview(input)
    XCTAssertEqual(snapshot(), before)
    XCTAssertEqual(result.entries.count, 3)
    XCTAssertEqual(result.issues.count, 1)
    XCTAssertEqual(result.matches.map(\.action), [.unchanged, .update, .conflict])
    XCTAssertEqual(result.payload.entries.map(\.selectedAction), ["skip", "skip", "conflict"])
    XCTAssertEqual(result.payload.counts.create, 0)
    XCTAssertEqual(result.payload.counts.update, 1)
    XCTAssertEqual(result.payload.counts.unchanged, 1)
    XCTAssertEqual(result.payload.counts.conflict, 1)
    XCTAssertEqual(result.payload.counts.skipped, 2)
    XCTAssertEqual(result.linkCandidates.map(\.id), [records[2].id])
    XCTAssertEqual(result.payload.vaultName, "Research")
    XCTAssertEqual(result.payload.entries[0].filePath, "2026-11-18.md")
    XCTAssertEqual(result.payload.entries[0].line, 2)
    XCTAssertEqual(result.payload.entries[0].startTime, "09:00")
    XCTAssertEqual(result.payload.entries[0].start, "2026-11-18T01:00:00Z")
    XCTAssertEqual(result.payload.entries[0].end, "2026-11-18T02:00:00Z")
    let encoded = try! JSONEncoder().encode(result.payload)
    XCTAssertEqual(try! JSONDecoder().decode(BridgePreview.self, from: encoded), result.payload)
    let jsonText = String(data: encoded, encoding: .utf8)!
    XCTAssertFalse(jsonText.contains("bookmarkData"))
    XCTAssertFalse(jsonText.contains("pairingToken"))
    XCTAssertFalse(jsonText.contains("eventID"))
    XCTAssertFalse(jsonText.contains(vault.path))

    // Same display name, different path, and a custom heading read from this vault's own config.
    let config = other.appendingPathComponent(".obsidian/plugins/obsidian-day-planner/data.json")
    try! fm.createDirectory(at: config.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! Data(#"{"plannerHeading":"Focus","plannerHeadingLevel":2}"#.utf8).write(to: config)
    try! Data(note.replacingOccurrences(of: "# Day planner", with: "## Focus").utf8).write(to: other.appendingPathComponent("2026-11-18.md"))
    let otherInput = PlannerPreviewInput(vaultPath: other.path, startDate: "2026-11-18", endDate: "2026-11-18", timeZone: "Asia/Shanghai")
    let otherBefore = snapshot()
    let otherResult = try! engine.preview(otherInput)
    XCTAssertEqual(snapshot(), otherBefore)
    XCTAssertEqual(otherResult.entries.count, 3)
    XCTAssertEqual(otherResult.payload.counts.create, 3)
    XCTAssertEqual(otherResult.payload.counts.skipped, 0)
    XCTAssertEqual(otherResult.payload.entries.map(\.selectedAction), ["create", "create", "create"])
    XCTAssertNotEqual(otherResult.payload.vaultKey, result.payload.vaultKey)
    XCTAssertEqual(otherResult.payload.vaultName, result.payload.vaultName)

    func rejects(_ operation: () throws -> Void) {
        do { try operation(); preconditionFailure("Expected P2 validation failure") } catch {}
    }
    for options in [PlannerOptions(notification: PlannerNotification(channel: "Both")),
                    PlannerOptions(notification: PlannerNotification(minutes: 7)),
                    PlannerOptions(notification: PlannerNotification(minutes: 65)),
                    PlannerOptions(notification: PlannerNotification(channel: "Unknown"))] {
        rejects { try options.validate() }
    }
    try! PlannerOptions(includeCalendar: true, notification: PlannerNotification(channel: "Both", minutes: 60)).validate()
    let historyBeforePairing = try! Data(contentsOf: historyURL)
    let store = PairingStore(root: root.appendingPathComponent("Bridge"))
    let paired = try! store.pair(vault: vault, vaultName: "Research", bookmarkData: Data([1, 2, 3]))
    XCTAssertEqual(paired.vaultKey, result.payload.vaultKey)
    XCTAssertEqual(Data(base64Encoded: paired.pairingToken)?.count, 32)
    XCTAssertEqual(try! store.pairing(for: vault), paired)
    XCTAssertEqual(try! store.authorize(vaultKey: paired.vaultKey, token: paired.pairingToken, vaultPath: vault.path), paired)
    rejects { _ = try store.authorize(vaultKey: paired.vaultKey, token: paired.pairingToken, vaultPath: other.path) }
    rejects { _ = try store.authorize(vaultKey: paired.vaultKey, token: "wrong", vaultPath: vault.path) }
    let second = try! store.pair(vault: other, vaultName: "Research", bookmarkData: Data([4]))
    XCTAssertNotEqual(second.vaultKey, paired.vaultKey)
    XCTAssertNotEqual(second.pairingToken, paired.pairingToken)
    let rotated = try! store.pair(vault: vault, vaultName: "Research", bookmarkData: Data([5]))
    XCTAssertEqual(rotated.vaultKey, paired.vaultKey)
    XCTAssertNotEqual(rotated.pairingToken, paired.pairingToken)
    rejects { _ = try store.authorize(vaultKey: paired.vaultKey, token: paired.pairingToken, vaultPath: vault.path) }
    XCTAssertEqual(try! store.authorize(vaultKey: rotated.vaultKey, token: rotated.pairingToken, vaultPath: vault.path).bookmarkData, Data([5]))
    try! store.revoke(vaultKey: rotated.vaultKey)
    XCTAssertEqual(try! store.pairing(for: vault), nil)
    XCTAssertEqual(try! store.pairing(for: other), second)
    XCTAssertEqual(try! Data(contentsOf: historyURL), historyBeforePairing)
    let dirMode = try! fm.attributesOfItem(atPath: store.root.path)[.posixPermissions] as! NSNumber
    let fileMode = try! fm.attributesOfItem(atPath: store.root.appendingPathComponent("pairings.json").path)[.posixPermissions] as! NSNumber
    XCTAssertEqual(dirMode.intValue, 0o700)
    XCTAssertEqual(fileMode.intValue, 0o600)

    let id = UUID()
    for action in ["pair", "preview"] {
        let route = BridgeRouter.route(URL(string: "obsidianplanner://bridge/\(action)?protocol=1&requestId=\(id.uuidString)")!)
        XCTAssertEqual(route, action == "pair" ? .pair(id) : .preview(id))
    }
    var request = BridgeOpenRequest(requestId: id.uuidString, action: "preview", vaultPath: vault.path, vaultName: "Research",
                                    startDate: "2026-11-18", endDate: "2026-11-18", timeZone: "Asia/Shanghai",
                                    vaultKey: paired.vaultKey, pairingToken: paired.pairingToken, options: PlannerOptions())
    try! request.validate(expectedID: id, expectedAction: "preview")
    rejects { try request.validate(expectedID: id) }
    request.options = nil
    rejects { try request.validate(expectedID: id, expectedAction: "preview") }
    request.action = "pair"
    try! request.validate(expectedID: id, expectedAction: "pair")
    let files = BridgeFiles(root: store.root)
    let response = BridgeOpenResponse(requestId: id.uuidString, status: "previewReady", appVersion: "0.4.0", message: "Read-only preview",
                                      preview: result.payload, capabilities: ["open", "pair", "preview"])
    try! files.writeResponse(response, id: id)
    try! JSONEncoder().encode(request).write(to: files.requestURL(id: id))
    XCTAssertEqual(try! files.readRequest(id: id, action: "pair"), request)
    rejects { _ = try files.readRequest(id: id) }
    XCTAssertEqual(try! JSONDecoder().decode(BridgeOpenResponse.self, from: Data(contentsOf: files.responseURL(id: id))), response)
    for status in ["pending", "paired", "needsSetup"] {
        let pairResponse = BridgeOpenResponse(requestId: id.uuidString, status: status, appVersion: "0.4.0", message: "Pairing state",
                                              errorCode: status == "needsSetup" ? "APP_SETUP_REQUIRED" : nil,
                                              pairing: status == "paired" ? BridgePairing(vaultKey: second.vaultKey, pairingToken: second.pairingToken) : nil,
                                              capabilities: ["open", "pair", "preview"])
        try! files.writeResponse(pairResponse, id: id)
        XCTAssertEqual(try! JSONDecoder().decode(BridgeOpenResponse.self, from: Data(contentsOf: files.responseURL(id: id))), pairResponse)
    }
    print("PASS P2 preview/pairing: shared read-only engine, legacy history, all match/default counts, custom headings, path identity, token rotation/revocation, private permissions, protocol DTOs")
}
