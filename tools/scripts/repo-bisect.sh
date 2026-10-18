#!/bin/bash
# repo-bisect - First-bad-commit identification over a commit range (Plan-004).
#
# Walks git bisect with a command; delivers the first bad commit with evidence.
# Deliberately carries NO scratchpad requirement: bisect is non-destructive by
# nature (read-only detached-HEAD visits; the branch tip never moves; worst
# case is `git bisect reset`-recoverable state). Works on any branch; when
# invoked outside a scratchpad it prints a soft notice naming the operating
# branch and pointing AI hunts at `repo-scratchpad enter` — guidance, not a
# gate (tool-level restrictions gate by blast radius, not by name).
#
# Refuses on a dirty working tree (uniform fail-closed rule: bisect checkouts
# + dirty tree = failure churn).
#
# The probe command's exit code is the bisect oracle: 0 = good, non-zero =
# bad. Inside a scratchpad, probe commits are made with
# `repo-scratchpad commit "<title>"` (deterministic exit-code pass-through).
#
# Usage:
#   repo-bisect <bad-ref> <good-ref> -- <probe command...>
#   repo-bisect status | reset
set -euo pipefail

# Self-root contract: self-location wins; a foreign exported DEVENV_TOOLS is
# ignored unless it realpath-matches this checkout.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"
# shellcheck source=../lib/scratchpad.bash
source "$DEVENV_TOOLS/lib/scratchpad.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME <bad-ref> <good-ref> -- <probe command...>
       $SCRIPT_NAME status
       $SCRIPT_NAME reset

First-bad-commit identification: walks git bisect, running the probe command
at each step. Probe exit 0 = good, non-zero = bad. Works on any branch.

  <bad-ref>    A commit known to have the defect (tip, tag, sha).
  <good-ref>   A commit known NOT to have it (defines the search range).
  probe        The command after '--'; run from the repo root at each step.

Outside a scratchpad, a notice names the operating branch — AI hunts should
start from: repo-scratchpad enter

Exit codes:
    0   Success (first-bad identified)
    1   General error / dirty-tree refusal
    2   Invalid arguments (EXIT_MISUSE)
    4   Not found (bad/good ref unresolvable)
EOF
    echo "Version: $SCRIPT_VERSION"
    exit 0
}

bisect_dirty_refuse() {
    if [ -n "$(git status --porcelain)" ]; then
        echo "Error: working tree is dirty — repo-bisect refuses (bisect checkouts + dirty tree = failure churn). Commit or save first." >&2
        return 1
    fi
}

bisect_notice_if_unsandboxed() {
    if ! is_scratchpad_active; then
        local branch
        branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "detached HEAD")"
        echo "notice: operating on '${branch}' directly — AI hunts should start from: repo-scratchpad enter" >&2
    fi
}

cmd_run() {
    scratchpad_require_git_repo || exit "$EXIT_GENERAL_ERROR"
    [ $# -ge 3 ] || { show_usage >&2; exit "$EXIT_MISUSE"; }
    [ "$1" = "--" ] && { show_usage >&2; exit "$EXIT_MISUSE"; }

    local bad="$1" good="$2"
    shift 2
    [ "${1:-}" = "--" ] || { echo "Error: probe command must be separated by '--'" >&2; exit "$EXIT_MISUSE"; }
    shift
    [ $# -ge 1 ] || { echo "Error: empty probe command" >&2; exit "$EXIT_MISUSE"; }

    bisect_dirty_refuse || exit "$EXIT_GENERAL_ERROR"

    git rev-parse --verify --quiet "$bad^{commit}" >/dev/null ||
        { echo "Error: bad-ref not resolvable: $bad" >&2; exit "$EXIT_API_FAILURE"; }
    git rev-parse --verify --quiet "$good^{commit}" >/dev/null ||
        { echo "Error: good-ref not resolvable: $good" >&2; exit "$EXIT_API_FAILURE"; }

    bisect_notice_if_unsandboxed

    if ! git bisect start "$bad" "$good" >/dev/null 2>&1; then
        # Show the REAL cause: mid-bisect is only one of several start failures
        # (e.g. octopus-merge ranges fail start with their own message).
        echo "Error: git bisect start failed:" >&2
        git bisect start "$bad" "$good" 2>&1 | tail -3 >&2 || true
        git bisect reset >/dev/null 2>&1 || true
        exit "$EXIT_GENERAL_ERROR"
    fi

    # Reject a degenerate range: bad and good must be distinct commits, or
    # `bisect run` aborts with "was both good and bad".
    if [ "$(git rev-parse --verify "$bad^{commit}")" = "$(git rev-parse --verify "$good^{commit}")" ]; then
        git bisect reset >/dev/null 2>&1 || true
        echo "Error: bad-ref and good-ref resolve to the same commit — nothing to search" >&2
        exit "$EXIT_MISUSE"
    fi

    local first_bad
    if ! first_bad="$(git bisect run "$@" 2>&1)"; then
        :
    fi
    # Probe ran but could not EXECUTE somewhere (126 permission / 127 not-found):
    # git treats those as 'bad', which fabricates a confident verdict from a
    # broken probe. Detect and report instead of concluding.
    if echo "$first_bad" | grep -qE "(failed to run|command not found|permission denied|exit code 12[67])"; then
        git bisect reset >/dev/null 2>&1 || true
        echo "repo-bisect: probe execution failed (exit 126/127 class) — the walk's conclusion would be fabricated. Fix the probe; full output above." >&2
        echo "$first_bad" | tail -8 >&2
        exit "$EXIT_GENERAL_ERROR"
    fi
    # Evidence reaches the report: the probe's own output (failures included),
    # then the summary lines.
    echo "$first_bad" | tail -12
    echo "--- summary ---"

    if echo "$first_bad" | grep -qi "first bad commit" &&
       ! echo "$first_bad" | grep -q "could be any of"; then
        # The definitive line is "<sha> is the first bad commit"; fall back to
        # "bisect found first bad commit" + the shown culprit.
        local sha
        sha="$(echo "$first_bad" | grep -oE '^[0-9a-f]{7,} is the first bad commit' | awk '{print $1}' | head -1)"
        if [ -z "$sha" ]; then
            sha="$(echo "$first_bad" | grep -oE '[0-9a-f]{7,}' | tail -1)"
        fi
        git bisect reset >/dev/null 2>&1 || true
        echo "FIRST-BAD: $sha"
        git show --no-patch --format="culprit: %h %s (%an, %ad)" "$sha"
        exit 0
    fi

    git bisect reset >/dev/null 2>&1 || true
    # Ambiguity is honest: all-skip ("could be any of") or a non-concluding walk
    # reports NO culprit rather than a fabricated one.
    if echo "$first_bad" | grep -q "could be any of"; then
        echo "repo-bisect: AMBIGUOUS — the probe skipped (exit 125) too many commits; the first bad commit could be any of those listed above." >&2
    else
        echo "repo-bisect: no first-bad identified (probe never discriminated — check probe correctness or range)" >&2
    fi
    exit "$EXIT_GENERAL_ERROR"
}

cmd_status() {
    scratchpad_require_git_repo || exit "$EXIT_GENERAL_ERROR"
    if git show-ref --verify --quiet refs/bisect/start; then
        git bisect log
    else
        echo "No bisect session in flight."
    fi
}

cmd_reset() {
    scratchpad_require_git_repo || exit "$EXIT_GENERAL_ERROR"
    if ! git show-ref --verify --quiet refs/bisect/start; then
        echo "No bisect session in flight — nothing to reset."
        exit 0
    fi
    git bisect reset
    echo "Bisect session ended."
}

main() {
    if handle_global_flag "${1:-}"; then
        exit 0
    fi

    [ $# -ge 1 ] || { show_usage; }
    local cmd="$1"
    shift
    case "$cmd" in
        status) cmd_status ;;
        reset)  cmd_reset ;;
        -h|--help) show_usage ;;
        *)      cmd_run "$cmd" "$@" ;;
    esac
}

main "$@"
