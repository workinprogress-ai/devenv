#!/usr/bin/env bash
# Run all BATS tests

set -euo pipefail

# Resolve the tools root from this script's own location (self-root contract:
# self-location wins; an exported DEVENV_TOOLS is honored only when it points
# at this same checkout). Export for child bats processes, which read it from
# the environment; without export, a CI-like invocation leaves them unset.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
export DEVENV_TOOLS

TESTS_DIR="$DEVENV_TOOLS/tests"

echo "Running Devenv test suite..."
echo "======================================"

# Verify tests directory exists
if [ ! -d "$TESTS_DIR" ]; then
    echo "Error: Test directory not found at $TESTS_DIR"
    exit 1
fi

# Run library tests
echo "Running library tests..."
if [ -d "$TESTS_DIR/lib" ] && [ -n "$(ls -A "$TESTS_DIR/lib"/*.bats 2>/dev/null)" ]; then
    if ! bats "$TESTS_DIR/lib"/*.bats; then
        echo "======================================"
        echo "❌ Library tests failed!"
        exit 1
    fi
fi

# Run script tests
echo ""
echo "Running script tests..."
if [ -d "$TESTS_DIR/scripts" ] && [ -n "$(ls -A "$TESTS_DIR/scripts"/*.bats 2>/dev/null)" ]; then
    if ! bats "$TESTS_DIR/scripts"/*.bats; then
        echo "======================================"
        echo "❌ Script tests failed!"
        exit 1
    fi
fi

# Run devenv tests
echo ""
echo "Running devenv tests..."
if [ -d "$TESTS_DIR/devenv" ] && [ -n "$(ls -A "$TESTS_DIR/devenv"/*.bats 2>/dev/null)" ]; then
    if ! bats "$TESTS_DIR/devenv"/*.bats; then
        echo "======================================"
        echo "❌ Devenv tests failed!"
        exit 1
    fi
fi

echo "======================================"
echo "✅ All tests passed!"
exit 0
