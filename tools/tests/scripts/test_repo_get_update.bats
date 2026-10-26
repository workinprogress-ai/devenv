#!/usr/bin/env bats
# repo-get's update of an existing clone must never destroy local work: a dirty working
# tree or unpushed commits make it skip the repo with a message, and a clean tree only
# ever moves forward (fast-forward). repo-update-all must report a failed update as a
# failed run.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../repo-get"
UPDATE_ALL="$BATS_TEST_DIRNAME/../../repo-update-all"

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

# update_clone: run the real repo-get against $CLONE — no-arg context mode
# from inside the clone (DEVENV_ROOT sandbox places repos/clone at $CLONE).
update_clone() {
    local root="$TEST_TEMP_DIR/getroot"
    mkdir -p "$root/repos" "$root/bin"
    printf '[organization]\norg=test-org\n' > "$root/devenv.config"
    # gh auth-status stub: the update path's provider gates run before any
    # git work; only `auth status` is answered, everything else fails loud.
    printf '#!/bin/sh\n[ "$1" = auth ] && exit 0\nexit 1\n' > "$root/bin/gh"
    chmod +x "$root/bin/gh"
    ln -sfn "$CLONE" "$root/repos/clone"
    run bash -c "cd '$CLONE' && DEVENV_ROOT='$root' PATH='$root/bin:$PROJECT_ROOT/tools:$PATH' '$SCRIPT'"
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
    printf '#!/bin/bash\necho nope >&2\nexit 1\n' > "$fake/scripts/repo-get.ts"
    chmod +x "$fake/scripts/repo-get.ts"
    cp "$BATS_TEST_DIRNAME/../../ts/repo-update-all.ts" "$fake/scripts/"
    run node "$fake/scripts/repo-update-all.ts" --jobs 1
    [ "$status" -ne 0 ]
    [[ "$output" == *"Update failed"* ]]
}
