#!/usr/bin/env bats
# Tests for .devcontainer/entry-stubs-sync.sh — the idempotent owner of the
# tools/ depth-1 entry points.
#
# Contract: stub exists ⇔ tools/scripts/ script exists. Stubs exec the real
# scripts/ file. Foreign depth-1 files are not ours and are left untouched.

load ../test_helper

SYNC_SCRIPT=""   # set in setup: path to the real sync script inside the mock

# Build a minimal mock checkout: .devcontainer/ (sync script) + tools/scripts/
# + tools/lib (resolver deps). Echoes the mock root.
_make_mock_checkout() {
    local root="$1"
    mkdir -p "$root/.devcontainer" "$root/tools/scripts" "$root/tools/lib"
    cp "$PROJECT_ROOT/.devcontainer/entry-stubs-sync.sh" "$root/.devcontainer/"
    cp "$PROJECT_ROOT/tools/lib/self-root.bash" "$root/tools/lib/"
    cp "$PROJECT_ROOT/tools/lib/error-handling.bash" "$root/tools/lib/"
    SYNC_SCRIPT="$root/.devcontainer/entry-stubs-sync.sh"
}

_make_script() {
    local root="$1" name="$2"
    printf '#!/bin/bash\nsource "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"\necho "ran-%s"\n' "$name" \
        > "$root/tools/scripts/$name"
}

_make_stub() {
    local root="$1" name="$2" file="$3"
    printf '#!/bin/bash\nexec bash "$(dirname "$0")/scripts/%s" "$@"\n' "$file" \
        > "$root/tools/$name"
    chmod +x "$root/tools/$name"
}

@test "setup: sync script exists in .devcontainer/" {
    [ -f "$PROJECT_ROOT/.devcontainer/entry-stubs-sync.sh" ]
}

@test "creates a stub for every tools/scripts/ script" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    _make_script "$root" "beta.sh"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ -f "$root/tools/alpha" ]
    [ -f "$root/tools/beta" ]
    grep -q 'scripts/alpha.sh' "$root/tools/alpha"
    grep -q 'scripts/beta.sh' "$root/tools/beta"
    rm -rf "$root"
}

@test "converts a stale symlink into a stub" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    ln -s "$root/tools/scripts/alpha.sh" "$root/tools/alpha"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ ! -L "$root/tools/alpha" ]
    grep -q 'scripts/alpha.sh' "$root/tools/alpha"
    rm -rf "$root"
}

@test "converts a drifted real-file copy into a stub (scripts/ is canonical)" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    printf ' drifted stale content\n' > "$root/tools/alpha"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    grep -q 'scripts/alpha.sh' "$root/tools/alpha"
    ! grep -q 'drifted stale content' "$root/tools/alpha"
    rm -rf "$root"
}

@test "idempotent: second run changes nothing" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]
    local first_sum
    first_sum=$(cat "$root/tools/alpha" | md5sum)

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"already-ok=1"* ]]
    [ "$(cat "$root/tools/alpha" | md5sum)" = "$first_sum" ]
    rm -rf "$root"
}

@test "stubs execute the real scripts/ file (BASH_SOURCE is the scripts path)" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    run bash "$root/tools/alpha"
    [ "$status" -eq 0 ]
    [[ "$output" == *"ran-alpha"* ]]
    rm -rf "$root"
}

@test "foreign depth-1 files are left untouched" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    printf 'not-ours\n' > "$root/tools/unrelated"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ -f "$root/tools/unrelated" ]
    [ "$(cat "$root/tools/unrelated")" = "not-ours" ]
    rm -rf "$root"
}

@test "handles git-* scripts (no .sh suffix) by full name" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    printf '#!/bin/bash\necho git-tool-ran\n' > "$root/tools/scripts/git-wip"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ -f "$root/tools/git-wip" ]
    grep -q 'scripts/git-wip' "$root/tools/git-wip"
    rm -rf "$root"
}

@test "hidden files in tools/ are never touched" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    printf 'config\n' > "$root/tools/.continueignore"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ "$(cat "$root/tools/.continueignore")" = "config" ]
    rm -rf "$root"
}
