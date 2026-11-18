import Foundation
import PlannerCore

var checks = 0
func check(_ ok: Bool, _ message: String) {
    checks += 1
    if !ok { fatalError(message) }
}
func rejects(_ message: String, _ operation: () throws -> Void) {
    checks += 1
    do { try operation(); fatalError(message) } catch { }
}
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try privateDirectory(root)
defer { try? FileManager.default.removeItem(at: root) }
let id = UUID()
let route = "obsidianplanner-helper://bridge/info?protocol=1&requestId=\(id)"
check(HelperTransport.route(URL(string: route)!)?.id == id, "valid route")
for bad in [route + "&vaultPath=/tmp", route.replacingOccurrences(of: "info", with: "open"), route.replacingOccurrences(of: "helper", with: "app"), route.replacingOccurrences(of: "protocol=1", with: "protocol=2"), route + "#fragment"] {
    check(HelperTransport.route(URL(string: bad)!) == nil, "reject route \(bad)")
}
try privateDirectory(root.appendingPathComponent("inbox"))
let path = root.appendingPathComponent("inbox/\(id.uuidString.lowercased()).json")
let transport = HelperTransport(root: root)
var request = BridgeOpenRequest(requestId: id.uuidString, action: "info", vaultPath: "/tmp/fake-vault", vaultName: "Test", startDate: "2026-11-18", endDate: "2026-11-19", timeZone: "Asia/Shanghai")
try privateJSON(request, to: path)
check(try transport.read(id: id, action: "info").core == request, "read common request")
request.vaultPath = "relative"
try privateJSON(request, to: path)
rejects("relative path") { _ = try transport.read(id: id, action: "info") }
request.vaultPath = "/tmp/fake-vault"; request.action = "authorize"
var json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
json["entity"] = "reminders"
try JSONSerialization.data(withJSONObject: json).write(to: path)
rejects("authorize requires credentials") { _ = try transport.read(id: id, action: "authorize") }
json["vaultKey"] = "test"; json["pairingToken"] = "test"; json["entity"] = "all"
try JSONSerialization.data(withJSONObject: json).write(to: path)
rejects("entity invalid") { _ = try transport.read(id: id, action: "authorize") }
json["entity"] = "reminders"
try JSONSerialization.data(withJSONObject: json).write(to: path)
check(try transport.read(id: id, action: "authorize").entity == "reminders", "entity valid")
json["sourceText"] = "forbidden"
try JSONSerialization.data(withJSONObject: json).write(to: path)
rejects("unknown field") { _ = try transport.read(id: id, action: "authorize") }
try Data(repeating: 32, count: 65537).write(to: path)
rejects("size bound") { _ = try transport.read(id: id, action: "info") }
try FileManager.default.removeItem(at: path)
let target = root.appendingPathComponent("other.json")
try privateJSON(request, to: target)
try FileManager.default.createSymbolicLink(at: path, withDestinationURL: target)
rejects("symlink") { _ = try transport.read(id: id, action: "authorize") }
let state = HelperState(remindersPermission: "notDetermined", calendarPermission: "notDetermined", reminderSources: [], calendarSources: [], reminderSourceID: "", calendarSourceID: "")
try transport.write(HelperResponse(base: BridgeOpenResponse(requestId: id.uuidString.lowercased(), status: "ready", appVersion: "0.4.0", message: "Ready"), state: state), id: id)
let out = root.appendingPathComponent("outbox/\(id.uuidString.lowercased()).json")
let response = try JSONSerialization.jsonObject(with: Data(contentsOf: out)) as! [String: Any]
check(response["status"] as? String == "ready" && response["state"] is [String: Any] && response["base"] == nil, "flattened wire")
check(try FileManager.default.attributesOfItem(atPath: out.path)[.posixPermissions] as? Int == 0o600, "private output")
let previews = HelperPreviewStore(root: root)
let previewID = UUID().uuidString
let context = HelperPreviewContext(previewId: previewID, input: PlannerPreviewInput(vaultPath: "/tmp/test", startDate: "2026-11-18", endDate: "2026-11-18", timeZone: "Asia/Shanghai"), snapshot: PlannerPreviewSnapshot(sourceFingerprint: "source", historyFingerprint: "history"), createdAt: Date(), reminderSourceID: "reminders", calendarSourceID: "calendar")
try previews.save(context)
check(try previews.load(previewID) == context, "persisted preview survives new reader")
rejects("expired preview") { _ = try previews.load(previewID, now: context.createdAt.addingTimeInterval(1801)) }
rejects("traversal") { _ = try previews.load("../../outside") }
let expiredID = UUID().uuidString
try previews.save(HelperPreviewContext(previewId: expiredID, input: context.input, snapshot: context.snapshot, createdAt: Date().addingTimeInterval(-1801), reminderSourceID: "", calendarSourceID: ""))
rejects("expired context pruned") { _ = try previews.load(expiredID) }
for _ in 0..<22 {
    try previews.save(HelperPreviewContext(previewId: UUID().uuidString, input: context.input, snapshot: context.snapshot, createdAt: Date(), reminderSourceID: "", calendarSourceID: ""))
}
check(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("previews").path).count == 20, "preview cache bounded")
let lock1 = try HelperWriteLock(root: root), lock2 = try HelperWriteLock(root: root)
check(lock1.acquire(), "first lock")
check(!lock2.acquire(), "second writer excluded")
lock1.release()
check(lock2.acquire(), "lock reusable")
lock2.release()
// A second process can acquire the lock after the first process completed its receipt.
// Re-reading under that lock must expose the terminal receipt, never a new execution.
let ledger = SyncJobLedger(root: root)
let jobID = UUID()
check(try ledger.lookup(id: jobID) == nil, "initial missing receipt")
check(lock1.acquire(), "first job writer")
_ = try ledger.begin(id: jobID, requestDigest: "same", previewId: previewID, vaultKey: "vault")
_ = try ledger.finish(id: jobID, result: SyncBatchResult(status: "completed", message: "Done"))
lock1.release()
check(lock2.acquire(), "second job writer")
check(try ledger.lookup(id: jobID)?.status == "completed", "lock recheck sees completed receipt")
rejects("same UUID new digest") { _ = try ledger.begin(id: jobID, requestDigest: "different", previewId: previewID, vaultKey: "vault") }
lock2.release()
check(pluginMessage("Grant access in the Mac app") == "Grant access in the plugin settings", "plugin guidance")
print("Helper tests passed: \(checks) checks; no EventKit authorization or writes.")
