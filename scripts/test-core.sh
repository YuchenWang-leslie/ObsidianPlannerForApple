#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
swiftc Sources/PlannerCore/*.swift Tests/Standalone/*.swift -o "$test_dir/core-tests"
"$test_dir/core-tests"
