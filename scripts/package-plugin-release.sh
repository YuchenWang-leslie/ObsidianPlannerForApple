#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { printf 'Plugin release packaging failed: %s\n' "$*" >&2; exit 1; }
[ "$#" -le 1 ] || fail "Usage: $0 [0.4.0-beta.1]"
RELEASE_VERSION="${1:-0.4.0-beta.1}"
RELEASE_VERSION="${RELEASE_VERSION#plugin-v}"
[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || fail "Invalid plugin release version."
[ "$(uname -s)" = Darwin ] || fail "Bundled-helper releases must be packaged on macOS."
[ "$(uname -m)" = arm64 ] || fail "This plugin release supports Apple silicon only."
command -v node >/dev/null || fail "Node.js 24+ is required."
command -v npm >/dev/null || fail "npm is required."
PLUGIN_VERSION="$(node --input-type=commonjs <<'NODE'
const { readFileSync } = require('node:fs');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24+ is required.');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const manifest = read('plugin/manifest.json');
const pkg = read('plugin/package.json');
const lock = read('plugin/package-lock.json');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || [pkg.version, lock.version, lock.packages?.['']?.version].some(value => value !== manifest.version)) {
    throw new Error('Plugin manifest/package/lock versions must agree and use x.y.z.');
}
process.stdout.write(manifest.version);
NODE
)"
[ "$PLUGIN_VERSION" = "${RELEASE_VERSION%%-*}" ] || fail "Tag plugin-v$RELEASE_VERSION does not match plugin $PLUGIN_VERSION."
(
    cd plugin
    npm ci
    npm test
    npm run build
)
./scripts/build-plugin-helper.sh
(
    cd plugin
    node package.mjs
)
printf 'Plugin %s, tag plugin-v%s\n' "$PLUGIN_VERSION" "$RELEASE_VERSION"
printf 'Release assets are in plugin/dist/. The standalone App and its release assets were not rebuilt.\n'
