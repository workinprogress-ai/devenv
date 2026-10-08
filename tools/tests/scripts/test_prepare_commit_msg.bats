#!/usr/bin/env bats
# scripts/prepare-commit-msg.sh: the Change-Id (and Devenv-Action placeholder) hook.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    SCRIPT="$DEVENV_TOOLS/scripts/prepare-commit-msg.sh"
    source "$DEVENV_TOOLS/lib/change-id.bash"
    MSG="$TEST_TEMP_DIR/COMMIT_EDITMSG"
}

teardown() {
    test_helper_teardown
}

_hooked_repo() {
    REPO="$TEST_TEMP_DIR/repo"
    git init -q -b main "$REPO"
    git -C "$REPO" config user.email t@t
    git -C "$REPO" config user.name t
    mkdir -p "$REPO/.git/hooks"
    printf '#!/bin/sh\nexec bash "%s" "$@"\n' "$SCRIPT" > "$REPO/.git/hooks/prepare-commit-msg"
    chmod +x "$REPO/.git/hooks/prepare-commit-msg"
}

_message_of() {
    git -C "$REPO" log -1 --format=%B "${1:-HEAD}"
}

@test "prepare-commit-msg: script has valid syntax and the husky hook delegates to it" {
    bash -n "$SCRIPT"
    grep -q 'tools/scripts/prepare-commit-msg.sh' "$PROJECT_ROOT/.husky/prepare-commit-msg"
}

@test "prepare-commit-msg: --help and --version succeed" {
    run bash "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Change-Id"* ]]
    run bash "$SCRIPT" --version
    [ "$status" -eq 0 ]
}

@test "prepare-commit-msg: a missing argument or file is a usage error" {
    run bash "$SCRIPT"
    [ "$status" -eq 2 ]
    run bash "$SCRIPT" "$TEST_TEMP_DIR/nope"
    [ "$status" -eq 2 ]
}

@test "prepare-commit-msg: source message adds a valid Change-Id and no Devenv-Action placeholder" {
    printf 'feat: x\n' > "$MSG"
    run bash "$SCRIPT" "$MSG" message
    [ "$status" -eq 0 ]
    change_id_get_from_message "$(cat "$MSG")" > /dev/null
    run grep -c 'Devenv-Action' "$MSG"
    [ "$output" = "0" ]
}

@test "prepare-commit-msg: an editor-bound message gets an empty Devenv-Action as well" {
    for kind in "" template; do
        printf '\n' > "$MSG"
        run bash "$SCRIPT" "$MSG" "$kind"
        [ "$status" -eq 0 ]
        change_id_get_from_message "$(cat "$MSG")" > /dev/null
        grep -qE '^Devenv-Action:[[:space:]]*$' "$MSG"
    done
}

@test "prepare-commit-msg: an existing Change-Id is never replaced" {
    printf 'feat: x\n\nChange-Id: Abc123Abc123\n' > "$MSG"
    bash "$SCRIPT" "$MSG" message
    bash "$SCRIPT" "$MSG" commit
    [ "$(change_id_get_from_message "$(cat "$MSG")")" = "Abc123Abc123" ]
    [ "$(grep -c '^Change-Id:' "$MSG")" -eq 1 ]
}

@test "prepare-commit-msg: running it twice adds nothing the second time" {
    printf 'feat: x\n' > "$MSG"
    bash "$SCRIPT" "$MSG" ""
    first="$(cat "$MSG")"
    bash "$SCRIPT" "$MSG" ""
    [ "$(cat "$MSG")" = "$first" ]
}

@test "prepare-commit-msg: an existing Devenv-Action is not duplicated" {
    printf 'feat: x\n\nDevenv-Action: nothing\n' > "$MSG"
    bash "$SCRIPT" "$MSG" ""
    [ "$(grep -c '^Devenv-Action:' "$MSG")" -eq 1 ]
    grep -q '^Devenv-Action: nothing$' "$MSG"
}

@test "prepare-commit-msg: amend adds a missing Change-Id but no placeholder" {
    printf 'feat: x\n' > "$MSG"
    bash "$SCRIPT" "$MSG" commit HEAD
    change_id_get_from_message "$(cat "$MSG")" > /dev/null
    run grep -c 'Devenv-Action' "$MSG"
    [ "$output" = "0" ]
}

@test "prepare-commit-msg: merge and squash messages are left untouched" {
    for kind in merge squash; do
        printf 'Merge branch x\n' > "$MSG"
        bash "$SCRIPT" "$MSG" "$kind"
        [ "$(cat "$MSG")" = "Merge branch x" ]
    done
}

@test "prepare-commit-msg: git commit -m records a Change-Id" {
    _hooked_repo
    echo a > "$REPO/a"
    git -C "$REPO" add a
    git -C "$REPO" commit -q -m "feat: a"
    change_id_get_from_message "$(_message_of)" > /dev/null
}

@test "prepare-commit-msg: the editor sees the placeholders and a typed subject survives" {
    _hooked_repo
    echo a > "$REPO/a"
    git -C "$REPO" add a
    cat > "$TEST_TEMP_DIR/editor.sh" <<'EOF'
#!/bin/sh
{ echo "feat: typed subject"; cat "$1"; } > "$1.new" && mv "$1.new" "$1"
EOF
    chmod +x "$TEST_TEMP_DIR/editor.sh"
    GIT_EDITOR="$TEST_TEMP_DIR/editor.sh" git -C "$REPO" commit -q
    [ "$(_message_of | head -n1)" = "feat: typed subject" ]
    change_id_get_from_message "$(_message_of)" > /dev/null
    git -C "$REPO" log -1 --format=%B | grep -qE '^Devenv-Action:$'
}

@test "prepare-commit-msg: amend, cherry-pick and rebase keep the Change-Id" {
    _hooked_repo
    echo a > "$REPO/a"
    git -C "$REPO" add a
    git -C "$REPO" commit -q -m "base"
    git -C "$REPO" checkout -q -b side
    echo b > "$REPO/b"
    git -C "$REPO" add b
    git -C "$REPO" commit -q -m "feat: b"
    id="$(change_id_get_from_message "$(_message_of)")"
    git -C "$REPO" commit -q --amend --no-edit
    [ "$(change_id_get_from_message "$(_message_of)")" = "$id" ]
    git -C "$REPO" checkout -q -b pick main
    git -C "$REPO" cherry-pick side > /dev/null
    [ "$(change_id_get_from_message "$(_message_of)")" = "$id" ]
    git -C "$REPO" checkout -q main
    echo m > "$REPO/m"
    git -C "$REPO" add m
    git -C "$REPO" commit -q -m "main: m"
    git -C "$REPO" checkout -q side
    git -C "$REPO" rebase -q main > /dev/null 2>&1
    [ "$(change_id_get_from_message "$(_message_of)")" = "$id" ]
}

@test "prepare-commit-msg: --no-verify still adds a Change-Id" {
    _hooked_repo
    echo a > "$REPO/a"
    git -C "$REPO" add a
    git -C "$REPO" commit -q -n -m "feat: a"
    change_id_get_from_message "$(_message_of)" > /dev/null
}

@test "prepare-commit-msg: a WIP commit gets neither a Change-Id nor a placeholder" {
    printf 'WIP: scratch\n' > "$MSG"
    run bash "$SCRIPT" "$MSG" message
    [ "$status" -eq 0 ]
    [ "$(cat "$MSG")" = "WIP: scratch" ]
    _hooked_repo
    echo a > "$REPO/a"
    git -C "$REPO" add a
    git -C "$REPO" commit -q -n -m "WIP: a"
    run change_id_get_from_message "$(_message_of)"
    [ "$status" -ne 0 ]
}

@test "prepare-commit-msg: a foreign Change-Id is kept without a warning" {
    printf 'feat: x\n\nChange-Id: I8c9d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8\n' > "$MSG"
    run bash "$SCRIPT" "$MSG" message
    [ "$status" -eq 0 ]
    [ -z "$output" ]
    [ "$(grep -c '^Change-Id:' "$MSG")" -eq 1 ]
    grep -q '^Change-Id: I8c9d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8$' "$MSG"
}

@test "prepare-commit-msg: an unusable Change-Id is kept and reported on stderr" {
    printf 'feat: x\n\nChange-Id: short\n' > "$MSG"
    run bash "$SCRIPT" "$MSG" message
    [ "$status" -eq 0 ]
    [[ "$output" == *"the Change-Id 'short' is not usable"* ]]
    [ "$(grep -c '^Change-Id:' "$MSG")" -eq 1 ]
    grep -q '^Change-Id: short$' "$MSG"
}
