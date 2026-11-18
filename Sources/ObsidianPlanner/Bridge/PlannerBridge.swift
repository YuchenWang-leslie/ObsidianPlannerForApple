import AppKit
import Foundation
import PlannerCore

@MainActor
extension PlannerModel {
    private var bridgeFiles: BridgeFiles {
        BridgeFiles(root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ObsidianPlanner/Bridge", isDirectory: true))
    }

    func handleBridgeURL(_ url: URL) {
        switch BridgeRouter.route(url) {
        case .ignored:
            return
        case .reference:
            bridgeNotice = "This link identifies an exported plan. No sync was started."
        case .unsupported(let message):
            bridgeNotice = message
        case .open(let id):
            do {
                if let previous = bridgeResponses[id] {
                    try bridgeFiles.writeResponse(previous, id: id)
                    return
                }
                guard !busy else {
                    try replyToBridge(id, status: "busy", message: "The app is syncing. Try opening it again after the current operation finishes.")
                    return
                }
                let request = try bridgeFiles.readRequest(id: id)
                if matchesBridgeVault(request) {
                    applyBridgeRange(request)
                    try replyToBridge(id, status: "opened", message: "Date range applied in the Mac app. Review the preview and click Sync there; nothing was written automatically.")
                } else {
                    pendingBridgeRequest = request
                    bridgeNotice = "Obsidian requested “\(request.vaultName)”. Confirm its folder before applying the range."
                    entries = []; issues = []; syncActions = [:]; previewMatches = []
                    planChoices = [:]; resolutions = [:]; syncSummary = ""
                    try replyToBridge(id, status: "needsVault", message: "App opened. Confirm the requested vault folder in the Mac app before previewing. No sync was started.")
                }
            } catch {
                bridgeNotice = "Could not open the plugin request: \(error.localizedDescription)"
                try? replyToBridge(id, status: "failed", message: "The app could not read or apply the request. Check its message and try again.")
            }
        }
    }

    private func replyToBridge(_ id: UUID, status: String, message: String) throws {
        let response = BridgeOpenResponse(requestId: id.uuidString.lowercased(), status: status,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "development",
            message: message)
        try bridgeFiles.writeResponse(response, id: id)
        // Retrying the same request only repeats its acknowledgement, not a UI state change.
        if status == "opened" || status == "needsVault" { bridgeResponses[id] = response }
    }

    private func matchesBridgeVault(_ request: BridgeOpenRequest) -> Bool {
        guard let vault else { return false }
        return vault.standardizedFileURL.resolvingSymlinksInPath() ==
            URL(fileURLWithPath: request.vaultPath, isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
    }

    func confirmBridgeVaultSelection() {
        guard let request = pendingBridgeRequest else { return }
        guard matchesBridgeVault(request) else {
            bridgeNotice = "The selected folder does not match the vault requested by Obsidian. Choose its folder or dismiss the request."
            return
        }
        applyBridgeRange(request)
    }

    func dismissBridgeRequest() {
        pendingBridgeRequest = nil
        bridgeNotice = nil
        entries = []; issues = []; syncActions = [:]; previewMatches = []
        planChoices = [:]; resolutions = [:]
        message = "Plugin request dismissed. Choose a range and preview to continue."
    }

    private func applyBridgeRange(_ request: BridgeOpenRequest) {
        // The router/file reader already validated these dates and this IANA time zone.
        let timeZone = TimeZone(identifier: request.timeZone)!
        planChoices = [:]; resolutions = [:]; entries = []
        zone = request.timeZone
        start = PlannerDates.day(request.startDate, timeZone: timeZone)!
        end = PlannerDates.day(request.endDate, timeZone: timeZone)!
        range = "Custom"
        pendingBridgeRequest = nil
        preview()
        bridgeNotice = "Opened from Obsidian · \(request.startDate) – \(request.endDate) · \(request.timeZone). Review the preview before syncing. Nothing was written automatically."
    }
}
