#!/usr/bin/env bats
# Tests for lib/providers/azure/azure-setup.sh — the one-time project setup.
#
# Contract-shaped tests only (gate, help, dry-run flag, PAT resolution
# error); the live API interaction is manual-only (AZURE_SETUP gate) and
# validated against the disposable test project, never here.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    SETUP_SCRIPT="$DEVENV_TOOLS/lib/providers/azure/azure-setup.sh"
}

teardown() {
    test_helper_teardown
}

@test "azure-setup: script has valid syntax" {
    bash -n "$SETUP_SCRIPT"
}

@test "azure-setup: refuses to run without AZURE_SETUP=1" {
    run bash "$SETUP_SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "AZURE_SETUP=1" ]]
    # And it refused BEFORE any network attempt (no curl spawn).
}

@test "azure-setup: --help prints usage and requirements without the gate" {
    run bash "$SETUP_SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" =~ "azure-setup.sh" ]]
    [[ "$output" =~ "AZURE_SETUP=1" ]]
    [[ "$output" =~ "key-update-azure" ]]
    [[ "$output" =~ "status_workflow" ]]
    [[ "$output" =~ "--dry-run" ]]
}

@test "azure-setup: help works via -h too" {
    run bash "$SETUP_SCRIPT" -h
    [ "$status" -eq 0 ]
    [[ "$output" =~ "USAGE" ]]
}

@test "azure-setup: gated run without PAT fails with guidance, not a stack trace" {
    # Gate passes but no PAT: the auth seam must fail with the documented
    # message. config points at a temp DEVENV_ROOT with no PAT file.
    export DEVENV_ROOT="$TEST_TEMP_DIR"
    mkdir -p "$DEVENV_ROOT"
    printf '[provider]\nname=azure\nazure_org=o\nazure_project=p\n' > "$DEVENV_ROOT/devenv.config"
    AZURE_SETUP=1 run bash "$SETUP_SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "key-update-azure" ]]
}
