#!/usr/bin/env bats
# repo-get's update of an existing clone must never destroy local work: a dirty working
# tree or unpushed commits make it skip the repo with a message, and a clean tree only
# ever moves forward (fast-forward). repo-update-all must report a failed update as a
# failed run.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/repo-get.sh"
UPDATE_ALL="$BATS_TEST_DIRNAME/../../scripts/repo-update-all.sh"

setup() {
    test_helper_setup
    export HOME="$TEST_TEMP_DIR/home"; mkdir -p "$HOME"
    export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
    ORIGIN="$TEST_TEMP_DIR/origin.git"
    SEED="$TEST_TEMP_DIR/seed"
    CLONE="$TEST_TEMP_DIR/clone"
    git init -q --bare -b main "$ORIGIN"
    git init -q -b main "$SEED"
    git -C "$SEED" remote add origin "$ORIGIN"
    commit_in "$SEED" base
    git -C "$SEED" push -q origin main
    git clone -q "$ORIGIN" "$CLONE"
    git -C "$CLONE" config user.email t@example.test
    git -C "$CLONE" config user.name t
}

teardown() {
    test_helper_teardown
}

commit_in() {   # commit_in <dir> <name>
    echo "$2" > "$1/$2.txt"; git -C "$1" add "$2.txt"; git -C "$1" commit -q -m "$2"
}

advance_origin() {   # a new commit on origin's main
    commit_in "$SEED" upstream
    git -C "$SEED" push -q origin main
}

# update_clone: run repo-get's update_existing_repo against $CLONE
update_clone() {
    run bash -c "
        set -euo pipefail
        configure_git_repo() { :; }
        REPO_NAME=clone TARGET_DIR='$CLONE' GIT_URL=unused
        $(sed -n '/^detect_default_branch()/,/^}/p;/^update_existing_repo()/,/^}/p' "$SCRIPT")
        update_existing_repo
    "
}

@test "a clean clone on the default branch fast-forwards to origin" {
    advance_origin
    update_clone
    [ "$status" -eq 0 ]
    [ "$(git -C "$CLONE" rev-parse HEAD)" = "$(git -C "$ORIGIN" rev-parse main)" ]
}

@test "unpushed commits on the default branch survive an update, and the repo is skipped with a message" {
    commit_in "$CLONE" mine
    local mine; mine="$(git -C "$CLONE" rev-parse HEAD)"
    advance_origin
    update_clone
    [ "$status" -eq 0 ]
    [[ "$output" == *"Skipping"* ]]
    [[ "$output" == *"unpushed"* ]]
    [ "$(git -C "$CLONE" rev-parse HEAD)" = "$mine" ]
}

@test "uncommitted changes survive an update, and the repo is skipped with a message" {
    echo local-edit >> "$CLONE/base.txt"
    advance_origin
    update_clone
    [ "$status" -eq 0 ]
    [[ "$output" == *"Skipping"* ]]
    [[ "$output" == *"uncommitted"* ]]
    grep -q local-edit "$CLONE/base.txt"
}

@test "on a feature branch a clean update fast-forwards the default branch and leaves the feature branch's commits" {
    git -C "$CLONE" checkout -q -b feature
    commit_in "$CLONE" feat
    advance_origin
    update_clone
    [ "$status" -eq 0 ]
    [ "$(git -C "$CLONE" rev-parse main)" = "$(git -C "$ORIGIN" rev-parse main)" ]
    [ -f "$CLONE/feat.txt" ]
    [ "$(git -C "$CLONE" rev-parse --abbrev-ref HEAD)" = "feature" ]
}

@test "a local default branch with unpushed commits is not overwritten while another branch is checked out" {
    commit_in "$CLONE" mine
    local mine; mine="$(git -C "$CLONE" rev-parse HEAD)"
    git -C "$CLONE" checkout -q -b feature
    advance_origin
    update_clone
    [ "$(git -C "$CLONE" rev-parse main)" = "$mine" ]
}

@test "the update never uses reset --hard" {
    run ! grep -nE "reset --hard" "$SCRIPT"
}

@test "repo-update-all exits non-zero when a repo update fails" {
    export DEVENV_ROOT="$TEST_TEMP_DIR/root"
    mkdir -p "$DEVENV_ROOT/repos/broken/.git"
    # a fake tools root whose repo-get always fails
    local fake="$TEST_TEMP_DIR/tools"
    mkdir -p "$fake/scripts"
    cp -r "$BATS_TEST_DIRNAME/../../lib" "$fake/lib"
    printf '#!/bin/bash\necho nope >&2\nexit 1\n' > "$fake/scripts/repo-get.sh"
    chmod +x "$fake/scripts/repo-get.sh"
    cp "$UPDATE_ALL" "$fake/scripts/repo-update-all.sh"
    run bash "$fake/scripts/repo-update-all.sh" --jobs 1
    [ "$status" -ne 0 ]
    [[ "$output" == *"Update failed"* ]]
}
