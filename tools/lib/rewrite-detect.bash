#!/usr/bin/env bash
# rewrite-detect.bash - Classify a clone's branch against a history-rewritten
# remote (the fork master after fork-sync --replay + force-push). One scan,
# shared by git-update, check-update-devenv-repo.sh and bootstrap's
# devenv-update, so the reachability conditions live in exactly one place.

# Guard against multiple sourcing
if [ -n "${_REWRITE_DETECT_LIB_LOADED:-}" ]; then
    return 0
fi
_REWRITE_DETECT_LIB_LOADED=1

# Reflog entries scanned for a past remote tip. Same cap the original
# detection in check-update-devenv-repo.sh used.
readonly REWRITE_DETECT_REFLOG_DEPTH=50

# Classify the current branch against its upstream remote-tracking ref.
#
# The branch has diverged from its upstream when LOCAL != REMOTE and neither
# side is an ancestor of the other (the ordinary pull states — up to date,
# strictly behind, strictly ahead — are the caller's business and are not
# classified here). Among diverged states:
#
#   clean    — local HEAD IS a past remote tip recorded in the remote-tracking
#              ref's reflog: the remote was rewritten and this clone kept
#              nothing unique, so a hard reset to the remote is safe. The past
#              tip is echoed as the second field (the pre-rewrite base).
#   diverged — local HEAD has unique commits (it is not any recorded past
#              remote tip): the clone has work to preserve, so the update is
#              a rebase, not a reset.
#   none     — not diverged at all, or no rewritten past tip could be
#              identified (includes shallow clones, whose missing objects make
#              the reachability tests fail — they read as "not rewritten").
#
# Output: "<verdict> [past-tip]" on stdout (past-tip only for clean/diverged).
# Returns 0 in all classified states; callers treat the output as the contract.
#
# Usage: rewrite_detect_state <branch>
# Requires: run inside the repository; the branch's remote-tracking ref
# (<branch> here means the local branch whose upstream is origin/<branch>).
rewrite_detect_state() {
    local branch="$1"
    local local_hash remote_hash
    if ! local_hash="$(git rev-parse "$branch" 2>/dev/null)"; then echo "none"; return 0; fi
    if ! remote_hash="$(git rev-parse "origin/$branch" 2>/dev/null)"; then echo "none"; return 0; fi

    # Not diverged: nothing for this classifier to say. (Probes in if ! form:
    # safe under set -e, where an exit-1 "no" answer is data, not failure.)
    if [ "$local_hash" = "$remote_hash" ]; then echo "none"; return 0; fi
    if ! git merge-base --is-ancestor "$local_hash" "$remote_hash" 2>/dev/null; then :; else echo "none"; return 0; fi
    if ! git merge-base --is-ancestor "$remote_hash" "$local_hash" 2>/dev/null; then :; else echo "none"; return 0; fi

    # Diverged. Look for a past remote tip that explains it: recorded in the
    # remote-tracking ref's reflog, an ancestor of local HEAD (so this clone
    # built on it), no longer reachable from the rewritten remote, and still
    # present as an object. Every probe ends in || true / if ! form: the lib
    # must stay safe to source under set -e, where "not an ancestor" (exit 1)
    # would otherwise kill the sourcing shell.
    local tip found_tip="" is_ancestor not_ancestor
    while IFS= read -r tip; do
        [ -n "$tip" ] && [ "$tip" != "$remote_hash" ] || continue
        is_ancestor=0; not_ancestor=0
        git merge-base --is-ancestor "$tip" "$local_hash" 2>/dev/null && is_ancestor=1 || true
        git merge-base --is-ancestor "$tip" "$remote_hash" 2>/dev/null && not_ancestor=1 || true
        if [ "$is_ancestor" -eq 1 ] && [ "$not_ancestor" -eq 0 ] \
            && git cat-file -e "${tip}^{commit}" 2>/dev/null || true; then
            if [ "$is_ancestor" -eq 1 ] && [ "$not_ancestor" -eq 0 ]; then
                found_tip="$tip"
                break
            fi
        fi
    done <<EOF
$(git reflog show --format=%H "origin/$branch" 2>/dev/null | head -n "$REWRITE_DETECT_REFLOG_DEPTH")
EOF

    if [ -z "$found_tip" ]; then
        echo "none"
        return 0
    fi

    # The safety split: local HEAD equal to the past tip means this clone has
    # nothing the rewritten remote lacks — reset is lossless. Anything else
    # (HEAD a descendant of the tip with unique work) needs a rebase.
    if [ "$local_hash" = "$found_tip" ]; then
        echo "clean $found_tip"
    else
        echo "diverged $found_tip"
    fi
    return 0
}
