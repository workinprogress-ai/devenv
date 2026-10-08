#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# fork-export.sh - Export a commit range for transfer to a
# clone of the upstream repository (see docs/Forking.md).
#
set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/fork.bash"
source "$DEVENV_TOOLS/lib/change-id.bash"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<'HELP'
fork-export.sh — export commits for transfer into a clone of the upstream repository

Exports from the merge-base with `upstream/<branch>` to `<end-ref>` (default
`HEAD`); the upstream-derived base is always used. With a TTY and no explicit
refs, fzf lets you select the commits to export (TAB marks each one; they need
not be contiguous) from the commits not in upstream. `--start-ref <commit>
<end-ref>` selects a range non-interactively;
`--all` exports the complete upstream-to-end range without prompting.
`--format` selects `bundle` (default), `patch`, or `both`.
Without `--apply-to`, a unique clone under `repos/` whose `origin` matches
`[fork] upstream_repo` is used automatically. If none matches, files go under
`.local-artifacts/fork-export/<range-slug>/`; use `--export-only` to force that
behavior. `--apply-to <path>` explicitly selects a sibling clone.
`--dry-run` reports the operation without writing files or changing the target.
When applying an export interactively, the script waits for conflicts to be
resolved and staged, then continues the queued operation. Without a TTY, it
prints the manual continuation command and leaves the Git operation intact.
A range that contains merge commits is refused with guidance (rebase onto upstream
first); patches are applied with `git am -3` so a context drift falls back to a
three-way merge.

Commits are identified by their Change-Id trailer. A commit without one is hidden
(and counted) unless `--include-untracked` is given, which also restores matching
against the target by patch equivalence. A commit marked `Fork-Only: yes` or
listed in the local skip list (`fork-export-skip` in the git directory) is skipped
unless `--include-skipped` is given. A commit whose Change-Id is already in the
target is not exported again.

Skip list: `--skip <commit>` skips a commit for good (recorded by Change-Id and SHA);
`--skip` with no commit opens a picker (TAB marks, multiple allowed) over the same
candidate range to choose which ones to skip. `--unskip <commit-or-change-id>` reverses
it and `--list-skipped` lists the entries, dropping stale ones. In the export picker,
ctrl-x skips the marked (or highlighted) commits for good and reopens the picker; when
the picker finishes, the commits left unselected can be excluded from future exports.

USAGE
  fork-export [<end-ref>] [--all] [--export-only] [--format bundle|patch|both] [--apply-to <path>] [--dry-run] [--include-untracked] [--include-skipped]
  fork-export --start-ref <start-commit> <end-ref> [--export-only] [--format bundle|patch|both] [--apply-to <path>] [--include-untracked] [--include-skipped]
  fork-export --skip [<commit>] | --unskip <commit-or-change-id> | --list-skipped
HELP
    exit 0
fi

devenv_ensure_root "${BASH_SOURCE[0]}"
fork_load_config

FORMAT=bundle
APPLY_TO=""
EXPORT_ONLY=0
DRY_RUN=0
END_REF=HEAD
END_REF_SET=0
START_REF=""
ALL_COMMITS=0
INCLUDE_UNTRACKED=0
INCLUDE_SKIPPED=0
SKIP_REF=""
SKIP_INTERACTIVE=0
UNSKIP_REF=""
LIST_SKIPPED=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip)
      if [ -n "${2:-}" ] && [[ "$2" != --* ]]; then
        shift
        SKIP_REF="$1"
      else
        SKIP_INTERACTIVE=1
      fi
      ;;
    --unskip)
      require_option_value "--unskip" "${2:-}"
      shift
      UNSKIP_REF="$1"
      ;;
    --list-skipped) LIST_SKIPPED=1 ;;
    --include-untracked) INCLUDE_UNTRACKED=1 ;;
    --include-skipped) INCLUDE_SKIPPED=1 ;;
    --start-ref)
      require_option_value "--start-ref" "${2:-}"
      shift
      START_REF="$1"
      ;;
    --all) ALL_COMMITS=1 ;;
    --export-only) EXPORT_ONLY=1 ;;
    --format)
      require_option_value "--format" "${2:-}"
      shift
      FORMAT="$1"
      case "$FORMAT" in
        bundle|patch|both) ;;
        *) die "invalid format '$FORMAT'; choose bundle, patch, or both" "$EXIT_MISUSE" ;;
      esac
      ;;
    --apply-to)
      require_option_value "--apply-to" "${2:-}"
      shift
      APPLY_TO="$1"
      ;;
    --dry-run) DRY_RUN=1 ;;
    --*) die "unknown option: $1" "$EXIT_MISUSE" ;;
    *)
      [ "$END_REF_SET" -eq 0 ] || die "only one end commit/ref may be provided" "$EXIT_MISUSE"
      END_REF="$1"
      END_REF_SET=1
      ;;
  esac
  shift
done
[ "$ALL_COMMITS" -eq 0 ] || [ -z "$START_REF" ] || die "--all cannot be combined with --start-ref" "$EXIT_MISUSE"
[ "$EXPORT_ONLY" -eq 0 ] || [ -z "$APPLY_TO" ] || die "--export-only cannot be combined with --apply-to" "$EXIT_MISUSE"
[ "$DRY_RUN" -eq 0 ] || { [ -z "$SKIP_REF" ] && [ "$SKIP_INTERACTIVE" -eq 0 ] && [ -z "$UNSKIP_REF" ] && [ "$LIST_SKIPPED" -eq 0 ]; } || die "--dry-run cannot be combined with --skip, --unskip or --list-skipped (they change the skip list)" "$EXIT_MISUSE"
[ "$SKIP_INTERACTIVE" -eq 0 ] || { [ -t 0 ] && [ -t 1 ]; } || die "--skip needs an explicit commit when not running interactively (no TTY for the picker)" "$EXIT_MISUSE"

# Whether the range will be chosen interactively (the picker narrows it). The dry
# run and the real run must agree on this, so it is decided once, here.
PICKER_WILL_RUN=0
if [ -z "$START_REF" ] && [ "$END_REF_SET" -eq 0 ] && [ "$ALL_COMMITS" -eq 0 ] && [ -t 0 ] && [ -t 1 ]; then
  PICKER_WILL_RUN=1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run fork-export.sh from inside a git repository" "$EXIT_GENERAL_ERROR"

# Record a commit in the skip list: by SHA always, and by Change-Id when it has one.
#
# Usage: skip_commit COMMIT
skip_commit() {
  local commit="$1" id subject
  subject="$(git -C "$REPO_ROOT" log -1 --format=%s "$commit")"
  id="$(change_id_get_from_commit "$REPO_ROOT" "$commit" || true)"
  skip_list_add "$REPO_ROOT" sha "$commit" "$subject"
  if [ -n "$id" ]; then
    skip_list_add "$REPO_ROOT" change-id "$id" "$subject"
  fi
}

if [ -n "$SKIP_REF" ]; then
  skip_target="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$SKIP_REF^{commit}" 2>/dev/null)" || die "not a commit: $SKIP_REF" "$EXIT_MISUSE"
  skip_commit "$skip_target"
  git --no-pager -C "$REPO_ROOT" show -s --format='skipped %h %s' "$skip_target"
  exit 0
fi
if [ -n "$UNSKIP_REF" ]; then
  skip_list_remove "$REPO_ROOT" "$UNSKIP_REF" || die "no skip-list entry matches: $UNSKIP_REF" "$EXIT_MISUSE"
  echo "removed from the skip list: $UNSKIP_REF"
  exit 0
fi
if [ "$LIST_SKIPPED" -eq 1 ]; then
  skip_entries="$(skip_list_list "$REPO_ROOT")"
  if [ -z "$skip_entries" ]; then
    echo "no skipped commits"
  else
    printf '%s\n' "$skip_entries"
  fi
  exit 0
fi
UPSTREAM_URL="$(git -C "$REPO_ROOT" remote get-url upstream 2>/dev/null || true)"
[ -n "$UPSTREAM_URL" ] || die "upstream remote is missing; run fork-setup.sh first" "$EXIT_GENERAL_ERROR"
fork_upstream_matches "$REPO_ROOT" || die "upstream remote URL does not match [fork] upstream_repo" "$EXIT_GENERAL_ERROR"

if [ -z "$APPLY_TO" ] && [ "$EXPORT_ONLY" -eq 0 ]; then
  CONFIGURED_TARGET="$(fork_normalize_git_url "$FORK_UPSTREAM_REPO")"
  TARGET_MATCHES=()
  for candidate in "$REPO_ROOT"/repos/*; do
    [ -d "$candidate" ] || continue
    candidate_root="$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null || true)"
    [ -n "$candidate_root" ] && [ "$candidate_root" != "$REPO_ROOT" ] || continue
    candidate_origin="$(git -C "$candidate_root" remote get-url origin 2>/dev/null || true)"
    [ -n "$candidate_origin" ] || continue
    [ "$(fork_normalize_git_url "$candidate_origin")" = "$CONFIGURED_TARGET" ] || continue
    match_seen=0
    for matched_root in "${TARGET_MATCHES[@]}"; do
      [ "$matched_root" != "$candidate_root" ] || match_seen=1
    done
    [ "$match_seen" -eq 1 ] || TARGET_MATCHES+=("$candidate_root")
  done
  if [ "${#TARGET_MATCHES[@]}" -eq 1 ]; then
    APPLY_TO="${TARGET_MATCHES[0]}"
    echo "detected upstream clone: $APPLY_TO"
  elif [ "${#TARGET_MATCHES[@]}" -gt 1 ]; then
    echo "multiple repos/ clones match [fork] upstream_repo; pass --apply-to <path> to choose one:" >&2
    printf '  %s\n' "${TARGET_MATCHES[@]}" >&2
    exit "$EXIT_MISUSE"
  else
    echo "no matching clone found in repos/; writing export artifacts"
  fi
fi

UPSTREAM_REF="refs/remotes/upstream/$FORK_UPSTREAM_BRANCH"
TARGET_ROOT=""
TARGET_HEAD=""
if [ -n "$APPLY_TO" ]; then
  TARGET_ROOT="$(git -C "$APPLY_TO" rev-parse --show-toplevel 2>/dev/null)" || die "--apply-to target is not a git repository: $APPLY_TO" "$EXIT_MISUSE"
  [ "$TARGET_ROOT" != "$REPO_ROOT" ] || die "--apply-to must be a sibling clone, not the source repository" "$EXIT_MISUSE"
  [ -z "$(git -C "$TARGET_ROOT" status --porcelain 2>/dev/null)" ] || die "--apply-to target has uncommitted changes" "$EXIT_MISUSE"
  git -C "$TARGET_ROOT" symbolic-ref --quiet HEAD >/dev/null 2>&1 || die "--apply-to target has a detached HEAD" "$EXIT_MISUSE"
  TARGET_HEAD="$(git -C "$TARGET_ROOT" rev-parse HEAD)" || die "could not resolve --apply-to target HEAD" "$EXIT_GENERAL_ERROR"
fi

# A range with merge commits cannot be exported: format-patch skips merges and a
# bundle replayed by cherry-pick has no single parent to apply them against.
# Refuse, name them, and say how to get a linear range.
#
# Usage: refuse_merge_commits RANGE
refuse_merge_commits() {
  local merges
  merges="$(git -C "$REPO_ROOT" --no-pager log --merges --format='  %h %s' "$1")"
  [ -z "$merges" ] && return 0
  {
    echo "the range $1 contains merge commit(s), which cannot be exported:"
    echo "$merges"
    echo "Rebase the branch onto upstream first (fork-sync --rebase) so the range is linear,"
    echo "or choose commits that exclude the merge (--start-ref, or the picker)."
  } >&2
  exit "$EXIT_MISUSE"
}

declare -A TARGET_EQUIVALENT_COMMITS=()
declare -A TARGET_CHANGE_IDS=()
TARGET_DUPLICATE_COUNT=0
TARGET_ID_DUPLICATE_COUNT=0
HIDDEN_UNTRACKED_COUNT=0
SKIPPED_COUNT=0
skip_list_load "$REPO_ROOT"
DUPLICATE_IDS_CHECKED=0
declare -A DUPLICATE_SOURCE_IDS=()

# Warn about Change-Ids carried by more than one commit in the range (once). Matching
# such an ID against the target is skipped, so none of those commits is silently hidden.
check_duplicate_source_ids() {
  local commit id
  local -A id_counts=()
  local -A id_commits=()
  [ "$DUPLICATE_IDS_CHECKED" -eq 0 ] || return 0
  DUPLICATE_IDS_CHECKED=1
  for commit in "${COMMITS[@]}"; do
    id="$(change_id_get_from_commit "$REPO_ROOT" "$commit" || true)"
    [ -n "$id" ] || continue
    id_counts["$id"]=$(( ${id_counts[$id]:-0} + 1 ))
    id_commits["$id"]="${id_commits[$id]:-} $(git -C "$REPO_ROOT" rev-parse --short "$commit")"
  done
  for id in "${!id_counts[@]}"; do
    if [ "${id_counts[$id]}" -gt 1 ]; then
      DUPLICATE_SOURCE_IDS["$id"]=1
      echo "warning: Change-Id $id is carried by ${id_counts[$id]} commits (${id_commits[$id]# }); it is not matched against the target for them" >&2
    fi
  done
  return 0
}

# Collect what the target already has: commits patch-equivalent to a source commit and
# the Change-Ids in its history since the shared base. Needs TARGET_ROOT, BASE_SHA and
# END_SHA.
load_target_state() {
  local status abbreviated_commit commit target_message target_id cherry_output missing_output range_output log_file
  [ -n "$TARGET_ROOT" ] || return 0
  if ! git -C "$TARGET_ROOT" merge-base --is-ancestor "$BASE_SHA" "$TARGET_HEAD"; then
    die "--apply-to target does not descend from the upstream merge-base $BASE_SHA" "$EXIT_MISUSE"
  fi
  TARGET_OBJECTS="$(git -C "$TARGET_ROOT" rev-parse --path-format=absolute --git-path objects)" || die "could not locate target Git object store" "$EXIT_GENERAL_ERROR"
  ALTERNATE_OBJECTS="$TARGET_OBJECTS"
  [ -z "${GIT_ALTERNATE_OBJECT_DIRECTORIES:-}" ] || ALTERNATE_OBJECTS+="${ALTERNATE_OBJECTS:+:}${GIT_ALTERNATE_OBJECT_DIRECTORIES}"
  # Every scan below is read through a command substitution (or a file) so a failing
  # git command stops the export instead of reading as "nothing is in the target".
  cherry_output="$(GIT_ALTERNATE_OBJECT_DIRECTORIES="$ALTERNATE_OBJECTS" git -C "$REPO_ROOT" cherry "$TARGET_HEAD" "$END_SHA" "$BASE_SHA")" || die "could not compare the commits with the target (git cherry failed)" "$EXIT_GENERAL_ERROR"
  while read -r status abbreviated_commit _; do
    [ "$status" = "-" ] || continue
    commit="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$abbreviated_commit^{commit}")" || die "git cherry returned an unresolvable commit: $abbreviated_commit" "$EXIT_GENERAL_ERROR"
    TARGET_EQUIVALENT_COMMITS["$commit"]=1
  done <<< "$cherry_output"
  # Commits the target already contains by ancestry (an earlier fast-forward export
  # carries the very same commits) are present too.
  local -A missing_in_target=()
  missing_output="$(GIT_ALTERNATE_OBJECT_DIRECTORIES="$ALTERNATE_OBJECTS" git -C "$REPO_ROOT" rev-list "$END_SHA" --not "$BASE_SHA" "$TARGET_HEAD")" || die "could not read the target's history (git rev-list failed)" "$EXIT_GENERAL_ERROR"
  while read -r commit; do
    [ -z "$commit" ] || missing_in_target["$commit"]=1
  done <<< "$missing_output"
  range_output="$(git -C "$REPO_ROOT" rev-list "$BASE_SHA..$END_SHA")" || die "could not list the commits to export (git rev-list failed)" "$EXIT_GENERAL_ERROR"
  while read -r commit; do
    [ -n "$commit" ] || continue
    if [ -z "${missing_in_target[$commit]:-}" ]; then
      TARGET_EQUIVALENT_COMMITS["$commit"]=1
    fi
  done <<< "$range_output"
  log_file="$(mktemp "${TMPDIR:-/tmp}/fork-export-log.XXXXXX")" || die "could not create a temporary file" "$EXIT_GENERAL_ERROR"
  if ! git -C "$TARGET_ROOT" log -z --format=%B "$BASE_SHA..$TARGET_HEAD" > "$log_file"; then
    rm -f "$log_file"
    die "could not read the target's commit messages (git log failed)" "$EXIT_GENERAL_ERROR"
  fi
  while IFS= read -r -d '' target_message; do
    target_id="$(change_id_get_from_message "$target_message" || true)"
    if [ -n "$target_id" ]; then
      TARGET_CHANGE_IDS["$target_id"]=1
    fi
  done < "$log_file"
  rm -f "$log_file"
  return 0
}

# Reduce COMMITS to what may be exported: skipped commits (Fork-Only trailer, skip list)
# and commits without a Change-Id are set aside unless asked for; commits the target
# already has are dropped, by patch equivalence or by Change-Id.
filter_candidate_commits() {
  local commit message id
  local -a remaining=()
  TARGET_DUPLICATE_COUNT=0
  TARGET_ID_DUPLICATE_COUNT=0
  HIDDEN_UNTRACKED_COUNT=0
  SKIPPED_COUNT=0
  check_duplicate_source_ids
  for commit in "${COMMITS[@]}"; do
    message="$(git -C "$REPO_ROOT" log -1 --format=%B "$commit")"
    id="$(change_id_get_from_message "$message" || true)"
    if [ "$INCLUDE_SKIPPED" -eq 0 ] && { skip_list_has "$commit" "$id" || change_id_is_fork_only "$message"; }; then
      SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
      continue
    fi
    if [ -z "$id" ] && [ "$INCLUDE_UNTRACKED" -eq 0 ]; then
      HIDDEN_UNTRACKED_COUNT=$((HIDDEN_UNTRACKED_COUNT + 1))
      continue
    fi
    if [ -n "${TARGET_EQUIVALENT_COMMITS[$commit]:-}" ]; then
      TARGET_DUPLICATE_COUNT=$((TARGET_DUPLICATE_COUNT + 1))
      continue
    fi
    if [ -n "$id" ] && [ -z "${DUPLICATE_SOURCE_IDS[$id]:-}" ] && [ -n "${TARGET_CHANGE_IDS[$id]:-}" ]; then
      TARGET_ID_DUPLICATE_COUNT=$((TARGET_ID_DUPLICATE_COUNT + 1))
      continue
    fi
    remaining+=("$commit")
  done
  COMMITS=("${remaining[@]}")
}

# Say what filter_candidate_commits set aside.
report_filtered_commits() {
  if [ "$TARGET_DUPLICATE_COUNT" -gt 0 ]; then
    echo "excluded ${TARGET_DUPLICATE_COUNT} commit(s) already present in target by patch equivalence"
  fi
  if [ "$TARGET_ID_DUPLICATE_COUNT" -gt 0 ]; then
    echo "excluded ${TARGET_ID_DUPLICATE_COUNT} commit(s) already present in target by Change-Id"
  fi
  if [ "$SKIPPED_COUNT" -gt 0 ]; then
    echo "skipped ${SKIPPED_COUNT} commit(s) marked Fork-Only or in the skip list (--include-skipped shows them)"
  fi
  if [ "$HIDDEN_UNTRACKED_COUNT" -gt 0 ]; then
    echo "${HIDDEN_UNTRACKED_COUNT} commit(s) without a Change-Id hidden (--include-untracked shows them)"
  fi
}

if [ "$DRY_RUN" -eq 1 ]; then
  END_SHA="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$END_REF^{commit}" 2>/dev/null)" || die "end ref '$END_REF' does not resolve to a commit" "$EXIT_MISUSE"
  echo "dry run: would fetch upstream/$FORK_UPSTREAM_BRANCH and export $END_REF as $FORMAT"
  if git -C "$REPO_ROOT" show-ref --verify --quiet "$UPSTREAM_REF"; then
    BASE_SHA="$(git -C "$REPO_ROOT" merge-base "$UPSTREAM_REF" "$END_SHA" 2>/dev/null)" || die "upstream/$FORK_UPSTREAM_BRANCH and '$END_REF' have no common history" "$EXIT_GENERAL_ERROR"
    mapfile -t COMMITS < <(git -C "$REPO_ROOT" rev-list --topo-order --reverse "$BASE_SHA..$END_SHA")
    load_target_state
    filter_candidate_commits
    COMMIT_COUNT="${#COMMITS[@]}"
    report_filtered_commits
    # With --start-ref, or the interactive picker, the range is narrowed later; only
    # the selected range matters.
    if [ -z "$START_REF" ] && [ "$PICKER_WILL_RUN" -eq 0 ]; then
        refuse_merge_commits "$BASE_SHA..$END_SHA"
    fi
    echo "dry run: would export $COMMIT_COUNT commit(s) from $(git -C "$REPO_ROOT" rev-parse --short "$BASE_SHA") to $(git -C "$REPO_ROOT" rev-parse --short "$END_SHA")"
  else
    echo "dry run: upstream ref is not fetched; range will be resolved after fetch"
  fi
  if [ -n "$APPLY_TO" ]; then
    echo "dry run: would apply export to $TARGET_ROOT"
  else
    echo "dry run: output would be written under $REPO_ROOT/.local-artifacts/fork-export/"
  fi
  exit 0
fi

git -C "$REPO_ROOT" fetch upstream || die "failed to fetch upstream" "$EXIT_GENERAL_ERROR"
git -C "$REPO_ROOT" show-ref --verify --quiet "$UPSTREAM_REF" || die "upstream branch '$FORK_UPSTREAM_BRANCH' was not fetched" "$EXIT_GENERAL_ERROR"
END_SHA="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$END_REF^{commit}" 2>/dev/null)" || die "end ref '$END_REF' does not resolve to a commit after fetching upstream" "$EXIT_MISUSE"
BASE_SHA="$(git -C "$REPO_ROOT" merge-base "$UPSTREAM_REF" "$END_SHA" 2>/dev/null)" || die "upstream/$FORK_UPSTREAM_BRANCH and '$END_REF' have no common history" "$EXIT_GENERAL_ERROR"
RANGE="$BASE_SHA..$END_SHA"
# The whole range is checked here only when nothing narrows it later: an explicit
# --start-ref, or the interactive picker, selects the range that is checked below.
if [ -z "$START_REF" ] && [ "$PICKER_WILL_RUN" -eq 0 ] && [ "$SKIP_INTERACTIVE" -eq 0 ]; then
  refuse_merge_commits "$RANGE"
fi
mapfile -t COMMITS < <(git -C "$REPO_ROOT" rev-list --topo-order --reverse "$RANGE")
[ "${#COMMITS[@]}" -gt 0 ] || die "no commits to export from '$END_REF' beyond its upstream merge-base" "$EXIT_MISUSE"

if [ -n "$TARGET_ROOT" ]; then
  load_target_state
fi

filter_candidate_commits
report_filtered_commits
if [ "${#COMMITS[@]}" -eq 0 ]; then
  if [ "$SKIPPED_COUNT" -eq 0 ] && [ "$HIDDEN_UNTRACKED_COUNT" -eq 0 ]; then
    die "all candidate commits are already present in target" "$EXIT_MISUSE"
  fi
  die "no exportable commits remain; see the lines above" "$EXIT_MISUSE"
fi

if [ "$SKIP_INTERACTIVE" -eq 1 ] || [ "$PICKER_WILL_RUN" -eq 1 ]; then
  # The common picker returns the selected rows; keep the full object ID in
  # the first tab-separated field so display formatting cannot affect refs.
  source "$DEVENV_TOOLS/lib/fzf-selection.bash"
  check_fzf_installed || die "install fzf or pass --all / explicit refs / an explicit commit to --skip" "$EXIT_MISUSE"
  printf -v preview_cmd 'git -C %q show --format=fuller --stat --patch {1}' "$REPO_ROOT"

  # Rows for the commits in the given list, one tab-separated line each.
  # Usage: picker_rows COMMIT...
  picker_rows() {
    local row_commit row_display
    for row_commit in "$@"; do
      row_display="$(git -C "$REPO_ROOT" show -s --format='%h %cs %s' "$row_commit")"
      printf '%s\t%s\n' "$row_commit" "$row_display"
    done
  }
fi

if [ "$SKIP_INTERACTIVE" -eq 1 ]; then
  picked_rows="$(fzf_select_multi "$(picker_rows "${COMMITS[@]}")" "Commits to skip for good (TAB marks): " "$preview_cmd")" || die "commit selection cancelled" "$EXIT_MISUSE"
  SKIP_SELECTED=()
  while IFS= read -r picked_row; do
    [ -n "$picked_row" ] || continue
    SKIP_SELECTED+=("${picked_row%%$'\t'*}")
  done <<< "$picked_rows"
  [ "${#SKIP_SELECTED[@]}" -gt 0 ] || die "no commits selected" "$EXIT_MISUSE"
  for commit in "${SKIP_SELECTED[@]}"; do
    skip_commit "$commit"
    git --no-pager -C "$REPO_ROOT" show -s --format='skipped %h %s' "$commit"
  done
  echo "skipped ${#SKIP_SELECTED[@]} commit(s) for good (fork-export --unskip <commit> reverses it)"
  exit 0
fi

if [ "$PICKER_WILL_RUN" -eq 1 ]; then
  # After the export is confirmed: offer to exclude the unselected commits from
  # future exports.
  # Usage: offer_exclusion_of_unselected COMMIT...
  offer_exclusion_of_unselected() {
    local choice picked_rows picked_row
    [ "$#" -gt 0 ] || return 0
    printf '%d commit(s) were not selected:\n' "$#"
    for commit in "$@"; do
      git --no-pager -C "$REPO_ROOT" show -s --format='  %h %cs %s' "$commit"
    done
    printf 'Exclude them from future exports? [n]one / [a]ll / [c]hoose (default none): ' > /dev/tty
    IFS= read -r choice < /dev/tty || return 0
    case "${choice,,}" in
      a|all)
        for commit in "$@"; do skip_commit "$commit"; done
        echo "excluded $# commit(s) from future exports"
        ;;
      c|choose)
        picked_rows="$(fzf_select_multi "$(picker_rows "$@")" "Commits to exclude for good (TAB marks): " "$preview_cmd")" || return 0
        excluded=0
        while IFS= read -r picked_row; do
          [ -n "$picked_row" ] || continue
          skip_commit "${picked_row%%$'\t'*}"
          excluded=$((excluded + 1))
        done <<< "$picked_rows"
        echo "excluded $excluded commit(s) from future exports"
        ;;
      *) ;;
    esac
  }

  while :; do
    picker_rc=0
    picker_output="$(fzf_select_multi_or_action "$(picker_rows "${COMMITS[@]}")" "Commits to export (TAB marks, ctrl-x skips for good): " "$preview_cmd" "ctrl-x")" || picker_rc=$?
    [ "$picker_rc" -ne 1 ] || die "commit selection cancelled" "$EXIT_MISUSE"
    SELECTED=()
    while IFS= read -r picked_row; do
      [ -n "$picked_row" ] || continue
      SELECTED+=("${picked_row%%$'\t'*}")
    done <<< "$picker_output"
    [ "${#SELECTED[@]}" -gt 0 ] || die "no commits selected" "$EXIT_MISUSE"
    [ "$picker_rc" -eq 2 ] || break
    declare -A SKIPPED_NOW=()
    for commit in "${SELECTED[@]}"; do
      skip_commit "$commit"
      SKIPPED_NOW["$commit"]=1
    done
    echo "skipped ${#SELECTED[@]} commit(s) for good (fork-export --unskip <commit> reverses it)"
    skip_list_load "$REPO_ROOT"
    REMAINING=()
    for commit in "${COMMITS[@]}"; do
      if [ -z "${SKIPPED_NOW[$commit]:-}" ]; then
        REMAINING+=("$commit")
      fi
    done
    COMMITS=("${REMAINING[@]}")
    [ "${#COMMITS[@]}" -gt 0 ] || die "no exportable commits remain" "$EXIT_MISUSE"
  done

  declare -A SELECTED_SET=()
  for commit in "${SELECTED[@]}"; do SELECTED_SET["$commit"]=1; done
  CHOSEN=()
  UNSELECTED=()
  for commit in "${COMMITS[@]}"; do
    if [ -n "${SELECTED_SET[$commit]:-}" ]; then
      CHOSEN+=("$commit")
    else
      UNSELECTED+=("$commit")
    fi
  done
  COMMITS=("${CHOSEN[@]}")
  END_SHA="${COMMITS[${#COMMITS[@]}-1]}"
  END_REF="$END_SHA"

  selected_merges="$(git -C "$REPO_ROOT" --no-pager log --no-walk=unsorted --merges --format='  %h %s' "${COMMITS[@]}")"
  if [ -n "$selected_merges" ]; then
    printf 'the selection contains merge commit(s), which cannot be exported:\n%s\n' "$selected_merges" >&2
    exit "$EXIT_MISUSE"
  fi

  printf 'Selected commits (%d):\n' "${#COMMITS[@]}"
  for commit in "${COMMITS[@]}"; do
    # --no-pager: stdout is a terminal here, and a pager would stall on its
    # own prompt and swallow the confirmation input read below.
    git --no-pager -C "$REPO_ROOT" show -s --format='  %h %cs %s' "$commit"
  done
  printf 'Export these commits? [y/N] ' > /dev/tty
  IFS= read -r confirmation < /dev/tty || die "commit export confirmation cancelled" "$EXIT_MISUSE"
  [[ "$confirmation" =~ ^[Yy]([Ee][Ss])?$ ]] || die "commit export cancelled" "$EXIT_MISUSE"
  offer_exclusion_of_unselected "${UNSELECTED[@]}"
fi

EXPORT_BASE_SHA="$BASE_SHA"
if [ -n "$START_REF" ]; then
  START_SHA="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$START_REF^{commit}" 2>/dev/null)" || die "start ref '$START_REF' does not resolve to a commit" "$EXIT_MISUSE"
  [ "$START_SHA" != "$BASE_SHA" ] || die "start commit must be after the upstream merge-base" "$EXIT_MISUSE"
  git -C "$REPO_ROOT" merge-base --is-ancestor "$BASE_SHA" "$START_SHA" || die "start commit is not based on the upstream merge-base" "$EXIT_MISUSE"
  git -C "$REPO_ROOT" merge-base --is-ancestor "$START_SHA" "$END_SHA" || die "start commit must be an ancestor of the end commit" "$EXIT_MISUSE"
  EXPORT_BASE_SHA="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$START_SHA^" 2>/dev/null)" || die "start commit has no parent" "$EXIT_MISUSE"
  git -C "$REPO_ROOT" merge-base --is-ancestor "$BASE_SHA" "$EXPORT_BASE_SHA" || die "start commit is not on a contiguous range from upstream" "$EXIT_MISUSE"
  RANGE="$EXPORT_BASE_SHA..$END_SHA"
  refuse_merge_commits "$RANGE"
  mapfile -t COMMITS < <(git -C "$REPO_ROOT" rev-list --topo-order --reverse "$RANGE")
  filter_candidate_commits
  [ "${#COMMITS[@]}" -gt 0 ] && [ "${COMMITS[0]}" = "$START_SHA" ] || die "the start commit is not exportable (already in the target, skipped, or without a Change-Id; see --include-untracked and --include-skipped)" "$EXIT_MISUSE"
  if [ -t 0 ] && [ -t 1 ]; then
    printf 'Selected range (%d commit(s)):\n' "${#COMMITS[@]}"
    for commit in "${COMMITS[@]}"; do
      # --no-pager: stdout is a terminal here, and a pager would stall on its
      # own prompt and swallow the confirmation input read below.
      git --no-pager -C "$REPO_ROOT" show -s --format='  %h %cs %s' "$commit"
    done
    printf 'Export this range? [y/N] ' > /dev/tty
    IFS= read -r confirmation < /dev/tty || die "commit range confirmation cancelled" "$EXIT_MISUSE"
    [[ "$confirmation" =~ ^[Yy]([Ee][Ss])?$ ]] || die "commit range export cancelled" "$EXIT_MISUSE"
  fi
fi

if [ -n "$APPLY_TO" ] && ! git -C "$TARGET_ROOT" merge-base --is-ancestor "$BASE_SHA" "$TARGET_HEAD"; then
  die "--apply-to target does not descend from the upstream merge-base $BASE_SHA" "$EXIT_MISUSE"
fi

# The bundle ends at the newest commit that is actually exported, never at a skipped or
# hidden tip.
END_SHA="${COMMITS[${#COMMITS[@]}-1]}"
FULL_RANGE=0
if fork_is_full_range_selection "$REPO_ROOT" "$BASE_SHA" "$END_SHA" "${COMMITS[@]}"; then
  FULL_RANGE=1
fi
BASE_SHORT="$(git -C "$REPO_ROOT" rev-parse --short "$BASE_SHA")"
END_SHORT="$(git -C "$REPO_ROOT" rev-parse --short "$END_SHA")"
if [ -n "$START_REF" ]; then
  START_SHORT="$(git -C "$REPO_ROOT" rev-parse --short "$START_SHA")"
  if fork_is_full_range_selection "$REPO_ROOT" "$EXPORT_BASE_SHA" "$END_SHA" "${COMMITS[@]}"; then
    RANGE_SLUG="${BASE_SHORT}-${START_SHORT}-${END_SHORT}"
  else
    RANGE_SLUG="$(fork_get_selection_slug "$BASE_SHORT" "$END_SHORT" "${COMMITS[@]}")"
  fi
elif [ "$FULL_RANGE" -eq 1 ]; then
  RANGE_SLUG="${BASE_SHORT}-${END_SHORT}"
else
  RANGE_SLUG="$(fork_get_selection_slug "$BASE_SHORT" "$END_SHORT" "${COMMITS[@]}")"
fi
TEMP_REFS=()
TEMP_REF_TIPS=()
TEMP_OUTPUT_ROOT=""
cleanup() {
  local ref_index
  for ref_index in "${!TEMP_REFS[@]}"; do
    git -C "$REPO_ROOT" update-ref -d "${TEMP_REFS[$ref_index]}" "${TEMP_REF_TIPS[$ref_index]}" 2>/dev/null || true
  done
  if [ -n "$TEMP_OUTPUT_ROOT" ]; then
    rm -rf "$TEMP_OUTPUT_ROOT"
  fi
}
trap cleanup EXIT

wait_for_conflict_resolution() {
  local target_root="$1" operation="$2" unresolved state_path
  while :; do
    case "$operation" in
      cherry-pick)
        git -C "$target_root" rev-parse --verify --quiet CHERRY_PICK_HEAD >/dev/null || return 0
        ;;
      am)
        state_path="$(git -C "$target_root" rev-parse --absolute-git-dir)/rebase-apply"
        [ -d "$state_path" ] || return 0
        ;;
    esac

    if [ ! -t 0 ] || [ ! -t 1 ] || [ ! -r /dev/tty ]; then
      echo "${operation} conflict in $target_root; resolve and stage the conflicted files, then run 'git -C $target_root ${operation} --continue'." >&2
      return 1
    fi

    unresolved="$(git -C "$target_root" diff --name-only --diff-filter=U)"
    if [ -n "$unresolved" ]; then
      printf 'Conflicts remain in:\n%s\n' "$unresolved" >&2
    fi
    printf 'Resolve and stage these files in the target clone, then press Enter to continue (Ctrl-C leaves the operation paused).\n' >&2
    read -r _ < /dev/tty || return 1

    unresolved="$(git -C "$target_root" diff --name-only --diff-filter=U)"
    if [ -n "$unresolved" ]; then
      echo "Unresolved files remain; resolve and stage them before continuing." >&2
      continue
    fi

    case "$operation" in
      cherry-pick)
        if ! GIT_EDITOR=true git -C "$target_root" cherry-pick --continue; then
          if git -C "$target_root" rev-parse --verify --quiet CHERRY_PICK_HEAD >/dev/null; then
            echo "Cherry-pick could not continue; review the target clone and resolve any remaining issue." >&2
            continue
          fi
          return 1
        fi
        ;;
      am)
        if ! GIT_EDITOR=true git -C "$target_root" am --continue; then
          [ -d "$state_path" ] || return 1
          echo "Patch application could not continue; review the target clone and resolve any remaining issue." >&2
        fi
        ;;
    esac
  done
}

OUTPUT_ROOT="$REPO_ROOT/.local-artifacts/fork-export/$RANGE_SLUG"
if [ -n "$APPLY_TO" ]; then
  TEMP_OUTPUT_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fork-export.XXXXXX")"
  OUTPUT_ROOT="$TEMP_OUTPUT_ROOT"
else
  mkdir -p "$OUTPUT_ROOT" || die "could not create export directory: $OUTPUT_ROOT" "$EXIT_GENERAL_ERROR"
fi

BUNDLE_FILE=""
PATCH_DIR=""
if [ "$FORMAT" = "bundle" ] || [ "$FORMAT" = "both" ]; then
  BUNDLE_FILE="$OUTPUT_ROOT/commits.bundle"
  # One endpoint per independent tip: selected commits on diverging branches are not
  # reachable from each other.
  bundle_tips="$(git -C "$REPO_ROOT" merge-base --independent "${COMMITS[@]}")" || die "could not determine the bundle endpoints" "$EXIT_GENERAL_ERROR"
  tip_index=0
  while read -r bundle_tip; do
    [ -n "$bundle_tip" ] || continue
    TEMP_REF_NEW="refs/fork-export/$RANGE_SLUG-$$-$tip_index"
    git -C "$REPO_ROOT" update-ref "$TEMP_REF_NEW" "$bundle_tip" || die "failed to prepare bundle endpoint" "$EXIT_GENERAL_ERROR"
    TEMP_REFS+=("$TEMP_REF_NEW")
    TEMP_REF_TIPS+=("$bundle_tip")
    tip_index=$((tip_index + 1))
  done <<< "$bundle_tips"
  # Include history from the shared upstream base so sibling clones satisfy
  # bundle prerequisites even when the selected start is later in the range.
  git -C "$REPO_ROOT" bundle create "$BUNDLE_FILE" "${TEMP_REFS[@]}" "^$BASE_SHA" || die "failed to create git bundle" "$EXIT_GENERAL_ERROR"
  [ -n "$APPLY_TO" ] || echo "Bundle: $BUNDLE_FILE"
fi
if [ "$FORMAT" = "patch" ] || [ "$FORMAT" = "both" ]; then
  PATCH_DIR="$OUTPUT_ROOT/patches"
  mkdir -p "$PATCH_DIR" || die "could not create patch directory: $PATCH_DIR" "$EXIT_GENERAL_ERROR"
  patch_number=1
  for commit in "${COMMITS[@]}"; do
    git -C "$REPO_ROOT" format-patch --start-number="$patch_number" --output-directory "$PATCH_DIR" -1 "$commit" >/dev/null || die "failed to create patch series" "$EXIT_GENERAL_ERROR"
    patch_number=$((patch_number + 1))
  done
  [ -n "$APPLY_TO" ] || echo "Patches: $PATCH_DIR"
fi
echo "Commits: ${#COMMITS[@]}"

if [ -n "$APPLY_TO" ]; then
  if [ -n "$BUNDLE_FILE" ]; then
    git -C "$TARGET_ROOT" fetch --no-tags "$BUNDLE_FILE" "${TEMP_REFS[@]}" || die "failed to fetch the bundle into $TARGET_ROOT" "$EXIT_GENERAL_ERROR"
    if [ "$TARGET_HEAD" = "$BASE_SHA" ] && [ -z "$START_REF" ] && [ "$FULL_RANGE" -eq 1 ]; then
      git -C "$TARGET_ROOT" merge --ff-only FETCH_HEAD || die "could not fast-forward $TARGET_ROOT to the exported commits" "$EXIT_GENERAL_ERROR"
    elif git -C "$TARGET_ROOT" merge-base --is-ancestor "$END_SHA" "$TARGET_HEAD"; then
      echo "Target already contains the exported commits: $TARGET_ROOT"
    elif git -C "$TARGET_ROOT" merge-base --is-ancestor "$BASE_SHA" "$TARGET_HEAD"; then
      if ! git -C "$TARGET_ROOT" cherry-pick --no-edit "${COMMITS[@]}"; then
        if ! git -C "$TARGET_ROOT" rev-parse --verify --quiet CHERRY_PICK_HEAD >/dev/null; then
          die "bundle cherry-pick failed without an active conflict" "$EXIT_GENERAL_ERROR"
        fi
        wait_for_conflict_resolution "$TARGET_ROOT" cherry-pick || exit "$EXIT_GENERAL_ERROR"
      fi
    else
      die "--apply-to target does not contain the upstream merge-base $BASE_SHORT" "$EXIT_MISUSE"
    fi
    git -C "$TARGET_ROOT" rev-parse --verify --quiet CHERRY_PICK_HEAD >/dev/null && die "bundle application remains unfinished" "$EXIT_GENERAL_ERROR"
    echo "Applied bundle to $TARGET_ROOT; cherry-pick sequence finalized"
  else
    shopt -s nullglob
    PATCH_FILES=("$PATCH_DIR"/*.patch)
    shopt -u nullglob
    if ! git -C "$TARGET_ROOT" am -3 "${PATCH_FILES[@]}"; then
      if [ ! -d "$(git -C "$TARGET_ROOT" rev-parse --absolute-git-dir)/rebase-apply" ]; then
        die "patch application failed without an active conflict" "$EXIT_GENERAL_ERROR"
      fi
      wait_for_conflict_resolution "$TARGET_ROOT" am || exit "$EXIT_GENERAL_ERROR"
    fi
    [ ! -d "$(git -C "$TARGET_ROOT" rev-parse --absolute-git-dir)/rebase-apply" ] || die "patch application remains unfinished" "$EXIT_GENERAL_ERROR"
    echo "Applied patch series to $TARGET_ROOT; patch sequence finalized"
  fi
fi
