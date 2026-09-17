#!/usr/bin/env bats
# Tests for the WIP-commit gate (tools/git-hooks/wip-gate.sh)
#
# The gate enforces: only a WIP commit may follow a WIP commit. Delivery to
# repos happens via the template boilerplate sync (the gate block ships in the
# templates' .husky/pre-commit) or the global hooks directory — these tests
# exercise the gate logic itself plus the delegation mechanics (a husky-style
# local hooksPath with a block that invokes the gate), using the exact block
# shape the templates ship.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup

    GATE="$DEVENV_TOOLS/git-hooks/wip-gate.sh"

    # Scratch "workspace" with two husky-style repos
    WORKSPACE="$TEST_TEMP_DIR/workspace"
    mkdir -p "$WORKSPACE/repos/alpha" "$WORKSPACE/repos/beta"

    # The delegation block exactly as the template repos ship it.
    # (Kept in a fixture file so a change to the shipped block and these
    # tests move together.)
    cat > "$WORKSPACE/gate-block.txt" <<'BLOCK'
# >>> devenv wip-gate >>>
# devenv WIP gate — enforces: only a WIP commit may follow a WIP commit.
# Run 'git-unwip' to clear WIP state before real commits.
if [ -n "${DEVENV_TOOLS:-}" ] && [ -f "$DEVENV_TOOLS/git-hooks/wip-gate.sh" ]; then
    bash "$DEVENV_TOOLS/git-hooks/wip-gate.sh"
elif tools_dir=$(git config --global devenv.toolsDir 2>/dev/null) && [ -f "$tools_dir/git-hooks/wip-gate.sh" ]; then
    bash "$tools_dir/git-hooks/wip-gate.sh"
fi
# <<< devenv wip-gate <<<
BLOCK

    for repo in alpha beta; do
        git -C "$WORKSPACE/repos/$repo" init -q -b main
        git -C "$WORKSPACE/repos/$repo" config user.email t@t.test
        git -C "$WORKSPACE/repos/$repo" config user.name t
        mkdir -p "$WORKSPACE/repos/$repo/.husky"
        { cat "$WORKSPACE/gate-block.txt"; echo "# repo-local checks follow"; } \
            > "$WORKSPACE/repos/$repo/.husky/pre-commit"
        (cd "$WORKSPACE/repos/$repo" && echo a > f && git add f && git commit -q -m base)
    done

    # beta additionally gets the husky _ dispatcher (faithful husky chain)
    mkdir -p "$WORKSPACE/repos/beta/.husky/_"
    cat > "$WORKSPACE/repos/beta/.husky/_/pre-commit" <<'DISPATCH'
#!/usr/bin/env sh
n=$(basename "$0")
s=$(dirname "$(dirname "$0")")/$n
[ ! -f "$s" ] && exit 0
sh -e "$s" "$@"
DISPATCH
    chmod +x "$WORKSPACE/repos/beta/.husky/_/pre-commit"
    git -C "$WORKSPACE/repos/beta" config core.hooksPath ".husky/_"
}

@test "gate through husky delegation: blocks normal commit on WIP HEAD" {
    local repo="$WORKSPACE/repos/beta"
    (cd "$repo" && echo b > f && git add f && git commit -q -m "WIP: state")
    (cd "$repo" && echo c > f && git add f)
    run git -C "$repo" commit -m "feat: should be blocked"
    [ "$status" -ne 0 ]
    [[ "$output" == *"git-unwip"* ]]
}

@test "gate through husky delegation: WIP commit on WIP HEAD still allowed" {
    local repo="$WORKSPACE/repos/beta"
    (cd "$repo" && echo b > f && git add f && git commit -q -m "WIP: first")
    (cd "$repo" && echo c > f && git add f)
    run git -C "$repo" commit -q -m "WIP: second" -n
    [ "$status" -eq 0 ]
}

@test "gate through husky delegation: normal commit allowed on clean HEAD" {
    local repo="$WORKSPACE/repos/beta"
    (cd "$repo" && echo c > f && git add f)
    run git -C "$repo" commit -q -m "feat: clean"
    [ "$status" -eq 0 ]
}

@test "gate script: blocks when HEAD is WIP (direct invocation)" {
    local repo="$WORKSPACE/repos/alpha"
    (cd "$repo" && echo b > f && git add f && git commit -q -m "WIP: direct" -n)
    run bash -c "cd '$repo' && bash '$GATE'"
    [ "$status" -eq 1 ]
    [[ "$output" == *"git-unwip"* ]]
}

@test "gate script: passes on clean HEAD (direct invocation)" {
    local repo="$WORKSPACE/repos/alpha"
    run bash -c "cd '$repo' && bash '$GATE'"
    [ "$status" -eq 0 ]
}

@test "global thin-caller pre-commit delegates to the shared gate" {
    run bash "$DEVENV_TOOLS/git-hooks/pre-commit"
    [ "$status" -eq 0 ]
    local repo="$WORKSPACE/repos/alpha"
    (cd "$repo" && echo b > f && git add f && git commit -q -m "WIP: thin" -n)
    run bash -c "cd '$repo' && bash '$DEVENV_TOOLS/git-hooks/pre-commit'"
    [ "$status" -eq 1 ]
}
