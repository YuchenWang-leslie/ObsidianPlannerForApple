import Foundation

public struct BridgeJob: Codable, Equatable, Sendable {
    public let requestId: String
    public let previewId: String
    public let vaultKey: String
    public let status: String
    public let createdAt: String
    public let updatedAt: String
    public let result: SyncBatchResult?
}

public struct SyncJobRecord: Codable, Equatable, Sendable {
    public let requestId: String
    public let requestDigest: String
    public let previewId: String
    public let vaultKey: String
    public var status: String
    public let createdAt: String
    public var updatedAt: String
    public var result: SyncBatchResult?
    public var bridgeJob: BridgeJob {
        BridgeJob(requestId: requestId, previewId: previewId, vaultKey: vaultKey, status: status,
                  createdAt: createdAt, updatedAt: updatedAt, result: result)
    }
}

/// Called from the app's single execution gate; receipts are separate from task history.
public struct SyncJobLedger: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root }
    private var directory: URL { root.appendingPathComponent("jobs", isDirectory: true) }
    private func file(_ id: UUID) -> URL { directory.appendingPathComponent(id.uuidString.lowercased() + ".json") }

    public func lookup(id: UUID) throws -> SyncJobRecord? {
        guard FileManager.default.fileExists(atPath: file(id).path) else { return nil }
        return try JSONDecoder().decode(SyncJobRecord.self, from: Data(contentsOf: file(id)))
    }

    public func begin(id: UUID, requestDigest: String, previewId: String, vaultKey: String) throws -> SyncJobRecord {
        guard let previewUUID = UUID(uuidString: previewId) else {
            throw SyncExecutionError(code: "INVALID_REQUEST", message: "A sync receipt requires a valid preview ID.")
        }
        let previewId = previewUUID.uuidString.lowercased()
        if let existing = try lookup(id: id) {
            guard existing.requestDigest == requestDigest, existing.previewId == previewId, existing.vaultKey == vaultKey else {
                throw SyncExecutionError(code: "REQUEST_ID_REUSED", message: "This request ID was already used for different input.")
            }
            return existing
        }
        guard !(try records()).contains(where: { $0.previewId == previewId }) else {
            throw SyncExecutionError(code: "PREVIEW_USED", message: "This preview already belongs to a sync request. Check that run or request a new preview.")
        }
        let now = Date().ISO8601Format()
        let record = SyncJobRecord(requestId: id.uuidString.lowercased(), requestDigest: requestDigest,
                                   previewId: previewId, vaultKey: vaultKey, status: "running",
                                   createdAt: now, updatedAt: now, result: nil)
        try save(record, id: id)
        return record
    }

    @discardableResult
    public func finish(id: UUID, result: SyncBatchResult) throws -> SyncJobRecord {
        guard var record = try lookup(id: id) else {
            throw SyncExecutionError(code: "INVALID_REQUEST", message: "The sync receipt does not exist.")
        }
        guard record.status == "running" else { return record }
        record.status = result.status; record.result = result; record.updatedAt = Date().ISO8601Format()
        try save(record, id: id)
        return record
    }

    @discardableResult
    public func markInterrupted(id: UUID) throws -> SyncJobRecord? {
        guard var record = try lookup(id: id), record.status == "running" else { return try lookup(id: id) }
        record.status = "interrupted"; record.updatedAt = Date().ISO8601Format()
        try save(record, id: id)
        return record
    }

    public func prune() throws {
        let terminal = try records().filter { ["completed", "partial", "failed"].contains($0.status) }.sorted { $0.updatedAt > $1.updatedAt }
        let cutoff = Date().addingTimeInterval(-14 * 24 * 3600)
        let format = ISO8601DateFormatter()
        for (index, record) in terminal.enumerated() {
            if index >= 200 || (format.date(from: record.updatedAt).map { $0 < cutoff } ?? false) {
                if let id = UUID(uuidString: record.requestId) { try FileManager.default.removeItem(at: file(id)) }
            }
        }
    }

    private func records() throws -> [SyncJobRecord] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .map { try JSONDecoder().decode(SyncJobRecord.self, from: Data(contentsOf: $0)) }
    }

    private func save(_ record: SyncJobRecord, id: UUID) throws {
        let fm = FileManager.default
        for folder in [root, directory] {
            if fm.fileExists(atPath: folder.path) {
                guard try fm.attributesOfItem(atPath: folder.path)[.type] as? FileAttributeType == .typeDirectory else {
                    throw SyncExecutionError(code: "APP_SETUP_REQUIRED", message: "Sync receipt storage must be a directory.")
                }
            } else {
                try fm.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            }
            try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: folder.path)
        }
        try JSONEncoder().encode(record).write(to: file(id), options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file(id).path)
    }
}
