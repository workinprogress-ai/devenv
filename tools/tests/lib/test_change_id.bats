#!/usr/bin/env bats
# tools/lib/change-id.bash: Change-Id generation and parsing, the Fork-Only marker
# and the local skip list.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    # A pre-commit hook exports these; left set they redirect the test repos' git calls.
    unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    source "$DEVENV_TOOLS/lib/change-id.bash"
    REPO="$TEST_TEMP_DIR/repo"
    git init -q -b main "$REPO"
    git -C "$REPO" config user.email t@t
    git -C "$REPO" config user.name t
}

teardown() {
    test_helper_teardown
}

commit() {
    echo "$1" > "$REPO/$1"
    git -C "$REPO" add "$1"
    git -C "$REPO" commit -q -m "$1" ${2:+-m "$2"}
}

@test "change_id_generate prints 12 base62 characters" {
    run change_id_generate
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^[0-9A-Za-z]{12}$ ]]
}

@test "change_id_generate returns different values" {
    a="$(change_id_generate)"
    b="$(change_id_generate)"
    [ "$a" != "$b" ]
}

@test "change_id_is_valid accepts the generated format and foreign IDs of 8 to 64 safe characters" {
    change_id_is_valid Abc123Abc123
    change_id_is_valid I8c9d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8
    change_id_is_valid 'abc.123_x-y'
    change_id_is_valid "$(printf 'a%.0s' $(seq 1 64))"
    run ! change_id_is_valid Abc1234
    run ! change_id_is_valid "$(printf 'a%.0s' $(seq 1 65))"
    run ! change_id_is_valid 'Abc123 Abc123'
    run ! change_id_is_valid 'Abc123#Abc123'
    run ! change_id_is_valid 'Abc123/Abc123'
    run ! change_id_is_valid ''
    run ! change_id_is_valid $'Abc123Abc123\n'
}

@test "change_id_get_from_message reads a trailer from the last paragraph" {
    msg=$'feat: x\n\nbody text\n\nChange-Id: Abc123Abc123\nDevenv-Action: nothing'
    [ "$(change_id_get_from_message "$msg")" = "Abc123Abc123" ]
}

@test "change_id_get_from_message fails without a trailer or with a malformed value" {
    run change_id_get_from_message $'feat: x\n\nbody'
    [ "$status" -ne 0 ]
    run change_id_get_from_message $'feat: x\n\nChange-Id: short'
    [ "$status" -ne 0 ]
}

@test "change_id_get_from_message ignores a Change-Id that is not in the trailer block" {
    run change_id_get_from_message $'feat: x\n\nChange-Id: Abc123Abc123\n\nmore body text here'
    [ "$status" -ne 0 ]
}

@test "change_id_get_from_message does not match a differently cased key" {
    run change_id_get_from_message $'feat: x\n\nchange-id: Abc123Abc123'
    [ "$status" -ne 0 ]
}

@test "change_id_get_from_commit reads the id from a commit" {
    commit one $'Change-Id: Abc123Abc123'
    [ "$(change_id_get_from_commit "$REPO" HEAD)" = "Abc123Abc123" ]
}

@test "change_id_is_fork_only is true only for Fork-Only: yes" {
    change_id_is_fork_only $'feat: x\n\nFork-Only: yes'
    change_id_is_fork_only $'feat: x\n\nFork-Only: Yes'
    run ! change_id_is_fork_only $'feat: x\n\nFork-Only: no'
    run ! change_id_is_fork_only $'feat: x\n\nbody'
}

@test "skip_list_get_path is the git common directory, shared by worktrees" {
    commit one
    git -C "$REPO" worktree add -q "$TEST_TEMP_DIR/wt" -b other
    [ "$(skip_list_get_path "$REPO")" = "$(skip_list_get_path "$TEST_TEMP_DIR/wt")" ]
    [[ "$(skip_list_get_path "$REPO")" == "$REPO/.git/$SKIP_LIST_FILE_NAME" ]]
}

@test "skip_list_add records a change-id and a resolved sha, once each, with a note" {
    commit one
    sha="$(git -C "$REPO" rev-parse HEAD)"
    skip_list_add "$REPO" change-id Abc123Abc123 "fork only"
    skip_list_add "$REPO" change-id Abc123Abc123
    skip_list_add "$REPO" sha HEAD
    skip_list_add "$REPO" sha "$sha"
    path="$(skip_list_get_path "$REPO")"
    [ "$(grep -c '^change-id Abc123Abc123' "$path")" -eq 1 ]
    grep -q '^change-id Abc123Abc123 # fork only$' "$path"
    [ "$(grep -c "^sha $sha" "$path")" -eq 1 ]
}

@test "skip_list_add rejects a malformed id, an unknown commit and an unknown kind" {
    commit one
    run skip_list_add "$REPO" change-id short
    [ "$status" -ne 0 ]
    run skip_list_add "$REPO" sha deadbeef
    [ "$status" -ne 0 ]
    run skip_list_add "$REPO" label x
    [ "$status" -ne 0 ]
}

@test "skip_list_has matches by sha or by change-id" {
    commit one
    sha="$(git -C "$REPO" rev-parse HEAD)"
    skip_list_add "$REPO" sha "$sha"
    skip_list_add "$REPO" change-id Abc123Abc123
    skip_list_load "$REPO"
    skip_list_has "$sha"
    skip_list_has 0000000000000000000000000000000000000000 Abc123Abc123
    run ! skip_list_has 0000000000000000000000000000000000000000 Zzz999Zzz999
    run ! skip_list_has 0000000000000000000000000000000000000000
}

@test "skip_list_load of a missing list is empty" {
    skip_list_load "$REPO"
    ! skip_list_has 0000000000000000000000000000000000000000 Abc123Abc123
}

@test "skip_list_remove drops entries by id or by commit ref and fails when nothing matches" {
    commit one
    skip_list_add "$REPO" sha HEAD "note"
    skip_list_add "$REPO" change-id Abc123Abc123
    skip_list_remove "$REPO" Abc123Abc123
    skip_list_remove "$REPO" HEAD
    path="$(skip_list_get_path "$REPO")"
    [ -z "$(grep -vE '^[[:space:]]*(#|$)' "$path")" ]
    run skip_list_remove "$REPO" Abc123Abc123
    [ "$status" -ne 0 ]
}

@test "skip_list_list prints entries and prunes stale ones" {
    commit one $'Change-Id: Abc123Abc123'
    sha="$(git -C "$REPO" rev-parse HEAD)"
    skip_list_add "$REPO" change-id Abc123Abc123
    skip_list_add "$REPO" change-id Zzz999Zzz999 "gone"
    printf 'sha 0000000000000000000000000000000000000000\n' >> "$(skip_list_get_path "$REPO")"
    run --separate-stderr skip_list_list "$REPO"
    [ "$status" -eq 0 ]
    [[ "$output" == *"change-id Abc123Abc123"* ]]
    [[ "$output" != *"Zzz999Zzz999"* ]]
    [[ "$stderr" == *"pruned stale entry: change-id Zzz999Zzz999"* ]]
    [[ "$stderr" == *"pruned stale entry: sha 0000000000000000000000000000000000000000"* ]]
    run ! grep -q Zzz999Zzz999 "$(skip_list_get_path "$REPO")"
    [ -n "$sha" ]
}

@test "skip_list_list leaves a fully valid list untouched" {
    commit one $'Change-Id: Abc123Abc123'
    skip_list_add "$REPO" change-id Abc123Abc123 "keep"
    before="$(cat "$(skip_list_get_path "$REPO")")"
    run --separate-stderr skip_list_list "$REPO"
    [ "$status" -eq 0 ]
    [ -z "$stderr" ]
    [ "$(cat "$(skip_list_get_path "$REPO")")" = "$before" ]
}

@test "skip_list_remove by Change-Id also drops the sha entries of commits carrying it" {
    commit one $'Change-Id: Abc123Abc123'
    skip_list_add "$REPO" sha HEAD
    skip_list_add "$REPO" change-id Abc123Abc123
    skip_list_remove "$REPO" Abc123Abc123
    [ -z "$(grep -vE '^[[:space:]]*(#|$)' "$(skip_list_get_path "$REPO")")" ]
}

@test "skip_list_remove by commit ref also drops the entry for its Change-Id" {
    commit one $'Change-Id: Abc123Abc123'
    skip_list_add "$REPO" sha HEAD
    skip_list_add "$REPO" change-id Abc123Abc123
    skip_list_remove "$REPO" HEAD
    [ -z "$(grep -vE '^[[:space:]]*(#|$)' "$(skip_list_get_path "$REPO")")" ]
}

@test "skip_list_remove by Change-Id leaves the entries of other commits alone" {
    commit one $'Change-Id: Abc123Abc123'
    commit two $'Change-Id: Zzz999Zzz999'
    skip_list_add "$REPO" sha HEAD
    skip_list_add "$REPO" sha HEAD~1
    skip_list_remove "$REPO" Abc123Abc123
    [ "$(grep -c '^sha ' "$(skip_list_get_path "$REPO")")" -eq 1 ]
    grep -qx "sha $(git -C "$REPO" rev-parse HEAD)" "$(skip_list_get_path "$REPO")"
}

@test "skip list: concurrent adds and removes lose no entry" {
    commit one
    for n in 1 2 3 4 5; do
        skip_list_add "$REPO" change-id "$(printf 'Del%09d' "$n")"
    done
    pids=()
    for n in $(seq 1 15); do
        bash -c 'source "$1/lib/change-id.bash"; skip_list_add "$2" change-id "$3"' _ "$DEVENV_TOOLS" "$REPO" "$(printf 'New%09d' "$n")" &
        pids+=($!)
        if [ "$n" -le 5 ]; then
            bash -c 'source "$1/lib/change-id.bash"; skip_list_remove "$2" "$3"' _ "$DEVENV_TOOLS" "$REPO" "$(printf 'Del%09d' "$n")" &
            pids+=($!)
        fi
    done
    for pid in "${pids[@]}"; do
        wait "$pid"
    done
    path="$(skip_list_get_path "$REPO")"
    [ "$(grep -c '^change-id New' "$path")" -eq 15 ]
    [ "$(grep -c '^change-id Del' "$path" || true)" -eq 0 ]
}

@test "skip list: a write that cannot create its temporary file fails and keeps the list" {
    [ "$(id -u)" -ne 0 ] || skip "directory permissions do not bind root"
    commit one $'Change-Id: Abc123Abc123'
    skip_list_add "$REPO" change-id Abc123Abc123
    path="$(skip_list_get_path "$REPO")"
    before="$(cat "$path")"
    chmod a-w "$REPO/.git"
    run skip_list_remove "$REPO" Abc123Abc123
    remove_status=$status
    run skip_list_list "$REPO"
    list_status=$status
    chmod u+w "$REPO/.git"
    [ "$remove_status" -ne 0 ]
    [ "$list_status" -ne 0 ]
    [ "$(cat "$path")" = "$before" ]
    [ -z "$(find "$REPO/.git" -maxdepth 1 -name 'fork-export-skip.??????')" ]
}

@test "skip_list_load ignores truncated lines with no value" {
    commit one
    path="$(skip_list_get_path "$REPO")"
    printf 'sha\nchange-id\nchange-id Abc123Abc123\n' > "$path"
    skip_list_load "$REPO"
    skip_list_has 0000000000000000000000000000000000000000 Abc123Abc123
    run ! skip_list_has 0000000000000000000000000000000000000000
}

@test "skip_list_load fails when the list cannot be read, instead of reading it as empty" {
    [ "$(id -u)" -ne 0 ] || skip "file permissions do not bind root"
    commit one
    skip_list_add "$REPO" change-id Abc123Abc123
    path="$(skip_list_get_path "$REPO")"
    chmod 000 "$path"
    run skip_list_load "$REPO"
    load_status=$status
    load_output="$output"
    chmod 600 "$path"
    [ "$load_status" -ne 0 ]
    [[ "$load_output" == *"could not read the skip list"* ]]
}

@test "skip_list_list leaves the list untouched when a repository lookup fails" {
    commit one $'Change-Id: Abc123Abc123'
    skip_list_add "$REPO" change-id Abc123Abc123
    skip_list_add "$REPO" change-id Zzz999Zzz999
    path="$(skip_list_get_path "$REPO")"
    before="$(cat "$path")"
    real_git="$(command -v git)"
    mkdir -p "$TEST_TEMP_DIR/shim"
    cat > "$TEST_TEMP_DIR/shim/git" <<SHIM
#!/usr/bin/env bash
sub=""
skip=0
for a in "\$@"; do
    if [ "\$skip" -eq 1 ]; then skip=0; continue; fi
    case "\$a" in -C) skip=1; continue ;; -*) continue ;; esac
    sub="\$a"; break
done
if [ "\$sub" = "log" ]; then echo "fatal: injected failure" >&2; exit 128; fi
exec $real_git "\$@"
SHIM
    chmod +x "$TEST_TEMP_DIR/shim/git"
    PATH="$TEST_TEMP_DIR/shim:$PATH" run skip_list_list "$REPO"
    [ "$status" -ne 0 ]
    [[ "$output" == *"left untouched"* ]]
    [ "$(cat "$path")" = "$before" ]
}
