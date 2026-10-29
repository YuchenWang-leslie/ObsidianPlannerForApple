import SwiftUI
import AppKit
import EventKit
import PlannerCore

@main
struct ObsidianPlannerApp: App {
    @StateObject private var model = PlannerModel()
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.openWindow) private var openWindow
    var body: some Scene {
        WindowGroup(id: "main") {
            ContentView(model: model).frame(minWidth: 760, minHeight: 660)
                .onAppear {
                    delegate.reopen = { openWindow(id: "main") }
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var reopen: (() -> Void)?

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { reopen?() }
        sender.activate(ignoringOtherApps: true)
        return true
    }
}

@MainActor
final class PlannerModel: ObservableObject {
    let store = EKEventStore()
    @Published var authorized = false
    @Published var includeCalendar = false
    @Published var calendarSources: [EKSource] = []
    @Published var reminderSources: [EKSource] = []
    @Published var calendarSource = ""
    @Published var reminderSource = ""
    @Published var message = "Grant access to inspect available accounts."
    @Published var busy = false
    @Published var vault: URL?
    @Published var entries: [ScheduleEntry] = []
    @Published var issues: [String] = []
    @Published var range = "This Week"
    @Published var start = Date()
    @Published var end = Date()
    @Published var zone = TimeZone.current.identifier
    @Published var notice = "Reminders"
    @Published var minutes = 10
    private var scopedURL: URL?
    let defaults = UserDefaults.standard
    @Published var syncSummary = ""
    @Published var syncActions: [String: String] = [:]
    @Published var conflicts: [SyncMatch] = []
    @Published var linkCandidates: [SyncRecord] = []
    @Published var resolutions: [String: String] = [:]
    @Published var lastSync = UserDefaults.standard.object(forKey: "lastSync") as? Date

    init() {
        if let data = defaults.data(forKey: "vaultBookmark") {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: data, options: [.withSecurityScope], bookmarkDataIsStale: &stale) {
                if url.startAccessingSecurityScopedResource() { scopedURL = url }
                vault = url
            }
        }
        zone = defaults.string(forKey: "timeZone") ?? TimeZone.current.identifier
        refreshAccess()
    }
    func refreshAccess() {
        authorized = EKEventStore.authorizationStatus(for: .reminder) == .fullAccess
        if authorized {
            // iCloud may expose separate sources for events and reminders with the same title.
            // Derive each picker from that entity's writable calendars, never from all sources.
            calendarSources = eligibleSources(for: .event)
            reminderSources = eligibleSources(for: .reminder)
            calendarSource = restoredSource(calendarSource, key: "calendarSource", available: calendarSources)
            reminderSource = restoredSource(reminderSource, key: "reminderSource", available: reminderSources)
        }
    }
    private func eligibleSources(for type: EKEntityType) -> [EKSource] {
        let ids = Set(store.calendars(for: type).filter { $0.allowsContentModifications && $0.source.sourceType != .local }.map { $0.source.sourceIdentifier })
        return store.sources.filter { ids.contains($0.sourceIdentifier) }.sorted { $0.title < $1.title }
    }
    private func restoredSource(_ current: String, key: String, available: [EKSource]) -> String {
        if available.contains(where: { $0.sourceIdentifier == current }) { return current }
        if let saved = defaults.string(forKey: key), available.contains(where: { $0.sourceIdentifier == saved }) { return saved }
        defaults.removeObject(forKey: key)
        return available.count == 1 ? available[0].sourceIdentifier : ""
    }
    func grant() async {
        busy = true; defer { busy = false }
        do {
            let reminders = try await store.requestFullAccessToReminders()
            let events = includeCalendar ? try await store.requestFullAccessToEvents() : true
            refreshAccess()
            message = events && reminders ? "Access granted. Choose your iCloud accounts below." : "Access was not granted. Enable Calendar and Reminders access in System Settings → Privacy & Security."
        } catch { message = error.localizedDescription }
    }
    func chooseVault() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let bookmark = try url.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
            scopedURL?.stopAccessingSecurityScopedResource()
            scopedURL = url.startAccessingSecurityScopedResource() ? url : nil
            defaults.set(bookmark, forKey: "vaultBookmark"); vault = url
            entries = []; issues = []; syncActions = [:]; conflicts = []; resolutions = [:]
            syncSummary = ""; message = "Vault selected. Choose a date range and preview your schedules."
        } catch { message = error.localizedDescription }
    }
    func bounds() throws -> (Date, Date, Calendar) {
        guard let timezone = TimeZone(identifier: zone) else { throw AppError("Choose a valid time zone.") }
        var cal = Calendar(identifier: .gregorian); cal.timeZone = timezone; cal.firstWeekday = 2; cal.minimumDaysInFirstWeek = 4
        var first = cal.startOfDay(for: start), last = cal.startOfDay(for: end)
        if range != "Custom" {
            let today = cal.startOfDay(for: Date())
            let offset = (cal.component(.weekday, from: today) + 5) % 7
            first = cal.date(byAdding: .day, value: -offset + (range == "Next Week" ? 7 : 0), to: today)!
            last = cal.date(byAdding: .day, value: 6, to: first)!
        }
        guard last >= first else { throw AppError("End date must not be earlier than start date.") }
        return (first, last, cal)
    }
    func preview() {
        let previousEntries = entries
        entries = []; issues = []; syncActions = [:]; conflicts = []
        do {
            guard let vault else { throw AppError("Choose your Obsidian vault first.") }
            let (first, last, cal) = try bounds()
            defaults.set(zone, forKey: "timeZone")
            var heading = "Day planner", level = 1
            let config = vault.appendingPathComponent(".obsidian/plugins/obsidian-day-planner/data.json")
            if let data = try? Data(contentsOf: config), let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                heading = object["plannerHeading"] as? String ?? heading
                level = object["plannerHeadingLevel"] as? Int ?? level
            }
            entries = []; issues = []
            let formatter = DateFormatter(); formatter.calendar = cal; formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = cal.timeZone; formatter.dateFormat = "yyyy-MM-dd"
            var day = first
            while day <= last {
                let date = formatter.string(from: day)
                let file = vault.appendingPathComponent(date + ".md")
                if FileManager.default.fileExists(atPath: file.path) {
                    do {
                        let result = DayPlannerParser.parse(text: try String(contentsOf: file, encoding: .utf8), date: date, timeZone: cal.timeZone, heading: heading, headingLevel: level)
                        entries += result.entries
                        issues += result.issues
                    } catch { issues.append("\(date): \(error.localizedDescription)") }
                }
                day = cal.date(byAdding: .day, value: 1, to: day)!
            }
            if entries != previousEntries { resolutions = [:] }
            updateSyncPreview()
            message = "Preview: \(entries.count) schedules, \(issues.count) issues. No changes written."
        } catch { message = error.localizedDescription }
    }
    func testDestination(type: EKEntityType, sourceID: String) throws -> EKCalendar {
        guard let source = store.source(withIdentifier: sourceID), source.sourceType != .local else {
            throw AppError("Select an iCloud account for both destinations. Local accounts cannot sync to iPhone.")
        }
        let matches = store.calendars(for: type).filter { $0.source.sourceIdentifier == sourceID && $0.title == "DayPlanner Test" && $0.allowsContentModifications }
        guard matches.count <= 1 else { throw AppError("Multiple DayPlanner Test lists found. Rename duplicates in the system app first.") }
        if let match = matches.first { return match }
        let calendar = EKCalendar(for: type, eventStore: store)
        calendar.title = "DayPlanner Test"; calendar.source = source
        try store.saveCalendar(calendar, commit: true)
        return calendar
    }
    func createTest() {
        busy = true; defer { busy = false }
        do {
            guard authorized else { throw AppError("Grant both permissions first.") }
            defaults.set(calendarSource, forKey: "calendarSource"); defaults.set(reminderSource, forKey: "reminderSource")
            let calendar = try testDestination(type: .event, sourceID: calendarSource)
            let reminders = try testDestination(type: .reminder, sourceID: reminderSource)
            let testStart = Date().addingTimeInterval(20 * 60)
            let event = EKEvent(eventStore: store)
            event.calendar = calendar; event.title = "ObsidianPlanner connection test"
            event.startDate = testStart; event.endDate = testStart.addingTimeInterval(15 * 60)
            event.notes = "Connection test. Safe to delete after checking your iPhone."
            let reminder = EKReminder(eventStore: store)
            reminder.calendar = reminders; reminder.title = event.title; reminder.notes = event.notes
            var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: zone) ?? .current
            let components = cal.dateComponents([.year, .month, .day, .hour, .minute, .timeZone], from: testStart)
            reminder.startDateComponents = components; reminder.dueDateComponents = components
            if notice == "Calendar" || notice == "Both" { event.addAlarm(EKAlarm(relativeOffset: -Double(minutes * 60))) }
            if notice == "Reminders" || notice == "Both" { reminder.addAlarm(EKAlarm(absoluteDate: testStart.addingTimeInterval(-Double(minutes * 60)))) }
            // Save separately and report partial success accurately.
            try store.save(event, span: .thisEvent, commit: true)
            do { try store.save(reminder, commit: true) }
            catch { message = "Calendar test saved; reminder failed: \(error.localizedDescription). Check Calendar before creating another test."; return }
            message = "Saved one event and one reminder in DayPlanner Test, starting in 20 minutes. Check both on your iPhone. Each click creates a new test pair."
        } catch { message = error.localizedDescription }
    }
}

struct AppError: LocalizedError {
    let text: String
    init(_ text: String) { self.text = text }
    var errorDescription: String? { text }
}

struct ContentView: View {
    @ObservedObject var model: PlannerModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 16) {
                    Image(nsImage: NSWorkspace.shared.icon(forFile: Bundle.main.bundlePath))
                        .resizable().interpolation(.high).scaledToFit()
                        .frame(width: 64, height: 64)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("ObsidianPlanner").font(.system(size: 25, weight: .bold, design: .rounded))
                        Text("Your plans, wherever you are.").font(.callout).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if model.busy { ProgressView().controlSize(.small) }
                }.padding(.vertical, 8)
                GroupBox("Source & destinations") {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Button("Choose Vault…") { model.chooseVault() }
                            Text(model.vault?.lastPathComponent ?? "No vault selected").foregroundStyle(.secondary)
                        }
                        HStack {
                            if model.authorized { Label("Reminders connected", systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
                            else { Button("Grant Reminders Access") { Task { await model.grant() } } }
                            Spacer()
                            Button("Refresh Accounts") { model.refreshAccess() }
                        }
                        if model.authorized {
                            if model.includeCalendar {
                                if EKEventStore.authorizationStatus(for: .event) != .fullAccess {
                                    Button("Grant Calendar Access") { Task { await model.grant() } }
                                }
                                accountPicker("Calendar", selection: $model.calendarSource, sources: model.calendarSources)
                            }
                            accountPicker("Reminders", selection: $model.reminderSource, sources: model.reminderSources)
                            Text("Choose your iCloud account. Exports go into DayPlanner.").font(.caption).foregroundStyle(.secondary)
                            if (model.includeCalendar && model.calendarSources.isEmpty) || model.reminderSources.isEmpty {
                                Text("No writable account found for one service. Enable iCloud Calendar and Reminders and create a list in the Apple app, then refresh.").font(.caption).foregroundStyle(.orange)
                            }
                        }
                    }.padding(8)
                }
                GroupBox("Schedule range") {
                    VStack(alignment: .leading, spacing: 12) {
                        Picker("Date range", selection: $model.range) {
                            ForEach(["This Week", "Next Week", "Custom"], id: \.self) { Text($0) }
                        }.pickerStyle(.segmented)
                        if model.range == "Custom" {
                            HStack {
                                DatePicker("From", selection: $model.start, displayedComponents: .date)
                                DatePicker("To", selection: $model.end, displayedComponents: .date)
                            }
                        }
                        TimeZoneSelector(selection: $model.zone)
                    }.padding(8)
                }
                GroupBox("Sync destinations") {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Reminders", systemImage: "checklist").fontWeight(.medium)
                        Toggle("Also create calendar events", isOn: $model.includeCalendar)
                        Text("Existing calendar events are kept when this option is off.").font(.caption).foregroundStyle(.secondary)
                    }.padding(8)
                }
                GroupBox("Notifications") {
                    HStack {
                        Picker("Notify via", selection: $model.notice) {
                            ForEach(model.includeCalendar ? ["Reminders", "Calendar", "Both", "None"] : ["Reminders", "None"], id: \.self) { Text($0) }
                        }
                        if model.notice != "None" { Stepper("\(model.minutes) min before", value: $model.minutes, in: 0...60, step: 5) }
                    }.padding(8)
                    if model.notice == "Both" { Text("Both apps may notify you for the same schedule.").font(.caption).foregroundStyle(.secondary) }
                }
                HStack {
                    Button { model.preview() } label: { Label("Preview", systemImage: "eye") }
                        .controlSize(.large)
                    Button { Task { await model.sync() } } label: { Label("Sync to DayPlanner", systemImage: "arrow.triangle.2.circlepath") }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                        .disabled(!model.authorized || model.vault == nil || model.reminderSource.isEmpty || (model.includeCalendar && (model.calendarSource.isEmpty || EKEventStore.authorizationStatus(for: .event) != .fullAccess)))
                    Spacer()
                    if let last = model.lastSync { Text("Last run: " + last.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary) }
                }
                if !model.authorized {
                    Label("Grant Reminders access above to enable sync.", systemImage: "lock")
                        .font(.caption).foregroundStyle(.secondary)
                } else if model.vault == nil {
                    Label("Choose a vault above to enable sync.", systemImage: "folder")
                        .font(.caption).foregroundStyle(.secondary)
                } else if model.reminderSource.isEmpty {
                    Label("Choose an iCloud Reminders account above to enable sync.", systemImage: "person.crop.circle")
                        .font(.caption).foregroundStyle(.secondary)
                } else if model.includeCalendar && (model.calendarSource.isEmpty || EKEventStore.authorizationStatus(for: .event) != .fullAccess) {
                    Label("Grant Calendar access and choose an account above to enable calendar sync.", systemImage: "calendar")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if !model.entries.isEmpty {
                    GroupBox("Preview · \(model.entries.count) schedules") {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(model.entries) { entry in
                                HStack(alignment: .top) {
                                    Image(systemName: entry.completed ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(entry.completed ? Color.accentColor : Color.secondary)
                                        .font(.system(size: 16)).padding(.top, 2)
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(entry.title).font(.system(size: 14, weight: .medium))
                                        Label(entry.date + "  ·  " + timeLabel(entry), systemImage: "clock")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text((model.syncActions[entry.id] ?? "").capitalized)
                                        .font(.caption.weight(.medium)).foregroundStyle(Color.accentColor)
                                        .padding(.horizontal, 9).padding(.vertical, 4)
                                        .background(Color.accentColor.opacity(0.10), in: Capsule())
                                }
                                if entry.id != model.entries.last?.id { Divider() }
                            }
                        }.padding(8)
                    }
                }
                if !model.conflicts.isEmpty {
                    GroupBox("Resolve before syncing") {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Link a changed schedule to its previous export, or explicitly create a new pair. Unresolved schedules are skipped.").font(.caption)
                            ForEach(model.conflicts) { conflict in
                                VStack(alignment: .leading) {
                                    Text(conflict.entry.title).fontWeight(.medium)
                                    Picker("Action", selection: Binding(get: { model.resolutions[conflict.entry.id] ?? "skip" }, set: { model.resolutions[conflict.entry.id] = $0 })) {
                                        Text("Skip this schedule").tag("skip")
                                        Text("Create as new").tag("new")
                                        ForEach(model.linkCandidates) { record in
                                            Text("Update: " + record.entry.date + " · " + timeLabel(record.entry) + " · " + record.entry.title).tag(record.id)
                                        }
                                    }
                                    Text(conflict.reason).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }.padding(8)
                    }
                }
                if !model.issues.isEmpty {
                    GroupBox("Needs attention") {
                        VStack(alignment: .leading, spacing: 5) {
                            ForEach(Array(model.issues.enumerated()), id: \.offset) { _, issue in Text(issue).font(.caption) }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
                    }
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text(model.message).textSelection(.enabled)
                    if !model.syncSummary.isEmpty { Text(model.syncSummary).fontWeight(.medium) }
                    Text("One-way sync. Obsidian stays unchanged. Source deletions do not remove Apple items.").font(.caption).foregroundStyle(.secondary)
                }
                DisclosureGroup("Connection test") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Each click creates a test event and reminder starting in 20 minutes, in DayPlanner Test. Uses the notification settings above.").font(.caption).foregroundStyle(.secondary)
                        Button("Create Test Event & Reminder") { model.createTest() }
                            .disabled(!model.authorized || model.calendarSource.isEmpty || model.reminderSource.isEmpty)
                    }.padding(.top, 8)
                }
            }.padding(.horizontal, 32).padding(.vertical, 26)
                .frame(maxWidth: 980, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
                .groupBoxStyle(PlannerCardStyle())
                .tint(Color(red: 0.48, green: 0.34, blue: 0.82))
                .disabled(model.busy)
                .environment(\.timeZone, TimeZone(identifier: model.zone) ?? .current)
                .onChange(of: model.zone) { _, value in
                    model.defaults.set(value, forKey: "timeZone")
                    if model.vault != nil { model.preview() }
                }
                .onChange(of: model.includeCalendar) { _, enabled in
                    if !enabled && (model.notice == "Calendar" || model.notice == "Both") { model.notice = "Reminders" }
                    model.refreshAccess()
                }
        }
    }
    private func timeLabel(_ entry: ScheduleEntry) -> String {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: model.zone) ?? .current; formatter.dateFormat = "HH:mm"
        return formatter.string(from: entry.start) + "–" + formatter.string(from: entry.end)
    }
    private func accountPicker(_ title: String, selection: Binding<String>, sources: [EKSource]) -> some View {
        Picker(title, selection: selection) {
            Text("Select account…").tag("")
            ForEach(sources, id: \.sourceIdentifier) { source in
                Text(source.title + (sources.filter { $0.title == source.title }.count > 1 ? " (" + source.sourceIdentifier.suffix(6) + ")" : "")).tag(source.sourceIdentifier)
            }
        }
    }
}

struct PlannerCardStyle: GroupBoxStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            configuration.label
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
            configuration.content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.7), in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.primary.opacity(0.07)))
    }
}

final class TimeZonePickerState: ObservableObject {
    @Published var browsing = false
    @Published var query = ""
}

struct TimeZoneSelector: View {
    @Binding var selection: String
    @StateObject private var state = TimeZonePickerState()
    private let common = ["Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Singapore", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "UTC"]

    var body: some View {
        HStack {
            Label("Time zone", systemImage: "globe").foregroundStyle(.secondary)
            Spacer()
            Menu {
                Button("Use system time zone (" + TimeZone.current.identifier + ")") { selection = TimeZone.current.identifier }
                Divider()
                ForEach(common, id: \.self) { identifier in
                    Button { selection = identifier } label: {
                        if selection == identifier { Label(label(identifier), systemImage: "checkmark") }
                        else { Text(label(identifier)) }
                    }
                }
                Divider()
                Button("Browse all time zones…") { state.query = ""; state.browsing = true }
            } label: {
                Text(label(selection))
            }.menuStyle(.borderlessButton).fixedSize()
            .popover(isPresented: $state.browsing) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Choose a time zone").font(.headline)
                    TextField("Search city or time zone", text: $state.query).textFieldStyle(.roundedBorder)
                    List {
                        ForEach(TimeZone.knownTimeZoneIdentifiers.filter { state.query.isEmpty || $0.localizedCaseInsensitiveContains(state.query.replacingOccurrences(of: " ", with: "_")) }, id: \.self) { identifier in
                            Button { selection = identifier; state.browsing = false } label: {
                                HStack { Text(label(identifier)); Spacer(); if selection == identifier { Image(systemName: "checkmark") } }
                                    .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                            }.buttonStyle(.plain).padding(.vertical, 3)
                        }
                    }.listStyle(.plain)
                }.padding(18).frame(width: 420, height: 400)
            }
        }
    }
    private func label(_ identifier: String) -> String {
        guard let zone = TimeZone(identifier: identifier) else { return identifier }
        let minutes = zone.secondsFromGMT() / 60
        let offset = String(format: "UTC%@%02d:%02d", minutes < 0 ? "−" : "+", abs(minutes) / 60, abs(minutes) % 60)
        return identifier.replacingOccurrences(of: "_", with: " ") + " · " + offset
    }
}
