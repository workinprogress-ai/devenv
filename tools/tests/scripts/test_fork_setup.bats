#!/usr/bin/env bats
# Tests for lib/providers/azure/fork-setup.sh — one-time upstream setup.
#
# Contract tests for one-time upstream setup.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    SCRIPT="$DEVENV_TOOLS/lib/providers/azure/fork-setup.sh"
}

teardown() {
    test_helper_teardown
}

_setup_fork_fixture() {
    create_fork_fixture_trio "$TEST_TEMP_DIR/fork-fixture"
    export DEVENV_ROOT="$TEST_TEMP_DIR/config-root"
    export DEVENV_ROOT_SET=1
    mkdir -p "$DEVENV_ROOT"
    printf '[fork]\nupstream_repo=%s\nupstream_branch=master\n' "$FORK_FIXTURE_UPSTREAM" > "$DEVENV_ROOT/devenv.config"
    cd "$FORK_FIXTURE_WORKING_CLONE"
}

@test "fork-setup: script has valid syntax" {
    bash -n "$SCRIPT"
}

@test "fork-setup: --help prints usage without implementing logic" {
    run bash "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"fork-setup.sh"* ]]
    [[ "$output" == *"fetch-only"* ]]
    [[ "$output" == *"upstream_repo"* ]]
    [[ "$output" == *"upstream_branch"* ]]
    [[ "$output" == *"--dry-run"* ]]
}

@test "fork-setup: requires upstream_repo and upstream_branch in [fork] config" {
    export DEVENV_ROOT="$TEST_TEMP_DIR/config-root"
    export DEVENV_ROOT_SET=1
    mkdir -p "$DEVENV_ROOT"

    printf '[fork]\nupstream_repo=https://example.invalid/devenv.git\n' > "$DEVENV_ROOT/devenv.config"
    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"upstream_branch"* ]]

    printf '[fork]\nupstream_branch=master\n' > "$DEVENV_ROOT/devenv.config"
    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"upstream_repo"* ]]
}

@test "fork-setup: adds a fetch-only upstream remote" {
    _setup_fork_fixture

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [ "$(git remote get-url upstream)" = "$FORK_FIXTURE_UPSTREAM" ]
    [ "$(git remote get-url --push upstream)" = "/dev/null" ]
    [[ "$output" == *"master"* ]]
}

@test "fork-setup: repeated setup is idempotent" {
    _setup_fork_fixture

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    before_config="$(git config --local --list --show-origin | sort)"
    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"already configured"* ]]
    [ "$(git config --local --list --show-origin | sort)" = "$before_config" ]
}

@test "fork-setup: replaces additional push URLs after the fetch-only guard" {
    _setup_fork_fixture
    git remote add upstream "$FORK_FIXTURE_UPSTREAM"
    git config --local --add remote.upstream.pushurl /dev/null
    git config --local --add remote.upstream.pushurl "$FORK_FIXTURE_UPSTREAM"

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [ "$(git remote get-url --push --all upstream)" = "/dev/null" ]
}

@test "fork-setup: refuses to overwrite a conflicting upstream remote" {
    _setup_fork_fixture
    git remote add upstream "$FORK_FIXTURE_ADO_ORIGIN"

    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"already points to a different URL"* ]]
    [ "$(git remote get-url upstream)" = "$FORK_FIXTURE_ADO_ORIGIN" ]
}

@test "fork-setup: --dry-run leaves remotes unchanged" {
    _setup_fork_fixture

    run bash "$SCRIPT" --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"dry run"* ]]
    [ -z "$(git remote get-url upstream 2>/dev/null || true)" ]
}
