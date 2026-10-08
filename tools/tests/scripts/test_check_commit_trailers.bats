#!/usr/bin/env bats
# Tests for scripts/check-commit-trailers.sh: the Devenv-Action trailer gate used
# by the commit-msg hook (message-file mode) and by CI (commit-range mode).

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/check-commit-trailers.sh"

setup() {
    test_helper_setup
    export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
    export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
    REPO="$TEST_TEMP_DIR/repo"
    git init -q -b main "$REPO"
    cd "$REPO"
    echo base > f && git add f && git commit -q -m "chore: base" -m "Devenv-Action: nothing"
    BASE="$(git rev-parse HEAD)"
}

teardown() {
    cd "$PROJECT_ROOT"
    test_helper_teardown
}

commit() { # commit <subject> [trailer-line]
    echo "$1" >> f && git add f
    if [ -n "${2:-}" ]; then git commit -q -m "$1" -m "$2"; else git commit -q -m "$1"; fi
}

@test "check-commit-trailers.sh has valid bash syntax" {
    run bash -n "$SCRIPT"
    [ "$status" -eq 0 ]
}

@test "--help exits 0 and shows usage; --version prints a version" {
    run bash "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
    run bash "$SCRIPT" --version
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

@test "no arguments is a usage error (exit 2)" {
    run bash "$SCRIPT"
    [ "$status" -eq 2 ]
}

@test "range mode passes when every commit carries a valid trailer" {
    commit "feat: one" "Devenv-Action: restart"
    commit "fix: two" "Devenv-Action: nothing"
    run bash "$SCRIPT" "$BASE" HEAD
    [ "$status" -eq 0 ]
}

@test "range mode fails on a commit with no trailer and names it" {
    commit "feat: ok" "Devenv-Action: nothing"
    commit "fix: forgot the trailer"
    run bash "$SCRIPT" "$BASE" HEAD
    [ "$status" -eq 1 ]
    [[ "$output" == *"forgot the trailer"* ]]
}

@test "range mode fails on an invalid trailer value" {
    commit "feat: bad value" "Devenv-Action: reboot"
    run bash "$SCRIPT" "$BASE" HEAD
    [ "$status" -eq 1 ]
}

@test "range mode rejects a WIP commit (WIP never reaches master)" {
    commit "WIP: half done" "Devenv-Action: nothing"
    run bash "$SCRIPT" "$BASE" HEAD
    [ "$status" -eq 1 ]
    [[ "$output" == *"WIP"* ]]
}

@test "range mode ignores commits outside the range" {
    run bash "$SCRIPT" "$BASE" HEAD
    [ "$status" -eq 0 ]
}

@test "message-file mode accepts every valid action, case-insensitively on the key" {
    for a in nothing restart bootstrap recreate; do
        printf 'feat: x\n\nbody\n\nDevenv-Action: %s\n' "$a" > "$TEST_TEMP_DIR/msg"
        run bash "$SCRIPT" --message-file "$TEST_TEMP_DIR/msg"
        [ "$status" -eq 0 ]
    done
}

@test "message-file mode rejects a missing trailer with guidance" {
    printf 'feat: x\n\nno trailer here\n' > "$TEST_TEMP_DIR/msg"
    run bash "$SCRIPT" --message-file "$TEST_TEMP_DIR/msg"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Devenv-Action"* ]]
    [[ "$output" == *"recreate"* ]]
}

@test "message-file mode exempts local WIP commits" {
    printf 'WIP: scratch\n' > "$TEST_TEMP_DIR/msg"
    run bash "$SCRIPT" --message-file "$TEST_TEMP_DIR/msg"
    [ "$status" -eq 0 ]
}

@test "the commit-msg hook delegates to this script (single source for the valid values)" {
    run grep -n 'check-commit-trailers' "$PROJECT_ROOT/.husky/commit-msg"
    [ "$status" -eq 0 ]
    run grep -n 'nothing|restart|bootstrap|recreate' "$PROJECT_ROOT/.husky/commit-msg"
    [ "$status" -ne 0 ]
}

@test "range mode warns, without failing, about a commit that has no Change-Id" {
    commit "feat: no id" "Devenv-Action: nothing"
    run bash "$SCRIPT" "$BASE" HEAD
    [ "$status" -eq 0 ]
    [[ "$output" == *"no id"*"no Change-Id trailer"* ]]
    [[ "$output" == *"1 commit(s) have no Change-Id trailer"* ]]
}

@test "range mode stays quiet about Change-Id when every commit has one" {
    echo x >> f && git add f
    git commit -q -m "feat: with id" -m $'Devenv-Action: nothing\nChange-Id: Abc123Abc123'
    run bash "$SCRIPT" "$BASE" HEAD
    [ "$status" -eq 0 ]
    [[ "$output" != *"Change-Id"* ]]
}

@test "range mode still fails on a missing Devenv-Action and warns about the Change-Id too" {
    commit "fix: neither"
    run bash "$SCRIPT" "$BASE" HEAD
    [ "$status" -eq 1 ]
    [[ "$output" == *"missing or invalid Devenv-Action"* ]]
    [[ "$output" == *"no Change-Id trailer"* ]]
}

@test "message-file mode warns, without failing, when the Change-Id is missing" {
    printf 'feat: x\n\nDevenv-Action: nothing\n' > "$TEST_TEMP_DIR/msg"
    run bash "$SCRIPT" --message-file "$TEST_TEMP_DIR/msg"
    [ "$status" -eq 0 ]
    [[ "$output" == *"no Change-Id trailer"* ]]
}

@test "message-file mode sees a Change-Id that is followed by the editor's comment block" {
    printf 'feat: x\n\nDevenv-Action: nothing\nChange-Id: Abc123Abc123\n# Please enter the commit message\n#\n' > "$TEST_TEMP_DIR/msg"
    run bash "$SCRIPT" --message-file "$TEST_TEMP_DIR/msg"
    [ "$status" -eq 0 ]
    [[ "$output" != *"Change-Id"* ]]
}

@test "message-file mode does not warn about a WIP commit" {
    printf 'WIP: scratch\n' > "$TEST_TEMP_DIR/msg"
    run bash "$SCRIPT" --message-file "$TEST_TEMP_DIR/msg"
    [ "$status" -eq 0 ]
    [[ "$output" != *"Change-Id"* ]]
}
