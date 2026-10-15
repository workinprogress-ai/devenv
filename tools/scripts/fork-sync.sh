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
fork-sync.sh — report or replay fork-only commits against the configured upstream

Fetches `upstream` and reports ahead/behind counts and commits by default;
it does not change history or push unless explicitly requested. `--replay`
replays the current branch's fork-only commits on top of `upstream/<branch>`
(commits upstream already has are dropped, not re-applied). On a conflict,
it prints `git rebase --abort` guidance and exits without pushing.
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
        --unlink)
            require_option_value "$1" "${2:-}"
            UNLINK_SHA="$2"
            shift
            ;;
        --rebase) die "--rebase was renamed --replay (the sync replays fork-only commits on top of upstream; it no longer describes itself as a rebase)" "$EXIT_MISUSE" ;;
        *) die "unknown option: $1" "$EXIT_MISUSE" ;;
    esac
    shift
done

[ "$YES" -eq 0 ] || { [ "$PUSH" -eq 1 ] || [ "$REPLAY" -eq 1 ]; } || die "--yes requires --push-to-origin or --replay" "$EXIT_MISUSE"
[ -z "$LINK_LOCAL" ] || { [ "$REPLAY" -eq 0 ] && [ "$PUSH" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ "$PROPOSE_LINKS" -eq 0 ] && [ -z "$UNLINK_SHA" ]; } || die "--link runs alone" "$EXIT_MISUSE"
[ "$PROPOSE_LINKS" -eq 0 ] || { [ "$REPLAY" -eq 0 ] && [ "$PUSH" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ -z "$LINK_LOCAL" ] && [ -z "$UNLINK_SHA" ]; } || die "--propose-links runs alone" "$EXIT_MISUSE"
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
# Classified replay support
# ---------------------------------------------------------------------------

# Classify every local commit since the merge-base against upstream. Fills:
#   VERDICT_SHA[], VERDICT_KIND[], VERDICT_TWIN[], VERDICT_SIGNAL[]
#   TWIN_DROP_COUNT (plain twins: safe to drop), RESIDUE_COUNT/RESIDUE_COMMITS
#   (twins with a differing patch: user decision), REPLAY_COUNT (fork-only),
#   SUSPECT_COUNT (subject-only matches: replayed, named).
# Requires BASE_SHA and UPSTREAM_REF; sets FORK_TWIN_LOCAL_REPO/UPSTREAM_REPO.
#
# Usage: classify_local_commits BASE_SHA UPSTREAM_REF
classify_local_commits() {
    local base="$1" upstream_ref="$2" sha verdict
    export FORK_TWIN_LOCAL_REPO="$REPO_ROOT"
    FORK_TWIN_UPSTREAM_REPO="${FORK_UPSTREAM_CLONE:-$(discover_upstream_clone)}"
    FORK_TWIN_UPSTREAM_REPO="${FORK_TWIN_UPSTREAM_REPO:-$REPO_ROOT}"
    CLASSIFY_SHAS=()
    VERDICT_KIND=()
    VERDICT_TWIN=()
    VERDICT_SIGNAL=()
    TWIN_DROP_COUNT=0
    RESIDUE_COUNT=0
    RESIDUE_SHAS=()
    RESIDUE_COMMITS=()
    REPLAY_COUNT=0
    SUSPECT_COUNT=0
    while read -r sha; do
        [ -n "$sha" ] || continue
        verdict="$(fork_twin_classify_commit "$sha" "$(git -C "$REPO_ROOT" rev-parse "$upstream_ref")" "$(fork_twin_map_get_path "$REPO_ROOT")" || true)"
        read -r kind _ twin signal <<< "$verdict"
        CLASSIFY_SHAS+=("$sha")
        VERDICT_KIND+=("$kind")
        VERDICT_TWIN+=("$twin")
        VERDICT_SIGNAL+=("$signal")
        case "$kind" in
            "$TWIN_VERDICT_TWIN" | "$TWIN_VERDICT_TWIN_RESIDUE")
                TWIN_DROP_COUNT=$((TWIN_DROP_COUNT + 1))
                if [ "$kind" = "$TWIN_VERDICT_TWIN_RESIDUE" ]; then
                    RESIDUE_COUNT=$((RESIDUE_COUNT + 1))
                    RESIDUE_SHAS+=("$sha")
                    RESIDUE_COMMITS+=("$(git -C "$REPO_ROOT" log -1 --format='  %h %s' "$sha")")
                fi
                ;;
            "$TWIN_VERDICT_SUSPECT") SUSPECT_COUNT=$((SUSPECT_COUNT + 1)); REPLAY_COUNT=$((REPLAY_COUNT + 1)) ;;
            *) REPLAY_COUNT=$((REPLAY_COUNT + 1)) ;;
        esac
    done < <(git -C "$REPO_ROOT" rev-list --reverse "$base..HEAD")
}

# Print the plan: every local commit with its verdict, twin, and signal, plus
# a residue diff for twins whose patch drifted. Used by --dry-run and by the
# pre-replay report.
#
# Usage: print_classification_plan
print_classification_plan() {
    local i sha kind twin signal
    for i in "${!VERDICT_KIND[@]}"; do
        kind="${VERDICT_KIND[$i]}"
        twin="${VERDICT_TWIN[$i]}"
        signal="${VERDICT_SIGNAL[$i]}"
        sha="${CLASSIFY_SHAS[$i]}"
        local line
        line="$(git -C "$REPO_ROOT" log -1 --format='%h %s' "$sha")"
        case "$kind" in
            "$TWIN_VERDICT_TWIN")
                echo "  $line — already upstream (twin $twin via $signal), will be dropped"
                ;;
            "$TWIN_VERDICT_TWIN_RESIDUE")
                echo "  $line — already upstream with residue (twin $twin via $signal); upstream copy kept, local drift dropped"
                echo "    residue in $(git -C "$REPO_ROOT" show --name-only --format= "$sha" | tr '\n' ' '):"
                fork_twin_residue_diff "$sha" "$twin" 2>/dev/null | sed 's/^/      /'
                ;;
            "$TWIN_VERDICT_SUSPECT")
                echo "  suspect twin (subject match only — will be replayed): $line (twin $twin)"
                ;;
            *)
                echo "  fork-only (will be replayed): $line"
                ;;
        esac
    done
}

# The GIT_SEQUENCE_EDITOR filter: reads the todo, drops lines whose commit is
# a classified plain twin, converts twin-residue lines to edit when --yes
# (replay as-is would be pick; residue needs the user's eyes — with --yes we
# replay them as pick and report afterwards), writes the todo back.
#
# The editor receives the todo path; classification arrives via the
# CLASSIFY_TWIN_SHAS space-separated list (plain twins: dropped).
_write_classify_editor() {
    cat > "$CLASSIFY_EDITOR_PATH" <<'EDITOR_SCRIPT'
#!/bin/bash
todo="$1"
drop_shas="$CLASSIFY_TWIN_SHAS"
filtered="$todo.filtered"
: > "$filtered"
while IFS= read -r line; do
    drop=0
    line_sha=""
    # A todo action line looks like "pick <sha> <subject>" (or "d <sha> ...").
    case "$line" in
        pick\ *|d\ *|p\ *) line_sha=$(printf '%s' "$line" | awk '{print $2}') ;;
    esac
    if [ -n "$line_sha" ]; then
        for sha in $drop_shas; do
            # The todo abbreviates SHAs; the drop list is full SHAs. Match
            # when the todo's short SHA is a prefix of a drop-list SHA (git
            # todo SHAs are unambiguous within the repo by construction).
            case "$sha" in
                "$line_sha"*) drop=1; break ;;
            esac
        done
    fi
    [ "$drop" -eq 1 ] || printf '%s
' "$line" >> "$filtered"
done < "$todo"
mv "$filtered" "$todo"
EDITOR_SCRIPT
    chmod +x "$CLASSIFY_EDITOR_PATH"
}

# Run the classified replay: build the twin-drop list from the classification,
# install the todo filter, then let git's interactive-rebase machinery apply
# the filtered todo (non-interactively: the editor does all the work).
#
# Usage: fork_replay_classified
fork_replay_classified() {
    local i sha
    CLASSIFY_TWIN_SHAS=""
    for i in "${!VERDICT_KIND[@]}"; do
        case "${VERDICT_KIND[$i]}" in
            "$TWIN_VERDICT_TWIN" | "$TWIN_VERDICT_TWIN_RESIDUE")
                CLASSIFY_TWIN_SHAS+=" ${CLASSIFY_SHAS[$i]}"
                ;;
        esac
    done
    export CLASSIFY_TWIN_SHAS
    CLASSIFY_EDITOR_PATH="$(mktemp "${TMPDIR:-/tmp}/fork-sync-editor.XXXXXX")"
    _write_classify_editor
    GIT_SEQUENCE_EDITOR="$CLASSIFY_EDITOR_PATH" git -C "$REPO_ROOT" rebase -i "$UPSTREAM_REF"
    local status=$?
    rm -f "$CLASSIFY_EDITOR_PATH"
    return "$status"
}

# Conflict guidance: name the conflicting commit's verdict and the exact
# skip/abort commands.
#
# Usage: replay_conflict_guidance
replay_conflict_guidance() {
    if git -C "$REPO_ROOT" rev-parse --verify --quiet REBASE_HEAD >/dev/null; then
        local conflicting
        conflicting="$(git -C "$REPO_ROOT" rev-parse --short REBASE_HEAD)"
        {
            echo "Rebase conflict while replaying $conflicting."
            if [ -n "${VERDICT_KIND+x}" ]; then
                # If the conflicting commit has a twin, say so: the resolution
                # may be "skip" (upstream already evolved this change).
                local i
                for i in "${!CLASSIFY_SHAS[@]}"; do
                    if [ "${CLASSIFY_SHAS[$i]}" = "$(git -C "$REPO_ROOT" rev-parse REBASE_HEAD)" ]; then
                        echo "This commit was classified: ${VERDICT_KIND[$i]} (twin: ${VERDICT_TWIN[$i]:-none}, signal: ${VERDICT_SIGNAL[$i]:-none})."
                        break
                    fi
                done
            fi
            echo "Resolve the conflicts and continue, skip this replayed commit, or return to the pre-replay state:"
            printf '  git -C %q rebase --continue\n' "$REPO_ROOT"
            printf '  git -C %q rebase --skip\n' "$REPO_ROOT"
            printf '  git -C %q rebase --abort\n' "$REPO_ROOT"
        } >&2
    else
        die "replay onto upstream/$FORK_UPSTREAM_BRANCH failed" "$EXIT_GENERAL_ERROR"
    fi
}

if [ "$REPLAY" -eq 1 ]; then
    [ "$CURRENT_BRANCH" != "HEAD" ] || die "cannot replay while HEAD is detached" "$EXIT_GENERAL_ERROR"
    [ -z "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ] || die "working tree has uncommitted changes; commit, stash, or discard them before --replay" "$EXIT_GENERAL_ERROR"
fi

UPSTREAM_REF="refs/remotes/upstream/$FORK_UPSTREAM_BRANCH"
if [ "$DRY_RUN" -eq 1 ]; then
    echo "dry run: would fetch upstream and compare HEAD with upstream/$FORK_UPSTREAM_BRANCH"
    if [ "$REPLAY" -eq 1 ]; then
        echo "dry run: would replay the branch's fork-only commits on top of upstream/$FORK_UPSTREAM_BRANCH"
        # No fetch on a dry run (existing contract): the plan classifies
        # against the last-fetched upstream state.
        if git -C "$REPO_ROOT" show-ref --verify --quiet "$UPSTREAM_REF"; then
            BASE_SHA="$(git -C "$REPO_ROOT" merge-base "$UPSTREAM_REF" HEAD 2>/dev/null)" || die "dry run: HEAD and upstream/$FORK_UPSTREAM_BRANCH share no common history" "$EXIT_GENERAL_ERROR"
            echo "dry run: classified replay plan (as of the last fetch):"
            classify_local_commits "$BASE_SHA" "$UPSTREAM_REF"
            print_classification_plan
            echo "dry run: would drop $TWIN_DROP_COUNT already-upstream commit(s), replay $REPLAY_COUNT fork-only commit(s)."
        else
            echo "dry run: upstream/$FORK_UPSTREAM_BRANCH not fetched yet; fetch first to see the classified plan"
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

# Print the residue diff for every dropped twin-with-residue, so the drift is
# reviewable as the dry-run plan promises. Uses the classification arrays.
#
# Usage: print_residue_diffs
print_residue_diffs() {
    echo "Residue on dropped twin(s) — upstream copy kept, local drift NOT replayed:"
    printf '%s\n' "${RESIDUE_COMMITS[@]}"
    local i j
    for i in "${!RESIDUE_SHAS[@]}"; do
        # RESIDUE_SHAS packs residue commits; find their position in the
        # classification arrays (which index every local commit).
        for j in "${!CLASSIFY_SHAS[@]}"; do
            [ "${CLASSIFY_SHAS[$j]}" = "${RESIDUE_SHAS[$i]}" ] || continue
            if [ -n "${VERDICT_TWIN[$j]}" ]; then
                echo "  residue diff for ${RESIDUE_COMMITS[$i]}:"
                fork_twin_residue_diff "${RESIDUE_SHAS[$i]}" "${VERDICT_TWIN[$j]}" 2>/dev/null | sed 's/^/    /'
            fi
            break
        done
    done
}

if [ "$REPLAY" -eq 1 ]; then
    merges="$(git -C "$REPO_ROOT" --no-pager log --merges --format='  %h %s' "$BASE_SHA..HEAD")"
    if [ -n "$merges" ]; then
        {
            echo "local history since the upstream merge-base contains merge commit(s); the replay only handles linear history:"
            echo "$merges"
            echo "Restructure the branch (e.g. rebase it yourself with --rebase-merges) before replaying."
        } >&2
        exit "$EXIT_MISUSE"
    fi
    # Classified replay: twins upstream already has are dropped from the
    # rebase todo; genuinely fork-only commits replay on top of upstream's
    # tip. See docs/Forking.md.
    classify_local_commits "$BASE_SHA" "$UPSTREAM_REF"
    if [ "$TWIN_DROP_COUNT" -eq 0 ]; then
        echo "No commits classified as already-upstream; replaying all local commits on top of upstream."
        git -C "$REPO_ROOT" rebase "$UPSTREAM_REF" || {
            replay_conflict_guidance
            exit "$EXIT_GENERAL_ERROR"
        }
    elif [ "$REPLAY_COUNT" -eq 0 ]; then
        # Everything local is already upstream: the fork branch is fully
        # contained — move it to upstream's tip without an (empty, failing)
        # interactive rebase. The expected old-value is the current branch
        # tip (read BEFORE the move) so a concurrent update fails the swap.
        branch_tip="$(git -C "$REPO_ROOT" rev-parse HEAD)"
        git -C "$REPO_ROOT" update-ref -m "fork-sync: fully merged upstream" \
            "refs/heads/$CURRENT_BRANCH" "$(git -C "$REPO_ROOT" rev-parse "$UPSTREAM_REF")" "$branch_tip"
        echo "Every local commit is already upstream; moved $CURRENT_BRANCH to upstream/$FORK_UPSTREAM_BRANCH."
    else
        # Upstream's copies are authoritative: twins (including drifted ones)
        # drop; their residue is named for manual follow-up. Fork-only and
        # suspect commits replay.
        if [ "$RESIDUE_COUNT" -gt 0 ]; then
            print_residue_diffs
        fi
        if ! fork_replay_classified; then
            replay_conflict_guidance
            exit "$EXIT_GENERAL_ERROR"
        fi
        echo "Classified replay: dropped $TWIN_DROP_COUNT twin commit(s), replayed $REPLAY_COUNT fork-only commit(s)."
    fi
    echo "Replayed $CURRENT_BRANCH on top of upstream/$FORK_UPSTREAM_BRANCH"
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
