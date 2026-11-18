import Foundation
import Darwin
import PlannerCore

final class HelperWriteLock {
    private var descriptor: Int32 = -1
    init(root: URL) throws {
        try privateDirectory(root)
        descriptor = Darwin.open(root.appendingPathComponent("helper-write.lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw BridgeError("Could not open the helper write lock.") }
        fchmod(descriptor, 0o600)
    }
    func acquire() -> Bool { flock(descriptor, LOCK_EX | LOCK_NB) == 0 }
    func release() { flock(descriptor, LOCK_UN) }
    deinit { if descriptor >= 0 { Darwin.close(descriptor) } }
}
struct HelperPreviewContext: Codable, Equatable {
    let previewId: String
    let input: PlannerPreviewInput
    let snapshot: PlannerPreviewSnapshot
    let createdAt: Date
    let reminderSourceID: String
    let calendarSourceID: String
}
struct HelperPreviewStore {
    let root: URL
    private func file(_ id: String) throws -> URL {
        guard let uuid = UUID(uuidString: id) else { throw BridgeError("Invalid preview ID.") }
        return root.appendingPathComponent("previews/" + uuid.uuidString.lowercased() + ".json")
    }
    func save(_ context: HelperPreviewContext) throws {
        try privateDirectory(root)
        try privateDirectory(root.appendingPathComponent("previews"))
        try privateJSON(context, to: file(context.previewId))
        let directory = root.appendingPathComponent("previews")
        let candidates = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .compactMap { url -> (URL, HelperPreviewContext)? in
                guard let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(HelperPreviewContext.self, from: data) else { return nil }
                return (url, value)
            }.sorted { $0.1.createdAt > $1.1.createdAt }
        for (index, candidate) in candidates.enumerated() where index >= 20 || Date().timeIntervalSince(candidate.1.createdAt) >= 1800 {
            try FileManager.default.removeItem(at: candidate.0)
        }
    }
    func load(_ id: String, now: Date = Date()) throws -> HelperPreviewContext {
        let path = try file(id)
        guard FileManager.default.fileExists(atPath: path.path) else { throw SyncExecutionError(code: "PREVIEW_EXPIRED", message: "Request a fresh preview before syncing.") }
        let value = try JSONDecoder().decode(HelperPreviewContext.self, from: Data(contentsOf: path))
        guard now.timeIntervalSince(value.createdAt) < 1800 else { throw SyncExecutionError(code: "PREVIEW_EXPIRED", message: "This preview expired. Request a fresh preview.") }
        return value
    }
}
