#!/bin/bash
# Compare a saved native bridge preview with the shared Swift engine; no EventKit.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 /absolute/TestVault /private/native-preview.json" >&2
  exit 1
fi
parity_dir="$(mktemp -d)"
trap 'rm -rf "$parity_dir"' EXIT
cat > "$parity_dir/main.swift" <<'SWIFT'
import Foundation
let vaultPath = CommandLine.arguments[1]
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
let native = try JSONDecoder().decode(BridgePreview.self, from: data)
let historyRoot = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("ObsidianPlanner", isDirectory: true)
let result = try PlannerPreviewEngine(history: PlannerHistoryStore(root: historyRoot)).preview(
    PlannerPreviewInput(vaultPath: vaultPath, startDate: native.startDate, endDate: native.endDate,
        timeZone: native.timeZone, options: native.options))
func comparable(_ value: BridgePreview) throws -> Data {
    var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
    object.removeValue(forKey: "previewId")
    return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
}
let actual = try comparable(native)
let expected = try comparable(result.payload)
precondition(actual == expected, "Native bridge preview differs from shared engine")
print("PASS P2 parity: complete bridge payload matches shared Swift engine (excluding per-preview ID).")
SWIFT
swiftc Sources/PlannerCore/*.swift "$parity_dir/main.swift" -o "$parity_dir/preview-parity"
"$parity_dir/preview-parity" "$1" "$2"
