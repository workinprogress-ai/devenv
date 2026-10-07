#!/usr/bin/env bats
# Argument handling of the small git helpers: --help prints usage and changes nothing
# (git-unwip rewrites history and force-pushes, git-update pulls, so an ignored flag
# is an action), an unknown argument is refused, and git-repo hands its arguments to
# the repo-get script that sits next to it.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPTS="$BATS_TEST_DIRNAME/../../scripts"

setup() {
    test_helper_setup
    export HOME="$TEST_TEMP_DIR/home"; mkdir -p "$HOME"
    export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
    REPO="$TEST_TEMP_DIR/repo"
    git init -q -b feature "$REPO"
    git -C "$REPO" commit -q --allow-empty -m "base"
    git -C "$REPO" commit -q --allow-empty -m "WIP: snapshot"
    HEAD_BEFORE="$(git -C "$REPO" rev-parse HEAD)"
}

teardown() {
    test_helper_teardown
}

@test "git-unwip --help prints usage and leaves history alone" {
    cd "$REPO"
    run bash "$SCRIPTS/git-unwip" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage"* ]]
    [ "$(git rev-parse HEAD)" = "$HEAD_BEFORE" ]
}

@test "git-unwip refuses an unknown argument and leaves history alone" {
    cd "$REPO"
    run bash "$SCRIPTS/git-unwip" --bogus
    [ "$status" -ne 0 ]
    [[ "$output" == *"Usage"* ]]
    [ "$(git rev-parse HEAD)" = "$HEAD_BEFORE" ]
}

@test "git-update --help prints usage without touching the repository" {
    cd "$REPO"
    run bash "$SCRIPTS/git-update" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage"* ]]
}

@test "git-update refuses an unknown argument" {
    cd "$REPO"
    run bash "$SCRIPTS/git-update" --bogus
    [ "$status" -ne 0 ]
    [[ "$output" == *"Usage"* ]]
}

@test "git-repo hands its arguments to the repo-get script next to it, not to whatever is on PATH" {
    local fake="$TEST_TEMP_DIR/fake"; mkdir -p "$fake/scripts" "$fake/path"
    cp "$SCRIPTS/git-repo" "$fake/scripts/git-repo"
    printf '#!/bin/bash\necho "next-to-it: $*"\n' > "$fake/scripts/repo-get.sh"
    printf '#!/bin/bash\necho "from-path: $*"\n' > "$fake/path/repo-get.sh"
    chmod +x "$fake/scripts/"* "$fake/path/"*
    PATH="$fake/path:$PATH" run bash "$fake/scripts/git-repo" some-repo
    [ "$status" -eq 0 ]
    [ "$output" = "next-to-it: some-repo" ]
}
