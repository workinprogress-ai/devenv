#!/usr/bin/env bats
# Smoke tests for scripts/issue-artifact-{get,list,select}.sh: syntax, help,
# version and argument validation. Everything here fails (or exits) before any
# provider call, so nothing touches the network.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPTS_DIR="$BATS_TEST_DIRNAME/../../scripts"

setup() {
    test_helper_setup
    unset DEVENV_REPO
}

teardown() {
    test_helper_teardown
}

@test "get, list and select have valid bash syntax" {
    for t in get list select; do
        run bash -n "$SCRIPTS_DIR/issue-artifact-$t.sh"
        [ "$status" -eq 0 ]
    done
}

@test "--help exits 0 and shows usage for each" {
    for t in get list select; do
        run bash "$SCRIPTS_DIR/issue-artifact-$t.sh" --help
        [ "$status" -eq 0 ]
        [[ "$output" == *"Usage: issue-artifact-$t.sh"* ]]
    done
}

@test "--version exits 0 and prints a semantic version for each" {
    for t in get list select; do
        run bash "$SCRIPTS_DIR/issue-artifact-$t.sh" --version
        [ "$status" -eq 0 ]
        [[ "$output" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
    done
}

@test "an unknown option is a usage error (exit 2) for each" {
    for t in get list select; do
        run bash "$SCRIPTS_DIR/issue-artifact-$t.sh" --bogus
        [ "$status" -eq 2 ]
        [[ "$output" == *"Unknown option"* ]]
    done
}

@test "no arguments is a usage error (exit 2) for each" {
    for t in get list select; do
        run bash "$SCRIPTS_DIR/issue-artifact-$t.sh"
        [ "$status" -eq 2 ]
    done
}

@test "a non-numeric issue number is a usage error (exit 2) for each" {
    for t in get list select; do
        run bash "$SCRIPTS_DIR/issue-artifact-$t.sh" --issue abc
        [ "$status" -eq 2 ]
        [[ "$output" == *"Invalid issue number"* ]]
    done
}

@test "get requires a doc id before it contacts the provider" {
    run bash "$SCRIPTS_DIR/issue-artifact-get.sh" --issue 5
    [ "$status" -eq 2 ]
    [[ "$output" == *"doc_id is required"* ]]
}
