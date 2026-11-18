#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { printf 'Release packaging failed: %s\n' "$*" >&2; exit 1; }
[ "$#" -le 1 ] || fail "Usage: $0 [0.5.0-beta.1]"
RELEASE_VERSION="${1:-0.5.0-beta.1}"
RELEASE_VERSION="${RELEASE_VERSION#v}"
[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || fail "Invalid release version."
[ "$(uname -s)" = Darwin ] || fail "Build release assets on macOS."
[ "$(uname -m)" = arm64 ] || fail "This release supports Apple silicon (arm64) only."

APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' Resources/Info.plist)"
APP_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' Resources/Info.plist)"
[ "$APP_VERSION" = "${RELEASE_VERSION%%-*}" ] || fail "Tag v$RELEASE_VERSION does not match native App $APP_VERSION."
[[ "$APP_BUILD" =~ ^[0-9]+$ ]] || fail "Native build number must be an integer."

command -v node >/dev/null || fail "Node.js 24+ is required."
command -v npm >/dev/null || fail "npm is required."
PLUGIN_METADATA="$(node --input-type=commonjs <<'NODE'
const { readFileSync } = require('node:fs');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24+ is required.');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const manifest = read('plugin/manifest.json');
const pkg = read('plugin/package.json');
const lock = read('plugin/package-lock.json');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) throw new Error('Unsafe plugin ID.');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Plugin version must be x.y.z.');
if ([pkg.version, lock.version, lock.packages?.['']?.version].some(v => v !== manifest.version)) {
  throw new Error('Plugin manifest, package and lock versions must agree.');
}
process.stdout.write(`${manifest.id}\t${manifest.version}`);
NODE
)"
IFS=$'\t' read -r PLUGIN_ID PLUGIN_VERSION <<< "$PLUGIN_METADATA"
APP_ARCHIVE="ObsidianPlanner-${RELEASE_VERSION}-macOS-arm64.zip"
PLUGIN_ARCHIVE="${PLUGIN_ID}-${PLUGIN_VERSION}.zip"

# Start from a fresh bundle; never include old output or local runtime data.
mkdir -p dist
rm -rf dist/ObsidianPlanner.app
./scripts/build-app.sh
(
  cd plugin
  npm ci
  npm run build
)
codesign --verify --strict dist/ObsidianPlanner.app
[ "$(lipo -archs dist/ObsidianPlanner.app/Contents/MacOS/ObsidianPlanner)" = arm64 ] || fail "Native binary must contain only arm64."

STAGING_DIR="$(mktemp -d "$(pwd)/dist/.release.XXXXXX")"
trap 'rm -rf "$STAGING_DIR"' EXIT
ditto --norsrc --noextattr --noacl --noqtn dist/ObsidianPlanner.app "$STAGING_DIR/ObsidianPlanner.app"
mkdir "$STAGING_DIR/$PLUGIN_ID"
for asset in main.js manifest.json styles.css README.md LICENSE; do
  cp "plugin/dist/$asset" "$STAGING_DIR/$PLUGIN_ID/$asset"
done
find "$STAGING_DIR" \( -name .DS_Store -o -name '._*' -o -name __MACOSX \) -prune -exec rm -rf {} +
xattr -cr "$STAGING_DIR"
codesign --verify --strict "$STAGING_DIR/ObsidianPlanner.app"

# Exact file allowlists prevent shipping credentials, vault notes or build caches.
node --input-type=commonjs - "$STAGING_DIR" "$PLUGIN_ID" "$PLUGIN_VERSION" <<'NODE'
const { readFileSync, readdirSync, lstatSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const assert = require('node:assert/strict');
const [stage, id, version] = process.argv.slice(2);
const privateHome = Buffer.from(homedir().replace(/\/$/, '') + '/');
function files(root, prefix = '') {
  return readdirSync(root).flatMap(name => {
    const relative = prefix + name;
    const path = join(root, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) return files(path, relative + '/');
    assert.ok(stat.isFile(), `Unexpected non-file: ${relative}`);
    const data = readFileSync(path);
    assert.ok(!data.includes(privateHome), `Private home path in ${relative}`);
    return [relative];
  }).sort();
}
assert.deepEqual(files(join(stage, 'ObsidianPlanner.app')), [
  'Contents/Info.plist', 'Contents/MacOS/ObsidianPlanner',
  'Contents/Resources/AppIcon.icns', 'Contents/Resources/LICENSE.txt',
  'Contents/_CodeSignature/CodeResources',
].sort());
assert.deepEqual(files(join(stage, id)), ['LICENSE', 'README.md', 'main.js', 'manifest.json', 'styles.css'].sort());
const manifest = JSON.parse(readFileSync(join(stage, id, 'manifest.json'), 'utf8'));
assert.equal(manifest.id, id);
assert.equal(manifest.version, version);
const license = readFileSync('LICENSE', 'utf8');
assert.equal(readFileSync(join(stage, id, 'LICENSE'), 'utf8'), license);
assert.equal(readFileSync(join(stage, 'ObsidianPlanner.app/Contents/Resources/LICENSE.txt'), 'utf8'), license);
NODE

ditto -c -k --norsrc --noextattr --noacl --noqtn --keepParent "$STAGING_DIR/ObsidianPlanner.app" "$STAGING_DIR/$APP_ARCHIVE"
ditto -c -k --norsrc --noextattr --noacl --noqtn --keepParent "$STAGING_DIR/$PLUGIN_ID" "$STAGING_DIR/$PLUGIN_ARCHIVE"
for archive in "$APP_ARCHIVE" "$PLUGIN_ARCHIVE"; do
  unzip -tq "$STAGING_DIR/$archive"
done
node --input-type=commonjs - "$STAGING_DIR/$APP_ARCHIVE" "$STAGING_DIR/$PLUGIN_ARCHIVE" <<'NODE'
const { execFileSync } = require('node:child_process');
for (const path of process.argv.slice(2)) {
  const names = execFileSync('/usr/bin/unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n');
  if (names.some(name => name.startsWith('/') || name.split('/').some(part => part === '..' || part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._')))) {
    throw new Error('Archive contains unsafe paths or Apple metadata.');
  }
}
NODE
mv "$STAGING_DIR/$APP_ARCHIVE" "dist/$APP_ARCHIVE"
mv "$STAGING_DIR/$PLUGIN_ARCHIVE" "dist/$PLUGIN_ARCHIVE"
(
  cd dist
  shasum -a 256 "$APP_ARCHIVE" "$PLUGIN_ARCHIVE" > SHA256SUMS.txt
  shasum -a 256 -c SHA256SUMS.txt
)
printf 'App %s (build %s), plugin %s, tag v%s\n' "$APP_VERSION" "$APP_BUILD" "$PLUGIN_VERSION" "$RELEASE_VERSION"
printf 'Release assets:\n  dist/%s\n  dist/%s\n  dist/SHA256SUMS.txt\n' "$APP_ARCHIVE" "$PLUGIN_ARCHIVE"
