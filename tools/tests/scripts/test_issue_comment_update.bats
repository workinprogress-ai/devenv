#!/usr/bin/env bats
# Tests for scripts/issue-comment-update.sh: syntax, help/version, and that the
# usage examples describe operations the tool actually performs.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/issue-comment-update.sh"

@test "issue-comment-update.sh has valid bash syntax" {
    run bash -n "$SCRIPT"
    [ "$status" -eq 0 ]
}

@test "--help exits 0 and shows usage" {
    run bash "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "--version exits 0 and prints a semantic version" {
    run bash "$SCRIPT" --version
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

@test "the usage example for finding a comment id lists comments with issue-comment-list" {
    run bash "$SCRIPT" --help
    # `issue-comment-update 42 | jq` would UPDATE comment 42, not list issue 42's comments
    [[ "$output" != *"issue-comment-update.sh 42 |"* ]]
    [[ "$output" == *"issue-comment-list"*"42"*"jq"* ]]
}
