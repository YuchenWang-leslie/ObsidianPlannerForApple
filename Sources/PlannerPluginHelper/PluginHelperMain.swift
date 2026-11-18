import AppKit

@main
struct PluginHelperMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegate = PluginHelperDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor
final class PluginHelperDelegate: NSObject, NSApplicationDelegate {
    private let service = HelperService()
    private var idleTimer: Timer?
    private var requestCount = 0
    private var lastActivity = Date()

    func applicationDidFinishLaunching(_ notification: Notification) {
        idleTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.requestCount == 0, !self.service.busy,
                      Date().timeIntervalSince(self.lastActivity) >= 60 else { return }
                NSApplication.shared.terminate(nil)
            }
        }
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            guard let route = HelperTransport.route(url) else { continue }
            requestCount += 1; lastActivity = Date()
            Task {
                await service.handle(id: route.id, action: route.action)
                requestCount -= 1; lastActivity = Date()
            }
        }
    }
}
