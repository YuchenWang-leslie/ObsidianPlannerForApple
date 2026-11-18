import Foundation
import PlannerCore

struct HelperSource: Codable, Equatable {
    let id: String
    let title: String
}
struct HelperState: Codable, Equatable {
    let remindersPermission: String
    let calendarPermission: String
    let reminderSources: [HelperSource]
    let calendarSources: [HelperSource]
    let reminderSourceID: String
    let calendarSourceID: String
}
struct HelperRequest: Decodable {
    let core: BridgeOpenRequest
    let entity: String?
    let reminderSourceID: String?
    let calendarSourceID: String?
    private enum CodingKeys: String, CodingKey { case entity, reminderSourceID, calendarSourceID }
    init(from decoder: Decoder) throws {
        core = try BridgeOpenRequest(from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        entity = try values.decodeIfPresent(String.self, forKey: .entity)
        reminderSourceID = try values.decodeIfPresent(String.self, forKey: .reminderSourceID)
        calendarSourceID = try values.decodeIfPresent(String.self, forKey: .calendarSourceID)
    }
    func validate(id: UUID, action: String) throws {
        guard core.action == action, HelperTransport.actions.contains(action) else { throw BridgeError("Unsupported helper action.") }
        if ["preview", "sync", "status"].contains(action) {
            try core.validate(expectedID: id, expectedAction: action)
        } else {
            var common = core; common.action = "open"
            try common.validate(expectedID: id)
        }
        if !["info", "pair"].contains(action) {
            guard let key = core.vaultKey, !key.isEmpty, let token = core.pairingToken, !token.isEmpty else {
                throw SyncExecutionError(code: "VAULT_NOT_PAIRED", message: "Connect this vault in the plugin settings first.")
            }
        }
        if action == "authorize", !["calendar", "reminders"].contains(entity ?? "") { throw BridgeError("Choose reminders or calendar access.") }
    }
}
struct HelperResponse: Encodable {
    let base: BridgeOpenResponse
    let state: HelperState?
    private enum CodingKeys: String, CodingKey { case state }
    func encode(to encoder: Encoder) throws {
        try base.encode(to: encoder)
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encodeIfPresent(state, forKey: .state)
    }
}
struct HelperTransport {
    static let actions = ["info", "pair", "authorize", "configure", "unpair", "preview", "sync", "status"]
    let root: URL
    static func route(_ url: URL) -> (action: String, id: UUID)? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "obsidianplanner-helper", components.host?.lowercased() == "bridge",
              components.user == nil, components.password == nil, components.port == nil, components.fragment == nil else { return nil }
        let action = String(components.path.dropFirst())
        guard components.path == "/" + action, actions.contains(action) else { return nil }
        let query = components.queryItems ?? []
        guard query.count == 2, Set(query.map(\.name)) == ["protocol", "requestId"],
              query.first(where: { $0.name == "protocol" })?.value == "1",
              let value = query.first(where: { $0.name == "requestId" })?.value,
              let id = UUID(uuidString: value) else { return nil }
        return (action, id)
    }
    func read(id: UUID, action: String) throws -> HelperRequest {
        let file = root.appendingPathComponent("inbox/" + id.uuidString.lowercased() + ".json")
        for dir in [root, file.deletingLastPathComponent()] {
            guard try FileManager.default.attributesOfItem(atPath: dir.path)[.type] as? FileAttributeType == .typeDirectory else { throw BridgeError("Helper transport folder is unavailable.") }
        }
        guard try FileManager.default.attributesOfItem(atPath: file.path)[.type] as? FileAttributeType == .typeRegular else { throw BridgeError("Helper request must be a regular file.") }
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: 65_537) ?? Data()
        guard data.count <= 65_536 else { throw BridgeError("Helper request exceeds 64 KB.") }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw BridgeError("Request must be a JSON object.") }
        let keys: Set<String> = ["protocolVersion", "requestId", "action", "vaultPath", "vaultName", "startDate", "endDate", "timeZone", "vaultKey", "pairingToken", "options", "allowSync", "previewId", "choices", "resolutions", "syncRequestId", "entity", "reminderSourceID", "calendarSourceID"]
        guard Set(object.keys).isSubset(of: keys) else { throw BridgeError("Unknown helper request field.") }
        if let options = object["options"] as? [String: Any] {
            guard Set(options.keys).isSubset(of: ["includeCalendar", "notification"]) else { throw BridgeError("Unknown options field.") }
            if let notification = options["notification"] as? [String: Any], !Set(notification.keys).isSubset(of: ["channel", "minutes"]) { throw BridgeError("Unknown notification field.") }
        }
        let request = try JSONDecoder().decode(HelperRequest.self, from: data)
        try request.validate(id: id, action: action)
        return request
    }
    func write(_ response: HelperResponse, id: UUID) throws {
        try privateDirectory(root)
        let outbox = root.appendingPathComponent("outbox", isDirectory: true)
        try privateDirectory(outbox)
        try privateJSON(response, to: outbox.appendingPathComponent(id.uuidString.lowercased() + ".json"))
    }
}
func privateDirectory(_ url: URL) throws {
    let fm = FileManager.default
    if fm.fileExists(atPath: url.path) {
        guard try fm.attributesOfItem(atPath: url.path)[.type] as? FileAttributeType == .typeDirectory else { throw BridgeError("Private helper storage must be a directory.") }
    } else { try fm.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
    try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
}
func privateJSON<T: Encodable>(_ value: T, to url: URL) throws {
    try JSONEncoder().encode(value).write(to: url, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
}
func pluginMessage(_ text: String) -> String {
    text.replacingOccurrences(of: "the Mac app", with: "the plugin settings")
        .replacingOccurrences(of: "the app", with: "the plugin")
        .replacingOccurrences(of: "Mac app", with: "plugin settings")
}
