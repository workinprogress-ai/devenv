#!/usr/bin/env bash
# Run all BATS tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Running Devenv test suite..."
echo "======================================"

# Run all test files
if bats "$SCRIPT_DIR"/*.bats; then
    echo "======================================"
    echo "✅ All tests passed!"
    exit 0
else
    echo "======================================"
    echo "❌ Some tests failed!"
    exit 1
fi
