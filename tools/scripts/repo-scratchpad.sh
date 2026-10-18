#!/bin/bash
# repo-scratchpad - Governed experiment sandbox for AI sessions (Plan-004).
#
# Cuts a scratchpad/<slug> branch, records the base, and permits hook-bypassing
# AI commits on it. The sandbox's destructive surface (reset, exit) only ever
# touches scratch-created content: entry is fail-closed on a dirty tree.
# Subcommands: enter | status | commit | reset | promote | exit.
#
# Scratch commits bypass hooks (git commit -n, the git-wip precedent) and carry
# no Devenv-Action/Change-Id trailers — they must never reach shared history.
# promote cherry-picks one scratch commit onto the base branch staged and
# uncommitted, where the normal (hook-running) flow takes over and trailers
# re-acquire.

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
Usage: $SCRIPT_NAME enter [slug] [--carry]
       $SCRIPT_NAME status
       $SCRIPT_NAME resume
       $SCRIPT_NAME commit "<title>"
       $SCRIPT_NAME reset
       $SCRIPT_NAME promote <sha>
       $SCRIPT_NAME exit

Governed experiment sandbox. Cuts scratchpad/<slug> from the current HEAD;
hook-bypassing commits are permitted on it; reset returns to base AI-safe.

Entry is FAIL-CLOSED: a dirty working tree (tracked or untracked) refuses
entry. Save work first: git wip (recommended; notes: it pushes) or a normal
commit. --carry overrides with a loud warning + best-effort snapshot into
.local-artifacts/tmp/scratchpad/ — carried work is DESTROYED by reset.

Exit codes:
    0   Success
    1   General error / safety refusal (dirty tree, bisect in flight, etc.)
    2   Invalid arguments (EXIT_MISUSE)
    3   Conflict (already active, nothing to reset) (EXIT_CONFLICT)
    4   Not found (unknown sha/promote target) (EXIT_API_FAILURE)
EOF
    echo "Version: $SCRIPT_VERSION"
    exit 0
}

cmd_enter() {
    scratchpad_require_git_repo || exit "$EXIT_GENERAL_ERROR"
    if scratchpad_bisect_in_flight; then
        echo "Error: a git bisect session is mid-flight — finish or abort it (git bisect reset) before entering a scratchpad." >&2
        exit "$EXIT_GENERAL_ERROR"
    fi

    local slug="" carry=false
    while [ $# -gt 0 ]; do
        case "$1" in
            --carry) carry=true ;;
            -h|--help) show_usage ;;
            *)
                if [ -z "$slug" ]; then slug="$1"; else
                    echo "Error: unexpected argument '$1'" >&2; exit "$EXIT_MISUSE"
                fi
                ;;
        esac
        shift
    done
    [ -n "$slug" ] || slug="exp"
    scratchpad_validate_slug "$slug" || exit "$EXIT_MISUSE"

    if is_scratchpad_active; then
        echo "Error: a scratchpad is already active ($(scratchpad_active_branch)). One per repo — exit it first." >&2
        exit "$EXIT_CONFLICT"
    fi

    if scratchpad_is_dirty; then
        if [ "$carry" = true ]; then
            echo "⚠️  CARRY: dirty tree carried into the scratchpad. scratchpad reset will DESTROY carried work." >&2
            scratchpad_snapshot_carry "$slug"
        else
            scratchpad_validate_clean_tree || exit "$EXIT_GENERAL_ERROR"
        fi
    fi

    local base branch origin
    base="$(git rev-parse HEAD)"
    origin="$(scratchpad_working_branch)"
    branch="${SCRATCHPAD_BRANCH_PREFIX}${slug}"

    if git show-ref --verify --quiet "refs/heads/$branch"; then
        echo "Error: branch '$branch' already exists — pick another slug or remove it." >&2
        exit "$EXIT_CONFLICT"
    fi

    git checkout -q -b "$branch"
    scratchpad_record_state "$slug" "$base" "$branch" "$origin"
    echo "Scratchpad active: $branch (base: $(git rev-parse --short "$base"))"
    echo "Hook-bypassing commits enabled: repo-scratchpad commit \"<title>\""
}

cmd_status() {
    scratchpad_require_git_repo || exit "$EXIT_GENERAL_ERROR"
    if ! is_scratchpad_active; then
        echo "No scratchpad active."
        exit 0
    fi
    local branch base
    branch="$(scratchpad_active_branch)"
    if [ -z "$branch" ]; then
        echo "⚠️  Scratchpad state refs exist but no scratchpad/* branch matches (ghost state)."
        echo "   Recovery (user's hands): git update-ref -d refs/scratchpad/state; git update-ref -d refs/scratchpad/base; git update-ref -d refs/scratchpad/origin-branch"
        exit "$EXIT_GENERAL_ERROR"
    fi
    base="$(scratchpad_base_commit)"
    echo "Scratchpad active: $branch"
    echo "Base: $(git rev-parse --short "$base" 2>/dev/null || echo unknown)"
    echo "Ahead of base: $(git rev-list --count "$base..HEAD" 2>/dev/null || echo '?') commit(s)"
    if ! scratchpad_on_scratch_branch; then
        echo "⚠️  HEAD is NOT on the scratch branch (paused or mid-foreign-bisect) — commit/reset refuse until you repo-scratchpad resume."
    fi
    scratchpad_bisect_in_flight && echo "⚠️  git bisect session in flight — reset/exit refuse until it finishes." || true
}

cmd_resume() {
    scratchpad_require_git_repo || exit "$EXIT_GENERAL_ERROR"
    is_scratchpad_active ||
        { echo "Error: no scratchpad active" >&2; exit "$EXIT_GENERAL_ERROR"; }
    local branch
    branch="$(scratchpad_active_branch)"
    [ -n "$branch" ] || { echo "Error: ghost state — see repo-scratchpad status" >&2; exit "$EXIT_GENERAL_ERROR"; }
    if scratchpad_bisect_in_flight; then
        echo "Error: a git bisect session is mid-flight — finish or abort it first." >&2
        exit "$EXIT_GENERAL_ERROR"
    fi
    # Dirty guard: a post-promote pause carries the salvage STAGED in the
    # index. Checking out the scratch branch with it staged means a later
    # `commit` sweeps it into a trailer-less scratch commit and `reset`
    # destroys it — work the tool itself staged and called salvageable.
    if [ -n "$(git status --porcelain)" ]; then
        echo "Error: working tree/index is dirty — a post-promote pause may hold the staged salvage. Land it first (repo-scratchpad exit keeps staged work; then commit via the normal flow), or clean the tree, then resume." >&2
        exit "$EXIT_GENERAL_ERROR"
    fi
    git checkout -q "$branch"
    scratchpad_sync_state_ref
    echo "Resumed: HEAD on $branch"
}

cmd_commit() {
    scratchpad_require_git_repo || exit "$EXIT_GENERAL_ERROR"
    [ $# -ge 1 ] || { echo "Error: commit requires a title" >&2; exit "$EXIT_MISUSE"; }
    is_scratchpad_active ||
        { echo "Error: no scratchpad active — enter one first (commits here are hook-bypassing and must stay on the scratchpad branch)" >&2; exit "$EXIT_GENERAL_ERROR"; }
    # HEAD-position guard (B1): the sandbox may only brand commits ON the
    # scratch branch. Detached HEAD or an origin-branch checkout (e.g. post-
    # promote pause, post-foreign-bisect) must not receive scratch commits.
    scratchpad_on_scratch_branch ||
        { echo "Error: HEAD is not on the scratch branch — return first: repo-scratchpad resume (raw git checkout is not sanctioned)" >&2; exit "$EXIT_GENERAL_ERROR"; }

    local title="$*"
    git add -A
    # Hook-bypass (git-wip precedent): enforcement hooks skipped, -m message
    # lands verbatim with the scratch: brand. Exit code passes through
    # unchanged — the bisect probe contract depends on determinism here.
    git commit -n -q -m "scratch: $title"
    scratchpad_sync_state_ref
    git log -1 --format="committed %h %s"
}

cmd_reset() {
    scratchpad_require_git_repo || exit "$EXIT_GENERAL_ERROR"
    is_scratchpad_active ||
        { echo "Error: no scratchpad active" >&2; exit "$EXIT_GENERAL_ERROR"; }
    if scratchpad_bisect_in_flight; then
        echo "Error: a git bisect session is mid-flight — finish or abort it (git bisect reset) before resetting the scratchpad." >&2
        exit "$EXIT_GENERAL_ERROR"
    fi
    # HEAD-position guard (B1): reset --hard is repo-wide against whatever
    # branch HEAD is on. Post-promote pause or a foreign bisect restore can
    # put HEAD on the ORIGIN branch — resetting there would rewind user work,
    # violating the sandbox's core invariant.
    scratchpad_on_scratch_branch ||
        { echo "Error: HEAD is not on the scratch branch — reset would rewind a non-scratch branch. Return first: repo-scratchpad resume" >&2; exit "$EXIT_GENERAL_ERROR"; }
    local base
    base="$(scratchpad_base_commit)"
    [ -n "$base" ] || { echo "Error: base ref missing — scratchpad state corrupt; exit and re-enter." >&2; exit "$EXIT_GENERAL_ERROR"; }
    git reset --hard -q "$base"
    # Clean untracked scratch debris repo-wide BUT preserve .local-artifacts/
    # — the carry-snapshot patch lives there and is the salvage record for
    # carried work. The clean runs AT THE REPO TOPLEVEL (git -C) so it is
    # cwd-independent, and the -e pattern protects the root-level dir.
    git -C "$(git rev-parse --show-toplevel)" clean -qfd -e .local-artifacts
    scratchpad_sync_state_ref
    echo "Reset to base $(git rev-parse --short "$base")"
}

cmd_promote() {
    scratchpad_require_git_repo || exit "$EXIT_GENERAL_ERROR"
    [ $# -eq 1 ] || { echo "Error: promote requires exactly one sha" >&2; exit "$EXIT_MISUSE"; }
    is_scratchpad_active ||
        { echo "Error: no scratchpad active" >&2; exit "$EXIT_GENERAL_ERROR"; }

    local sha="$1" branch base sha_full
    branch="$(scratchpad_active_branch)"
    base="$(scratchpad_base_commit)"
    # Normalize to full shas before comparing (a short base sha would
    # string-mismatch and slip through the not-the-base check).
    sha_full="$(git rev-parse --verify "${sha}^{commit}" 2>/dev/null)" ||
        { echo "Error: '$sha' is not a resolvable commit" >&2; exit "$EXIT_API_FAILURE"; }
    # Validate the sha is a scratch commit (an ancestor of the scratch tip,
    # not the base itself).
    if ! git merge-base --is-ancestor "$sha_full" "refs/heads/$branch" 2>/dev/null ||
       [ "$sha_full" = "$base" ] ||
       ! git merge-base --is-ancestor "$base" "$sha_full" 2>/dev/null; then
        echo "Error: '$sha' is not a commit on the scratchpad branch" >&2
        exit "$EXIT_API_FAILURE"
    fi

    # Land on the base (by origin-branch name when known), then cherry-pick.
    scratchpad_return_to_base
    # Staged, uncommitted: cherry-pick folds the change into the index+tree
    # without committing (--no-commit), so the normal hook-running flow
    # (/devenv-commit via repo-commit) takes over and trailers re-acquire.
    if ! git cherry-pick --no-commit "$sha" >/dev/null 2>&1; then
        git cherry-pick --quit >/dev/null 2>&1 || true
        git reset --hard -q "$base" 2>/dev/null || true
        git checkout -q "$branch"
        scratchpad_sync_state_ref
        echo "Error: cherry-pick conflicted — promote aborted, scratchpad state restored" >&2
        exit "$EXIT_CONFLICT"
    fi
    git update-ref "$SCRATCHPAD_STATE_REF" "$(git rev-parse "refs/heads/$branch")"
    echo "Promoted $(git rev-parse --short "$sha") onto $(git rev-parse --short "$base") — staged, uncommitted."
    echo "The scratchpad is PAUSED (state kept). To land the salvage: repo-scratchpad exit (staged work survives), then commit via the normal flow (/devenv-commit)."
    echo "To keep hunting: repo-scratchpad resume"
}

cmd_exit() {
    scratchpad_require_git_repo || exit "$EXIT_GENERAL_ERROR"
    is_scratchpad_active ||
        { echo "Error: no scratchpad active" >&2; exit "$EXIT_GENERAL_ERROR"; }
    if scratchpad_bisect_in_flight; then
        echo "Error: a git bisect session is mid-flight — finish or abort it (git bisect reset) before exiting the scratchpad." >&2
        exit "$EXIT_GENERAL_ERROR"
    fi

    local branch base tip commits
    branch="$(scratchpad_active_branch)"
    if [ -z "$branch" ]; then
        echo "Error: ghost state — state refs exist but no scratchpad/* branch matches. See repo-scratchpad status for the recovery steps." >&2
        exit "$EXIT_GENERAL_ERROR"
    fi
    base="$(scratchpad_base_commit)"
    tip="$(git rev-parse --verify "refs/heads/$branch")"
    commits="$(git rev-list --count "$base..$branch" 2>/dev/null || echo 0)"

    scratchpad_return_to_base
    git branch -q -D "$branch"
    scratchpad_clear_state

    echo "Scratchpad exited; branch $branch deleted ($commits scratch commit(s))."
    echo "Tip $tip remains reachable via reflog until gc — salvage with cherry-pick if needed."
}

main() {
    if handle_global_flag "${1:-}"; then
        exit 0
    fi

    [ $# -ge 1 ] || { show_usage; }

    local cmd="$1"
    shift
    case "$cmd" in
        enter)   cmd_enter "$@" ;;
        status)  cmd_status "$@" ;;
        resume)  cmd_resume "$@" ;;
        commit)  cmd_commit "$@" ;;
        reset)   cmd_reset "$@" ;;
        promote) cmd_promote "$@" ;;
        exit)    cmd_exit "$@" ;;
        -h|--help) show_usage ;;
        *) echo "Error: unknown command '$cmd'" >&2; show_usage >&2; exit "$EXIT_MISUSE" ;;
    esac
}

main "$@"
