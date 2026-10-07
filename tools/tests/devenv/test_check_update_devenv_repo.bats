#!/usr/bin/env bats
# check-update-devenv-repo.sh: every exit path, through a throwaway origin and
# clone. The script runs as its own process (sanity-check.sh executes it), so
# it needs no cd-back or return before exit — a child's cwd never reaches its
# parent, and `return` is not valid in an executed script.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
    export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
    ORIGIN="$TEST_TEMP_DIR/origin.git"
    CLONE="$TEST_TEMP_DIR/clone"
    OTHER="$TEST_TEMP_DIR/other"
    git init -q --bare -b master "$ORIGIN"
    git clone -q "$ORIGIN" "$CLONE" 2>/dev/null
    git -C "$CLONE" checkout -q -B master
    mkdir -p "$CLONE/.devcontainer" "$CLONE/tools"
    cp "$PROJECT_ROOT/.devcontainer/check-update-devenv-repo.sh" "$PROJECT_ROOT/.devcontainer/post-update.bash" "$CLONE/.devcontainer/"
    # git-update stand-in: succeeds or fails on demand, and records that it ran.
    printf '%s\n' '#!/usr/bin/env bash' 'echo ran >> "$GIT_UPDATE_LOG"' '[ -z "${GIT_UPDATE_PULL:-}" ] || git -C "$(dirname "$0")/.." pull -q --ff-only origin master' 'exit "${GIT_UPDATE_RC:-0}"' > "$CLONE/tools/git-update"
    printf '%s\n' '#!/usr/bin/env bash' 'echo bootstrap >> "$GIT_UPDATE_LOG"' > "$CLONE/.devcontainer/bootstrap.sh"
    chmod +x "$CLONE/tools/git-update" "$CLONE/.devcontainer/bootstrap.sh" "$CLONE/.devcontainer/check-update-devenv-repo.sh"
    git -C "$CLONE" add -A && git -C "$CLONE" commit -q -m "base" && git -C "$CLONE" push -q origin master
    export GIT_UPDATE_LOG="$TEST_TEMP_DIR/git-update.log"; : > "$GIT_UPDATE_LOG"
}

# Put a new commit on origin (optionally with a Devenv-Action trailer), then
# fetch it into the clone so origin/master is ahead of the clone.
advance_origin() {
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --allow-empty -m "change" -m "${1:+Devenv-Action: $1}"
    git -C "$OTHER" push -q origin master
    git -C "$CLONE" fetch -q origin
}

run_check() {
    # run_check ANSWER — answers the update prompt; an unattended run closes stdin.
    printf '%s\n' "${1:-}" | bash "$CLONE/.devcontainer/check-update-devenv-repo.sh"
}

@test "uncommitted changes with an update on offer: refuses and exits 1" {
    advance_origin ""
    echo dirty >> "$CLONE/tools/git-update"
    run run_check "y"
    [ "$status" -eq 1 ]
    [[ "$output" == *"uncommitted changes"* ]]
    [ ! -s "$GIT_UPDATE_LOG" ]
}

@test "uncommitted changes while up to date: silent, exit 0" {
    echo dirty >> "$CLONE/tools/git-update"
    run run_check ""
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "up to date: silent, exit 0" {
    run run_check ""
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "local ahead of remote: silent, exit 0" {
    git -C "$CLONE" commit -q --allow-empty -m "local only"
    run run_check ""
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "behind on a non-master branch: warns to update by hand, exit 0" {
    git -C "$CLONE" checkout -q -b feature
    git -C "$CLONE" push -q origin feature
    git clone -q -b feature "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --allow-empty -m "feature change"
    git -C "$OTHER" push -q origin feature
    git -C "$CLONE" fetch -q origin
    run run_check ""
    [ "$status" -eq 0 ]
    [[ "$output" == *"different on the remote"* ]]
    [ ! -s "$GIT_UPDATE_LOG" ]
}

@test "behind on master, answering n: exit 1 and nothing is pulled" {
    advance_origin ""
    run run_check "n"
    [ "$status" -eq 1 ]
    [ ! -s "$GIT_UPDATE_LOG" ]
}

@test "behind on master, answering y: updates and reports completion, exit 0" {
    advance_origin ""
    run run_check "y"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Update complete."* ]]
    grep -qx ran "$GIT_UPDATE_LOG"
}

@test "behind on master, update fails: exits 1 with guidance" {
    advance_origin ""
    GIT_UPDATE_RC=1 run run_check "y"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Error updating the repository"* ]]
}

@test "the update-check script has no cd-back or return before exit" {
    # It runs as its own process: cd - changes nothing the caller can see, and
    # `return` outside a function is an error in an executed script.
    run grep -nE 'cd - |\|\| return' "$PROJECT_ROOT/.devcontainer/check-update-devenv-repo.sh"
    [ "$status" -eq 1 ] || { echo "$output"; return 1; }
}

@test "a bootstrap trailer asks before running bootstrap, and runs it on y" {
    advance_origin "bootstrap"
    GIT_UPDATE_PULL=1 run run_check $'y\ny\nn'
    [ "$status" -eq 0 ]
    [[ "$output" == *"Post-update action: run bootstrap"* ]]
    grep -qx bootstrap "$GIT_UPDATE_LOG"
}

@test "a bootstrap trailer answered n skips bootstrap" {
    advance_origin "bootstrap"
    GIT_UPDATE_PULL=1 run run_check $'y\nn'
    [ "$status" -eq 0 ]
    run ! grep -qx bootstrap "$GIT_UPDATE_LOG"
}

@test "the highest-priority trailer across the pulled commits wins" {
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --allow-empty -m "one" -m "Devenv-Action: restart"
    git -C "$OTHER" commit -q --allow-empty -m "two" -m "Devenv-Action: recreate"
    git -C "$OTHER" commit -q --allow-empty -m "three" -m "Devenv-Action: nothing"
    git -C "$OTHER" push -q origin master
    git -C "$CLONE" fetch -q origin
    GIT_UPDATE_PULL=1 run run_check $'y\n3'
    [[ "$output" == *"recreate container"* ]]
}

@test "devenv-update and the update check share one post-update routine" {
    grep -q 'post-update.bash' "$PROJECT_ROOT/.devcontainer/check-update-devenv-repo.sh"
    grep -q 'post-update.bash' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
    run ! grep -q 'action_priority()' "$PROJECT_ROOT/.devcontainer/check-update-devenv-repo.sh"
}

@test "ordinary divergence (local commits plus new remote commits): silent, exit 0, nothing pulled" {
    advance_origin ""
    git -C "$CLONE" commit -q --allow-empty -m "local only"
    run run_check ""
    [ "$status" -eq 0 ]
    [ -z "$output" ]
    [ ! -s "$GIT_UPDATE_LOG" ]
}

@test "remote history rewritten (force-pushed): says so with recovery guidance, exit 0, nothing pulled" {
    # the remote's tip is replaced by a different commit on the same parent
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --amend --allow-empty -m "base (rewritten)"
    git -C "$OTHER" push -q --force origin master
    git -C "$CLONE" fetch -q origin
    run run_check ""
    [ "$status" -eq 0 ]
    [[ "$output" == *"remote history of master was rewritten"* ]]
    [[ "$output" == *"git rebase origin/master"* ]]
    [ ! -s "$GIT_UPDATE_LOG" ]
}

@test "a rewrite is still reported after a second, ordinary fetch" {
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --amend --allow-empty -m "base (rewritten)"
    git -C "$OTHER" push -q --force origin master
    git -C "$CLONE" fetch -q origin
    # an ordinary commit lands on the rewritten remote and is fetched too
    git -C "$OTHER" commit -q --allow-empty -m "later work"
    git -C "$OTHER" push -q origin master
    git -C "$CLONE" fetch -q origin
    run run_check ""
    [ "$status" -eq 0 ]
    [[ "$output" == *"remote history of master was rewritten"* ]]
}

@test "local commits that were never on the remote stay silent even with several fetches" {
    git -C "$CLONE" commit -q --allow-empty -m "local only"
    advance_origin ""
    git -C "$OTHER" commit -q --allow-empty -m "more upstream"
    git -C "$OTHER" push -q origin master
    git -C "$CLONE" fetch -q origin
    run run_check ""
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "a shallow clone's missing history reads as not rewritten, never as a false alarm" {
    advance_origin ""
    git -C "$CLONE" commit -q --allow-empty -m "local only"
    SHALLOW="$TEST_TEMP_DIR/shallow"
    git clone -q --depth 1 "file://$ORIGIN" "$SHALLOW" 2>/dev/null
    mkdir -p "$SHALLOW/.devcontainer" "$SHALLOW/tools"
    cp "$CLONE/.devcontainer/check-update-devenv-repo.sh" "$CLONE/.devcontainer/post-update.bash" "$SHALLOW/.devcontainer/"
    git -C "$SHALLOW" commit -q --allow-empty -m "shallow local"
    run bash -c "printf '\n' | bash '$SHALLOW/.devcontainer/check-update-devenv-repo.sh'"
    [ "$status" -eq 0 ]
    [[ "$output" != *"was rewritten"* ]]
}
