#!/usr/bin/env bats
# Behavior tests for git-wip-recover (Plan-002 task 3.2 / AC-4).
#
# Uses a real temp git repo (same scaffolding as test_git_unwip.bats) and
# creates refs/wip/last as git-wip would. Locks: --show output, --branch
# creation at the saved ref, unknown-option refusal, missing-ref refusal.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup

    REMOTE_REPO=$(mktemp -d)
    git init -q --bare "$REMOTE_REPO"

    TEST_REPO=$(mktemp -d)
    cd "$TEST_REPO"
    git init -q
    git config user.email "test@test.com"
    git config user.name "Test"
    git remote add origin "$REMOTE_REPO"

    touch file.txt && git add file.txt && git commit -q -m "initial"
    # Simulate what git-wip saves: a WIP commit plus its ref.
    git commit -q --allow-empty -m "WIP: checkpoint"
    WIP_COMMIT=$(git rev-parse HEAD)
    git update-ref refs/wip/last "$WIP_COMMIT"
}

teardown() {
    rm -rf "$TEST_REPO" "$REMOTE_REPO"
}

@test "recover: --show prints the saved WIP commit summary" {
    run bash "$PROJECT_ROOT/tools/scripts/git-wip-recover" --show
    [ "$status" -eq 0 ]
    [[ "$output" == *"Saved WIP commit: $WIP_COMMIT"* ]]
    [[ "$output" == *"WIP: checkpoint"* ]]
}

@test "recover: --branch creates a branch at the saved ref" {
    run bash "$PROJECT_ROOT/tools/scripts/git-wip-recover" --branch rescue-1
    [ "$status" -eq 0 ]
    [[ "$output" == *"checked out 'rescue-1'"* ]]
    [ "$(git rev-parse refs/heads/rescue-1)" = "$WIP_COMMIT" ]
    # HEAD is on the new branch
    [ "$(git branch --show-current)" = "rescue-1" ]
}

@test "recover: --branch defaults to wip-recovered" {
    run bash "$PROJECT_ROOT/tools/scripts/git-wip-recover" --branch
    [ "$status" -eq 0 ]
    [ "$(git rev-parse refs/heads/wip-recovered)" = "$WIP_COMMIT" ]
}

@test "recover: unknown option is refused" {
    run bash "$PROJECT_ROOT/tools/scripts/git-wip-recover" --bogus
    [ "$status" -eq 1 ]
    [[ "$output" == *"unknown option"* ]]
}

@test "recover: missing ref is refused" {
    git update-ref -d refs/wip/last
    run bash "$PROJECT_ROOT/tools/scripts/git-wip-recover" --show
    [ "$status" -eq 1 ]
    [[ "$output" == *"no saved WIP commit"* ]]
}

@test "recover: --help exits cleanly" {
    run bash "$PROJECT_ROOT/tools/scripts/git-wip-recover" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
}
