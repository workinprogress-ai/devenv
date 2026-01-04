#!/usr/bin/env bash
# Run all BATS tests

set -euo pipefail

TESTS_DIR="$DEVENV_TOOLS/tests"

echo "Running Devenv test suite..."
echo "======================================"

# Verify tests directory exists
if [ ! -d "$TESTS_DIR" ]; then
    echo "Error: Test directory not found at $TESTS_DIR"
    exit 1
fi

# Run all test files in tests directory
if bats "$TESTS_DIR"/*.bats; then
    echo "======================================"
    echo "✅ All tests passed!"
    exit 0
else
    echo "======================================"
    echo "❌ Some tests failed!"
    exit 1
fi
