import Foundation
import CryptoKit

public struct PlannerHistoryStore: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root }

    public static func vaultKey(for vault: URL) -> String {
        SHA256.hash(data: Data(vault.standardizedFileURL.path.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    public func load(vault: URL) throws -> [SyncRecord] {
        let url = fileURL(vault: vault)
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONDecoder().decode([SyncRecord].self, from: Data(contentsOf: url))
    }

    public func save(_ records: [SyncRecord], vault: URL) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try JSONEncoder().encode(records).write(to: fileURL(vault: vault), options: .atomic)
    }

    private func fileURL(vault: URL) -> URL {
        root.appendingPathComponent(Self.vaultKey(for: vault) + ".json")
    }
}
