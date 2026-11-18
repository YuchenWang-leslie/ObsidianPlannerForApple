import AppKit
import CryptoKit
import Foundation
import PlannerCore

struct BridgePreviewContext {
    let input: PlannerPreviewInput
    let snapshot: PlannerPreviewSnapshot
    let createdAt: Date
}

@MainActor
extension PlannerModel {
    private var bridgeFiles: BridgeFiles {
        BridgeFiles(root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ObsidianPlanner/Bridge", isDirectory: true))
    }
    private var pairingStore: PairingStore { PairingStore(root: bridgeFiles.root) }
    private var jobLedger: SyncJobLedger { SyncJobLedger(root: bridgeFiles.root) }

    func handleBridgeURL(_ url: URL) {
        switch BridgeRouter.route(url) {
        case .ignored: return
        case .reference: bridgeNotice = "This link identifies an exported plan. No sync was started."
        case .unsupported(let message): bridgeNotice = message
        case .open(let id): handleBridgeRequest(id, action: "open")
        case .pair(let id): handleBridgeRequest(id, action: "pair")
        case .preview(let id): handleBridgeRequest(id, action: "preview")
        case .sync(let id): Task { await handleBridgeSync(id) }
        case .status(let id): handleBridgeStatus(id)
        }
    }

    private func handleBridgeRequest(_ id: UUID, action: String) {
        do {
            guard !busy else { try replyToBridge(id, status: "busy", message: "The app is busy. Finish the current operation, then retry manually."); return }
            if action == "open", let previous = bridgeResponses[id], ["opened", "needsVault"].contains(previous.status) {
                try bridgeFiles.writeResponse(previous, id: id); return
            }
            if let pending = pendingBridgeRequest, UUID(uuidString: pending.requestId) != id {
                try replyToBridge(id, status: "busy", message: "Confirm or dismiss the pending vault request in the Mac app first."); return
            }
            let request = try bridgeFiles.readRequest(id: id, action: action)
            switch action {
            case "pair":
                if try repeatBridgeResponse(id, request: request) { return }
                pendingBridgeRequest = request; clearBridgePreview()
                bridgeNotice = request.allowSync == true
                    ? "Allow Obsidian to preview and sync this vault to your selected Apple accounts? Confirm its exact folder, then click Allow preview & sync. Pairing alone will not create Apple items."
                    : "Pair this vault for read-only previews? Confirm the exact folder, then click Pair this vault."
                try replyToBridge(id, status: "pending", message: "Review the vault path and requested access in the Mac app, then confirm pairing.")
            case "preview":
                let pairing = try authorizeBridge(request)
                if try repeatBridgeResponse(id, request: request) { return }
                let url = try resolvePairedVault(pairing)
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                let input = requestInput(request, vaultPath: pairing.vaultPath)
                let result = try PlannerPreviewEngine(history: historyStore).preview(input)
                activateVault(URL(fileURLWithPath: pairing.vaultPath, isDirectory: true), bookmark: pairing.bookmarkData, accessURL: url)
                applyBridgeRange(request, result: result)
                bridgePreviews = bridgePreviews.filter { Date().timeIntervalSince($0.value.createdAt) < 30 * 60 }
                if bridgePreviews.count >= 20, let oldest = bridgePreviews.min(by: { $0.value.createdAt < $1.value.createdAt })?.key { bridgePreviews.removeValue(forKey: oldest) }
                bridgePreviews[result.payload.previewId] = BridgePreviewContext(input: input, snapshot: result.snapshot, createdAt: Date())
                var payload = result.payload; payload.syncAllowed = pairing.allowSync
                bridgeRequests[id] = request
                try replyToBridge(id, status: "previewReady", message: "Preview ready. No Apple items or sync history were changed.", preview: payload)
            default:
                if matchesBridgeVault(request) {
                    applyBridgeRange(request)
                    try replyToBridge(id, status: "opened", message: "Date range applied. No sync was started.")
                } else {
                    pendingBridgeRequest = request; clearBridgePreview()
                    bridgeNotice = "Obsidian requested “\(request.vaultName)”. Confirm its folder before applying the range."
                    try replyToBridge(id, status: "needsVault", message: "Confirm the requested vault folder in the Mac app. No sync was started.")
                }
            }
        } catch { replyBridgeError(id, error: error) }
    }

    private func handleBridgeSync(_ id: UUID) async {
        do {
            let request = try bridgeFiles.readRequest(id: id, action: "sync")
            let pairing = try authorizeBridge(request, requireSync: true)
            let digest = try syncDigest(request)
            if var existing = try jobLedger.lookup(id: id) {
                guard existing.vaultKey == pairing.vaultKey, existing.requestDigest == digest else {
                    throw SyncExecutionError(code: "REQUEST_ID_REUSED", message: "This request ID was already used for different input. Check its result; do not submit it again.")
                }
                if existing.status == "running" && !activeBridgeJobs.contains(id), let interrupted = try jobLedger.markInterrupted(id: id) { existing = interrupted }
                try replyJob(id, record: existing); return
            }
            guard !busy, pendingBridgeRequest == nil else {
                try replyToBridge(id, status: "busy", message: "The Mac app is busy or waiting for source confirmation. Check it before syncing."); return
            }
            guard let previewID = request.previewId, let context = bridgePreviews[previewID], Date().timeIntervalSince(context.createdAt) < 30 * 60 else {
                throw SyncExecutionError(code: "PREVIEW_EXPIRED", message: "This preview expired or the Mac app restarted. Request a fresh preview before syncing.")
            }
            let input = requestInput(request, vaultPath: pairing.vaultPath)
            guard input == context.input else { throw SyncExecutionError(code: "INVALID_REQUEST", message: "Sync dates, vault and options must match the reviewed preview.") }
            let url = try resolvePairedVault(pairing)
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let receipt = try jobLedger.begin(id: id, requestDigest: digest, previewId: previewID, vaultKey: pairing.vaultKey)
            // The receipt is durable before the first async operation or account write.
            busy = true; activeBridgeJobs.insert(id)
            defer { busy = false; activeBridgeJobs.remove(id) }
            activateVault(URL(fileURLWithPath: pairing.vaultPath, isDirectory: true), bookmark: pairing.bookmarkData, accessURL: url)
            applyBridgeRange(request)
            bridgeNotice = "Sync requested from Obsidian. This window reports local saves; iPhone delivery depends on iCloud."
            try? replyJob(id, record: receipt)
            defaults.set(calendarSource, forKey: "calendarSource"); defaults.set(reminderSource, forKey: "reminderSource")
            let result = await PlannerSyncExecutor(history: historyStore).execute(input: input, expectedSnapshot: context.snapshot,
                choices: request.choices ?? [:], resolutions: request.resolutions ?? [:], backend: makeExportBackend())
            displaySyncResult(result)
            do {
                let finished = try jobLedger.finish(id: id, result: result)
                try replyJob(id, record: finished)
                try? jobLedger.prune()
            } catch {
                bridgeNotice = "The operation ended, but its receipt could not be saved. Check Apple items and sync history before retrying."
                try? replyToBridge(id, status: "interrupted", message: bridgeNotice!, errorCode: "RESULT_UNCONFIRMED")
            }
        } catch { replyBridgeError(id, error: error) }
    }

    private func handleBridgeStatus(_ id: UUID) {
        do {
            let request = try bridgeFiles.readRequest(id: id, action: "status")
            let pairing = try authorizeBridge(request)
            let originalID = UUID(uuidString: request.syncRequestId!)!
            guard var record = try jobLedger.lookup(id: originalID), record.vaultKey == pairing.vaultKey else {
                try replyToBridge(id, status: "notFound", message: "No receipt was found for this vault and request. Check the Mac app and Apple items; no request was resubmitted."); return
            }
            if record.status == "running" && !activeBridgeJobs.contains(originalID), let interrupted = try jobLedger.markInterrupted(id: originalID) { record = interrupted }
            try replyJob(id, record: record)
        } catch { replyBridgeError(id, error: error) }
    }
    private func authorizeBridge(_ request: BridgeOpenRequest, requireSync: Bool = false) throws -> VaultPairing {
        let record: VaultPairing
        do { record = try pairingStore.authorize(vaultKey: request.vaultKey!, token: request.pairingToken!, vaultPath: request.vaultPath) }
        catch { throw SyncExecutionError(code: "VAULT_NOT_PAIRED", message: "This vault's pairing is unavailable or no longer valid. Pair it again in the Mac app.") }
        if requireSync && !record.allowSync { throw SyncExecutionError(code: "SYNC_NOT_ALLOWED", message: "This pairing allows previews only. Pair again and explicitly allow preview & sync in the Mac app.") }
        return record
    }
    private func requestInput(_ request: BridgeOpenRequest, vaultPath: String) -> PlannerPreviewInput {
        PlannerPreviewInput(vaultPath: vaultPath, startDate: request.startDate, endDate: request.endDate, timeZone: request.timeZone, options: request.options ?? PlannerOptions())
    }
    private func syncDigest(_ request: BridgeOpenRequest) throws -> String {
        var sanitized = request; sanitized.pairingToken = nil
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return SHA256.hash(data: try encoder.encode(sanitized)).map { String(format: "%02x", $0) }.joined()
    }
    private func repeatBridgeResponse(_ id: UUID, request: BridgeOpenRequest) throws -> Bool {
        guard let previous = bridgeResponses[id] else { return false }
        guard bridgeRequests[id] == request else { throw SyncExecutionError(code: "REQUEST_ID_REUSED", message: "This request ID was already used for different input.") }
        try bridgeFiles.writeResponse(previous, id: id)
        return true
    }
    private func replyJob(_ id: UUID, record: SyncJobRecord) throws {
        let text: String
        if record.status == "running" { text = "Sync is running on this Mac. Check this same request's status; do not submit again." }
        else if record.status == "interrupted" { text = "The app stopped before confirming this run. Check Apple items, then refresh the preview; no automatic retry was made." }
        else { text = record.result?.message ?? "Check the local sync result." }
        try replyToBridge(id, status: record.status, message: text, errorCode: record.result?.errorCode, job: record.bridgeJob)
    }
    private func replyBridgeError(_ id: UUID, error: Error) {
        let coded = error as? SyncExecutionError
        let code = coded?.code ?? "INVALID_REQUEST"
        let message = coded?.message ?? "The app could not read or finish the request. Check the companion version, range and setup."
        bridgeNotice = message
        let setup = ["VAULT_NOT_PAIRED", "SYNC_NOT_ALLOWED", "APP_SETUP_REQUIRED", "PERMISSION_REQUIRED"].contains(code)
        try? replyToBridge(id, status: setup ? "needsSetup" : "failed", message: message, errorCode: code)
    }
    private func replyToBridge(_ id: UUID, status: String, message: String, errorCode: String? = nil,
                               pairing: BridgePairing? = nil, preview: BridgePreview? = nil, job: BridgeJob? = nil) throws {
        let response = BridgeOpenResponse(requestId: id.uuidString.lowercased(), status: status,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "development",
            message: message, errorCode: errorCode, pairing: pairing, preview: preview,
            capabilities: ["open", "pair", "preview", "sync", "status"], job: job)
        try bridgeFiles.writeResponse(response, id: id)
        if ["opened", "needsVault", "paired", "previewReady"].contains(status) {
            bridgeResponses[id] = response
            if !bridgeResponseOrder.contains(id) { bridgeResponseOrder.append(id) }
            while bridgeResponseOrder.count > 40 {
                let oldest = bridgeResponseOrder.removeFirst(); bridgeResponses.removeValue(forKey: oldest); bridgeRequests.removeValue(forKey: oldest)
            }
        }
    }
    private func matchesBridgeVault(_ request: BridgeOpenRequest) -> Bool {
        guard let vault else { return false }
        return vault.standardizedFileURL.resolvingSymlinksInPath() == URL(fileURLWithPath: request.vaultPath, isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
    }
    var canConfirmBridgePairing: Bool {
        guard let request = pendingBridgeRequest, request.action == "pair" else { return false }
        return matchesBridgeVault(request)
    }
    func confirmBridgeVaultSelection() {
        guard let request = pendingBridgeRequest else { return }
        guard matchesBridgeVault(request) else { bridgeNotice = "The selected folder does not match Obsidian's requested vault. Choose its folder or dismiss the request."; return }
        if request.action == "pair" {
            bridgeNotice = request.allowSync == true ? "The requested folder is selected. Click Allow preview & sync to approve this vault's requested access." : "The requested folder is selected. Click Pair this vault for read-only previews."
        } else { applyBridgeRange(request) }
    }
    func confirmBridgePairing() {
        guard let request = pendingBridgeRequest, canConfirmBridgePairing, let vault, let id = UUID(uuidString: request.requestId) else { return }
        do {
            guard try bridgeFiles.readRequest(id: id, action: "pair") == request else { throw AppError("The pairing request changed.") }
            let bookmark = try vault.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
            let record = try pairingStore.pair(vault: vault, vaultName: vault.lastPathComponent, bookmarkData: bookmark, allowSync: request.allowSync == true)
            bridgeRequests[id] = request
            try replyToBridge(id, status: "paired", message: record.allowSync ? "Vault paired for previews and explicit sync on this Mac." : "Vault paired for read-only previews on this Mac.",
                pairing: BridgePairing(vaultKey: record.vaultKey, pairingToken: record.pairingToken, allowSync: record.allowSync))
            pendingBridgeRequest = nil
            bridgeNotice = "Pairing saved. Return to Obsidian and request a fresh preview. Pairing did not sync any Apple items."
            refreshPairingStatus()
        } catch {
            pendingBridgeRequest = nil; bridgeNotice = "Pairing was not completed. Start pairing again from Obsidian."
            try? replyToBridge(id, status: "failed", message: "Pairing expired or could not be saved. Start it again from Obsidian.", errorCode: "PAIRING_CANCELLED")
        }
    }
    func refreshPairingStatus() {
        let record = vault.flatMap { try? pairingStore.pairing(for: $0) }
        pluginPaired = record != nil; pluginCanSync = record?.allowSync == true
    }
    func revokePluginPairing() {
        guard let vault else { return }
        do {
            try pairingStore.revoke(vaultKey: PlannerHistoryStore.vaultKey(for: vault))
            bridgeResponses = [:]; bridgeRequests = [:]; bridgeResponseOrder = []; bridgePreviews = [:]
            refreshPairingStatus()
            bridgeNotice = "Plugin pairing revoked for this vault. Sync history and Apple items are kept."
        } catch { bridgeNotice = "Could not revoke local pairing: \(error.localizedDescription)" }
    }
    private func resolvePairedVault(_ pairing: VaultPairing) throws -> URL {
        var stale = false
        let url = try URL(resolvingBookmarkData: pairing.bookmarkData, options: [.withSecurityScope], bookmarkDataIsStale: &stale)
        guard !stale, url.standardizedFileURL.resolvingSymlinksInPath() == URL(fileURLWithPath: pairing.vaultPath, isDirectory: true).standardizedFileURL.resolvingSymlinksInPath() else {
            throw SyncExecutionError(code: "APP_SETUP_REQUIRED", message: "The paired folder moved or its access expired. Select its original folder and pair again; history was not changed.")
        }
        return url
    }
    func dismissBridgeRequest() {
        if let request = pendingBridgeRequest, request.action == "pair", let id = UUID(uuidString: request.requestId) {
            try? replyToBridge(id, status: "failed", message: "Pairing cancelled in the Mac app.", errorCode: "PAIRING_CANCELLED")
        }
        pendingBridgeRequest = nil; bridgeNotice = nil; clearBridgePreview()
        message = "Plugin request dismissed. Choose a range and preview to continue."
    }
    private func clearBridgePreview() {
        entries = []; issues = []; syncActions = [:]; previewMatches = []; conflicts = []
        planChoices = [:]; resolutions = [:]; linkCandidates = []; lastPreview = nil; lastSnapshot = nil; syncSummary = ""
    }
    private func applyBridgeRange(_ request: BridgeOpenRequest, result: PlannerPreviewResult? = nil) {
        clearBridgePreview()
        let timeZone = TimeZone(identifier: request.timeZone)!
        zone = request.timeZone; start = PlannerDates.day(request.startDate, timeZone: timeZone)!
        end = PlannerDates.day(request.endDate, timeZone: timeZone)!; range = "Custom"; pendingBridgeRequest = nil
        if let options = request.options { includeCalendar = options.includeCalendar; notice = options.notification.channel; minutes = options.notification.minutes }
        if let result { entries = result.entries; issues = result.issues; applyPreviewMatches(result); message = "Preview: \(entries.count) schedules, \(issues.count) issues. No changes written." }
        else { preview() }
        bridgeNotice = "Opened from Obsidian · \(request.startDate) – \(request.endDate) · \(request.timeZone). No automatic sync was started."
    }
}
