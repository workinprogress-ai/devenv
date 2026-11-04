#!/usr/bin/env bats
# internal/prepare-commit-msg (TS body): the Change-Id (and Devenv-Action placeholder) hook.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    SCRIPT="$DEVENV_TOOLS/internal/prepare-commit-msg"
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
    printf '#!/bin/sh\nexec "%s" "$@"\n' "$SCRIPT" > "$REPO/.git/hooks/prepare-commit-msg"
    chmod +x "$REPO/.git/hooks/prepare-commit-msg"
}

_message_of() {
    git -C "$REPO" log -1 --format=%B "${1:-HEAD}"
}

@test "prepare-commit-msg: the hook body is executable and the husky hook delegates to it" {
    test -x "$SCRIPT"
    test -f "$DEVENV_TOOLS/internal/prepare-commit-msg.ts"
    grep -q 'tools/internal/prepare-commit-msg' "$PROJECT_ROOT/.husky/prepare-commit-msg"
}

@test "prepare-commit-msg: --help and --version succeed" {
    run "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Change-Id"* ]]
    run "$SCRIPT" --version
    [ "$status" -eq 0 ]
}

@test "prepare-commit-msg: a missing argument or file is a usage error" {
    run "$SCRIPT"
    [ "$status" -eq 2 ]
    run "$SCRIPT" "$TEST_TEMP_DIR/nope"
    [ "$status" -eq 2 ]
}

@test "prepare-commit-msg: source message adds a valid Change-Id and no Devenv-Action placeholder" {
    printf 'feat: x\n' > "$MSG"
    run "$SCRIPT" "$MSG" message
    [ "$status" -eq 0 ]
    grep -q '^Change-Id: ' "$MSG"
    run grep -c 'Devenv-Action' "$MSG"
    [ "$output" = "0" ]
}

@test "prepare-commit-msg: an editor-bound message gets a pre-filled Devenv-Action: nothing" {
    for kind in "" template; do
        printf '\n' > "$MSG"
        run "$SCRIPT" "$MSG" "$kind"
        [ "$status" -eq 0 ]
        grep -q '^Change-Id: ' "$MSG"
        # Pre-filled with a VALID action (nothing): commit-action-check
        # requires a complete value, so an empty placeholder would fail the
        # commit-msg hook — saving the editor unchanged must succeed.
        grep -qE '^Devenv-Action: nothing$' "$MSG"
    done
}

@test "prepare-commit-msg: an existing Change-Id is never replaced" {
    printf 'feat: x\n\nChange-Id: Abc123Abc123\n' > "$MSG"
    "$SCRIPT" "$MSG" message
    "$SCRIPT" "$MSG" commit
    [ "$(grep -oP '^Change-Id: \K.*' "$MSG")" = "Abc123Abc123" ]
    [ "$(grep -c '^Change-Id:' "$MSG")" -eq 1 ]
}

@test "prepare-commit-msg: running it twice adds nothing the second time" {
    printf 'feat: x\n' > "$MSG"
    "$SCRIPT" "$MSG" ""
    first="$(cat "$MSG")"
    "$SCRIPT" "$MSG" ""
    [ "$(cat "$MSG")" = "$first" ]
}

@test "prepare-commit-msg: an existing Devenv-Action is not duplicated" {
    printf 'feat: x\n\nDevenv-Action: nothing\n' > "$MSG"
    "$SCRIPT" "$MSG" ""
    [ "$(grep -c '^Devenv-Action:' "$MSG")" -eq 1 ]
    grep -q '^Devenv-Action: nothing$' "$MSG"
}

@test "prepare-commit-msg: amend adds a missing Change-Id but no placeholder" {
    printf 'feat: x\n' > "$MSG"
    "$SCRIPT" "$MSG" commit HEAD
    grep -q '^Change-Id: ' "$MSG"
    run grep -c 'Devenv-Action' "$MSG"
    [ "$output" = "0" ]
}

@test "prepare-commit-msg: merge and squash messages are left untouched" {
    for kind in merge squash; do
        printf 'Merge branch x\n' > "$MSG"
        "$SCRIPT" "$MSG" "$kind"
        [ "$(cat "$MSG")" = "Merge branch x" ]
    done
}

@test "prepare-commit-msg: git commit -m records a Change-Id" {
    _hooked_repo
    echo a > "$REPO/a"
    git -C "$REPO" add a
    git -C "$REPO" commit -q -m "feat: a"
    git -C "$REPO" log -1 --format=%B | grep -q '^Change-Id: '
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
    git -C "$REPO" log -1 --format=%B | grep -q '^Change-Id: '
    git -C "$REPO" log -1 --format=%B | grep -qE '^Devenv-Action: nothing$'
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
    id="$(git -C "$REPO" log -1 --format=%B | grep -oP '^Change-Id: \K.*')"
    git -C "$REPO" commit -q --amend --no-edit
    [ "$(git -C "$REPO" log -1 --format=%B | grep -oP '^Change-Id: \K.*')" = "$id" ]
    git -C "$REPO" checkout -q -b pick main
    git -C "$REPO" cherry-pick side > /dev/null
    [ "$(git -C "$REPO" log -1 --format=%B | grep -oP '^Change-Id: \K.*')" = "$id" ]
    git -C "$REPO" checkout -q main
    echo m > "$REPO/m"
    git -C "$REPO" add m
    git -C "$REPO" commit -q -m "main: m"
    git -C "$REPO" checkout -q side
    git -C "$REPO" rebase -q main > /dev/null 2>&1
    [ "$(git -C "$REPO" log -1 --format=%B | grep -oP '^Change-Id: \K.*')" = "$id" ]
}

@test "prepare-commit-msg: --no-verify still adds a Change-Id" {
    _hooked_repo
    echo a > "$REPO/a"
    git -C "$REPO" add a
    git -C "$REPO" commit -q -n -m "feat: a"
    git -C "$REPO" log -1 --format=%B | grep -q '^Change-Id: '
}

@test "prepare-commit-msg: a WIP commit gets neither a Change-Id nor a placeholder" {
    printf 'WIP: scratch\n' > "$MSG"
    run "$SCRIPT" "$MSG" message
    [ "$status" -eq 0 ]
    [ "$(cat "$MSG")" = "WIP: scratch" ]
    _hooked_repo
    echo a > "$REPO/a"
    git -C "$REPO" add a
    git -C "$REPO" commit -q -n -m "WIP: a"
    ! git -C "$REPO" log -1 --format=%B | grep -q '^Change-Id: '
}

@test "prepare-commit-msg: a foreign Change-Id is kept without a warning" {
    printf 'feat: x\n\nChange-Id: I8c9d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8\n' > "$MSG"
    run "$SCRIPT" "$MSG" message
    [ "$status" -eq 0 ]
    [ -z "$output" ]
    [ "$(grep -c '^Change-Id:' "$MSG")" -eq 1 ]
    grep -q '^Change-Id: I8c9d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8$' "$MSG"
}

@test "prepare-commit-msg: an unusable Change-Id is kept and reported on stderr" {
    printf 'feat: x\n\nChange-Id: short\n' > "$MSG"
    run "$SCRIPT" "$MSG" message
    [ "$status" -eq 0 ]
    [[ "$output" == *"the Change-Id 'short' is not usable"* ]]
    [ "$(grep -c '^Change-Id:' "$MSG")" -eq 1 ]
    grep -q '^Change-Id: short$' "$MSG"
}

@test "prepare-commit-msg: -e -n editor flow — typed subject commits with trailers (the restored prefill contract)" {
    _hooked_repo
    echo a > "$REPO/a"
    git -C "$REPO" add a
    printf '#!/bin/sh\nprintf %s "$2" > "$1"\n' "$TEST_TEMP_DIR" > /dev/null # no-op guard
    printf '#!/bin/sh\nprintf "feat: typed subject\\n" > "$1"\n' > "$TEST_TEMP_DIR/editor2.sh"
    chmod +x "$TEST_TEMP_DIR/editor2.sh"
    GIT_EDITOR="$TEST_TEMP_DIR/editor2.sh" git -C "$REPO" commit -e -n
    [ "$(_message_of | head -n1)" = "feat: typed subject" ]
    git -C "$REPO" commit -q --amend -m "feat: typed subject, amended"
    git -C "$REPO" log -1 --format=%B | grep -q '^Change-Id: '
}

@test "prepare-commit-msg: editor flow warns loudly when the effective editor is a no-op" {
    _hooked_repo
    printf '' > "$MSG"
    cd "$REPO"
    run env GIT_EDITOR=: "$SCRIPT" "$MSG" ""
    [ "$status" -eq 0 ]
    [[ "$output" == *"no editor will open"* ]]
    [[ "$output" == *"unset the GIT_EDITOR/core.editor override"* ]]
    grep -q 'Devenv-Action: nothing' "$MSG"
}

@test "prepare-commit-msg: editor flow stays silent when a real editor resolves" {
    _hooked_repo
    printf '' > "$MSG"
    cd "$REPO"
    # Ambient sessions may export a no-op GIT_EDITOR (AI shells do); the test
    # owns its inputs — unset the override so a real editor resolves.
    run env -u GIT_EDITOR "$SCRIPT" "$MSG" ""
    [ "$status" -eq 0 ]
    [[ "$output" != *"no editor will open"* ]]
    grep -q 'Devenv-Action: nothing' "$MSG"
}
