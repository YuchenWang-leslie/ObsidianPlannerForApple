import Foundation

public enum BridgeRoute: Equatable, Sendable {
    case open(UUID)
    case reference
    case unsupported(String)
    case ignored
}

public enum BridgeRouter {
    public static func route(_ url: URL) -> BridgeRoute {
        guard url.scheme?.lowercased() == "obsidianplanner" else { return .ignored }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return .unsupported("Invalid bridge URL.")
        }
        if components.host?.lowercased() == "sync" { return .reference }
        guard components.host?.lowercased() == "bridge", components.path == "/open",
              components.user == nil, components.password == nil, components.port == nil,
              components.fragment == nil else {
            return .unsupported("This app only supports bridge/open requests.")
        }
        let items = components.queryItems ?? []
        guard items.count == 2, Set(items.map(\.name)) == ["protocol", "requestId"] else {
            return .unsupported("Bridge URLs require only protocol and requestId.")
        }
        guard items.first(where: { $0.name == "protocol" })?.value == "1" else {
            return .unsupported("Unsupported bridge protocol. Update the app and plugin.")
        }
        guard let value = items.first(where: { $0.name == "requestId" })?.value,
              let id = UUID(uuidString: value) else {
            return .unsupported("Bridge requestId must be a UUID.")
        }
        return .open(id)
    }
}

public struct BridgeError: LocalizedError, Equatable, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

public struct BridgeOpenRequest: Codable, Equatable, Sendable {
    public var protocolVersion: Int
    public var requestId: String
    public var action: String
    public var vaultPath: String
    public var vaultName: String
    public var startDate: String
    public var endDate: String
    public var timeZone: String

    public init(protocolVersion: Int = 1, requestId: String, action: String = "open", vaultPath: String,
                vaultName: String, startDate: String, endDate: String, timeZone: String) {
        self.protocolVersion = protocolVersion; self.requestId = requestId; self.action = action
        self.vaultPath = vaultPath; self.vaultName = vaultName
        self.startDate = startDate; self.endDate = endDate; self.timeZone = timeZone
    }

    public func validate(expectedID: UUID) throws {
        guard protocolVersion == 1, action == "open" else {
            throw BridgeError("Unsupported bridge protocol or action. This version only opens the app.")
        }
        guard UUID(uuidString: requestId) == expectedID else { throw BridgeError("Request ID does not match its file name.") }
        guard (timeZone == "UTC" || TimeZone.knownTimeZoneIdentifiers.contains(timeZone)),
              let zone = TimeZone(identifier: timeZone) else { throw BridgeError("Choose a valid IANA time zone.") }
        guard let first = PlannerDates.day(startDate, timeZone: zone),
              let last = PlannerDates.day(endDate, timeZone: zone), first <= last else {
            throw BridgeError("Date range must use valid YYYY-MM-DD dates in ascending order.")
        }
        guard (vaultPath as NSString).isAbsolutePath, !vaultPath.contains("\0"),
              !vaultPath.components(separatedBy: "/").contains(where: { $0 == "." || $0 == ".." }) else {
            throw BridgeError("Vault path must be an absolute directory path.")
        }
    }
}

public struct BridgeOpenResponse: Codable, Equatable, Sendable {
    public var protocolVersion: Int
    public var requestId: String
    public var status: String
    public var appVersion: String
    public var message: String

    public init(protocolVersion: Int = 1, requestId: String, status: String, appVersion: String, message: String) {
        self.protocolVersion = protocolVersion; self.requestId = requestId
        self.status = status; self.appVersion = appVersion; self.message = message
    }
}

public struct BridgeFiles: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root }

    public func requestURL(id: UUID) -> URL {
        root.appendingPathComponent("inbox", isDirectory: true).appendingPathComponent(id.uuidString.lowercased() + ".json")
    }

    public func responseURL(id: UUID) -> URL {
        root.appendingPathComponent("outbox", isDirectory: true).appendingPathComponent(id.uuidString.lowercased() + ".json")
    }

    public func readRequest(id: UUID) throws -> BridgeOpenRequest {
        let file = requestURL(id: id)
        try requireDirectory(root)
        try requireDirectory(file.deletingLastPathComponent())
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular else { throw BridgeError("Bridge request must be a regular file, not a symbolic link.") }
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: 65_537) ?? Data()
        guard data.count <= 65_536 else { throw BridgeError("Bridge request exceeds the 64 KB limit.") }
        let request = try JSONDecoder().decode(BridgeOpenRequest.self, from: data)
        try request.validate(expectedID: id)
        return request
    }

    public func writeResponse(_ response: BridgeOpenResponse, id: UUID) throws {
        guard response.protocolVersion == 1, UUID(uuidString: response.requestId) == id,
              ["opened", "needsVault", "busy", "failed"].contains(response.status) else {
            throw BridgeError("Invalid bridge response version, request ID, or status.")
        }
        for directory in [root, root.appendingPathComponent("inbox", isDirectory: true), root.appendingPathComponent("outbox", isDirectory: true)] {
            if FileManager.default.fileExists(atPath: directory.path) {
                try requireDirectory(directory)
            } else {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            }
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        }
        let destination = responseURL(id: id)
        let data = try JSONEncoder().encode(response)
        try data.write(to: destination, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
    }

    private func requireDirectory(_ url: URL) throws {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeDirectory else {
            throw BridgeError("Bridge folders must be directories, not symbolic links.")
        }
    }
}
