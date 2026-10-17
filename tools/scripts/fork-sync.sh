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
source "$DEVENV_TOOLS/lib/fork-twin.bash"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<'HELP'
fork-sync.sh — report or apply upstream's new commits against the configured upstream

Fetches `upstream` and reports ahead/behind counts and commits by default;
it does not change history or push unless explicitly requested. `--replay`
applies `upstream/<branch>`'s new commits on top of the branch (commits the
branch already has are skipped, not re-applied; the branch's own SHAs never
move, so `--push-to-origin` stays a fast-forward). On a conflict, it prints
`git cherry-pick --abort` guidance and exits without pushing — abort returns
the branch to its exact pre-sync state.
`--push-to-origin` uses a normal fast-forward push. If `origin` has commits
missing locally, it refuses unless paired with `--rewrite-origin`; that
explicit path uses `--force-with-lease`. Applying commits requires
confirmation: `--yes` confirms without a prompt; otherwise a TTY gets a
`y/N` prompt and non-TTY use fails closed. `--dry-run` reports the planned
operations.

Divergent commits are matched against the other side by Change-Id trailer,
patch-equivalence, subject, or (for upstream-only commits) already being reachable
from a local branch or tag, in both directions, so a contribution upstream squash-
or rebase-merged back, or dropped from HEAD by a history rewrite, doesn't read as
new work; the action-needed verdict is based on what's left unrecognized.

Refuses to start on top of an unfinished rebase/am, merge, or cherry-pick, and
refuses when HEAD and upstream share no common history (a misconfigured
upstream_repo). `--replay` additionally refuses a dirty working tree and local
history that contains a merge commit since the upstream merge-base (replay
only handles linear history).

Commits exported upstream before Change-Ids existed cannot be matched by
trailer. `fork-sync --link <local> <upstream>` records one confirmed pair in
the adoption map; `fork-sync --propose-links` ranks candidate pairs (subject,
author date, file set) and asks for confirmation per pair on a TTY — without
one it prints the ranked candidates and the exact `--link` commands.

USAGE
    fork-sync [--dry-run] [--replay] [--push-to-origin [--rewrite-origin]] [--yes]
    fork-sync --link <local-commit> <upstream-commit>
    fork-sync --unlink <local-or-upstream-sha>
    fork-sync --drift
    fork-sync --propose-links
HELP
    exit 0
fi

devenv_ensure_root "${BASH_SOURCE[0]}"
fork_load_config

DRY_RUN=0
REPLAY=0
PUSH=0
REWRITE_ORIGIN=0
YES=0
LINK_LOCAL=""
LINK_UPSTREAM=""
UNLINK_SHA=""
PROPOSE_LINKS=0
DRIFT=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --replay) REPLAY=1 ;;
        --push-to-origin) PUSH=1 ;;
        --rewrite-origin) REWRITE_ORIGIN=1 ;;
        --yes) YES=1 ;;
        --link)
            require_option_value "$1" "${2:-}"
            require_option_value "$1" "${3:-}"
            LINK_LOCAL="$2"
            LINK_UPSTREAM="$3"
            shift 2
            ;;
        --propose-links) PROPOSE_LINKS=1 ;;
        --drift) DRIFT=1 ;;
        --unlink)
            require_option_value "$1" "${2:-}"
            UNLINK_SHA="$2"
            shift
            ;;
        --rebase) die "--rebase was renamed --replay (the sync applies upstream's commits on top of the branch; it no longer describes itself as a rebase)" "$EXIT_MISUSE" ;;
        *) die "unknown option: $1" "$EXIT_MISUSE" ;;
    esac
    shift
done

[ "$YES" -eq 0 ] || { [ "$PUSH" -eq 1 ] || [ "$REPLAY" -eq 1 ]; } || die "--yes requires --push-to-origin or --replay" "$EXIT_MISUSE"
[ -z "$LINK_LOCAL" ] || { [ "$REPLAY" -eq 0 ] && [ "$PUSH" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ "$PROPOSE_LINKS" -eq 0 ] && [ -z "$UNLINK_SHA" ]; } || die "--link runs alone" "$EXIT_MISUSE"
[ "$PROPOSE_LINKS" -eq 0 ] || { [ "$REPLAY" -eq 0 ] && [ "$PUSH" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ -z "$LINK_LOCAL" ] && [ -z "$UNLINK_SHA" ]; } || die "--propose-links runs alone" "$EXIT_MISUSE"
[ "$DRIFT" -eq 0 ] || { [ "$REPLAY" -eq 0 ] && [ "$PUSH" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ "$PROPOSE_LINKS" -eq 0 ] && [ -z "$LINK_LOCAL" ] && [ -z "$UNLINK_SHA" ]; } || die "--drift runs alone" "$EXIT_MISUSE"
[ -z "$UNLINK_SHA" ] || { [ "$REPLAY" -eq 0 ] && [ "$PUSH" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ -z "$LINK_LOCAL" ] && [ "$PROPOSE_LINKS" -eq 0 ]; } || die "--unlink runs alone" "$EXIT_MISUSE"
[ "$REWRITE_ORIGIN" -eq 0 ] || [ "$PUSH" -eq 1 ] || die "--rewrite-origin requires --push-to-origin" "$EXIT_MISUSE"
if [ "$PUSH" -eq 1 ] && [ "$YES" -eq 0 ] && [ ! -t 0 ]; then
    die "non-TTY --push-to-origin requires --yes" "$EXIT_MISUSE"
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run fork-sync.sh from inside a git repository" "$EXIT_GENERAL_ERROR"

# ---------------------------------------------------------------------------
# Adoption-map paths (--link / --propose-links): they need both repos' object
# stores — the local one for the fork side, the upstream clone for upstream
# SHAs. The upstream clone is discovered the same way fork-export finds it: a
# unique repos/ clone whose origin matches [fork] upstream_repo, or
# FORK_UPSTREAM_CLONE set explicitly.
# ---------------------------------------------------------------------------
# Discover the upstream clone: FORK_UPSTREAM_CLONE explicitly, or the unique
# repos/ clone whose origin matches [fork] upstream_repo. Prints the root or
# nothing.
#
# Usage: discover_upstream_clone
discover_upstream_clone() {
    if [ -n "${FORK_UPSTREAM_CLONE:-}" ]; then
        printf '%s\n' "$FORK_UPSTREAM_CLONE"
        return 0
    fi
    local config_target candidate candidate_root candidate_origin
    config_target="$(fork_normalize_git_url "$FORK_UPSTREAM_REPO")"
    local matches=()
    for candidate in "$REPO_ROOT"/repos/*; do
        [ -d "$candidate" ] || continue
        candidate_root="$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null || true)"
        [ -n "$candidate_root" ] && [ "$candidate_root" != "$REPO_ROOT" ] || continue
        candidate_origin="$(git -C "$candidate_root" remote get-url origin 2>/dev/null || true)"
        [ -n "$candidate_origin" ] || continue
        [ "$(fork_normalize_git_url "$candidate_origin")" = "$config_target" ] || continue
        matches+=("$candidate_root")
    done
    if [ "${#matches[@]}" -eq 1 ]; then
        printf '%s\n' "${matches[0]}"
    fi
}

if [ -n "$UNLINK_SHA" ]; then
    UPSTREAM_URL="$(git -C "$REPO_ROOT" remote get-url upstream 2>/dev/null || true)"
    [ -n "$UPSTREAM_URL" ] || die "upstream remote is missing; run fork-setup.sh first" "$EXIT_GENERAL_ERROR"
    if fork_twin_map_remove "$REPO_ROOT" "$UNLINK_SHA"; then
        echo "removed adoption pair(s) naming $UNLINK_SHA"
    else
        die "no adoption-map entry matches: $UNLINK_SHA" "$EXIT_MISUSE"
    fi
    exit 0
fi

if [ -n "$LINK_LOCAL" ] || [ "$PROPOSE_LINKS" -eq 1 ]; then
    UPSTREAM_URL="$(git -C "$REPO_ROOT" remote get-url upstream 2>/dev/null || true)"
    [ -n "$UPSTREAM_URL" ] || die "upstream remote is missing; run fork-setup.sh first" "$EXIT_GENERAL_ERROR"
    fork_upstream_matches "$REPO_ROOT" || die "upstream remote URL does not match [fork] upstream_repo" "$EXIT_GENERAL_ERROR"
    FORK_TWIN_LOCAL_REPO="$REPO_ROOT"
    UPSTREAM_REPO_ROOT="$(discover_upstream_clone)"
    [ -n "$UPSTREAM_REPO_ROOT" ] || die "could not identify the upstream clone (set FORK_UPSTREAM_CLONE, or keep exactly one matching clone under repos/)" "$EXIT_MISUSE"
    FORK_TWIN_UPSTREAM_REPO="$UPSTREAM_REPO_ROOT"

    MAP_PATH="$(fork_twin_map_get_path "$REPO_ROOT")"
    if [ -n "$LINK_LOCAL" ]; then
        fork_twin_map_add "$REPO_ROOT" "$LINK_LOCAL" "$LINK_UPSTREAM" \
            || die "could not record the adoption pair" "$EXIT_GENERAL_ERROR"
        echo "recorded adoption pair: $LINK_LOCAL <-> $LINK_UPSTREAM"
        exit 0
    fi

    # --propose-links: rank candidates and confirm. TTY asks per pair; a
    # non-TTY run prints the ranked candidates and the exact --link commands.
    git -C "$REPO_ROOT" fetch --prune upstream >/dev/null 2>&1 || true
    UPSTREAM_TIP="$(git -C "$FORK_TWIN_UPSTREAM_REPO" rev-parse HEAD)"
    BASE="$(git -C "$REPO_ROOT" merge-base upstream/"$FORK_UPSTREAM_BRANCH" HEAD 2>/dev/null)" || die "HEAD and upstream share no common history" "$EXIT_GENERAL_ERROR"
    CANDIDATES="$(fork_twin_map_propose "$BASE..HEAD" "$BASE..$UPSTREAM_TIP")"
    [ -n "$CANDIDATES" ] || { echo "no adoption candidates found (every unlinked local commit lacks a plausible upstream twin)"; exit 0; }
    if [ -t 0 ] && [ -t 1 ]; then
        CONFIRMED=0
        while read -r score l_sha u_sha subject; do
            [ -n "${score:-}" ] || continue
            echo "---"
            echo "score $score: $subject"
            echo "  local:    $l_sha"
            echo "  upstream: $u_sha"
            fork_twin_map_lookup_local "$MAP_PATH" "$l_sha" >/dev/null 2>&1 && { echo "  already recorded; skipping"; continue; }
            read -r -p "  link this pair? [y/N] " answer < /dev/tty || answer=""
            case "$answer" in
                [Yy]*)
                    fork_twin_map_add "$REPO_ROOT" "$l_sha" "$u_sha" "$subject" || die "could not record the adoption pair" "$EXIT_GENERAL_ERROR"
                    CONFIRMED=$((CONFIRMED + 1))
                    ;;
            esac
        done <<< "$CANDIDATES"
        echo "---"
        echo "$CONFIRMED pair(s) recorded."
    else
        echo "Adoption candidates (score, local, upstream, subject) — record with fork-sync --link:"
        printf '%s\n' "$CANDIDATES" | while read -r score l_sha u_sha subject; do
            [ -n "${score:-}" ] || continue
            printf '  fork-sync --link %s %s   # %s\n' "$l_sha" "$u_sha" "$subject"
        done
    fi
    exit 0
fi

# --drift: standing drift inventory. Reports fork-local modifications on
# upstream-stable paths — maintenance cost the fork carries by choice. Read-only;
# fetches nothing. A path matching no declared surface is upstream-stable by
# default, so only paths matching a fork-stable or fork-replaced glob are
# excluded from the inventory.
if [ "$DRIFT" -eq 1 ]; then
    source "$DEVENV_TOOLS/lib/fork-surfaces.bash"
    fork_surfaces_validate >/dev/null || die "fork-surfaces declaration is invalid" "$EXIT_GENERAL_ERROR"

    UPSTREAM_URL="$(git -C "$REPO_ROOT" remote get-url upstream 2>/dev/null || true)"
    [ -n "$UPSTREAM_URL" ] || die "upstream remote is missing; run fork-setup.sh first" "$EXIT_GENERAL_ERROR"
    fork_upstream_matches "$REPO_ROOT" || die "upstream remote URL does not match [fork] upstream_repo" "$EXIT_GENERAL_ERROR"

    # Compare local vs upstream tip without fetching: drift is about local
    # edits vs the last-known upstream state; a stale tip says so.
    local_drift_ref="refs/remotes/upstream/$FORK_UPSTREAM_BRANCH"
    if ! git -C "$REPO_ROOT" show-ref --verify --quiet "$local_drift_ref"; then
        die "upstream branch not fetched yet; run fork-sync (without --drift) once to fetch" "$EXIT_GENERAL_ERROR"
    fi

    BASE_DRIFT="$(git -C "$REPO_ROOT" merge-base "$local_drift_ref" HEAD 2>/dev/null)" || die "cannot compute the drift base — is upstream/$FORK_UPSTREAM_BRANCH still fetched and related to HEAD? run fork-sync once to refresh" "$EXIT_GENERAL_ERROR"

    echo "Drift inventory: fork-local edits on upstream-stable paths"
    echo "  (compared against the last-fetched upstream/$FORK_UPSTREAM_BRANCH)"
    DRIFT_COUNT=0
    # Every file the fork side changed since the merge-base.
    while IFS= read -r path; do
        [ -n "$path" ] || continue
        class="$(fork_surfaces_classify "$path")"
        [ "$class" = "upstream-stable" ] || continue
        DRIFT_COUNT=$((DRIFT_COUNT + 1))
        if [ "$DRIFT_COUNT" -eq 1 ]; then
            echo ""
        fi
        echo "  $path"
    done < <(git -C "$REPO_ROOT" diff --name-only "$BASE_DRIFT" HEAD -- . | sort -u)
    if [ "$DRIFT_COUNT" -eq 0 ]; then
        echo "  none — no fork-local edits on upstream-stable paths."
    else
        echo ""
        echo "  $DRIFT_COUNT upstream-stable path(s) carry fork-local edits."
        echo "  These are maintained at the fork's own cost; upstream changes to"
        echo "  them may conflict at sync time."
    fi
    exit 0
fi

# Refuse to start on top of an unfinished git operation: a prior rebase/am, merge, or
# cherry-pick left state a fresh fetch/replay/push would not account for.
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

# ---------------------------------------------------------------------------
# Pick-plan support (apply-upstream-onto-branch direction): classify each
# upstream commit in the pick range merge-base..upstream as apply or skip.
# Upstream commits whose Change-Id already exists on the branch are skipped
# (org rebase merges preserve trailers); adoption-map entries and bounded
# patch-id equivalence cover the rest. Local SHAs never move.
# ---------------------------------------------------------------------------

# Compose the pick plan. Fills:
#   PICK_SHAS[]/PICK_VERDICTS[]/PICK_SIGNALS[] — per upstream commit
#   PICK_COUNT (to apply), DROP_COUNT (already on the branch)
#   RESIDUE_LINES[] — divergence notes for skipped upstream commits whose
#     local twin carries a differing patch (local copy stays authoritative;
#     the divergence is named, never silently absorbed)
# Requires BASE_SHA and UPSTREAM_REF; sets FORK_TWIN_LOCAL_REPO/UPSTREAM_REPO.
#
# Usage: build_pick_plan BASE_SHA
build_pick_plan() {
    local base="$1"
    export FORK_TWIN_LOCAL_REPO="$REPO_ROOT"
    FORK_TWIN_UPSTREAM_REPO="${FORK_UPSTREAM_CLONE:-$(discover_upstream_clone)}"
    FORK_TWIN_UPSTREAM_REPO="${FORK_TWIN_UPSTREAM_REPO:-$REPO_ROOT}"
    PICK_SHAS=()
    PICK_VERDICTS=()
    PICK_SIGNALS=()
    PICK_COUNT=0
    DROP_COUNT=0
    RESIDUE_COUNT=0
    RESIDUE_LINES=()
    local line u_sha verdict signal u_id l_sha l_id subject local_twin
    while read -r line; do
        [ -n "$line" ] || continue
        read -r u_sha verdict signal <<< "$line"
        PICK_SHAS+=("$u_sha")
        PICK_VERDICTS+=("$verdict")
        PICK_SIGNALS+=("$signal")
        if [ "$verdict" = "$PICK_VERDICT_PICK" ]; then
            PICK_COUNT=$((PICK_COUNT + 1))
            continue
        fi
        DROP_COUNT=$((DROP_COUNT + 1))
        # Residue: the skipped upstream commit's local twin differs in patch
        # content — name the divergence for review.
        u_id="$(change_id_get_from_commit "${FORK_TWIN_UPSTREAM_REPO}" "$u_sha" 2>/dev/null || true)"
        local_twin=""
        if [ -n "$u_id" ]; then
            while read -r l_sha; do
                [ -n "$l_sha" ] || continue
                l_id="$(change_id_get_from_commit "$REPO_ROOT" "$l_sha" 2>/dev/null || true)"
                if [ "$l_id" = "$u_id" ]; then
                    local_twin="$l_sha"
                    break
                fi
            done < <(git -C "$REPO_ROOT" rev-list "HEAD")
        fi
        if [ -n "$local_twin" ] && ! fork_twin_patches_identical "$local_twin" "$u_sha"; then
            RESIDUE_COUNT=$((RESIDUE_COUNT + 1))
            subject="$(git -C "$REPO_ROOT" log -1 --format='  %h %s' "$u_sha")"
            RESIDUE_LINES+=("$subject — upstream copy differs from your local version (local kept)")
        fi
    done < <(fork_twin_classify_pick_range "$base..$UPSTREAM_REF" "$base..HEAD")
}

# Print the pick plan: every upstream commit with its verdict and twin
# signal, plus divergence notes and the per-surface-class forecast — what the
# applied work touches, bucketed by the fork-stable surfaces contract (AC:
# the sync reports upstream changes per surface class before anything
# merges). Used by --dry-run and the pre-apply report.
#
# Usage: print_pick_plan
print_pick_plan() {
    local i u_sha verdict signal line
    for i in "${!PICK_SHAS[@]}"; do
        u_sha="${PICK_SHAS[$i]}"
        verdict="${PICK_VERDICTS[$i]}"
        signal="${PICK_SIGNALS[$i]}"
        line="$(git -C "$REPO_ROOT" log -1 --format='%h %s' "$u_sha")"
        case "$verdict" in
            "$PICK_VERDICT_PICK")
                echo "  $line — new upstream work, will be applied"
                ;;
            *)
                echo "  $line — already on your branch (via $signal), skipped"
                ;;
        esac
    done
    if [ "$RESIDUE_COUNT" -gt 0 ]; then
        echo "Divergence on skipped commit(s) — your local copy kept:"
        printf '%s\n' "${RESIDUE_LINES[@]}"
    fi
}

# Forecast which surface classes the applied work touches. Requires
# FORK_TWIN_UPSTREAM_REPO set (the pick plan's upstream repo) and a populated
# pick plan. Prints one "  <count> file(s) — <class>" line per touched class,
# ordered fork-replaced (manual reconciliation expected) first, then
# fork-stable, then upstream-stable. Classifies every applied commit's
# changed paths against the fork-surfaces declaration.
#
# Usage: print_surface_forecast BASE_SHA
print_surface_forecast() {
    # shellcheck source=lib/fork-surfaces.bash
    source "$DEVENV_TOOLS/lib/fork-surfaces.bash"
    fork_surfaces_validate >/dev/null || die "fork-surfaces declaration is invalid; cannot forecast surface classes" "$EXIT_GENERAL_ERROR"
    local base="$1" i u_sha path class
    local fr=0 fs=0 us=0
    local -A fr_paths=() fs_paths=() us_paths=()
    for i in "${!PICK_SHAS[@]}"; do
        [ "${PICK_VERDICTS[$i]}" = "$PICK_VERDICT_PICK" ] || continue
        u_sha="${PICK_SHAS[$i]}"
        while IFS= read -r path; do
            [ -n "$path" ] || continue
            class="$(fork_surfaces_classify "$path")"
            case "$class" in
                fork-replaced) fr=$((fr + 1)); fr_paths["$path"]=1 ;;
                fork-stable)   fs=$((fs + 1)); fs_paths["$path"]=1 ;;
                *)             us=$((us + 1)); us_paths["$path"]=1 ;;
            esac
        done < <(git -C "${FORK_TWIN_UPSTREAM_REPO:?}" diff --name-only "${u_sha}^" "$u_sha" 2>/dev/null)
    done
    if [ "$fr" -eq 0 ] && [ "$fs" -eq 0 ] && [ "$us" -eq 0 ]; then
        return 0
    fi
    echo "Surface forecast for the applied work:"
    [ "$fr" -gt 0 ] && echo "  $fr fork-replaced path(s) — expect manual reconciliation (setup):"
    for path in "${!fr_paths[@]}"; do echo "    $path"; done
    [ "$fs" -gt 0 ] && echo "  $fs fork-stable path(s) — yours to keep, no reconciliation needed:"
    for path in "${!fs_paths[@]}"; do echo "    $path"; done
    [ "$us" -gt 0 ] && echo "  $us upstream-stable path(s) — should merge cleanly:"
    for path in "${!us_paths[@]}"; do echo "    $path"; done
}

# Conflict guidance: name the conflicting commit's classification and the
# exact skip/abort commands. Under the pick direction the conflicting commit
# is an upstream commit being applied onto the branch; abort returns the
# branch to its exact pre-sync state (nothing was rewritten).
#
# Usage: pick_conflict_guidance
pick_conflict_guidance() {
    if git -C "$REPO_ROOT" rev-parse --verify --quiet CHERRY_PICK_HEAD >/dev/null; then
        local conflicting verdict signal i
        conflicting="$(git -C "$REPO_ROOT" rev-parse --short CHERRY_PICK_HEAD)"
        {
            echo "Conflict while applying upstream commit $conflicting."
            for i in "${!PICK_SHAS[@]}"; do
                if [ "${PICK_SHAS[$i]}" = "$(git -C "$REPO_ROOT" rev-parse CHERRY_PICK_HEAD)" ]; then
                    verdict="${PICK_VERDICTS[$i]}"
                    signal="${PICK_SIGNALS[$i]}"
                    if [ "$verdict" = "$PICK_VERDICT_PICK" ]; then
                        echo "This commit was classified: pick (signal: ${signal:--})."
                    else
                        echo "This commit was classified: $verdict (signal: ${signal:--}) — it may already exist on your branch; skipping it may be the resolution."
                    fi
                    break
                fi
            done
            echo "Resolve the conflicts and continue, skip this commit, or return to the exact pre-sync state:"
            printf '  git -C %q cherry-pick --continue\n' "$REPO_ROOT"
            printf '  git -C %q cherry-pick --skip\n' "$REPO_ROOT"
            printf '  git -C %q cherry-pick --abort\n' "$REPO_ROOT"
        } >&2
    else
        die "apply of upstream/$FORK_UPSTREAM_BRANCH onto $CURRENT_BRANCH failed" "$EXIT_GENERAL_ERROR"
    fi
}

if [ "$REPLAY" -eq 1 ]; then
    [ "$CURRENT_BRANCH" != "HEAD" ] || die "cannot replay while HEAD is detached" "$EXIT_GENERAL_ERROR"
    # Dry-run enforces the same precondition as the real run: a plan computed
    # from a tree that could never sync would be a false promise.
    [ -z "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ] || die "working tree has uncommitted changes; commit, stash, or discard them before --replay" "$EXIT_GENERAL_ERROR"
fi

UPSTREAM_REF="refs/remotes/upstream/$FORK_UPSTREAM_BRANCH"
if [ "$DRY_RUN" -eq 1 ]; then
    echo "dry run: would fetch upstream and compare HEAD with upstream/$FORK_UPSTREAM_BRANCH"
    if [ "$REPLAY" -eq 1 ]; then
        echo "dry run: would apply upstream/$FORK_UPSTREAM_BRANCH's new commits onto the branch (local history unchanged)"
        # No fetch on a dry run (existing contract): the plan classifies
        # against the last-fetched upstream state.
        if git -C "$REPO_ROOT" show-ref --verify --quiet "$UPSTREAM_REF"; then
            BASE_SHA="$(git -C "$REPO_ROOT" merge-base "$UPSTREAM_REF" HEAD 2>/dev/null)" || die "dry run: HEAD and upstream/$FORK_UPSTREAM_BRANCH share no common history" "$EXIT_GENERAL_ERROR"
            echo "dry run: pick plan (as of the last fetch):"
            build_pick_plan "$BASE_SHA"
            print_pick_plan
            print_surface_forecast "$BASE_SHA"
            echo "dry run: would apply $PICK_COUNT new upstream commit(s), skip $DROP_COUNT already present."
        else
            echo "dry run: upstream/$FORK_UPSTREAM_BRANCH not fetched yet; fetch first to see the pick plan"
        fi
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
        echo "  The replay drops these (and any twin) automatically; rework them by hand only if upstream is missing something."
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

if [ "$PUSH" -eq 1 ] && [ "$REPLAY" -eq 0 ]; then
    PUSH_COUNTS="$(git -C "$REPO_ROOT" rev-list --left-right --count "$UPSTREAM_REF...HEAD")" || die "failed to compare HEAD with upstream/$FORK_UPSTREAM_BRANCH" "$EXIT_GENERAL_ERROR"
    read -r PUSH_BEHIND _ <<< "$PUSH_COUNTS"
    [ "$PUSH_BEHIND" -eq 0 ] || die "branch is behind upstream; pass --replay before --push-to-origin" "$EXIT_MISUSE"
fi


if [ "$REPLAY" -eq 1 ]; then
    merges="$(git -C "$REPO_ROOT" --no-pager log --merges --format='  %h %s' "$BASE_SHA..HEAD")"
    if [ -n "$merges" ]; then
        {
            echo "local history since the upstream merge-base contains merge commit(s); the sync only handles linear history"
            echo "(the result must stay exportable by fork-export, which refuses merge-bearing ranges):"
            echo "$merges"
            echo "Restructure the branch (e.g. rebase it yourself with --rebase-merges) before syncing."
        } >&2
        exit "$EXIT_MISUSE"
    fi
    # Snapshot fork-owned surface state before the picks run: a tree commit on
    # refs/fork-sync/snapshot holding every fork-stable/fork-replaced path the
    # branch currently has. Verify/reapply after the picks compares this tree
    # against the new HEAD; a ref survives an aborted sync untouched, and the
    # next sync overwrites it (the previous snapshot's moment has passed).
    source "$DEVENV_TOOLS/lib/fork-surfaces.bash"
    this_run_snapshotted=0
    snapshot_index="$(mktemp "${TMPDIR:-/tmp}/fork-sync-snapidx.XXXXXX")"
    # The temp index must not leak if anything below fails before the rm.
    trap 'rm -f "$snapshot_index"' RETURN
    GIT_INDEX_FILE="$snapshot_index" git -C "$REPO_ROOT" read-tree HEAD
    snapshot_paths=()
    while IFS= read -r snap_glob; do
        [ -n "$snap_glob" ] || continue
        # feed the declared glob verbatim; git pathspec expands it.
        snapshot_paths+=("${snap_glob#* }")
    done < <(fork_surfaces_list)
    if [ "${#snapshot_paths[@]}" -gt 0 ]; then
        # Note: read-tree HEAD then re-add the declared paths captures their
        # current worktree/index state; paths absent from the worktree drop out
        # of the snapshot tree, which is the truth of the current state.
        if ! GIT_INDEX_FILE="$snapshot_index" git -C "$REPO_ROOT" add -A -- "${snapshot_paths[@]}" 2>/dev/null; then
            echo "WARNING: could not stage some fork-owned paths; the snapshot may be incomplete" >&2
        fi
        snapshot_tree="$(GIT_INDEX_FILE="$snapshot_index" git -C "$REPO_ROOT" write-tree)"
        snapshot_commit="$(git -C "$REPO_ROOT" commit-tree "$snapshot_tree" -p HEAD -m "fork-sync: pre-sync snapshot of fork-owned surfaces")"
        git -C "$REPO_ROOT" update-ref -m "fork-sync: pre-sync snapshot" "refs/fork-sync/snapshot" "$snapshot_commit"
        echo "Snapshot of fork-owned surfaces: $snapshot_commit (refs/fork-sync/snapshot)"
        this_run_snapshotted=1
    fi
    rm -f "$snapshot_index"

    # Apply-upstream-onto-branch: classify upstream's new commits, skip the
    # ones the branch already has, cherry-pick the rest in order. Local SHAs
    # never move; origin pushes stay fast-forwards. See docs/Forking.md.
    build_pick_plan "$BASE_SHA"
    if [ "$PICK_COUNT" -eq 0 ]; then
        # Nothing to apply — either every new upstream commit is already on
        # the branch (immediate re-sync) or the plan is empty. No ref
        # movement, no confirmation: changing nothing needs no permission.
        echo "Nothing to apply from upstream/$FORK_UPSTREAM_BRANCH (skipped $DROP_COUNT already-present commit(s))."
    elif [ "$PICK_COUNT" -gt 0 ] && [ "$DROP_COUNT" -eq 0 ] && [ "$(git -C "$REPO_ROOT" rev-list --count "$BASE_SHA..HEAD")" -eq 0 ]; then
        # No local commits at all: fast-forward — upstream SHAs preserved verbatim.
        git -C "$REPO_ROOT" merge --ff-only "$UPSTREAM_REF" || {
            pick_conflict_guidance
            exit "$EXIT_GENERAL_ERROR"
        }
        echo "No local commits; fast-forwarded to upstream/$FORK_UPSTREAM_BRANCH."
    else
        if [ "$RESIDUE_COUNT" -gt 0 ]; then
            echo "Divergence on skipped commit(s) — your local copy kept:"
            printf '%s\n' "${RESIDUE_LINES[@]}"
        fi
        print_pick_plan
        print_surface_forecast "$BASE_SHA"
        # Confirmation gate: applying upstream commits changes the branch, so
        # without --yes a TTY confirms and anything else fails closed (same
        # contract as --push-to-origin). Pure no-op paths above stay
        # prompt-free: they change nothing the user would veto.
        if [ "$YES" -eq 0 ]; then
            # A TTY is both required and sufficient: with one, read prompts
            # and gets an answer; without one, read fails immediately and the
            # run fails closed (never hangs waiting on input that cannot come).
            if [ ! -t 0 ]; then
                die "non-TTY --replay requires --yes" "$EXIT_MISUSE"
            fi
            APPLY_CONFIRM=""
            read -r -p "Apply $PICK_COUNT upstream commit(s) onto $CURRENT_BRANCH? [y/N] " APPLY_CONFIRM < /dev/tty || APPLY_CONFIRM=""
            case "$APPLY_CONFIRM" in
                [Yy]*) ;;
                *) echo "Apply cancelled."; exit 0 ;;
            esac
        fi
        # Record each clean pick's adoption pair as it lands: applied upstream
        # SHAs map to their new local SHAs, so future classifications match by
        # the strongest signal. Conflict-resolved picks are named afterwards,
        # never auto-linked (their patch drifted).
        _record_pick_link() {
            if ! fork_twin_map_add "$REPO_ROOT" "$2" "$1" "fork-sync auto-record" 2>/dev/null; then
                echo "WARNING: could not record adoption link for $1 — the next sync may re-apply it" >&2
            fi
        }
        apply_status=0
        while read -r u_sha; do
            [ -n "$u_sha" ] || continue
            if ! git -C "$REPO_ROOT" cherry-pick "$u_sha" >/dev/null 2>&1; then
                echo "Conflict while applying $u_sha." >&2
                pick_conflict_guidance
                apply_status=1
                break
            fi
            _record_pick_link "$u_sha" "$(git -C "$REPO_ROOT" rev-parse HEAD)"
        done < <(for i in "${!PICK_SHAS[@]}"; do [ "${PICK_VERDICTS[$i]}" = "$PICK_VERDICT_PICK" ] && printf '%s\n' "${PICK_SHAS[$i]}"; done)
        if [ "$apply_status" -ne 0 ]; then
            exit "$EXIT_GENERAL_ERROR"
        fi
        echo "Applied $PICK_COUNT upstream commit(s) onto $CURRENT_BRANCH (skipped $DROP_COUNT already present)."
    fi

    # Verify fork-owned surfaces against the pre-sync snapshot: report any
    # fork-owned path the applied work changed. Reapply is a conscious user
    # act (the snapshot ref stays for inspection) — never auto-merged. Gated
    # on THIS run having taken a snapshot: a ref left by an earlier (aborted)
    # run must not be diffed against today's HEAD.
    if [ "${this_run_snapshotted:-0}" -eq 1 ]; then
        changed_owned=0
        # The declared globs word-split into pathspecs (SC2046 by design).
        # shellcheck disable=SC2046
        while IFS= read -r owned_path; do
            [ -n "$owned_path" ] || continue
            changed_owned=$((changed_owned + 1))
            if [ "$changed_owned" -eq 1 ]; then
                echo "Fork-owned paths touched by the applied work:"
            fi
            echo "  $owned_path"
        done < <(git -C "$REPO_ROOT" diff --name-only refs/fork-sync/snapshot HEAD -- $(fork_surfaces_list | awk '{print $2}'))
        if [ "$changed_owned" -gt 0 ]; then
            echo "  Review before continuing: diff with"
            echo "    git -C $REPO_ROOT diff refs/fork-sync/snapshot HEAD -- ${snapshot_paths[*]}"
            echo "  The pre-sync state remains at refs/fork-sync/snapshot."
        else
            echo "Fork-owned surfaces verified: untouched by the applied work."
        fi
    fi
    echo "Synced upstream/$FORK_UPSTREAM_BRANCH onto $CURRENT_BRANCH — local history unchanged."
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
        echo "Action needed: upstream has $UNRECOGNIZED_BEHIND commit(s) that don't look like your own work -- run 'fork-sync --replay' to sync."
    else
        echo "No urgent action needed: all $BEHIND upstream-only commit(s) look like your own contributions coming back. 'fork-sync --replay' still replays genuinely fork-only commits on top of upstream's tip (twins are dropped)."
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
