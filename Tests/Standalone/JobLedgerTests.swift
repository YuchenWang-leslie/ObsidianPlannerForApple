import Foundation

func runJobLedgerTests() {
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("PlannerJobs-" + UUID().uuidString)
    try! fm.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: root) }
    let ledger = SyncJobLedger(root: root)
    let id = UUID(), previewID = UUID().uuidString.lowercased()
    let running = try! ledger.begin(id: id, requestDigest: "digest-one", previewId: previewID, vaultKey: "vault-one")
    XCTAssertEqual(running.status, "running")
    XCTAssertEqual(try! ledger.lookup(id: id), running)
    XCTAssertEqual(try! ledger.begin(id: id, requestDigest: "digest-one", previewId: previewID, vaultKey: "vault-one"), running)
    func rejects(_ code: String? = nil, _ operation: () throws -> Void) {
        do { try operation(); preconditionFailure("Expected job/protocol rejection") }
        catch {
            if let code { XCTAssertEqual((error as? SyncExecutionError)?.code, code) }
        }
    }
    rejects("REQUEST_ID_REUSED") { _ = try ledger.begin(id: id, requestDigest: "digest-two", previewId: previewID, vaultKey: "vault-one") }
    rejects("PREVIEW_USED") { _ = try ledger.begin(id: UUID(), requestDigest: "digest-one", previewId: previewID, vaultKey: "vault-one") }
    rejects("PREVIEW_USED") { _ = try ledger.begin(id: UUID(), requestDigest: "digest-one", previewId: previewID.uppercased(), vaultKey: "vault-one") }
    let result = SyncBatchResult(status: "completed", message: "Saved locally", counts: SyncBatchCounts(remindersSaved: 1))
    let done = try! ledger.finish(id: id, result: result)
    XCTAssertEqual(done.status, "completed")
    XCTAssertEqual(done.result, result)
    XCTAssertEqual(try! ledger.markInterrupted(id: id), done)
    XCTAssertEqual(try! ledger.begin(id: id, requestDigest: "digest-one", previewId: previewID, vaultKey: "vault-one"), done)
    let interruptedID = UUID()
    _ = try! ledger.begin(id: interruptedID, requestDigest: "other", previewId: UUID().uuidString, vaultKey: "vault-one")
    let interrupted = try! ledger.markInterrupted(id: interruptedID)
    XCTAssertEqual(interrupted?.status, "interrupted")
    XCTAssertEqual(try! ledger.lookup(id: UUID()), nil)
    let response = BridgeOpenResponse(requestId: id.uuidString, status: "completed", appVersion: "0.5.0", message: "Done", job: done.bridgeJob)
    let responseJSON = try! JSONEncoder().encode(response)
    XCTAssertEqual(try! JSONDecoder().decode(BridgeOpenResponse.self, from: responseJSON), response)
    XCTAssertFalse(String(data: responseJSON, encoding: .utf8)!.contains("requestDigest"))
    XCTAssertFalse(String(data: responseJSON, encoding: .utf8)!.contains("pairingToken"))
    XCTAssertEqual((try! fm.attributesOfItem(atPath: root.appendingPathComponent("jobs").path)[.posixPermissions] as! NSNumber).intValue, 0o700)
    XCTAssertEqual((try! fm.attributesOfItem(atPath: root.appendingPathComponent("jobs/" + id.uuidString.lowercased() + ".json").path)[.posixPermissions] as! NSNumber).intValue, 0o600)

    // Pruning keeps running/interrupted jobs while bounding terminal receipts.
    let activeID = UUID()
    let active = try! ledger.begin(id: activeID, requestDigest: "running", previewId: UUID().uuidString, vaultKey: "vault-one")
    let jobs = root.appendingPathComponent("jobs")
    for _ in 0..<202 {
        let newID = UUID().uuidString.lowercased()
        var object = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(done)) as! [String: Any]
        object["requestId"] = newID
        object["previewId"] = UUID().uuidString
        try! JSONSerialization.data(withJSONObject: object).write(to: jobs.appendingPathComponent(newID + ".json"))
    }
    let oldID = UUID().uuidString.lowercased()
    var old = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(done)) as! [String: Any]
    old["requestId"] = oldID; old["updatedAt"] = "2000-01-01T00:00:00Z"
    try! JSONSerialization.data(withJSONObject: old).write(to: jobs.appendingPathComponent(oldID + ".json"))
    try! ledger.prune()
    XCTAssertEqual(try! ledger.lookup(id: activeID), active)
    XCTAssertEqual(try! ledger.lookup(id: interruptedID), interrupted)
    XCTAssertEqual(try! ledger.lookup(id: UUID(uuidString: oldID)!), nil)
    XCTAssertEqual(try! fm.contentsOfDirectory(atPath: jobs.path).count, 202)

    let store = PairingStore(root: root)
    let vault = root.appendingPathComponent("Vault")
    let paired = try! store.pair(vault: vault, vaultName: "Vault", bookmarkData: Data([1]))
    XCTAssertFalse(paired.allowSync)
    // An older on-disk record has no scope field and stays read-only.
    let pairingsURL = root.appendingPathComponent("pairings.json")
    var raw = try! JSONSerialization.jsonObject(with: Data(contentsOf: pairingsURL)) as! [String: [String: Any]]
    raw[paired.vaultKey]!.removeValue(forKey: "allowSync")
    try! JSONSerialization.data(withJSONObject: raw).write(to: pairingsURL)
    XCTAssertFalse(try! store.authorize(vaultKey: paired.vaultKey, token: paired.pairingToken, vaultPath: vault.path).allowSync)
    let legacyCredential = Data(#"{"vaultKey":"key","pairingToken":"token"}"#.utf8)
    XCTAssertFalse(try! JSONDecoder().decode(BridgePairing.self, from: legacyCredential).allowSync)
    let upgraded = try! store.pair(vault: vault, vaultName: "Vault", bookmarkData: Data([1]), allowSync: true)
    XCTAssertTrue(try! store.authorize(vaultKey: upgraded.vaultKey, token: upgraded.pairingToken, vaultPath: vault.path).allowSync)
    rejects { _ = try store.authorize(vaultKey: paired.vaultKey, token: paired.pairingToken, vaultPath: vault.path) }

    let requestID = UUID()
    for action in ["sync", "status"] {
        XCTAssertEqual(BridgeRouter.route(URL(string: "obsidianplanner://bridge/\(action)?protocol=1&requestId=\(requestID.uuidString)")!), action == "sync" ? .sync(requestID) : .status(requestID))
    }
    var request = BridgeOpenRequest(requestId: requestID.uuidString, action: "sync", vaultPath: vault.path, vaultName: "Vault",
                                    startDate: "2026-11-18", endDate: "2026-11-18", timeZone: "Asia/Shanghai",
                                    vaultKey: upgraded.vaultKey, pairingToken: upgraded.pairingToken, options: PlannerOptions(),
                                    previewId: UUID().uuidString, choices: ["entry": .skip], resolutions: [:])
    try! request.validate(expectedID: requestID, expectedAction: "sync")
    let files = BridgeFiles(root: root)
    try! files.writeResponse(BridgeOpenResponse(requestId: requestID.uuidString, status: "running", appVersion: "test", message: "Running"), id: requestID)
    let requestURL = files.requestURL(id: requestID)
    try! JSONEncoder().encode(request).write(to: requestURL)
    XCTAssertEqual(try! files.readRequest(id: requestID, action: "sync"), request)
    var requestObject = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
    requestObject["unknown"] = true
    try! JSONSerialization.data(withJSONObject: requestObject).write(to: requestURL)
    rejects { _ = try files.readRequest(id: requestID, action: "sync") }
    requestObject.removeValue(forKey: "unknown")
    requestObject["choices"] = ["entry": "overwriteEverything"]
    try! JSONSerialization.data(withJSONObject: requestObject).write(to: requestURL)
    rejects { _ = try files.readRequest(id: requestID, action: "sync") }
    request.action = "status"; request.syncRequestId = id.uuidString
    try! request.validate(expectedID: requestID, expectedAction: "status")
    request.syncRequestId = nil
    rejects { try request.validate(expectedID: requestID, expectedAction: "status") }
    print("PASS job ledger/protocol: persistent running/results, duplicate/collision/preview claim, interrupted recovery, pruning, private files, legacy read-only scope and explicit upgrade")
}
