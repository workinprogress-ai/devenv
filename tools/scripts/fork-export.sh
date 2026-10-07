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

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<'HELP'
fork-export.sh — export commits for transfer into a clone of the upstream repository

Exports from the merge-base with `upstream/<branch>` to `<end-ref>` (default
`HEAD`); the upstream-derived base is always used. With a TTY and no explicit
refs, fzf lets you choose inclusive start and end commits from the commits not
in upstream. `--start-ref <commit> <end-ref>` selects a range non-interactively;
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

USAGE
  fork-export [<end-ref>] [--all] [--export-only] [--format bundle|patch|both] [--apply-to <path>] [--dry-run]
  fork-export --start-ref <start-commit> <end-ref> [--export-only] [--format bundle|patch|both] [--apply-to <path>]
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
while [ "$#" -gt 0 ]; do
  case "$1" in
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

# Whether the range will be chosen interactively (the picker narrows it). The dry
# run and the real run must agree on this, so it is decided once, here.
PICKER_WILL_RUN=0
if [ -z "$START_REF" ] && [ "$END_REF_SET" -eq 0 ] && [ "$ALL_COMMITS" -eq 0 ] && [ -t 0 ] && [ -t 1 ]; then
  PICKER_WILL_RUN=1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run fork-export.sh from inside a git repository" "$EXIT_GENERAL_ERROR"
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
    echo "or choose a start and end commit that exclude the merge."
  } >&2
  exit "$EXIT_MISUSE"
}

if [ "$DRY_RUN" -eq 1 ]; then
  END_SHA="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$END_REF^{commit}" 2>/dev/null)" || die "end ref '$END_REF' does not resolve to a commit" "$EXIT_MISUSE"
  echo "dry run: would fetch upstream/$FORK_UPSTREAM_BRANCH and export $END_REF as $FORMAT"
  if git -C "$REPO_ROOT" show-ref --verify --quiet "$UPSTREAM_REF"; then
    BASE_SHA="$(git -C "$REPO_ROOT" merge-base "$UPSTREAM_REF" "$END_SHA" 2>/dev/null)" || die "upstream/$FORK_UPSTREAM_BRANCH and '$END_REF' have no common history" "$EXIT_GENERAL_ERROR"
    COMMIT_COUNT="$(git -C "$REPO_ROOT" rev-list --count "$BASE_SHA..$END_SHA")" || die "could not resolve commits to export" "$EXIT_GENERAL_ERROR"
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
if [ -z "$START_REF" ] && [ "$PICKER_WILL_RUN" -eq 0 ]; then
  refuse_merge_commits "$RANGE"
fi
mapfile -t COMMITS < <(git -C "$REPO_ROOT" rev-list --reverse "$RANGE")
[ "${#COMMITS[@]}" -gt 0 ] || die "no commits to export from '$END_REF' beyond its upstream merge-base" "$EXIT_MISUSE"

declare -A TARGET_EQUIVALENT_COMMITS=()
TARGET_DUPLICATE_COUNT=0
if [ -n "$TARGET_ROOT" ]; then
  if ! git -C "$TARGET_ROOT" merge-base --is-ancestor "$BASE_SHA" "$TARGET_HEAD"; then
    die "--apply-to target does not descend from the upstream merge-base $BASE_SHA" "$EXIT_MISUSE"
  fi
  TARGET_OBJECTS="$(git -C "$TARGET_ROOT" rev-parse --path-format=absolute --git-path objects)" || die "could not locate target Git object store" "$EXIT_GENERAL_ERROR"
  ALTERNATE_OBJECTS="$TARGET_OBJECTS"
  [ -z "${GIT_ALTERNATE_OBJECT_DIRECTORIES:-}" ] || ALTERNATE_OBJECTS+="${ALTERNATE_OBJECTS:+:}${GIT_ALTERNATE_OBJECT_DIRECTORIES}"
  while read -r status abbreviated_commit _; do
    [ "$status" = "-" ] || continue
    commit="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$abbreviated_commit^{commit}")" || die "git cherry returned an unresolvable commit: $abbreviated_commit" "$EXIT_GENERAL_ERROR"
    TARGET_EQUIVALENT_COMMITS["$commit"]=1
  done < <(GIT_ALTERNATE_OBJECT_DIRECTORIES="$ALTERNATE_OBJECTS" git -C "$REPO_ROOT" cherry "$TARGET_HEAD" "$END_SHA" "$BASE_SHA")
fi

filter_target_commits() {
  local commit
  local -a remaining=()
  TARGET_DUPLICATE_COUNT=0
  [ -n "$TARGET_ROOT" ] || return 0
  for commit in "${COMMITS[@]}"; do
    if [ -n "${TARGET_EQUIVALENT_COMMITS[$commit]:-}" ]; then
      TARGET_DUPLICATE_COUNT=$((TARGET_DUPLICATE_COUNT + 1))
      continue
    fi
    remaining+=("$commit")
  done
  COMMITS=("${remaining[@]}")
}

filter_target_commits
if [ "$TARGET_DUPLICATE_COUNT" -gt 0 ]; then
  echo "excluded ${TARGET_DUPLICATE_COUNT} commit(s) already present in target by patch equivalence"
fi
[ "${#COMMITS[@]}" -gt 0 ] || die "all candidate commits are already present in target" "$EXIT_MISUSE"

if [ "$PICKER_WILL_RUN" -eq 1 ]; then
  # The common picker returns the selected row; keep the full object ID in
  # the first tab-separated field so display formatting cannot affect refs.
  source "$DEVENV_TOOLS/lib/fzf-selection.bash"
  check_fzf_installed || die "install fzf or pass --all / explicit refs to export without selection" "$EXIT_MISUSE"
  local_rows=""
  for commit in "${COMMITS[@]}"; do
    display="$(git -C "$REPO_ROOT" show -s --format='%h %cs %s' "$commit")"
    local_rows+="${commit}"$'\t'"${display}"$'\n'
  done
  printf -v preview_cmd 'git -C %q show --format=fuller --stat --patch {1}' "$REPO_ROOT"
  start_row="$(fzf_select_single "$local_rows" "Start commit (inclusive): " "$preview_cmd")" || die "commit range selection cancelled" "$EXIT_MISUSE"
  START_REF="${start_row%%$'\t'*}"
  START_SHA="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$START_REF^{commit}" 2>/dev/null)" || die "selected start commit is invalid" "$EXIT_MISUSE"

  end_rows=""
  for commit in "${COMMITS[@]}"; do
    if git -C "$REPO_ROOT" merge-base --is-ancestor "$START_SHA" "$commit" 2>/dev/null; then
      display="$(git -C "$REPO_ROOT" show -s --format='%h %cs %s' "$commit")"
      end_rows+="${commit}"$'\t'"${display}"$'\n'
    fi
  done
  end_row="$(fzf_select_single "$end_rows" "End commit (inclusive): " "$preview_cmd")" || die "commit range selection cancelled" "$EXIT_MISUSE"
  END_REF="${end_row%%$'\t'*}"
  END_SHA="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$END_REF^{commit}" 2>/dev/null)" || die "selected end commit is invalid" "$EXIT_MISUSE"
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
  mapfile -t COMMITS < <(git -C "$REPO_ROOT" rev-list --reverse "$RANGE")
  filter_target_commits
  [ "${#COMMITS[@]}" -gt 0 ] && [ "${COMMITS[0]}" = "$START_SHA" ] || die "selected commits do not form a contiguous range; choose a later start or earlier end" "$EXIT_MISUSE"
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

BASE_SHORT="$(git -C "$REPO_ROOT" rev-parse --short "$BASE_SHA")"
END_SHORT="$(git -C "$REPO_ROOT" rev-parse --short "$END_SHA")"
if [ -n "$START_REF" ]; then
  START_SHORT="$(git -C "$REPO_ROOT" rev-parse --short "$START_SHA")"
  RANGE_SLUG="${BASE_SHORT}-${START_SHORT}-${END_SHORT}"
else
  RANGE_SLUG="${BASE_SHORT}-${END_SHORT}"
fi
TEMP_REF=""
TEMP_OUTPUT_ROOT=""
cleanup() {
  if [ -n "$TEMP_REF" ]; then
    git -C "$REPO_ROOT" update-ref -d "$TEMP_REF" "$END_SHA" 2>/dev/null || true
  fi
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
  TEMP_REF="refs/fork-export/$RANGE_SLUG-$$"
  git -C "$REPO_ROOT" update-ref "$TEMP_REF" "$END_SHA" || die "failed to prepare bundle endpoint" "$EXIT_GENERAL_ERROR"
  # Include history from the shared upstream base so sibling clones satisfy
  # bundle prerequisites even when the selected start is later in the range.
  git -C "$REPO_ROOT" bundle create "$BUNDLE_FILE" "$TEMP_REF" "^$BASE_SHA" || die "failed to create git bundle" "$EXIT_GENERAL_ERROR"
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
    git -C "$TARGET_ROOT" fetch --no-tags "$BUNDLE_FILE" "$TEMP_REF" || die "failed to fetch the bundle into $TARGET_ROOT" "$EXIT_GENERAL_ERROR"
    if [ "$TARGET_HEAD" = "$BASE_SHA" ] && [ -z "$START_REF" ]; then
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
