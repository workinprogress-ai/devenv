#!/bin/bash
# scratchpad.bash - State machine core for the repo-scratchpad experiment sandbox.
#
# A scratchpad is a branch under scratchpad/<slug>, cut from the current HEAD,
# on which an AI session may create hook-bypassing commits (`scratch: ` branded)
# and reset freely. Safety invariants:
#   - Entry is FAIL-CLOSED: a dirty working tree (tracked or untracked — any
#     `git status --porcelain` output) refuses entry unless --carry is passed
#     (loud warning + auto-snapshot of carried work).
#   - State lives in git refs, never loose files: refs/scratchpad/base records
#     the originating commit; the branch prefix is the mode marker.
#   - Detection is detached-HEAD-safe: it reads the metadata ref, not just the
#     branch name, so a mid-bisect checkout cannot blind mode detection.
#   - The destructive surface (reset, exit's branch deletion) can only ever
#     destroy scratch-created content; user work is saved before entry.
#   - Scratch commits bypass hooks and therefore carry no Devenv-Action/
#     Change-Id trailers; they must never reach shared history (push refusals
#     are wired in the restricted wrappers; promote re-acquires trailers).
#
# One active scratchpad per repo.

# shellcheck shell=bash

# Prevent double-sourcing.
[ -n "${_SCRATCHPAD_LIB_LOADED:-}" ] && return 0
_SCRATCHPAD_LIB_LOADED=1

readonly SCRATCHPAD_BRANCH_PREFIX="scratchpad/"
readonly SCRATCHPAD_BASE_REF="refs/scratchpad/base"
readonly SCRATCHPAD_STATE_REF="refs/scratchpad/state"
readonly SCRATCHPAD_ORIGIN_REF="refs/scratchpad/origin-branch"
readonly SCRATCHPAD_CARRY_DIR=".local-artifacts/tmp/scratchpad"

# scratchpad_carry_dir [repo_dir]
# The carry-snapshot directory, anchored at the REPO TOPLEVEL (not the
# invocation cwd) so entering from a subdirectory writes the snapshot where
# reset's root-scoped clean exclusion protects it.
scratchpad_carry_dir() {
    local top
    top="$(git rev-parse --show-toplevel 2>/dev/null)" || {
        printf '%s' "$SCRATCHPAD_CARRY_DIR"
        return 0
    }
    printf '%s' "$top/$SCRATCHPAD_CARRY_DIR"
}

# scratchpad_on_scratch_branch [repo_dir]
# True when the CURRENT branch of the repo is a scratchpad branch — regardless
# of whether the state refs exist. Defense-in-depth layer for push-path tools:
# any scratchpad/* branch may carry hook-bypassing, trailer-less commits, so
# pushing from one is refused even in orphaned-state situations (state refs
# lost, or a branch created manually under the prefix).
scratchpad_on_scratch_branch() {
    local branch
    branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" || return 1
    case "$branch" in
        "${SCRATCHPAD_BRANCH_PREFIX}"*) return 0 ;;
        *) return 1 ;;
    esac
}

# scratchpad_refuse <tool-name>
# The ratified refusal contract (Plan-004 Phase 3, decision recorded at
# kickoff): stable sentinel first line for skills to document against,
# salvage/exit guidance second line. Always exit EXIT_CONFLICT (3) — the
# tool and its arguments are valid; the repo STATE forbids the operation.
# Callers:  scratchpad_refuse "git-wip" || exit $?
scratchpad_refuse() {
    local tool="$1"
    local slug
    slug="$(scratchpad_active_branch)"
    cat >&2 <<EOF
Error: ${tool} is blocked while a scratchpad is active (${slug:-scratchpad branch}).
Salvage: repo-scratchpad promote <sha> · or leave the mode: repo-scratchpad exit
EOF
    return "$EXIT_CONFLICT"
}

# scratchpad_refuse_push <tool-name>
# Push-path refusal: same contract, distinct reason line — scratch commits
# bypass hooks and carry no Devenv-Action/Change-Id trailers, so they must
# never reach shared history. Fires on active-scratchpad OR bare scratch
# branch (two-layer design ratified at kickoff).
scratchpad_refuse_push() {
    local tool="$1"
    cat >&2 <<EOF
Error: ${tool} push is blocked on a scratchpad branch — scratch commits bypass hooks and carry no Devenv-Action/Change-Id trailers; they must never reach shared history.
Salvage to the base branch: repo-scratchpad promote <sha> · or leave the mode: repo-scratchpad exit
EOF
    return "$EXIT_CONFLICT"
}

# is_scratchpad_active [repo_dir]
# True when a scratchpad is active in the repo. Detached-HEAD-safe: reads the
# state ref (which records the active branch) rather than the current branch
# name, so a bisect's detached checkouts cannot blind detection.
is_scratchpad_active() {
    git show-ref --verify --quiet "$SCRATCHPAD_STATE_REF"
}

# scratchpad_active_branch [repo_dir]
# Print the active scratchpad branch name (empty when none).
# Two discovery routes, in order:
#   1. State-ref tip match (authoritative while active; survives detached HEAD
#      because the ref persists across checkouts).
#   2. Unique branch-prefix match — the seed route used at enter time, before
#      the state ref exists (avoids the chicken-and-egg), and a self-heal
#      fallback if the state ref was lost while exactly one scratchpad branch
#      remains.
scratchpad_active_branch() {
    local matches
    matches="$(git for-each-ref --format='%(refname:short)' "refs/heads/${SCRATCHPAD_BRANCH_PREFIX}")"
    [ -n "$matches" ] || return 0

    if git show-ref --verify --quiet "$SCRATCHPAD_STATE_REF"; then
        local state_tip
        state_tip="$(git rev-parse --verify "$SCRATCHPAD_STATE_REF" 2>/dev/null)" || return 0
        local by_tip
        by_tip="$(git for-each-ref --format='%(refname:short) %(objectname)' \
            "refs/heads/${SCRATCHPAD_BRANCH_PREFIX}" | awk -v tip="$state_tip" '$2 == tip {print $1; exit}')"
        if [ -n "$by_tip" ]; then
            printf '%s' "$by_tip"
            return 0
        fi
    fi

    # Seed/self-heal route: only unambiguous when exactly one branch matches.
    local count
    count="$(printf '%s\n' "$matches" | wc -l)"
    if [ "$count" -eq 1 ]; then
        printf '%s' "$matches"
    fi
}

# scratchpad_base_commit [repo_dir]
# Print the commit the scratchpad was cut from (empty when none).
scratchpad_base_commit() {
    git -C . rev-parse --verify "$SCRATCHPAD_BASE_REF^{commit}" 2>/dev/null || true
}

# scratchpad_require_git_repo
# Die when the current directory is not inside a git work tree.
scratchpad_require_git_repo() {
    git rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
        { echo "Error: not inside a git repository" >&2; return 1; }
}

# scratchpad_is_dirty
# True when the working tree has ANY status output — tracked modifications or
# untracked files. One uniform dirtiness rule; no second class of silent carry.
scratchpad_is_dirty() {
    [ -n "$(git status --porcelain)" ]
}

# scratchpad_working_branch
# Print the currently checked-out branch (empty when detached HEAD).
scratchpad_working_branch() {
    git symbolic-ref --quiet --short HEAD 2>/dev/null || true
}

# scratchpad_validate_slug <slug>
# Slug becomes the branch name suffix; keep it branch-name-safe and terse.
# Consecutive dots are rejected — git check-ref-format forbids them in the
# middle of a refname component and checkout would die with a raw error.
scratchpad_validate_slug() {
    local slug="$1"
    [[ "$slug" =~ ^[a-z0-9][a-z0-9.-]{0,38}$ ]] && [[ "$slug" != *..* ]] ||
        { echo "Error: slug must match [a-z0-9][a-z0-9.-]{0,38} with no '..': '$slug'" >&2; return 1; }
}

# scratchpad_validate_clean_tree
# Enforce the fail-closed entry rule. Prints the refusal guidance and fails
# when the tree is dirty. The guidance names git-wip (recommended, notes the
# push) or a normal commit; stash is deliberately not offered (the AI cannot
# run it; git-unwip does not recover stashes).
scratchpad_validate_clean_tree() {
    if scratchpad_is_dirty; then
        cat >&2 <<'EOF'
Error: working tree is dirty — scratchpad entry is refused (fail-closed).

The sandbox's destructive surface (reset, exit) may only ever touch scratch-
created content; save your work first:
  git wip            (recommended: stages everything, commits "WIP: ..." on this
                      branch, pushes; recover later with git-unwip)
  or: commit normally on this branch.
EOF
        return 1
    fi
}

# scratchpad_snapshot_carry <slug>
# Best-effort safety snapshot of carried work on the --carry path:
# tracked diff + untracked file list into the standard scratchpad carry dir.
# Returns 0 even when the snapshot is partial (it is belt-and-braces; the
# loud warning at entry is the primary guard).
scratchpad_snapshot_carry() {
    local slug="$1"
    local carry_dir
    carry_dir="$(scratchpad_carry_dir)"
    if ! mkdir -p "$carry_dir"; then
        echo "⚠️  WARNING: could not create carry-snapshot dir '$carry_dir' — carried work has NO salvage record." >&2
        return 1
    fi
    local patch="$carry_dir/${slug}-carry.patch"
    {
        echo "# scratchpad carry snapshot — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "# WARNING: scratchpad reset will DESTROY carried work."
        git diff HEAD
        echo ""
        echo "# Untracked files (contents NOT captured — list only):"
        git ls-files --others --exclude-standard
    } > "$patch" 2>/dev/null || {
        echo "⚠️  WARNING: carry-snapshot write FAILED ('$patch') — carried work has NO salvage record." >&2
        return 1
    }
    echo "Carry snapshot: $patch"
}

# scratchpad_origin_branch [repo_dir]
# Print the branch the scratchpad was cut from (empty when none or detached
# at entry — in which case exit/promote fall back to checking out the base
# sha, accepting detached HEAD as the honest restoration).
scratchpad_origin_branch() {
    git -C . rev-parse --verify --quiet "$SCRATCHPAD_ORIGIN_REF" >/dev/null &&
        git symbolic-ref --short "$SCRATCHPAD_ORIGIN_REF" 2>/dev/null || true
}

# scratchpad_record_state <slug> <base_commit> <branch> <origin_branch>
# Cut-point bookkeeping: base ref (recovery target) + state ref (mode marker)
# + originating branch (symref, so exit/promote land back by name — checking
# out the base sha would leave HEAD detached). The base write is a
# compare-and-swap against ABSENT: two concurrent enters race, exactly one
# update-ref succeeds, the loser fails loudly instead of silently overwriting
# the winner's refs (the C4 TOCTOU fix). origin_branch may be empty (entry
# from detached HEAD): no symref is written and return-to-base falls back to
# the base sha.
scratchpad_record_state() {
    local slug="$1" base="$2" branch="$3" origin="$4"
    local absent="0000000000000000000000000000000000000000"
    if ! git update-ref "$SCRATCHPAD_BASE_REF" "$base" "$absent" 2>/dev/null; then
        echo "Error: a scratchpad was activated concurrently — refusing to overwrite its state. Existing: $(scratchpad_active_branch)" >&2
        return 1
    fi
    local tip
    tip="$(git rev-parse --verify "refs/heads/$branch")" || return 1
    git update-ref "$SCRATCHPAD_STATE_REF" "$tip"
    if [ -n "$origin" ]; then
        git symbolic-ref "$SCRATCHPAD_ORIGIN_REF" "refs/heads/$origin"
    else
        git update-ref -d "$SCRATCHPAD_ORIGIN_REF" 2>/dev/null || true
    fi
}

# scratchpad_sync_state_ref
# Point the state ref at the active scratch branch's current tip. Called after
# commits/promotes so branch discovery by tip-match stays correct.
scratchpad_sync_state_ref() {
    local branch
    branch="$(scratchpad_active_branch)" || return 0
    [ -n "$branch" ] || return 0
    local tip
    tip="$(git rev-parse --verify "refs/heads/$branch")" || return 0
    git update-ref "$SCRATCHPAD_STATE_REF" "$tip"
}

# scratchpad_clear_state
# Remove the metadata refs when a scratchpad exits.
scratchpad_clear_state() {
    git update-ref -d "$SCRATCHPAD_BASE_REF" 2>/dev/null || true
    git update-ref -d "$SCRATCHPAD_STATE_REF" 2>/dev/null || true
    git update-ref -d "$SCRATCHPAD_ORIGIN_REF" 2>/dev/null || true
}

# scratchpad_return_to_base
# Land back on the originating branch by name when known (HEAD stays
# symbolic); fall back to the base sha (detached — the honest restoration
# when entry happened from a detached HEAD). Prints which shape was used.
scratchpad_return_to_base() {
    local base
    base="$(scratchpad_base_commit)"
    local origin
    origin="$(scratchpad_origin_branch)"
    if [ -n "$origin" ] && git show-ref --verify --quiet "refs/heads/$origin"; then
        git checkout -q "$origin"
        echo "Returned to branch $origin"
    else
        git checkout -q "$base"
        echo "Returned to base commit $(git rev-parse --short "$base") (detached — entry was from a detached HEAD)"
    fi
}

# scratchpad_bisect_in_flight [repo_dir]
# True when a git bisect session is mid-flight (refs/bisect present). reset
# and exit must refuse (or the caller must abort the bisect) in this state —
# bisect owns HEAD during its walk.
scratchpad_bisect_in_flight() {
    git show-ref --verify --quiet refs/bisect/start
}
