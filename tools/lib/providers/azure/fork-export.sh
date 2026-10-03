#!/usr/bin/env bash
# fork-export.sh (azure provider) - Export a commit range for transfer to a
# real GitHub clone (see docs/Forking.md).
#
set -euo pipefail
# shellcheck source=../../self-root.bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/lib/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

source "$DEVENV_TOOLS/lib/error-handling.bash"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<'HELP'
fork-export.sh — export commits for transfer into a real GitHub clone

Exports from the merge-base with `upstream/<branch>` to `<end-ref>` (default
`HEAD`); the upstream-derived base is always used. To export selected commits,
prepare a branch at the upstream base and cherry-pick the desired commits
before exporting. `--format` selects `bundle` (default), `patch`, or `both`.
Without `--apply-to`, files go under
`.local-artifacts/fork-export/<range-slug>/`. `--apply-to <path>` applies the
export directly into a sibling clone instead. `--dry-run` reports the
operation without writing files or changing the target clone.

USAGE
  bash tools/lib/providers/azure/fork-export.sh [<end-ref>] [--format bundle|patch|both] [--apply-to <path>] [--dry-run]
HELP
    exit 0
fi

devenv_ensure_root "${BASH_SOURCE[0]}"
source "$DEVENV_TOOLS/lib/config-reader.bash"
config_init "$DEVENV_ROOT/devenv.config" || die "could not read $DEVENV_ROOT/devenv.config" "$EXIT_GENERAL_ERROR"
FORK_UPSTREAM_REPO="$(config_read_value fork upstream_repo "")"
FORK_UPSTREAM_BRANCH="$(config_read_value fork upstream_branch "")"
[ -n "$FORK_UPSTREAM_REPO" ] || die "missing required [fork] upstream_repo in $DEVENV_ROOT/devenv.config" "$EXIT_GENERAL_ERROR"
[ -n "$FORK_UPSTREAM_BRANCH" ] || die "missing required [fork] upstream_branch in $DEVENV_ROOT/devenv.config" "$EXIT_GENERAL_ERROR"

FORMAT=bundle
APPLY_TO=""
DRY_RUN=0
END_REF=HEAD
END_REF_SET=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --format)
      shift
      [ "$#" -gt 0 ] || die "--format requires bundle, patch, or both" "$EXIT_MISUSE"
      FORMAT="$1"
      case "$FORMAT" in
        bundle|patch|both) ;;
        *) die "invalid format '$FORMAT'; choose bundle, patch, or both" "$EXIT_MISUSE" ;;
      esac
      ;;
    --apply-to)
      shift
      [ "$#" -gt 0 ] || die "--apply-to requires a target repository path" "$EXIT_MISUSE"
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

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run fork-export.sh from inside a git repository" "$EXIT_GENERAL_ERROR"
UPSTREAM_URL="$(git -C "$REPO_ROOT" remote get-url upstream 2>/dev/null || true)"
[ -n "$UPSTREAM_URL" ] || die "upstream remote is missing; run fork-setup.sh first" "$EXIT_GENERAL_ERROR"
[ "$UPSTREAM_URL" = "$FORK_UPSTREAM_REPO" ] || die "upstream remote URL does not match [fork] upstream_repo" "$EXIT_GENERAL_ERROR"

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

if [ "$DRY_RUN" -eq 1 ]; then
  END_SHA="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "$END_REF^{commit}" 2>/dev/null)" || die "end ref '$END_REF' does not resolve to a commit" "$EXIT_MISUSE"
  echo "dry run: would fetch upstream/$FORK_UPSTREAM_BRANCH and export $END_REF as $FORMAT"
  if git -C "$REPO_ROOT" show-ref --verify --quiet "$UPSTREAM_REF"; then
    BASE_SHA="$(git -C "$REPO_ROOT" merge-base "$UPSTREAM_REF" "$END_SHA" 2>/dev/null)" || die "upstream/$FORK_UPSTREAM_BRANCH and '$END_REF' have no common history" "$EXIT_GENERAL_ERROR"
    COMMIT_COUNT="$(git -C "$REPO_ROOT" rev-list --count "$BASE_SHA..$END_SHA")" || die "could not resolve commits to export" "$EXIT_GENERAL_ERROR"
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
mapfile -t COMMITS < <(git -C "$REPO_ROOT" rev-list --reverse "$RANGE")
[ "${#COMMITS[@]}" -gt 0 ] || die "no commits to export from '$END_REF' beyond its upstream merge-base" "$EXIT_MISUSE"
if [ -n "$APPLY_TO" ] && ! git -C "$TARGET_ROOT" merge-base --is-ancestor "$BASE_SHA" "$TARGET_HEAD"; then
  die "--apply-to target does not descend from the upstream merge-base $BASE_SHA" "$EXIT_MISUSE"
fi

BASE_SHORT="$(git -C "$REPO_ROOT" rev-parse --short "$BASE_SHA")"
END_SHORT="$(git -C "$REPO_ROOT" rev-parse --short "$END_SHA")"
RANGE_SLUG="${BASE_SHORT}-${END_SHORT}"
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
  git -C "$REPO_ROOT" bundle create "$BUNDLE_FILE" "$TEMP_REF" "^$BASE_SHA" || die "failed to create git bundle" "$EXIT_GENERAL_ERROR"
  [ -n "$APPLY_TO" ] || echo "Bundle: $BUNDLE_FILE"
fi
if [ "$FORMAT" = "patch" ] || [ "$FORMAT" = "both" ]; then
  PATCH_DIR="$OUTPUT_ROOT/patches"
  mkdir -p "$PATCH_DIR" || die "could not create patch directory: $PATCH_DIR" "$EXIT_GENERAL_ERROR"
  git -C "$REPO_ROOT" format-patch --output-directory "$PATCH_DIR" "$RANGE" >/dev/null || die "failed to create format-patch series" "$EXIT_GENERAL_ERROR"
  [ -n "$APPLY_TO" ] || echo "Patches: $PATCH_DIR"
fi
echo "Commits: ${#COMMITS[@]}"

if [ -n "$APPLY_TO" ]; then
  if [ -n "$BUNDLE_FILE" ]; then
    git -C "$TARGET_ROOT" fetch --no-tags "$BUNDLE_FILE" "$TEMP_REF" || die "failed to fetch the bundle into $TARGET_ROOT" "$EXIT_GENERAL_ERROR"
    if [ "$TARGET_HEAD" = "$BASE_SHA" ]; then
      git -C "$TARGET_ROOT" merge --ff-only FETCH_HEAD || die "could not fast-forward $TARGET_ROOT to the exported commits" "$EXIT_GENERAL_ERROR"
    elif git -C "$TARGET_ROOT" merge-base --is-ancestor "$END_SHA" "$TARGET_HEAD"; then
      echo "Target already contains the exported commits: $TARGET_ROOT"
    elif git -C "$TARGET_ROOT" merge-base --is-ancestor "$BASE_SHA" "$TARGET_HEAD"; then
      if ! git -C "$TARGET_ROOT" cherry-pick --no-edit "${COMMITS[@]}"; then
        echo "Bundle application conflict. Resolve the conflicts or run:" >&2
        printf '  git -C %q cherry-pick --abort\n' "$TARGET_ROOT" >&2
        exit "$EXIT_GENERAL_ERROR"
      fi
    else
      die "--apply-to target does not contain the upstream merge-base $BASE_SHORT" "$EXIT_MISUSE"
    fi
    echo "Applied bundle to $TARGET_ROOT"
  else
    shopt -s nullglob
    PATCH_FILES=("$PATCH_DIR"/*.patch)
    shopt -u nullglob
    if ! git -C "$TARGET_ROOT" am "${PATCH_FILES[@]}"; then
      echo "Patch application conflict. Resolve the conflicts or run:" >&2
      printf '  git -C %q am --abort\n' "$TARGET_ROOT" >&2
      exit "$EXIT_GENERAL_ERROR"
    fi
    echo "Applied patch series to $TARGET_ROOT"
  fi
fi
