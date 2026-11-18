#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
helper_test_dir="$(mktemp -d "${TMPDIR:-/tmp}/planner-helper-tests.XXXXXX")"
trap 'rm -rf "$helper_test_dir"' EXIT
swiftc -swift-version 5 -target "$(uname -m)-apple-macosx14.0" -emit-library -static -emit-module -module-name PlannerCore Sources/PlannerCore/*.swift -emit-module-path "$helper_test_dir/PlannerCore.swiftmodule" -o "$helper_test_dir/libPlannerCore.a"
swiftc -swift-version 5 -target "$(uname -m)-apple-macosx14.0" -I "$helper_test_dir" -L "$helper_test_dir" -lPlannerCore Sources/PlannerPluginHelper/HelperProtocol.swift Sources/PlannerPluginHelper/HelperStorage.swift Tests/PluginHelper/main.swift -o "$helper_test_dir/helper-tests"
"$helper_test_dir/helper-tests"

# Exercise the real constructor inside a signed bundle: suite/bundle behavior differs from a CLI.
helper_smoke_bundle="$helper_test_dir/DayPlannerAppleSyncHelper.app"
mkdir -p "$helper_smoke_bundle/Contents/MacOS"
cp Resources/PluginHelper-Info.plist "$helper_smoke_bundle/Contents/Info.plist"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macosx14.0" -I "$helper_test_dir" -L "$helper_test_dir" -lPlannerCore Sources/PlannerPluginHelper/*.swift Sources/ObsidianPlanner/EventKitExportBackend.swift -o "$helper_smoke_bundle/Contents/MacOS/DayPlannerAppleSyncHelper"
codesign --force --sign - "$helper_smoke_bundle"
python3 - "$helper_smoke_bundle/Contents/MacOS/DayPlannerAppleSyncHelper" <<'PYTHON'
import subprocess, sys, time
process = subprocess.Popen([sys.argv[1]], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
try:
    time.sleep(2)
    if process.poll() is not None:
        out, err = process.communicate()
        raise SystemExit(f"Helper startup failed ({process.returncode}): {out}{err}")
    print("Signed helper bundle startup passed; no request, permission prompt or Apple write.")
finally:
    if process.poll() is None:
        process.terminate()
    process.communicate(timeout=5)
PYTHON
