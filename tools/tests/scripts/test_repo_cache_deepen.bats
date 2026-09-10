#!/usr/bin/env bats
# Tests for repo-cache-deepen script

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup

    # Build a local "remote" repo with history, plus a feature branch
    REMOTE_REPO=$(mktemp -d)
    git init -q --bare "$REMOTE_REPO"

    SOURCE_REPO=$(mktemp -d)
    cd "$SOURCE_REPO"
    git init -q
    git config user.email "test@test.com"
    git config user.name "Test"
    git commit -q --allow-empty -m "c1"
    git commit -q --allow-empty -m "c2"
    git branch -M master
    git checkout -q -b issue-42-feature
    git commit -q --allow-empty -m "branch work"
    git checkout -q master
    git push -q "$REMOTE_REPO" --all

    # Shallow single-branch clone in a test cache dir (mirrors repo-cache.bash).
    # file:// prefix is required: local-path clones ignore --depth.
    export REPO_CACHE_DIR="$TEST_TEMP_DIR/cache/repo_cache"
    mkdir -p "$REPO_CACHE_DIR"
    git clone -q --depth 1 --single-branch --no-tags "file://$REMOTE_REPO" "$REPO_CACHE_DIR/repo-alpha"
    cd "$ORIGINAL_PWD"
}

teardown() {
    rm -rf "$TEST_TEMP_DIR" "$SOURCE_REPO" "$REMOTE_REPO"
}

@test "repo-cache-deepen script exists and is executable" {
    [ -x "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh" ]
}

@test "repo-cache-deepen script has valid bash syntax" {
    run bash -n "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh"
    [ "$status" -eq 0 ]
}

@test "repo-cache-deepen requires --repo" {
    run bash "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh"
    [ "$status" -ne 0 ]
    [[ "$output" == *"--repo is required"* ]]
}

@test "repo-cache-deepen fails on unknown repo" {
    run bash "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh" --repo does-not-exist
    [ "$status" -eq 1 ]
    [[ "$output" == *"not found in cache"* ]]
}

@test "repo-cache-deepen rejects non-numeric depth" {
    run bash "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh" --repo repo-alpha --depth abc
    [ "$status" -eq 3 ]
    [[ "$output" == *"--depth must be a positive integer"* ]]
}

@test "repo-cache-deepen deepens history (more commits reachable)" {
    local before after
    before=$(git -C "$REPO_CACHE_DIR/repo-alpha" rev-list --count HEAD)
    run bash "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh" --repo repo-alpha --depth 10
    [ "$status" -eq 0 ]
    after=$(git -C "$REPO_CACHE_DIR/repo-alpha" rev-list --count HEAD)
    [ "$after" -gt "$before" ]
}

@test "repo-cache-deepen never checks out (working copy stays on master)" {
    run bash "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh" --repo repo-alpha --branch issue-42-feature
    [ "$status" -eq 0 ]
    [ "$(git -C "$REPO_CACHE_DIR/repo-alpha" branch --show-current)" = "master" ]
}

@test "repo-cache-deepen fetches branch as remote ref" {
    run bash "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh" --repo repo-alpha --branch issue-42-feature
    [ "$status" -eq 0 ]
    git -C "$REPO_CACHE_DIR/repo-alpha" rev-parse --verify refs/remotes/origin/issue-42-feature > /dev/null
}

@test "repo-cache-deepen fetches multiple branches" {
    git -C "$SOURCE_REPO" checkout -q -b issue-57-audit 2>/dev/null
    git -C "$SOURCE_REPO" commit -q --allow-empty -m "audit work"
    git -C "$SOURCE_REPO" push -q "$REMOTE_REPO" issue-57-audit

    run bash "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh" --repo repo-alpha --branch issue-42-feature --branch issue-57-audit
    [ "$status" -eq 0 ]
    git -C "$REPO_CACHE_DIR/repo-alpha" rev-parse --verify refs/remotes/origin/issue-42-feature > /dev/null
    git -C "$REPO_CACHE_DIR/repo-alpha" rev-parse --verify refs/remotes/origin/issue-57-audit > /dev/null
}

@test "repo-cache-deepen is idempotent (re-run succeeds)" {
    run bash "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh" --repo repo-alpha --branch issue-42-feature
    [ "$status" -eq 0 ]
    run bash "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh" --repo repo-alpha --branch issue-42-feature
    [ "$status" -eq 0 ]
}

@test "repo-cache-deepen fails on fetch failure (bad remote)" {
    # Point the cached repo's origin at a nonexistent path
    git -C "$REPO_CACHE_DIR/repo-alpha" remote set-url origin "$TEST_TEMP_DIR/no-such-remote.git"
    run bash "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh" --repo repo-alpha
    [ "$status" -eq 1 ]
    [[ "$output" == *"Failed to deepen history"* ]]
}

@test "repo-cache-deepen fails on unknown branch" {
    run bash "$DEVENV_TOOLS/scripts/repo-cache-deepen.sh" --repo repo-alpha --branch no-such-branch
    [ "$status" -eq 1 ]
    [[ "$output" == *"Failed to fetch branch"* ]]
}
