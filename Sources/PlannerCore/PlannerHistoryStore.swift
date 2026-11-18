import Foundation
import CryptoKit

public struct PlannerHistoryStore: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root }

    public static func vaultKey(for vault: URL) -> String {
        SHA256.hash(data: Data(vault.standardizedFileURL.path.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    public func load(vault: URL) throws -> [SyncRecord] { try read(vault: vault).records }

    func read(vault: URL) throws -> (records: [SyncRecord], fingerprint: String) {
        let url = fileURL(vault: vault)
        let data = FileManager.default.fileExists(atPath: url.path) ? try Data(contentsOf: url) : nil
        let records = try data.map { try JSONDecoder().decode([SyncRecord].self, from: $0) } ?? []
        var fingerprintData = Data(data == nil ? "missing".utf8 : "present".utf8)
        fingerprintData.append(data ?? Data())
        let fingerprint = SHA256.hash(data: fingerprintData).map { String(format: "%02x", $0) }.joined()
        return (records, fingerprint)
    }

    public func save(_ records: [SyncRecord], vault: URL) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try JSONEncoder().encode(records).write(to: fileURL(vault: vault), options: .atomic)
    }

    private func fileURL(vault: URL) -> URL {
        root.appendingPathComponent(Self.vaultKey(for: vault) + ".json")
    }
}
