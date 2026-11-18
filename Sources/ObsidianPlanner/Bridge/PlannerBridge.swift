import AppKit
import Foundation
import PlannerCore

@MainActor
extension PlannerModel {
    private var bridgeFiles: BridgeFiles {
        BridgeFiles(root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ObsidianPlanner/Bridge", isDirectory: true))
    }
    private var pairingStore: PairingStore { PairingStore(root: bridgeFiles.root) }

    func handleBridgeURL(_ url: URL) {
        switch BridgeRouter.route(url) {
        case .ignored: return
        case .reference:
            bridgeNotice = "This link identifies an exported plan. No sync was started."
        case .unsupported(let message): bridgeNotice = message
        case .open(let id): handleBridgeRequest(id, action: "open")
        case .pair(let id): handleBridgeRequest(id, action: "pair")
        case .preview(let id): handleBridgeRequest(id, action: "preview")
        }
    }

    private func handleBridgeRequest(_ id: UUID, action: String) {
        do {
            guard !busy else {
                try replyToBridge(id, status: "busy", message: "The app is busy. Finish the current operation, then retry manually.")
                return
            }
            // P1 open acknowledgements contain no credentials and can outlive client cleanup.
            if action == "open", let previous = bridgeResponses[id], ["opened", "needsVault"].contains(previous.status) {
                try bridgeFiles.writeResponse(previous, id: id)
                return
            }
            if let pending = pendingBridgeRequest, UUID(uuidString: pending.requestId) != id {
                try replyToBridge(id, status: "busy", message: "Confirm or dismiss the pending vault request in the Mac app first.")
                return
            }
            let request: BridgeOpenRequest
            do { request = try bridgeFiles.readRequest(id: id, action: action) }
            catch {
                bridgeNotice = "Could not read the plugin request: \(error.localizedDescription)"
                try replyToBridge(id, status: "failed", message: "The plugin request is invalid. Check its range, options and companion version.", errorCode: "INVALID_REQUEST")
                return
            }
            switch action {
            case "pair":
                if let previous = bridgeResponses[id] {
                    guard bridgeRequests[id] == request else {
                        try replyToBridge(id, status: "failed", message: "This request ID was already used for different input. Start a new request.", errorCode: "INVALID_REQUEST")
                        return
                    }
                    try bridgeFiles.writeResponse(previous, id: id)
                    return
                }
                pendingBridgeRequest = request
                clearBridgePreview()
                bridgeNotice = "Pair Obsidian with this vault for read-only previews? Confirm the exact folder, then click Pair this vault. Apple items will not be written."
                try replyToBridge(id, status: "pending", message: "Confirm this vault and click Pair this vault in the Mac app. No sync will run.")
            case "preview":
                let pairing: VaultPairing
                do {
                    pairing = try pairingStore.authorize(vaultKey: request.vaultKey!, token: request.pairingToken!, vaultPath: request.vaultPath)
                } catch {
                    try replyToBridge(id, status: "needsSetup", message: "This vault's local pairing is unavailable or no longer valid. Pair it again in the Mac app.", errorCode: "VAULT_NOT_PAIRED")
                    return
                }
                // Even cached read-only results require a still-valid pairing.
                if let previous = bridgeResponses[id] {
                    guard bridgeRequests[id] == request else {
                        try replyToBridge(id, status: "failed", message: "This request ID was already used for different input. Start a new request.", errorCode: "INVALID_REQUEST")
                        return
                    }
                    try bridgeFiles.writeResponse(previous, id: id)
                    return
                }
                do {
                    let authorizedURL = try resolvePairedVault(pairing)
                    let temporaryAccess = authorizedURL.startAccessingSecurityScopedResource()
                    defer { if temporaryAccess { authorizedURL.stopAccessingSecurityScopedResource() } }
                    let result = try PlannerPreviewEngine(history: historyStore).preview(PlannerPreviewInput(
                        vaultPath: pairing.vaultPath, startDate: request.startDate, endDate: request.endDate,
                        timeZone: request.timeZone, options: request.options!))
                    activateVault(URL(fileURLWithPath: pairing.vaultPath, isDirectory: true), bookmark: pairing.bookmarkData, accessURL: authorizedURL)
                    applyBridgeRange(request, result: result)
                    bridgeRequests[id] = request
                    try replyToBridge(id, status: "previewReady", message: "Read-only preview ready. Review and sync in the Mac app; no Apple items or sync history were written.", preview: result.payload)
                } catch {
                    bridgeNotice = "Could not preview the paired vault: \(error.localizedDescription)"
                    try replyToBridge(id, status: "failed", message: error.localizedDescription, errorCode: "PREVIEW_FAILED")
                }
            default:
                if matchesBridgeVault(request) {
                    applyBridgeRange(request)
                    try replyToBridge(id, status: "opened", message: "Date range applied in the Mac app. Review the preview and click Sync there; nothing was written automatically.")
                } else {
                    pendingBridgeRequest = request
                    clearBridgePreview()
                    bridgeNotice = "Obsidian requested “\(request.vaultName)”. Confirm its folder before applying the range."
                    try replyToBridge(id, status: "needsVault", message: "App opened. Confirm the requested vault folder in the Mac app before previewing. No sync was started.")
                }
            }
        } catch {
            bridgeNotice = "Could not finish the plugin request: \(error.localizedDescription)"
            try? replyToBridge(id, status: "failed", message: "The app could not finish the request. Check its window and retry manually.", errorCode: "APP_SETUP_REQUIRED")
        }
    }

    private func replyToBridge(_ id: UUID, status: String, message: String, errorCode: String? = nil,
                               pairing: BridgePairing? = nil, preview: BridgePreview? = nil) throws {
        let response = BridgeOpenResponse(requestId: id.uuidString.lowercased(), status: status,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "development",
            message: message, errorCode: errorCode, pairing: pairing, preview: preview, capabilities: ["open", "pair", "preview"])
        try bridgeFiles.writeResponse(response, id: id)
        if ["opened", "needsVault", "paired", "previewReady"].contains(status) { bridgeResponses[id] = response }
    }

    private func matchesBridgeVault(_ request: BridgeOpenRequest) -> Bool {
        guard let vault else { return false }
        return vault.standardizedFileURL.resolvingSymlinksInPath() ==
            URL(fileURLWithPath: request.vaultPath, isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
    }
    var canConfirmBridgePairing: Bool {
        guard let request = pendingBridgeRequest, request.action == "pair" else { return false }
        return matchesBridgeVault(request)
    }

    func confirmBridgeVaultSelection() {
        guard let request = pendingBridgeRequest else { return }
        guard matchesBridgeVault(request) else {
            bridgeNotice = "The selected folder does not match the vault requested by Obsidian. Choose its folder or dismiss the request."
            return
        }
        if request.action == "pair" {
            bridgeNotice = "The requested folder is selected. Click Pair this vault to allow read-only previews from Obsidian."
        } else { applyBridgeRange(request) }
    }

    func confirmBridgePairing() {
        guard let request = pendingBridgeRequest, canConfirmBridgePairing, let vault,
              let id = UUID(uuidString: request.requestId) else { return }
        do {
            // The client deletes its request on timeout/unload; a late approval must not create a pairing.
            guard try bridgeFiles.readRequest(id: id, action: "pair") == request else { throw AppError("Pairing request changed. Start pairing again from Obsidian.") }
            let bookmark = try vault.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
            let record = try pairingStore.pair(vault: vault, vaultName: vault.lastPathComponent, bookmarkData: bookmark)
            bridgeRequests[id] = request
            try replyToBridge(id, status: "paired", message: "Vault paired for previews on this Mac. Existing sync history is preserved.",
                pairing: BridgePairing(vaultKey: record.vaultKey, pairingToken: record.pairingToken))
            pendingBridgeRequest = nil
            bridgeNotice = "Vault paired for read-only previews. Return to Obsidian and choose Preview. No sync was started."
            refreshPairingStatus()
        } catch {
            pendingBridgeRequest = nil
            bridgeNotice = "Pairing was not completed. Return to Obsidian and start pairing again."
            try? replyToBridge(id, status: "failed", message: "Pairing expired or could not be saved. Start pairing again from Obsidian.", errorCode: "PAIRING_CANCELLED")
        }
    }

    func refreshPairingStatus() {
        pluginPaired = vault.flatMap { try? pairingStore.pairing(for: $0) } != nil
    }
    func revokePluginPairing() {
        guard let vault else { return }
        do {
            try pairingStore.revoke(vaultKey: PlannerHistoryStore.vaultKey(for: vault))
            bridgeResponses = [:]; bridgeRequests = [:]
            refreshPairingStatus()
            bridgeNotice = "Plugin pairing revoked for this vault. Sync history and Apple items are kept. Pair again in Obsidian to request previews."
        } catch { bridgeNotice = "Could not revoke local pairing: \(error.localizedDescription)" }
    }

    private func resolvePairedVault(_ pairing: VaultPairing) throws -> URL {
        var stale = false
        let url = try URL(resolvingBookmarkData: pairing.bookmarkData, options: [.withSecurityScope], bookmarkDataIsStale: &stale)
        let original = URL(fileURLWithPath: pairing.vaultPath, isDirectory: true)
        guard !stale, url.standardizedFileURL.resolvingSymlinksInPath() == original.standardizedFileURL.resolvingSymlinksInPath() else {
            throw AppError("The paired folder moved or its access expired. Select its original folder and pair again; history was not changed.")
        }
        return url
    }

    func dismissBridgeRequest() {
        if let request = pendingBridgeRequest, request.action == "pair", let id = UUID(uuidString: request.requestId) {
            try? replyToBridge(id, status: "failed", message: "Pairing cancelled in the Mac app.", errorCode: "PAIRING_CANCELLED")
        }
        pendingBridgeRequest = nil; bridgeNotice = nil
        clearBridgePreview()
        message = "Plugin request dismissed. Choose a range and preview to continue."
    }
    private func clearBridgePreview() {
        entries = []; issues = []; syncActions = [:]; previewMatches = []; conflicts = []
        planChoices = [:]; resolutions = [:]; linkCandidates = []; lastPreview = nil; syncSummary = ""
    }
    private func applyBridgeRange(_ request: BridgeOpenRequest, result: PlannerPreviewResult? = nil) {
        let timeZone = TimeZone(identifier: request.timeZone)!
        clearBridgePreview()
        zone = request.timeZone
        start = PlannerDates.day(request.startDate, timeZone: timeZone)!
        end = PlannerDates.day(request.endDate, timeZone: timeZone)!
        range = "Custom"
        pendingBridgeRequest = nil
        if let options = request.options {
            includeCalendar = options.includeCalendar
            notice = options.notification.channel; minutes = options.notification.minutes
        }
        if let result {
            entries = result.entries; issues = result.issues; applyPreviewMatches(result)
            message = "Preview: \(entries.count) schedules, \(issues.count) issues. No changes written."
        } else { preview() }
        bridgeNotice = "Preview from Obsidian · \(request.startDate) – \(request.endDate) · \(request.timeZone). Nothing was written automatically. Sync remains an explicit action in this Mac app."
    }
}
