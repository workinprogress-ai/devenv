#!/usr/bin/env bats
# Tests for fork-sync.sh --link / --propose-links (adoption-map wiring).

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    SCRIPT="$DEVENV_TOOLS/fork-sync"
    create_fork_fixture_trio "$TEST_TEMP_DIR/fork-fixture"
    export FORK_TWIN_LOCAL_REPO="$FORK_FIXTURE_WORKING_CLONE"
    export FORK_TWIN_UPSTREAM_REPO="$FORK_FIXTURE_GH_CLONE"
    source "$DEVENV_TOOLS/lib/fork-twin.bash"
    git -C "$FORK_FIXTURE_WORKING_CLONE" remote add upstream "$FORK_FIXTURE_UPSTREAM"
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    export DEVENV_ROOT="$TEST_TEMP_DIR/config-root"
    export DEVENV_ROOT_SET=1
    mkdir -p "$DEVENV_ROOT"
    printf '[fork]\nupstream_repo=%s\nupstream_branch=master\n' "$FORK_FIXTURE_UPSTREAM" > "$DEVENV_ROOT/devenv.config"
    export FORK_UPSTREAM_CLONE="$FORK_FIXTURE_GH_CLONE"
    cd "$FORK_FIXTURE_WORKING_CLONE"
}

teardown() {
    test_helper_teardown
}

@test "fork-sync: --link records an adoption pair" {
    fork_scenario_pre_change_id_backlog 2
    local_l="$(git log --format=%H --grep='backlog: pre-change-id commit 1' -1)"
    git format-patch -1 --stdout "$local_l" | git -C "$FORK_FIXTURE_GH_CLONE" am -q
    local_u="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep='backlog: pre-change-id commit 1' -1)"

    run "$SCRIPT" --link "$local_l" "$local_u"
    [ "$status" -eq 0 ]
    [[ "$output" == *"recorded adoption pair"* ]]
    MAP="$(fork_twin_map_get_path "$FORK_FIXTURE_WORKING_CLONE")"
    grep -q "$local_l $local_u" "$MAP"
}

@test "fork-sync: --propose-links (non-TTY) prints exact --link commands" {
    fork_scenario_pre_change_id_backlog 2
    for n in 1 2; do
        c="$(git log --format=%H --grep="backlog: pre-change-id commit $n" -1)"
        git format-patch -1 --stdout "$c" | git -C "$FORK_FIXTURE_GH_CLONE" am -q
    done

    run "$SCRIPT" --propose-links
    [ "$status" -eq 0 ]
    [[ "$output" == *"fork-sync --link"* ]]
    l2="$(git log --format=%H --grep='backlog: pre-change-id commit 2' -1)"
    u2="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep='backlog: pre-change-id commit 2' -1)"
    [[ "$output" == *"--link $l2 $u2"* ]]
}

@test "fork-sync: --link refuses to combine with --replay" {
    run "$SCRIPT" --link a b --replay
    [ "$status" -ne 0 ]
    [[ "$output" == *"--link runs alone"* ]]
}

@test "fork-sync: --propose-links reports no candidates when nothing matches" {
    run "$SCRIPT" --propose-links
    [ "$status" -eq 0 ]
    [[ "$output" == *"no adoption candidates"* ]]
}
