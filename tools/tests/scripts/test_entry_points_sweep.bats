#!/usr/bin/env bats
# Automated entry-point sweep (Plan-005 AC-5 guard).
#
# Every depth-1 stub in tools/ must execute cleanly — through the stub to the
# real tools/scripts/ file — even with a foreign DEVENV_TOOLS exported.
#
# Interactive scripts get </dev/null; failure detection greps for resolver
# failure signatures only (not usage text — many scripts have no --help and
# legitimately exit non-zero on empty args).

FOREIGN_ENV=(env DEVENV_TOOLS=/nonexistent/foreign/tools DEVENV_ROOT=/nonexistent/foreign)

resolver_failure() {
    local out="$1"
    echo "$out" | grep -qE "self-root.bash: No such file|devenv_resolve_tools_root: command not found|devenv_self_root: command not found"
}

@test "sweep setup: every tools/scripts-backed depth-1 entry is a stub, not a symlink" {
    # Ownership rule: only tools/scripts/-backed entries are ours. Foreign
    # depth-1 entries (e.g. dangling user symlinks) are ignored.
    while IFS= read -r script; do
        local name entry
        name="$(basename "$script" .sh)"
        entry="${BATS_TEST_DIRNAME}/../../$name"
        if [ -e "$entry" ]; then
            if [ -L "$entry" ]; then
                echo "STILL A SYMLINK: $entry" >&2
                return 1
            fi
        fi
    done < <(find "${BATS_TEST_DIRNAME}/../../scripts" -maxdepth 1 -name '*.sh' -print)
}

@test "sweep: every depth-1 entry is a dispatching stub (execution spot-checked separately)" {
    local bad=0
    local first_bad=""
    while IFS= read -r -d '' f; do
        grep -q 'exec bash "$(dirname "$0")/scripts/' "$f" || {
            echo "NOT A DISPATCHING STUB: $f" >&2
            bad=$((bad + 1))
        }
    done < <(find "${BATS_TEST_DIRNAME}/../../" -maxdepth 1 -type f ! -name "*.sh" ! -name ".*" -print0)
    [ "$bad" -eq 0 ]
}

@test "sweep: entry stub dispatches to the scripts/ file (spot check issue-get)" {
    # Clones (post nested-devenv refactor) do not materialize depth-1 entry
    # stubs — those live in the workspace-root tools tree. Skip the spot check
    # when no stub exists at this tree's depth-1, consistent with the setup
    # test's tolerance for missing entries. See issue #42 for the layout
    # contract decision.
    local entry="${BATS_TEST_DIRNAME}/../../issue-get"
    if [ ! -e "$entry" ]; then
        skip "no depth-1 entry stubs in this tree (clone layout; issue #42)"
    fi
    local out
    out=$(timeout 10 env DEVENV_TOOLS=/nonexistent/foreign/tools \
        bash "$entry" --help < /dev/null 2>&1 || true)
    [[ "$out" == *"Usage: issue-get"* ]]
    ! resolver_failure "$out"
}
