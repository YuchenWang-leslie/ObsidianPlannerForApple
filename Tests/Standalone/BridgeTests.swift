import Foundation

func runBridgeTests() {
    let id = UUID(uuidString: "665F38B8-4CCE-49E0-A66A-C570F8872F03")!
    let query = "protocol=1&requestId=\(id.uuidString)"
    XCTAssertEqual(BridgeRouter.route(URL(string: "obsidianplanner://bridge/open?\(query)")!), .open(id))
    XCTAssertEqual(BridgeRouter.route(URL(string: "https://bridge/open?\(query)")!), .ignored)
    XCTAssertEqual(BridgeRouter.route(URL(string: "obsidianplanner://sync/vault/task?\(query)")!), .reference)
    for value in [
        "obsidianplanner://bridge/sync?\(query)",
        "obsidianplanner://bridge/open?protocol=2&requestId=\(id.uuidString)",
        "obsidianplanner://bridge/open?protocol=1&requestId=bad",
        "obsidianplanner://bridge/open?protocol=1",
        "obsidianplanner://bridge/open?\(query)&vaultPath=/tmp/vault",
        "obsidianplanner://bridge/open?\(query)&requestId=\(id.uuidString)",
        "obsidianplanner://bridge/open?\(query)#extra",
        "obsidianplanner://user@bridge/open?\(query)",
        "obsidianplanner://bridge:123/open?\(query)",
        "obsidianplanner://other/open?\(query)"
    ] {
        if case .unsupported = BridgeRouter.route(URL(string: value)!) {} else { preconditionFailure("Accepted invalid bridge route: \(value)") }
    }
    let json = """
    {"protocolVersion":1,"requestId":"665f38b8-4cce-49e0-a66a-c570f8872f03","action":"open","vaultPath":"/tmp/Example Vault","vaultName":"Example Vault","startDate":"2026-11-18","endDate":"2026-11-22","timeZone":"Asia/Shanghai"}
    """
    let request = try! JSONDecoder().decode(BridgeOpenRequest.self, from: Data(json.utf8))
    try! request.validate(expectedID: id)
    XCTAssertEqual(try! JSONDecoder().decode(BridgeOpenRequest.self, from: JSONEncoder().encode(request)), request)
    func rejects(_ operation: () throws -> Void) {
        do { try operation(); preconditionFailure("Expected bridge validation to reject input") }
        catch {}
    }
    for mutation in [
        { (r: inout BridgeOpenRequest) in r.protocolVersion = 2 },
        { (r: inout BridgeOpenRequest) in r.action = "sync" },
        { (r: inout BridgeOpenRequest) in r.requestId = UUID().uuidString },
        { (r: inout BridgeOpenRequest) in r.startDate = "2026-02-29" },
        { (r: inout BridgeOpenRequest) in r.endDate = "2026-11-17" },
        { (r: inout BridgeOpenRequest) in r.startDate = "2026-1-01" },
        { (r: inout BridgeOpenRequest) in r.timeZone = "Bad/Zone" },
        { (r: inout BridgeOpenRequest) in r.timeZone = "PST" },
        { (r: inout BridgeOpenRequest) in r.vaultPath = "relative/vault" },
        { (r: inout BridgeOpenRequest) in r.vaultPath = "file:///tmp/vault" },
        { (r: inout BridgeOpenRequest) in r.vaultPath = "/tmp/../vault" },
        { (r: inout BridgeOpenRequest) in r.vaultPath = "/tmp/\0vault" }
    ] {
        var invalid = request; mutation(&invalid)
        rejects { try invalid.validate(expectedID: id) }
    }
    var leap = request; leap.startDate = "2028-02-29"; leap.endDate = "2028-02-29"; leap.timeZone = "UTC"
    try! leap.validate(expectedID: id)

    let fm = FileManager.default
    let temporary = fm.temporaryDirectory.appendingPathComponent("PlannerBridgeTests-" + UUID().uuidString, isDirectory: true)
    try! fm.createDirectory(at: temporary, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: temporary) }
    let outside = temporary.appendingPathComponent("outside.txt")
    try! Data("untouched".utf8).write(to: outside)
    let files = BridgeFiles(root: temporary.appendingPathComponent("Bridge", isDirectory: true))
    let response = BridgeOpenResponse(requestId: id.uuidString, status: "opened", appVersion: "0.1.0-test", message: "Opened for review; no sync performed.")
    try! files.writeResponse(response, id: id)
    XCTAssertEqual(files.requestURL(id: id).lastPathComponent, id.uuidString.lowercased() + ".json")
    XCTAssertEqual(files.responseURL(id: id).lastPathComponent, id.uuidString.lowercased() + ".json")
    XCTAssertEqual(try! JSONDecoder().decode(BridgeOpenResponse.self, from: Data(contentsOf: files.responseURL(id: id))), response)
    for directory in [files.root, files.root.appendingPathComponent("inbox"), files.root.appendingPathComponent("outbox")] {
        let mode = try! fm.attributesOfItem(atPath: directory.path)[.posixPermissions] as! NSNumber
        XCTAssertEqual(mode.intValue, 0o700)
    }
    let fileMode = try! fm.attributesOfItem(atPath: files.responseURL(id: id).path)[.posixPermissions] as! NSNumber
    XCTAssertEqual(fileMode.intValue, 0o600)
    try! Data(json.utf8).write(to: files.requestURL(id: id), options: .atomic)
    XCTAssertEqual(try! files.readRequest(id: id), request)
    let updatedResponse = BridgeOpenResponse(requestId: id.uuidString, status: "needsVault", appVersion: "test", message: "Choose vault in app.")
    try! files.writeResponse(updatedResponse, id: id)
    XCTAssertEqual(try! JSONDecoder().decode(BridgeOpenResponse.self, from: Data(contentsOf: files.responseURL(id: id))), updatedResponse)
    rejects { _ = try files.readRequest(id: UUID()) }
    var invalidResponse = response; invalidResponse.status = "completed"
    rejects { try files.writeResponse(invalidResponse, id: id) }
    rejects { try files.writeResponse(response, id: UUID()) }
    try! Data(repeating: 32, count: 65_537).write(to: files.requestURL(id: id))
    rejects { _ = try files.readRequest(id: id) }
    try! Data("{".utf8).write(to: files.requestURL(id: id))
    rejects { _ = try files.readRequest(id: id) }
    try! fm.removeItem(at: files.requestURL(id: id))
    try! fm.createSymbolicLink(at: files.requestURL(id: id), withDestinationURL: outside)
    rejects { _ = try files.readRequest(id: id) }
    // A symlinked response destination is replaced atomically rather than modifying its target.
    try! fm.removeItem(at: files.responseURL(id: id))
    try! fm.createSymbolicLink(at: files.responseURL(id: id), withDestinationURL: outside)
    try! files.writeResponse(response, id: id)
    XCTAssertEqual(try! String(contentsOf: outside, encoding: .utf8), "untouched")
    let linkedRoot = temporary.appendingPathComponent("LinkedBridge")
    try! fm.createSymbolicLink(at: linkedRoot, withDestinationURL: files.root)
    rejects { try BridgeFiles(root: linkedRoot).writeResponse(response, id: id) }
    XCTAssertEqual(Set(try! fm.contentsOfDirectory(atPath: files.root.path)), ["inbox", "outbox"])
    print("PASS bridge: strict URL routing, reference-only sync URLs, request validation, private file roundtrip, size and symlink checks")
}
