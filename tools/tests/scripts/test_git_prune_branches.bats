#!/usr/bin/env bats
# Tests for scripts/git-prune-branches — destructive, so every test runs in a
# throwaway clone of a throwaway bare origin.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/git-prune-branches"

setup() {
    test_helper_setup
    export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
    export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
    ORIGIN="$TEST_TEMP_DIR/origin.git"
    CLONE="$TEST_TEMP_DIR/clone"
    git init -q --bare -b main "$ORIGIN"
    git clone -q "$ORIGIN" "$CLONE" 2>/dev/null
    cd "$CLONE"
    git checkout -q -b main 2>/dev/null || true
    echo base > f && git add f && git commit -q -m base
    git push -q -u origin main 2>/dev/null
}

teardown() {
    cd "$PROJECT_ROOT"
    test_helper_teardown
}

# gone_branch <name> [unmerged]: a branch pushed then deleted upstream; with
# "unmerged" it carries a commit main does not have.
gone_branch() {
    git checkout -q -b "$1"
    if [ "${2:-}" = unmerged ]; then
        echo "$1" > "$1.txt" && git add "$1.txt" && git commit -q -m "$1 work"
    fi
    git push -q -u origin "$1" 2>/dev/null
    git checkout -q main
    git push -q origin --delete "$1" 2>/dev/null
}

branches() { git for-each-ref --format='%(refname:short)' refs/heads | sort | tr '\n' ' '; }

@test "git-prune-branches has valid bash syntax" {
    run bash -n "$SCRIPT"
    [ "$status" -eq 0 ]
}

@test "with no gone upstream it reports nothing to prune and never prompts" {
    run bash "$SCRIPT" </dev/null
    [ "$status" -eq 0 ]
    [[ "$output" == *"Nothing to prune"* ]]
    [ "$(branches)" = "main " ]
}

@test "the preview lists the gone branch but deletes nothing before confirmation" {
    gone_branch merged-gone
    run bash -c "echo n | bash '$SCRIPT'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"merged-gone"* ]]
    [[ "$output" == *"Aborted"* ]]
    [ "$(branches)" = "main merged-gone " ]
}

@test "any answer other than y/Y aborts and deletes nothing" {
    gone_branch merged-gone
    run bash -c "echo x | bash '$SCRIPT'"
    [[ "$output" == *"Aborted"* ]]
    [ "$(branches)" = "main merged-gone " ]
}

@test "Y deletes a merged branch whose upstream is gone" {
    gone_branch merged-gone
    run bash -c "echo Y | bash '$SCRIPT'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Deleted: merged-gone"* ]]
    [ "$(branches)" = "main " ]
}

@test "a branch whose upstream still exists is never touched" {
    git checkout -q -b live && git push -q -u origin live 2>/dev/null && git checkout -q main
    gone_branch merged-gone
    run bash -c "echo Y | bash '$SCRIPT'"
    [ "$status" -eq 0 ]
    [ "$(branches)" = "live main " ]
}

@test "an unmerged gone branch is skipped with a report, never force-deleted" {
    gone_branch unmerged-gone unmerged
    run --separate-stderr bash -c "echo Y | bash '$SCRIPT'"
    [ "$status" -eq 0 ]
    [[ "$stderr" == *"SKIPPED"*"unmerged-gone"* ]]
    [ "$(branches)" = "main unmerged-gone " ]
}

@test "a skipped branch does not stop the others from being deleted" {
    gone_branch unmerged-gone unmerged
    gone_branch merged-gone
    run --separate-stderr bash -c "echo Y | bash '$SCRIPT'"
    [ "$status" -eq 0 ]
    [ "$(branches)" = "main unmerged-gone " ]
}
