#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { printf 'Plugin release packaging failed: %s\n' "$*" >&2; exit 1; }
[ "$#" -le 1 ] || fail "Usage: $0 [0.4.1]"
RELEASE_VERSION="${1:-0.4.1}"
[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Community tags must use x.y.z without a prefix or suffix."
[ "$(uname -s)" = Darwin ] || fail "Bundled-helper releases must be packaged on macOS."
[ "$(uname -m)" = arm64 ] || fail "This plugin release supports Apple silicon only."
command -v node >/dev/null || fail "Node.js 24+ is required."
command -v npm >/dev/null || fail "npm is required."
PLUGIN_VERSION="$(node --input-type=commonjs <<'NODE'
const { readFileSync } = require('node:fs');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24+ is required.');
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
process.stdout.write(manifest.version);
NODE
)"
[ "$PLUGIN_VERSION" = "$RELEASE_VERSION" ] || fail "Tag $RELEASE_VERSION does not match plugin $PLUGIN_VERSION."
npm ci
npm run check:release
npm test
npm run build
./scripts/build-plugin-helper.sh
(
    cd plugin
    node package.mjs
)
printf 'Plugin %s, community tag %s\n' "$PLUGIN_VERSION" "$RELEASE_VERSION"
printf 'Release assets are in plugin/dist/. The helper ZIP is installed manually; the plugin never installs native code.\n'
