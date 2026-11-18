import Foundation
import Security

public struct VaultPairing: Codable, Equatable, Sendable {
    public let vaultKey: String
    public let pairingToken: String
    public let vaultPath: String
    public let vaultName: String
    public let bookmarkData: Data

    public init(vaultKey: String, pairingToken: String, vaultPath: String, vaultName: String, bookmarkData: Data) {
        self.vaultKey = vaultKey; self.pairingToken = pairingToken; self.vaultPath = vaultPath
        self.vaultName = vaultName; self.bookmarkData = bookmarkData
    }
}

public struct PairingStore: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root }
    private var file: URL { root.appendingPathComponent("pairings.json") }

    public func pair(vault: URL, vaultName: String, bookmarkData: Data) throws -> VaultPairing {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw BridgeError("Could not create a local pairing credential.")
        }
        let pairing = VaultPairing(vaultKey: PlannerHistoryStore.vaultKey(for: vault),
                                   pairingToken: Data(bytes).base64EncodedString(),
                                   vaultPath: vault.standardizedFileURL.path,
                                   vaultName: vaultName, bookmarkData: bookmarkData)
        var records = try load()
        records[pairing.vaultKey] = pairing
        try save(records)
        return pairing
    }

    public func authorize(vaultKey: String, token: String, vaultPath: String) throws -> VaultPairing {
        guard let pairing = try load()[vaultKey], pairing.pairingToken == token,
              URL(fileURLWithPath: pairing.vaultPath, isDirectory: true).standardizedFileURL.resolvingSymlinksInPath() ==
                URL(fileURLWithPath: vaultPath, isDirectory: true).standardizedFileURL.resolvingSymlinksInPath() else {
            throw BridgeError("This vault is not paired. Pair it in the Mac app first.")
        }
        return pairing
    }

    public func revoke(vaultKey: String) throws {
        var records = try load()
        records.removeValue(forKey: vaultKey)
        try save(records)
    }

    public func pairing(for vault: URL) throws -> VaultPairing? {
        try load()[PlannerHistoryStore.vaultKey(for: vault)]
    }

    private func load() throws -> [String: VaultPairing] {
        guard FileManager.default.fileExists(atPath: file.path) else { return [:] }
        return try JSONDecoder().decode([String: VaultPairing].self, from: Data(contentsOf: file))
    }

    private func save(_ records: [String: VaultPairing]) throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: root.path) {
            guard try fm.attributesOfItem(atPath: root.path)[.type] as? FileAttributeType == .typeDirectory else {
                throw BridgeError("Pairing storage must be a directory.")
            }
        } else {
            try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        }
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
        try JSONEncoder().encode(records).write(to: file, options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}
