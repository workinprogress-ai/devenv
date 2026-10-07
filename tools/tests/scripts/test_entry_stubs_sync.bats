#!/usr/bin/env bats
# Tests for .devcontainer/entry-stubs-sync.sh — the idempotent owner of the
# tools/ depth-1 entry points.
#
# Contract: stub exists ⇔ tools/scripts/ script exists, EXCEPT underscore-
# prefixed scripts (internal: no depth-1 entry, stale stubs purged).
# tools/tests/run-devenv-tests.sh also gets a depth-1 entry. Stubs exec the
# real scripts/ file. Foreign depth-1 files are not ours and are untouched.

bats_require_minimum_version 1.5.0

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
    printf '#!/bin/bash\n# drifted stale content\n' > "$root/tools/alpha"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    grep -q 'scripts/alpha.sh' "$root/tools/alpha"
    run ! grep -q 'drifted stale content' "$root/tools/alpha"
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

@test "underscore-prefixed scripts get no depth-1 entry (internal by contract)" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    printf '#!/bin/bash\nexec bash "$(dirname "$0")/scripts/_on_event_dispatch.sh" "_on_merge" "$@"\n' > "$root/tools/scripts/_on_merge.sh"
    chmod +x "$root/tools/scripts/_on_merge.sh"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ -f "$root/tools/alpha" ]
    [ ! -e "$root/tools/_on_merge" ]
    rm -rf "$root"
}

@test "stubs whose script was renamed away are purged (dead exec target)" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    # Stub for a script that no longer exists in tools/scripts/ (renamed or
    # deleted): the sync must remove it, not leave a dead entry point.
    _make_stub "$root" "old-name" "old-name.sh"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ ! -e "$root/tools/old-name" ]
    [ -f "$root/tools/alpha" ]
    rm -rf "$root"
}

@test "stale underscore stubs from the old contract are purged" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    _make_stub "$root" "_on_merge" "_on_merge.sh"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ ! -e "$root/tools/_on_merge" ]
    [ -f "$root/tools/alpha" ]
    rm -rf "$root"
}

@test "foreign underscore files at depth-1 are left untouched" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    printf 'custom internal tool\n' > "$root/tools/_my_private_tool"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ "$(cat "$root/tools/_my_private_tool")" = "custom internal tool" ]
    rm -rf "$root"
}

@test "test runner gets a depth-1 entry (tools/run-devenv-tests)" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    mkdir -p "$root/tools/tests"
    printf '#!/bin/bash\necho tests-ran\n' > "$root/tools/tests/run-devenv-tests.sh"
    chmod +x "$root/tools/tests/run-devenv-tests.sh"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ -f "$root/tools/run-devenv-tests" ]
    grep -q 'tests/run-devenv-tests.sh' "$root/tools/run-devenv-tests"
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

@test "real checkout: every depth-1 stub's exec target exists" {
    # The mock-checkout tests above verify the sync script's mechanics; this
    # one guards the real tree: a stub whose target is missing breaks the
    # command for every developer. This exact gap shipped once (rename wave
    # left nine stale stubs) — this test fails if it ever recurs.
    local broken=""
    local f target
    for f in "$PROJECT_ROOT"/tools/[a-z]*; do
        [ -f "$f" ] || continue
        target=$(grep -o 'scripts/[a-zA-Z0-9._-]*\.sh' "$f" 2>/dev/null | head -1)
        [ -n "$target" ] || continue
        if [ ! -f "$PROJECT_ROOT/tools/$target" ]; then
            broken+="$(basename "$f") -> $target"$'\n'
        fi
    done
    [ -z "$broken" ] || {
        echo "stale depth-1 stubs (exec target missing):" >&2
        printf '%s' "$broken" >&2
        return 1
    }
}

@test "a stub for an extensionless script whose target is gone is purged" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    # git-style tools have no .sh suffix: their stale stubs must go too
    _make_stub "$root" "git-old-tool" "git-old-tool"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ ! -e "$root/tools/git-old-tool" ]
    [ -f "$root/tools/alpha" ]
    rm -rf "$root"
}

@test "a stub for an extensionless script that still exists is kept" {
    local root
    root="$(mktemp -d)"
    _make_mock_checkout "$root"
    printf '#!/bin/bash\necho git-live\n' > "$root/tools/scripts/git-live"
    chmod +x "$root/tools/scripts/git-live"
    _make_stub "$root" "git-live" "git-live"

    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]

    [ -f "$root/tools/git-live" ]
    rm -rf "$root"
}

# ---------------------------------------------------------------------------
# Override layers: tools/custom/ over tools/fork/ over tools/scripts/
# ---------------------------------------------------------------------------

_make_layer_script() {
    local root="$1" layer="$2" name="$3"
    mkdir -p "$root/tools/$layer"
    printf '#!/bin/bash\necho "ran-%s-%s"\n' "$layer" "$name" > "$root/tools/$layer/$name"
}

@test "a tools/fork/ script gets a depth-1 stub that runs it" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_layer_script "$root" fork "own-tool.sh"
    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]
    grep -q 'fork/own-tool.sh' "$root/tools/own-tool"
    run bash "$root/tools/own-tool"
    [ "$output" = "ran-fork-own-tool.sh" ]
    rm -rf "$root"
}

@test "a tools/custom/ script gets a depth-1 stub that runs it" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_layer_script "$root" custom "mine.sh"
    run bash "$SYNC_SCRIPT"
    grep -q 'custom/mine.sh' "$root/tools/mine"
    rm -rf "$root"
}

@test "precedence: custom beats fork beats provided for the same name" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "shared.sh"
    _make_layer_script "$root" fork "shared.sh"
    run bash "$SYNC_SCRIPT"
    grep -q 'fork/shared.sh' "$root/tools/shared"
    _make_layer_script "$root" custom "shared.sh"
    run bash "$SYNC_SCRIPT"
    grep -q 'custom/shared.sh' "$root/tools/shared"
    run bash "$root/tools/shared"
    [ "$output" = "ran-custom-shared.sh" ]
    rm -rf "$root"
}

@test "removing an override and re-syncing points the stub back at the next layer" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "shared.sh"
    _make_layer_script "$root" custom "shared.sh"
    bash "$SYNC_SCRIPT" >/dev/null
    grep -q 'custom/shared.sh' "$root/tools/shared"
    rm "$root/tools/custom/shared.sh"
    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]
    grep -q 'scripts/shared.sh' "$root/tools/shared"
    rm -rf "$root"
}

@test "removing a pure custom tool purges its stub" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_layer_script "$root" custom "temp.sh"
    bash "$SYNC_SCRIPT" >/dev/null
    [ -f "$root/tools/temp" ]
    rm "$root/tools/custom/temp.sh"
    run bash "$SYNC_SCRIPT"
    [[ "$output" == *"removed=1"* ]]
    [ ! -e "$root/tools/temp" ]
    rm -rf "$root"
}

@test "underscore-prefixed scripts in fork/ and custom/ get no depth-1 entry" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_layer_script "$root" fork "_internal.sh"
    _make_layer_script "$root" custom "_hidden.sh"
    run bash "$SYNC_SCRIPT"
    [ ! -e "$root/tools/_internal" ]
    [ ! -e "$root/tools/_hidden" ]
    [ ! -e "$root/tools/_internal.sh" ]
    rm -rf "$root"
}

@test "a stale extensionless git-* stub is purged along with the .sh ones" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_stub "$root" "git-gone" "git-gone"
    run bash "$SYNC_SCRIPT"
    [ ! -e "$root/tools/git-gone" ]
    rm -rf "$root"
}

@test "a fork-layer git-* tool overrides the provided one" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    printf '#!/bin/bash\necho provided\n' > "$root/tools/scripts/git-thing"
    mkdir -p "$root/tools/fork"; printf '#!/bin/bash\necho forked\n' > "$root/tools/fork/git-thing"
    bash "$SYNC_SCRIPT" >/dev/null
    run bash "$root/tools/git-thing"
    [ "$output" = "forked" ]
    rm -rf "$root"
}

@test "a re-run with no changes in any layer is a no-op" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "a.sh"
    _make_layer_script "$root" fork "b.sh"
    _make_layer_script "$root" custom "a.sh"
    bash "$SYNC_SCRIPT" >/dev/null
    run bash "$SYNC_SCRIPT"
    [[ "$output" == *"created=0 converted=0"* ]]
    [[ "$output" == *"removed=0"* ]]
    rm -rf "$root"
}

@test "a custom tool named like a tools/ directory is skipped with a warning and the rest still sync" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    mkdir -p "$root/tools/config"
    _make_layer_script "$root" custom "lib.sh"
    _make_layer_script "$root" custom "config.sh"
    _make_layer_script "$root" custom "fine.sh"
    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"tools/lib is a directory"* ]]
    [[ "$output" == *"tools/config is a directory"* ]]
    [ -d "$root/tools/lib" ] && [ -d "$root/tools/config" ]
    [ -f "$root/tools/fine" ]
    rm -rf "$root"
}

@test "a filename the stub could interpret is skipped, never written into a stub" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    mkdir -p "$root/tools/custom"
    printf '#!/bin/bash\necho x\n' > "$root/tools/custom/"'$(touch PWNED).sh'
    printf '#!/bin/bash\necho x\n' > "$root/tools/custom/"'back`tick.sh'
    printf '#!/bin/bash\necho x\n' > "$root/tools/custom/"'my tool.sh'
    printf '#!/bin/bash\necho x\n' > "$root/tools/custom/"'ok-name.sh'
    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"not a plain tool name"* ]]
    [ -f "$root/tools/ok-name" ]
    run bash "$root/tools/ok-name"
    [ ! -e "$root/PWNED" ] && [ ! -e "$root/tools/PWNED" ]
    # nothing but the one plain name was created
    [ "$(find "$root/tools" -maxdepth 1 -type f | wc -l)" -eq 1 ]
    rm -rf "$root"
}

@test "a dangling symlink and a directory named like a script are ignored" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    mkdir -p "$root/tools/custom/dir.sh"
    ln -s /nonexistent/target "$root/tools/custom/dangling.sh"
    _make_layer_script "$root" custom "real.sh"
    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]
    [ -f "$root/tools/real" ]
    [ ! -e "$root/tools/dir" ] && [ ! -e "$root/tools/dangling" ]
    rm -rf "$root"
}

@test "a document or data file that shares a tool's name is left alone with a warning" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "README.sh"
    printf 'my notes\n' > "$root/tools/README"
    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]
    [ "$(cat "$root/tools/README")" = "my notes" ]
    [[ "$output" == *"leaving tools/README alone"* ]]
    rm -rf "$root"
}

@test "a drifted script copy or a stub for an old source is still converted to the winning stub" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "tool.sh"
    printf '#!/bin/bash\necho an old copy\n' > "$root/tools/tool"
    chmod +x "$root/tools/tool"
    run bash "$SYNC_SCRIPT"
    grep -q 'scripts/tool.sh' "$root/tools/tool"
    rm -rf "$root"
}

@test "a hardlinked entry is replaced, and the source script it shares an inode with is untouched" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    local before; before="$(cat "$root/tools/scripts/alpha.sh")"
    ln "$root/tools/scripts/alpha.sh" "$root/tools/alpha"
    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]
    [ "$(cat "$root/tools/scripts/alpha.sh")" = "$before" ]
    grep -q 'scripts/alpha.sh' "$root/tools/alpha"
    [ "$(stat -c %i "$root/tools/alpha")" != "$(stat -c %i "$root/tools/scripts/alpha.sh")" ]
    rm -rf "$root"
}

@test "a hardlinked runner entry leaves the runner script untouched" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    mkdir -p "$root/tools/tests"
    printf '#!/bin/bash\necho runner\n' > "$root/tools/tests/run-devenv-tests.sh"
    ln "$root/tools/tests/run-devenv-tests.sh" "$root/tools/run-devenv-tests"
    run bash "$SYNC_SCRIPT"
    [ "$status" -eq 0 ]
    [ "$(cat "$root/tools/tests/run-devenv-tests.sh")" = $'#!/bin/bash\necho runner' ]
    rm -rf "$root"
}

@test "a stub is written with mode 755 whatever the umask, and no temporary file is left behind" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    run bash -c "umask 077; bash '$SYNC_SCRIPT'"
    [ "$status" -eq 0 ]
    [ "$(stat -c %a "$root/tools/alpha")" = "755" ]
    [ -z "$(find "$root/tools" -maxdepth 1 -name '*.tmp.*')" ]
    rm -rf "$root"
}

@test "a stub that cannot be written leaves the old entry in place and says so" {
    [ "$(id -u)" -ne 0 ] || skip "directory permissions do not bind root"
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    printf '#!/bin/bash\necho old entry\n' > "$root/tools/alpha"
    chmod +x "$root/tools/alpha"
    chmod a-w "$root/tools"
    run bash "$SYNC_SCRIPT"
    chmod u+w "$root/tools"
    [ "$status" -ne 0 ]
    [[ "$output" == *"could not write"* ]]
    [ "$(cat "$root/tools/alpha")" = $'#!/bin/bash\necho old entry' ]
    rm -rf "$root"
}

@test "the entry never goes missing while the sync replaces it" {
    local root; root="$(mktemp -d)"
    _make_mock_checkout "$root"
    _make_script "$root" "alpha.sh"
    printf '#!/bin/bash\necho old\n' > "$root/tools/alpha"
    chmod +x "$root/tools/alpha"
    # a watcher checks for the entry in a tight loop while the sync runs
    ( while [ ! -e "$root/.stop" ]; do [ -e "$root/tools/alpha" ] || { touch "$root/.missing"; break; }; done ) &
    local watcher=$!
    local i
    for i in 1 2 3 4 5 6 7 8; do
        printf '#!/bin/bash\necho old %s\n' "$i" > "$root/tools/alpha.stale"
        mv -f "$root/tools/alpha.stale" "$root/tools/alpha"
        bash "$SYNC_SCRIPT" >/dev/null 2>&1
    done
    touch "$root/.stop"; wait "$watcher" 2>/dev/null || true
    [ ! -e "$root/.missing" ]
    rm -rf "$root"
}
