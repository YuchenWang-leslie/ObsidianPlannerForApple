import AppKit
import EventKit
import CryptoKit
import PlannerCore

@MainActor
final class HelperService {
    private let transport: HelperTransport
    private let pairings: PairingStore
    private let history: PlannerHistoryStore
    private let ledger: SyncJobLedger
    private let previews: HelperPreviewStore
    private let store = EKEventStore()
    // The helper bundle ID already gives standard defaults its independent domain.
    private let defaults = UserDefaults.standard
    private(set) var busy = false
    private var activeJobs: Set<UUID> = []
    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ObsidianPlanner")
        let root = base.appendingPathComponent("PluginBridge")
        transport = HelperTransport(root: root); pairings = PairingStore(root: root)
        history = PlannerHistoryStore(root: base); ledger = SyncJobLedger(root: root)
        previews = HelperPreviewStore(root: root)
    }
    func handle(id: UUID, action: String) async {
        do {
            let request = try transport.read(id: id, action: action)
            let core = request.core
            if action == "info" { try reply(id, status: "ready", message: "Helper is ready.", state: state()); return }
            if busy && action != "status" && action != "sync" { try reply(id, status: "busy", message: "Another helper operation is active."); return }
            if action == "pair" {
                let lock = try writeLock(); defer { lock.release() }
                let vault = URL(fileURLWithPath: core.vaultPath, isDirectory: true).standardizedFileURL
                var directory: ObjCBool = false
                guard FileManager.default.fileExists(atPath: vault.path, isDirectory: &directory), directory.boolValue else { throw BridgeError("Choose an existing local vault folder.") }
                let bookmark = try vault.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
                let value = try pairings.pair(vault: vault, vaultName: core.vaultName, bookmarkData: bookmark, allowSync: core.allowSync == true)
                try reply(id, status: "paired", message: "Vault connected.", pairing: BridgePairing(vaultKey: value.vaultKey, pairingToken: value.pairingToken, allowSync: value.allowSync), state: state()); return
            }
            let pairing: VaultPairing
            do { pairing = try pairings.authorize(vaultKey: core.vaultKey!, token: core.pairingToken!, vaultPath: core.vaultPath) }
            catch { throw SyncExecutionError(code: "VAULT_NOT_PAIRED", message: "Reconnect this vault in the plugin settings.") }
            if action == "status" {
                let original = UUID(uuidString: core.syncRequestId!)!
                guard var record = try ledger.lookup(id: original), record.vaultKey == pairing.vaultKey else { try reply(id, status: "notFound", message: "No sync receipt exists for this vault and request."); return }
                record = try recover(record, id: original)
                try replyJob(id, record); return
            }
            if action == "sync" { try await sync(id, core, pairing); return }
            if action == "authorize" {
                busy = true; defer { busy = false }
                let previous = NSWorkspace.shared.frontmostApplication
                NSApp.activate(ignoringOtherApps: true)
                let granted: Bool
                do {
                    if request.entity == "reminders" { granted = try await store.requestFullAccessToReminders() }
                    else { granted = try await store.requestFullAccessToEvents() }
                } catch { previous?.activate(options: []); throw error }
                previous?.activate(options: [])
                try reply(id, status: granted ? "ready" : "needsSetup", message: granted ? "Access granted." : "Allow access in macOS Privacy & Security to continue.", state: state()); return
            }
            if action == "configure" {
                let lock = try writeLock(); defer { lock.release() }
                let current = state()
                // Validate both selections before changing either one.
                if let selected = request.reminderSourceID, !current.reminderSources.contains(where: { $0.id == selected }) { throw setup("Choose an available Reminders account in the plugin settings.") }
                if let selected = request.calendarSourceID, !current.calendarSources.contains(where: { $0.id == selected }) { throw setup("Choose an available Calendar account in the plugin settings.") }
                setSource(request.reminderSourceID, key: "reminderSource", destination: "reminderCalendarID")
                setSource(request.calendarSourceID, key: "calendarSource", destination: "eventCalendarID")
                try reply(id, status: "ready", message: "Accounts saved.", state: state()); return
            }
            if action == "unpair" {
                let lock = try writeLock(); defer { lock.release() }
                try pairings.revoke(vaultKey: pairing.vaultKey)
                try reply(id, status: "ready", message: "Vault disconnected. Sync history and Apple items were kept.", state: state()); return
            }
            let access = try resolve(pairing); let scoped = access.startAccessingSecurityScopedResource()
            defer { if scoped { access.stopAccessingSecurityScopedResource() } }
            let input = input(core, pairing)
            let result = try PlannerPreviewEngine(history: history).preview(input)
            var payload = result.payload; payload.syncAllowed = pairing.allowSync
            let current = state()
            try previews.save(HelperPreviewContext(previewId: payload.previewId, input: input, snapshot: result.snapshot, createdAt: Date(), reminderSourceID: current.reminderSourceID, calendarSourceID: current.calendarSourceID))
            try reply(id, status: "previewReady", message: "Preview ready. No Apple items were changed.", preview: payload)
        } catch {
            let coded = error as? SyncExecutionError
            let code = coded?.code ?? "INVALID_REQUEST"
            let message = coded?.message ?? "The helper could not finish this request. Check the plugin setup, folder and date range."
            let status = code == "BUSY" ? "busy" : (["VAULT_NOT_PAIRED", "SYNC_NOT_ALLOWED", "APP_SETUP_REQUIRED", "PERMISSION_REQUIRED"].contains(code) ? "needsSetup" : "failed")
            try? reply(id, status: status, message: pluginMessage(message), errorCode: code, state: action == "authorize" ? state() : nil)
        }
    }
    private func sync(_ id: UUID, _ request: BridgeOpenRequest, _ pairing: VaultPairing) async throws {
        guard pairing.allowSync else { throw SyncExecutionError(code: "SYNC_NOT_ALLOWED", message: "Enable sync access by reconnecting this vault in the plugin settings.") }
        var sanitized = request; sanitized.pairingToken = nil
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        let digest = SHA256.hash(data: try encoder.encode(sanitized)).map { String(format: "%02x", $0) }.joined()
        if var existing = try ledger.lookup(id: id) {
            guard existing.vaultKey == pairing.vaultKey, existing.requestDigest == digest else { throw SyncExecutionError(code: "REQUEST_ID_REUSED", message: "This request ID was already used for different input.") }
            existing = try recover(existing, id: id); try replyJob(id, existing); return
        }
        guard !busy else { throw SyncExecutionError(code: "BUSY", message: "Another helper operation is active.") }
        let lock = try writeLock(); defer { lock.release() }
        // Another process may have finished this UUID between our lookup and acquiring the lock.
        if var existing = try ledger.lookup(id: id) {
            guard existing.vaultKey == pairing.vaultKey, existing.requestDigest == digest else { throw SyncExecutionError(code: "REQUEST_ID_REUSED", message: "This request ID was already used for different input.") }
            if existing.status == "running" { existing = try ledger.markInterrupted(id: id) ?? existing }
            try replyJob(id, existing); return
        }
        let context = try previews.load(request.previewId!)
        let input = input(request, pairing), current = state()
        guard context.input == input, context.reminderSourceID == current.reminderSourceID, context.calendarSourceID == current.calendarSourceID else { throw SyncExecutionError(code: "SOURCE_CHANGED", message: "The input or accounts changed. Request a fresh preview.") }
        let access = try resolve(pairing); let scoped = access.startAccessingSecurityScopedResource()
        defer { if scoped { access.stopAccessingSecurityScopedResource() } }
        let running = try ledger.begin(id: id, requestDigest: digest, previewId: context.previewId, vaultKey: pairing.vaultKey)
        try replyJob(id, running)
        busy = true; activeJobs.insert(id)
        defer { busy = false; activeJobs.remove(id) }
        let backend = EventKitExportBackend(store: store, defaults: defaults, calendarSourceID: current.calendarSourceID, reminderSourceID: current.reminderSourceID)
        let raw = await PlannerSyncExecutor(history: history).execute(input: input, expectedSnapshot: context.snapshot, choices: request.choices ?? [:], resolutions: request.resolutions ?? [:], backend: backend)
        let result = SyncBatchResult(status: raw.status, message: pluginMessage(raw.message), errorCode: raw.errorCode, counts: raw.counts, items: raw.items.map { SyncItemResult(entryId: $0.entryId, title: $0.title, date: $0.date, action: $0.action, status: $0.status, calendarSaved: $0.calendarSaved, reminderSaved: $0.reminderSaved, message: pluginMessage($0.message)) })
        let record = try ledger.finish(id: id, result: result)
        try replyJob(id, record)
        try? ledger.prune()
    }
    private func recover(_ record: SyncJobRecord, id: UUID) throws -> SyncJobRecord {
        guard record.status == "running", !activeJobs.contains(id), !busy else { return record }
        let lock = try HelperWriteLock(root: transport.root)
        guard lock.acquire() else { return record }; defer { lock.release() }
        return try ledger.markInterrupted(id: id) ?? record
    }
    private func writeLock() throws -> HelperWriteLock {
        let lock = try HelperWriteLock(root: transport.root)
        guard lock.acquire() else { throw SyncExecutionError(code: "BUSY", message: "Another helper process is writing. Check its status and try later.") }
        return lock
    }
    private func input(_ request: BridgeOpenRequest, _ pairing: VaultPairing) -> PlannerPreviewInput {
        PlannerPreviewInput(vaultPath: pairing.vaultPath, startDate: request.startDate, endDate: request.endDate, timeZone: request.timeZone, options: request.options ?? PlannerOptions())
    }
    private func resolve(_ pairing: VaultPairing) throws -> URL {
        var stale = false
        let url = try URL(resolvingBookmarkData: pairing.bookmarkData, options: .withSecurityScope, bookmarkDataIsStale: &stale)
        guard !stale, url.standardizedFileURL.resolvingSymlinksInPath() == URL(fileURLWithPath: pairing.vaultPath).standardizedFileURL.resolvingSymlinksInPath() else { throw setup("The paired folder moved or its access expired. Reconnect its original folder in the plugin settings.") }
        return url
    }
    private func state() -> HelperState {
        let reminders = sources(.reminder), calendars = sources(.event)
        return HelperState(remindersPermission: permission(.reminder), calendarPermission: permission(.event), reminderSources: reminders, calendarSources: calendars, reminderSourceID: selection(reminders, key: "reminderSource"), calendarSourceID: selection(calendars, key: "calendarSource"))
    }
    private func sources(_ type: EKEntityType) -> [HelperSource] {
        guard EKEventStore.authorizationStatus(for: type) == .fullAccess else { return [] }
        let ids = Set(store.calendars(for: type).filter { $0.allowsContentModifications && $0.source.sourceType != .local }.map { $0.source.sourceIdentifier })
        return store.sources.filter { ids.contains($0.sourceIdentifier) }.map { HelperSource(id: $0.sourceIdentifier, title: $0.title) }.sorted { $0.title < $1.title }
    }
    private func permission(_ type: EKEntityType) -> String {
        switch EKEventStore.authorizationStatus(for: type) {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .fullAccess: return "fullAccess"
        case .writeOnly: return "writeOnly"
        @unknown default: return "denied"
        }
    }
    private func selection(_ values: [HelperSource], key: String) -> String {
        if let saved = defaults.string(forKey: key), values.contains(where: { $0.id == saved }) { return saved }
        // Do not silently switch a formerly selected account when it disappears.
        if defaults.string(forKey: key) == nil, values.count == 1 { defaults.set(values[0].id, forKey: key); return values[0].id }
        return ""
    }
    private func setSource(_ id: String?, key: String, destination: String) {
        guard let id else { return }
        if defaults.string(forKey: key) != id { defaults.removeObject(forKey: destination) }
        defaults.set(id, forKey: key)
    }
    private func setup(_ message: String) -> SyncExecutionError { SyncExecutionError(code: "APP_SETUP_REQUIRED", message: message) }
    private func replyJob(_ id: UUID, _ record: SyncJobRecord) throws {
        let message = record.status == "running" ? "Sync is running. Check this request's status; do not submit again." : (record.status == "interrupted" ? "The helper stopped before confirming this run. Inspect Apple items and refresh the preview; no automatic retry was made." : record.result?.message ?? "Check the sync result.")
        try reply(id, status: record.status, message: message, errorCode: record.result?.errorCode, job: record.bridgeJob)
    }
    private func reply(_ id: UUID, status: String, message: String, errorCode: String? = nil, pairing: BridgePairing? = nil, preview: BridgePreview? = nil, job: BridgeJob? = nil, state: HelperState? = nil) throws {
        try transport.write(HelperResponse(base: BridgeOpenResponse(requestId: id.uuidString.lowercased(), status: status, appVersion: "0.4.0", message: message, errorCode: errorCode, pairing: pairing, preview: preview, capabilities: HelperTransport.actions, job: job), state: state), id: id)
    }
}
