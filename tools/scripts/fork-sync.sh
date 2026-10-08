#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# fork-sync.sh - On-demand sync against the configured
# upstream remote (see docs/Forking.md).
#
set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/fork.bash"
source "$DEVENV_TOOLS/lib/change-id.bash"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<'HELP'
fork-sync.sh — report or rebase against the configured upstream

Fetches `upstream` and reports ahead/behind counts and commits by default;
it does not rebase or push unless explicitly requested. `--rebase` rebases
the current branch onto `upstream/<branch>` without merge commits. On a
conflict, it prints `git rebase --abort` guidance and exits without pushing.
`--push-to-origin` uses a normal fast-forward push. If `origin` has commits
missing locally, it refuses unless paired with `--rewrite-origin`; that
explicit path uses `--force-with-lease`. `--yes` confirms without a prompt;
otherwise a TTY gets a `y/N` prompt and non-TTY use fails closed.
`--dry-run` reports the planned operations.

Divergent commits are matched against the other side by Change-Id trailer,
patch-equivalence, subject, or (for upstream-only commits) already being reachable
from a local branch or tag, in both directions, so a contribution upstream squash-
or rebase-merged back, or dropped from HEAD by a history rewrite, doesn't read as
new work; the action-needed verdict is based on what's left unrecognized.

Refuses to start on top of an unfinished rebase/am, merge, or cherry-pick, and
refuses when HEAD and upstream share no common history (a misconfigured
upstream_repo). `--rebase` additionally refuses a dirty working tree and local
history that contains a merge commit since the upstream merge-base (a default
rebase does not replay it faithfully).

USAGE
    fork-sync [--dry-run] [--rebase] [--push-to-origin [--rewrite-origin]] [--yes]
HELP
    exit 0
fi

devenv_ensure_root "${BASH_SOURCE[0]}"
fork_load_config

DRY_RUN=0
REBASE=0
PUSH=0
REWRITE_ORIGIN=0
YES=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --rebase) REBASE=1 ;;
        --push-to-origin) PUSH=1 ;;
        --rewrite-origin) REWRITE_ORIGIN=1 ;;
        --yes) YES=1 ;;
        *) die "unknown option: $1" "$EXIT_MISUSE" ;;
    esac
    shift
done

[ "$YES" -eq 0 ] || [ "$PUSH" -eq 1 ] || die "--yes requires --push-to-origin" "$EXIT_MISUSE"
[ "$REWRITE_ORIGIN" -eq 0 ] || [ "$PUSH" -eq 1 ] || die "--rewrite-origin requires --push-to-origin" "$EXIT_MISUSE"
if [ "$PUSH" -eq 1 ] && [ "$YES" -eq 0 ] && [ ! -t 0 ]; then
    die "non-TTY --push-to-origin requires --yes" "$EXIT_MISUSE"
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run fork-sync.sh from inside a git repository" "$EXIT_GENERAL_ERROR"

# Refuse to start on top of an unfinished git operation: a prior rebase/am, merge, or
# cherry-pick left state a fresh fetch/rebase/push would not account for.
git -C "$REPO_ROOT" rev-parse --verify --quiet MERGE_HEAD >/dev/null && die "a merge is already in progress; finish it (git -C $REPO_ROOT merge --continue) or abort it (--abort) before syncing" "$EXIT_GENERAL_ERROR"
git -C "$REPO_ROOT" rev-parse --verify --quiet CHERRY_PICK_HEAD >/dev/null && die "a cherry-pick is already in progress; finish it (git -C $REPO_ROOT cherry-pick --continue) or abort it (--abort) before syncing" "$EXIT_GENERAL_ERROR"
for state_dir in rebase-merge rebase-apply; do
    git_state_path="$(git -C "$REPO_ROOT" rev-parse --git-path "$state_dir")"
    [ ! -d "$git_state_path" ] || die "a rebase (or 'git am') is already in progress; finish it (--continue) or abort it (--abort) before syncing" "$EXIT_GENERAL_ERROR"
done

UPSTREAM_URL="$(git -C "$REPO_ROOT" remote get-url upstream 2>/dev/null || true)"
[ -n "$UPSTREAM_URL" ] || die "upstream remote is missing; run fork-setup.sh first" "$EXIT_GENERAL_ERROR"
fork_upstream_matches "$REPO_ROOT" || die "upstream remote URL does not match [fork] upstream_repo" "$EXIT_GENERAL_ERROR"

CURRENT_BRANCH="$(git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || printf 'HEAD')"
if [ "$REBASE" -eq 1 ]; then
    [ "$CURRENT_BRANCH" != "HEAD" ] || die "cannot rebase while HEAD is detached" "$EXIT_GENERAL_ERROR"
    [ -z "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ] || die "working tree has uncommitted changes; commit, stash, or discard them before --rebase" "$EXIT_GENERAL_ERROR"
fi

UPSTREAM_REF="refs/remotes/upstream/$FORK_UPSTREAM_BRANCH"
if [ "$DRY_RUN" -eq 1 ]; then
    echo "dry run: would fetch upstream and compare HEAD with upstream/$FORK_UPSTREAM_BRANCH"
    if [ "$REBASE" -eq 1 ]; then
        echo "dry run: would rebase the current branch onto upstream/$FORK_UPSTREAM_BRANCH"
    fi
    if [ "$REWRITE_ORIGIN" -eq 1 ]; then
        echo "dry run: would allow an explicit origin history rewrite if required"
    fi
    exit 0
fi

git -C "$REPO_ROOT" fetch --prune upstream || die "failed to fetch upstream" "$EXIT_GENERAL_ERROR"
git -C "$REPO_ROOT" show-ref --verify --quiet "$UPSTREAM_REF" || die "upstream branch '$FORK_UPSTREAM_BRANCH' was not fetched" "$EXIT_GENERAL_ERROR"
BASE_SHA="$(git -C "$REPO_ROOT" merge-base "$UPSTREAM_REF" HEAD 2>/dev/null)" || die "HEAD and upstream/$FORK_UPSTREAM_BRANCH share no common history; check [fork] upstream_repo" "$EXIT_GENERAL_ERROR"

# Change-Ids (the prepare-commit-msg trailer) carried by commits in RANGE, one per
# line; commits without one are skipped. Survives rewording and content edits, so it
# catches contributions upstream reworked or squashed in ways patch-equivalence and
# subject matching miss.
#
# Usage: collect_change_ids REPO RANGE
collect_change_ids() {
    local repo="$1" range="$2" message id
    while IFS= read -r -d '' message; do
        id="$(change_id_get_from_message "$message" || true)"
        [ -z "$id" ] || printf '%s\n' "$id"
    done < <(git -C "$repo" log -z --format=%B "$range")
}

# Local commits that look as if upstream already has them: a patch-equivalent
# commit (git cherry marks it "-"), one carrying the same Change-Id trailer, or one
# whose subject also appears on upstream since the merge base (a contributed commit
# upstream may have edited). A rebase drops the first kind on its own; the others
# stay and may conflict, so they are named before anything is rewritten.
#
# Usage: report_likely_upstreamed BASE_SHA
report_likely_upstreamed() {
    local base="$1" sha subject id upstream_subjects upstream_ids found=0 line
    upstream_subjects="$(git -C "$REPO_ROOT" log --format=%s "$base..$UPSTREAM_REF")"
    upstream_ids="$(collect_change_ids "$REPO_ROOT" "$base..$UPSTREAM_REF")"
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        sha="${line#* }"
        subject="$(git -C "$REPO_ROOT" log -1 --format=%s "$sha")"
        id="$(change_id_get_from_commit "$REPO_ROOT" "$sha" || true)"
        if [ "${line%% *}" = "-" ] || { [ -n "$id" ] && grep -qxF -- "$id" <<< "$upstream_ids"; } || grep -qxF -- "$subject" <<< "$upstream_subjects"; then
            if [ "$found" -eq 0 ]; then
                echo "Local commits that look already upstream (patch-equivalent, same Change-Id, or the same subject on upstream):"
                found=1
            fi
            printf '  %s %s\n' "$(git -C "$REPO_ROOT" rev-parse --short "$sha")" "$subject"
        fi
    done < <(git -C "$REPO_ROOT" cherry "$UPSTREAM_REF" HEAD)
    if [ "$found" -eq 1 ]; then
        echo "  A rebase drops patch-equivalent commits itself; for the others, drop them by hand if upstream has them."
    fi
}

# Whether SHA is already reachable from some local branch or tag -- the exact same
# commit object, not just an equivalent one. Catches a commit dropped from HEAD's
# ancestry by a history rewrite (e.g. --rewrite-origin) while an old tag still holds it;
# patch-equivalence and subject matching only look at HEAD's current ancestry, so they
# miss this case entirely.
#
# Usage: known_by_other_ref REPO SHA
known_by_other_ref() {
    [ -n "$(git -C "$1" for-each-ref --contains "$2" --format='%(refname)' refs/heads refs/tags refs/remotes/origin 2>/dev/null)" ]
}

# Upstream-only commits that look like your own work coming back (a squash-merge or
# a rebase-merge of a local contribution): the mirror of report_likely_upstreamed.
# Sets UNRECOGNIZED_BEHIND to the count of upstream commits none of the four
# signals recognizes, which is what should actually drive an "action needed" verdict.
#
# Usage: report_likely_local BASE_SHA
report_likely_local() {
    local base="$1" sha subject id local_subjects local_ids found=0 line
    UNRECOGNIZED_BEHIND=0
    local_subjects="$(git -C "$REPO_ROOT" log --format=%s "$base..HEAD")"
    local_ids="$(collect_change_ids "$REPO_ROOT" "$base..HEAD")"
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        sha="${line#* }"
        subject="$(git -C "$REPO_ROOT" log -1 --format=%s "$sha")"
        id="$(change_id_get_from_commit "$REPO_ROOT" "$sha" || true)"
        if [ "${line%% *}" = "-" ] || { [ -n "$id" ] && grep -qxF -- "$id" <<< "$local_ids"; } || grep -qxF -- "$subject" <<< "$local_subjects" || known_by_other_ref "$REPO_ROOT" "$sha"; then
            if [ "$found" -eq 0 ]; then
                echo "Upstream commits that look like your own work (patch-equivalent, same Change-Id, same subject locally, or already reachable from a local branch/tag):"
                found=1
            fi
            printf '  %s %s\n' "$(git -C "$REPO_ROOT" rev-parse --short "$sha")" "$subject"
        else
            UNRECOGNIZED_BEHIND=$((UNRECOGNIZED_BEHIND + 1))
        fi
    done < <(git -C "$REPO_ROOT" cherry HEAD "$UPSTREAM_REF")
}

report_likely_upstreamed "$BASE_SHA"
report_likely_local "$BASE_SHA"

if [ "$PUSH" -eq 1 ] && [ "$REBASE" -eq 0 ]; then
    PUSH_COUNTS="$(git -C "$REPO_ROOT" rev-list --left-right --count "$UPSTREAM_REF...HEAD")" || die "failed to compare HEAD with upstream/$FORK_UPSTREAM_BRANCH" "$EXIT_GENERAL_ERROR"
    read -r PUSH_BEHIND _ <<< "$PUSH_COUNTS"
    [ "$PUSH_BEHIND" -eq 0 ] || die "branch is behind upstream; pass --rebase before --push-to-origin" "$EXIT_MISUSE"
fi

if [ "$REBASE" -eq 1 ]; then
    merges="$(git -C "$REPO_ROOT" --no-pager log --merges --format='  %h %s' "$BASE_SHA..HEAD")"
    if [ -n "$merges" ]; then
        {
            echo "local history since the upstream merge-base contains merge commit(s), which a default rebase does not replay faithfully:"
            echo "$merges"
            echo "Restructure the branch (or rebase it onto upstream yourself with --rebase-merges) before syncing."
        } >&2
        exit "$EXIT_MISUSE"
    fi
    if ! git -C "$REPO_ROOT" rebase "$UPSTREAM_REF"; then
        if git -C "$REPO_ROOT" rev-parse --verify --quiet REBASE_HEAD >/dev/null; then
            echo "Rebase conflict. Resolve the conflicts or return to the pre-rebase state with:" >&2
            printf '  git -C %q rebase --abort\n' "$REPO_ROOT" >&2
            exit "$EXIT_GENERAL_ERROR"
        fi
        die "rebase onto upstream/$FORK_UPSTREAM_BRANCH failed" "$EXIT_GENERAL_ERROR"
    fi
    echo "Rebased $CURRENT_BRANCH onto upstream/$FORK_UPSTREAM_BRANCH"
fi

COUNTS="$(git -C "$REPO_ROOT" rev-list --left-right --count "$UPSTREAM_REF...HEAD")" || die "failed to compare HEAD with upstream/$FORK_UPSTREAM_BRANCH" "$EXIT_GENERAL_ERROR"
read -r BEHIND AHEAD <<< "$COUNTS"

echo "Upstream: upstream/$FORK_UPSTREAM_BRANCH"
echo "Current: $CURRENT_BRANCH"
echo "Behind: $BEHIND"
echo "Ahead: $AHEAD"
if [ "$BEHIND" -eq 0 ] && [ "$AHEAD" -eq 0 ]; then
    echo "No divergent commits. Up to date -- nothing to sync."
else
    echo "Divergent commits (< upstream-only, > local-only):"
    git -C "$REPO_ROOT" --no-pager log --oneline --left-right --no-color "$UPSTREAM_REF...HEAD" || die "failed to list divergent commits" "$EXIT_GENERAL_ERROR"
    if [ "$BEHIND" -eq 0 ]; then
        echo "No action needed: local-only commits, nothing to pull from upstream."
    elif [ "$UNRECOGNIZED_BEHIND" -gt 0 ]; then
        echo "Action needed: upstream has $UNRECOGNIZED_BEHIND commit(s) that don't look like your own work -- run 'fork-sync --rebase' to sync."
    else
        echo "No urgent action needed: all $BEHIND upstream-only commit(s) look like your own contributions coming back; 'fork-sync --rebase' would still canonicalize the hashes if you want."
    fi
fi

if [ "$PUSH" -eq 1 ]; then
    [ "$CURRENT_BRANCH" != "HEAD" ] || die "cannot push while HEAD is detached" "$EXIT_GENERAL_ERROR"
    ORIGIN_URL="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
    [ -n "$ORIGIN_URL" ] || die "origin remote is missing" "$EXIT_GENERAL_ERROR"
    UPSTREAM_DESTINATION="$(fork_normalize_git_url "$FORK_UPSTREAM_REPO")"
    while IFS= read -r origin_push_url; do
        [ -n "$origin_push_url" ] || continue
        if [ "$(fork_normalize_git_url "$origin_push_url")" = "$UPSTREAM_DESTINATION" ]; then
            die "origin push destination matches configured upstream; refusing to push" "$EXIT_MISUSE"
        fi
    done < <(git -C "$REPO_ROOT" remote get-url --push --all origin)
    git -C "$REPO_ROOT" fetch --prune origin || die "failed to fetch origin" "$EXIT_GENERAL_ERROR"

    ORIGIN_REF="refs/remotes/origin/$CURRENT_BRANCH"
    git -C "$REPO_ROOT" show-ref --verify --quiet "$ORIGIN_REF" || die "origin branch '$CURRENT_BRANCH' was not fetched; cannot establish a push lease" "$EXIT_GENERAL_ERROR"
    ORIGIN_EXPECTED_SHA="$(git -C "$REPO_ROOT" rev-parse "$ORIGIN_REF")" || die "failed to resolve origin/$CURRENT_BRANCH" "$EXIT_GENERAL_ERROR"
    ORIGIN_COUNTS="$(git -C "$REPO_ROOT" rev-list --left-right --count "$ORIGIN_EXPECTED_SHA...HEAD")" || die "failed to compare HEAD with origin/$CURRENT_BRANCH" "$EXIT_GENERAL_ERROR"
    read -r ORIGIN_AHEAD LOCAL_AHEAD <<< "$ORIGIN_COUNTS"

    echo "Origin: origin/$CURRENT_BRANCH"
    echo "Origin ahead: $ORIGIN_AHEAD"
    echo "Local ahead of origin: $LOCAL_AHEAD"
    if [ "$ORIGIN_AHEAD" -gt 0 ]; then
        echo "Origin-only commits (< origin-only, > local-only):"
        git -C "$REPO_ROOT" --no-pager log --oneline --left-right --no-color "$ORIGIN_EXPECTED_SHA...HEAD" || die "failed to list origin divergence" "$EXIT_GENERAL_ERROR"
        [ "$REWRITE_ORIGIN" -eq 1 ] || die "origin contains commits absent locally; use --rewrite-origin with --push-to-origin to replace them" "$EXIT_MISUSE"
        echo "WARNING: --rewrite-origin will replace origin-only commits on origin/$CURRENT_BRANCH."
    fi

    if [ "$LOCAL_AHEAD" -eq 0 ]; then
        echo "No push needed; origin already contains the current branch."
        exit 0
    fi

    if [ "$YES" -eq 0 ]; then
        PUSH_CONFIRM=""
        if [ "$ORIGIN_AHEAD" -gt 0 ]; then
            read -r -p "Replace origin-only commits on origin/$CURRENT_BRANCH? [y/N] " PUSH_CONFIRM < /dev/tty
        else
            read -r -p "Proceed with push? [y/N] " PUSH_CONFIRM < /dev/tty
        fi
        case "$PUSH_CONFIRM" in
            [Yy]*) ;;
            *) echo "Push cancelled."; exit 0 ;;
        esac
    fi

    if [ "$ORIGIN_AHEAD" -gt 0 ]; then
        git -C "$REPO_ROOT" push "--force-with-lease=refs/heads/$CURRENT_BRANCH:$ORIGIN_EXPECTED_SHA" origin "HEAD:refs/heads/$CURRENT_BRANCH" || die "lease-protected rewrite of origin/$CURRENT_BRANCH failed" "$EXIT_GENERAL_ERROR"
        echo "Rewrote origin/$CURRENT_BRANCH with --force-with-lease"
    else
        git -C "$REPO_ROOT" push origin "HEAD:refs/heads/$CURRENT_BRANCH" || die "fast-forward push to origin/$CURRENT_BRANCH failed" "$EXIT_GENERAL_ERROR"
        echo "Pushed current branch to origin/$CURRENT_BRANCH"
    fi
fi
