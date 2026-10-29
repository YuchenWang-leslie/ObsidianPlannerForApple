#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
RELEASE_VERSION="${1:-0.1.0-beta.2}"
./scripts/build-app.sh
ARCH="$(uname -m)"
ARCHIVE="ObsidianPlanner-${RELEASE_VERSION}-macOS-${ARCH}.zip"
codesign --verify --strict dist/ObsidianPlanner.app
ditto -c -k --sequesterRsrc --keepParent dist/ObsidianPlanner.app "dist/$ARCHIVE"
(cd dist && shasum -a 256 "$ARCHIVE" > SHA256SUMS.txt)
echo "Release assets: dist/$ARCHIVE and dist/SHA256SUMS.txt"
