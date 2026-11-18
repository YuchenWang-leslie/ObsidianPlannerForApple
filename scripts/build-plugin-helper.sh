#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(uname -s)" = Darwin ] || { echo 'Build the plugin helper on macOS.' >&2; exit 1; }
[ "$(uname -m)" = arm64 ] || { echo 'The plugin helper currently supports Apple silicon only.' >&2; exit 1; }
helper_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' Resources/PluginHelper-Info.plist)"
client_helper_version="$(node --input-type=commonjs <<'NODE'
const source = require('node:fs').readFileSync('plugin/src/helper-client.ts', 'utf8');
const match = source.match(/export const HELPER_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!match) throw new Error('Missing helper protocol version.');
process.stdout.write(match[1]);
NODE
)"
[ "$helper_version" = "$client_helper_version" ] || { echo 'Native helper and client helper versions must match.' >&2; exit 1; }

helper_build="$(pwd)/.build/plugin-helper"
helper_bundle="$(pwd)/plugin/dist/native/DayPlannerAppleSyncHelper.app"
mkdir -p "$helper_build"
task_sdk="$(xcrun --sdk macosx --show-sdk-path)"

# Compile the existing core and EventKit implementation without building or changing the App.
swiftc -O -swift-version 5 -target arm64-apple-macosx14.0 -sdk "$task_sdk" \
    -file-prefix-map "$(pwd)=." \
    -parse-as-library -emit-library -static -emit-module -module-name PlannerCore \
    -emit-module-path "$helper_build/PlannerCore.swiftmodule" \
    Sources/PlannerCore/*.swift -o "$helper_build/libPlannerCore.a"
swiftc -O -swift-version 5 -target arm64-apple-macosx14.0 -sdk "$task_sdk" \
    -file-prefix-map "$(pwd)=." \
    -parse-as-library -I "$helper_build" \
    Sources/PlannerPluginHelper/*.swift Sources/ObsidianPlanner/EventKitExportBackend.swift \
    "$helper_build/libPlannerCore.a" -framework AppKit -framework EventKit \
    -o "$helper_build/DayPlannerAppleSyncHelper"

rm -rf "$helper_bundle"
mkdir -p "$helper_bundle/Contents/MacOS" "$helper_bundle/Contents/Resources"
cp "$helper_build/DayPlannerAppleSyncHelper" "$helper_bundle/Contents/MacOS/"
cp Resources/PluginHelper-Info.plist "$helper_bundle/Contents/Info.plist"
cp LICENSE "$helper_bundle/Contents/Resources/LICENSE.txt"
strip -S "$helper_bundle/Contents/MacOS/DayPlannerAppleSyncHelper"
codesign --force --sign - "$helper_bundle"
codesign --verify --strict "$helper_bundle"
printf '%s\n' "$helper_bundle"
