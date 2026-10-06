#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

################################################################################
# pr-create.sh
#
# Create a pull request from the current branch to a target branch
#
# Usage:
#   ./pr-create.sh <title> --issue <number> [--base <branch>]
#
# Description:
#   Creates a pull request from the current branch into a target branch
#   (defaults to the repository's default branch: main/master).
#   Use --base to target a different branch. Uses GitHub CLI and prefers SSH remotes.
#   Supports issue references in PR body.
#
# Dependencies:
#   - git
#   - gh (GitHub CLI)
#   - error-handling.bash
#   - provider-loader.bash
#   - fzf-selection.bash
#   - git-operations.bash
#   - issue-operations.bash
#
################################################################################

set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/provider-loader.bash"
source "$DEVENV_TOOLS/lib/fzf-selection.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"


# Create a PR from the current branch into a target branch (default: repo's default branch).
# Use --base to target a specific branch instead. Uses GitHub CLI and prefers SSH remotes.



usage() {
  echo "Usage: $(basename "$0") [<title>] [options]" >&2
  echo "" >&2
  echo "Options:" >&2
  echo "  --issue <number>     Issue number this PR addresses. Omitted: inferred from the branch name ([<type>/]<issue>-<slug>); if not inferable, an error asks for --issue or --no-issue" >&2
  echo "  --no-issue           Explicitly indicate this PR has no associated issue" >&2
  echo "  <title>              PR title. Optional for non-squash repos without a message (the issue title is used); required for squash-merge repos, where it must follow Conventional Commits" >&2
  echo "  --base <branch>      Target branch for PR (default: repository's default branch)" >&2
  echo "                        Examples: master, main, develop, release/v1.0" >&2
  echo "  --repo-dir <path>    Repository directory (default: current)" >&2
  echo "  --branch <name>      Source branch for PR (default: current branch)" >&2
  echo "  --body <text>        PR body text" >&2
  echo "  --body-file <file>   Read PR body from a file" >&2
  echo "  --draft              Create as draft" >&2
  echo "  --reviewer <handle>  Add a reviewer (can be repeated)" >&2
  echo "  --assignee <handle>  Add an assignee (default: @me)" >&2
  echo "  --label <name>       Add a label (can be repeated)" >&2
  echo "  --at <hash-or-title> Partial-branch mode: open the PR from a merge" >&2
  echo "                       branch (merge/<short-hash>-<branch>) created at the" >&2
  echo "                       chosen commit — for trailing merges of a ready prefix" >&2
  echo "                       while work continues; interactive commit picker when" >&2
  echo "                       the value is 'pick'" >&2
  exit "$EXIT_GENERAL_ERROR"
}

PR_TITLE=""
PR_BODY=""
REPO_DIR="$(pwd)"
TARGET_BRANCH=""
SOURCE_BRANCH=""
DRAFT="false"
BODY_FILE=""
REVIEWERS=()
ASSIGNEES=("@me")
LABELS=()
ISSUE_NUMBER=""
NO_ISSUE="false"
AT_COMMIT=""

POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue)
      ISSUE_NUMBER="$2"; shift 2 ;;
    --no-issue)
      NO_ISSUE="true"; shift ;;
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --branch)
      SOURCE_BRANCH="$2"; shift 2 ;;
    --base)
      TARGET_BRANCH="$2"; shift 2 ;;
    --body)
      PR_BODY="$2"; shift 2 ;;
    --body-file)
      BODY_FILE="$2"; shift 2 ;;
    --draft)
      DRAFT="true"; shift ;;
    --reviewer)
      REVIEWERS+=("$2"); shift 2 ;;
    --assignee)
      ASSIGNEES+=("$2"); shift 2 ;;
    --label)
      LABELS+=("$2"); shift 2 ;;
    --at)
      AT_COMMIT="$2"; shift 2 ;;
    -h|--help)
      usage ;;
    *)
      POSITIONAL+=("$1"); shift ;;
  esac
done
set -- "${POSITIONAL[@]}"

PR_TITLE="${1:-}"
# Title is optional: non-squash repos without a supplied message adopt the
# issue title (validated later, after issue resolution).

PR_TITLE="${1:-}"

# Issue inference: with neither --issue nor --no-issue, derive the number from
# the branch name — the org's branch convention is [<type>/]<issue>-<slug>
# (e.g. 29-refactor-allow-non-github-adaptation, feat/29-fix-thing). The first
# numeric segment after any folder prefix is the issue number. An
# un-inferable branch is an error, not a silent no-issue: an unintended
# no-issue PR skips close-out linkage.
if [ -z "$ISSUE_NUMBER" ] && [ "$NO_ISSUE" != "true" ]; then
  BRANCH_NAME="$(git -C "$REPO_DIR" branch --show-current 2>/dev/null)"
  BRANCH_LEAF="${BRANCH_NAME##*/}"
  INFERRED_ISSUE=""
  [[ "$BRANCH_LEAF" =~ ^([0-9]+) ]] && INFERRED_ISSUE="${BASH_REMATCH[1]}"
  if [ -z "$INFERRED_ISSUE" ]; then
    echo "Error: No issue passed (--issue) and none inferable from branch name '${BRANCH_NAME:-<none>}' — pass --issue <number> or --no-issue." >&2
    exit "$EXIT_MISUSE"
  fi
  ISSUE_NUMBER="$INFERRED_ISSUE"
  echo "Inferred issue #$ISSUE_NUMBER from branch '$BRANCH_NAME'." >&2
fi

# Read body from file if --body-file was given
if [ -n "$BODY_FILE" ]; then
  [ -f "$BODY_FILE" ] || { echo "Error: body file not found: $BODY_FILE" >&2; exit "$EXIT_GENERAL_ERROR"; }
  PR_BODY="$(cat "$BODY_FILE")"
fi

# (Issue requirement is enforced above: --issue, --no-issue, or branch-name
# inference — an un-inferable branch errors with guidance there.)

if [ -n "$ISSUE_NUMBER" ] && [ "$NO_ISSUE" = "true" ]; then
  echo "Error: Cannot specify both --issue and --no-issue." >&2
  exit "$EXIT_GENERAL_ERROR"
fi

if [ -n "$ISSUE_NUMBER" ]; then
  # Validate issue number using library function
  if ! validate_issue_number "$ISSUE_NUMBER"; then
    echo "Error: Issue number must be numeric and positive." >&2
    exit $EXIT_MISUSE
  fi
fi

# Repo spec for provider reads: derived from the target repo's origin remote
# (pr-create runs with --repo-dir from any cwd, so the cwd-resolution leg of
# provider_repo_target does not apply). The web URL's host prefix is stripped,
# leaving the provider spec (owner/repo).
ORIGIN_URL="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null)"
# Guarded pipeline: a provider that can't parse this remote returns 1, and
# under set -euo pipefail an unguarded failing substitution would kill the
# script before the provider_repo_target fallback below could engage.
REPO_SPEC=""
REPO_SPEC="$(provider_remote_to_web "$ORIGIN_URL" 2>/dev/null | sed -E "s#https?://[^/]+/##; s#\.git\$##" || true)"
[ -n "$REPO_SPEC" ] || REPO_SPEC="$(provider_repo_target 2>/dev/null || true)"

# Squash detection: the Conventional Commits gate matters only when a squash
# merge would adopt this title as the commit subject. Live repo settings are
# ground truth (a fork can flip them after provisioning); a failed read is
# treated as non-squash — rebase is the org's standard, so permissive is the
# safe default.
repo_is_squash() {
  [ -n "$REPO_SPEC" ] || return 1
  local enabled
  enabled="$(provider_repos_view "$REPO_SPEC" --json allowSquashMerge -q .allowSquashMerge 2>/dev/null)" || return 1
  [ "$enabled" = "true" ]
}

ISSUE_TITLE=""
if [ -n "$ISSUE_NUMBER" ] && [ -n "$REPO_SPEC" ]; then
  ISSUE_TITLE="$(provider_issues_view "$REPO_SPEC" "$ISSUE_NUMBER" --json title -q .title 2>/dev/null)" || ISSUE_TITLE=""
fi

if [ -z "$PR_TITLE" ]; then
  # No message given: non-squash repos adopt the issue title as the PR title
  # (the squash commit path keeps an explicit title mandatory — the title
  # would become the commit subject).
  if repo_is_squash; then
    echo "Error: A PR title is required when the repository uses squash merges (the title becomes the commit subject)." >&2
    exit "$EXIT_GENERAL_ERROR"
  fi
  [ -n "$ISSUE_TITLE" ] || { echo "Error: No PR title given and the issue title could not be fetched — pass a title explicitly." >&2; exit "$EXIT_GENERAL_ERROR"; }
  PR_TITLE="$ISSUE_TITLE"
fi

if repo_is_squash; then
  CC_REGEX='^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert|patch|minor|major)(\([^)]+\))?!?: .+'
  if ! [[ "$PR_TITLE" =~ $CC_REGEX ]]; then
    echo "Error: PR title must follow Conventional Commits (e.g., feat(api): add feature) — this repository uses squash merges, so the title becomes the commit subject." >&2
    exit "$EXIT_GENERAL_ERROR"
  fi
fi

cd "$REPO_DIR" 2>/dev/null || { echo "Failed to change directory to $REPO_DIR" >&2; exit "$EXIT_GENERAL_ERROR"; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Directory $REPO_DIR is not a git repository." >&2; exit "$EXIT_GENERAL_ERROR"; }

# Refuse to open a PR if implementation plan files are present in the repo root
mapfile -t PLAN_FILES < <(find . -maxdepth 1 \( -name 'Plan-*.md' -o -name 'Implementation_plan-*.md' \) 2>/dev/null | sort)
if [ ${#PLAN_FILES[@]} -gt 0 ]; then
  echo "Error: Implementation plan file(s) found in the repo root:" >&2
  for f in "${PLAN_FILES[@]}"; do
    echo "  ${f#./}" >&2
  done
  echo "These are working files and must not be committed. Move the content to the associated GitHub issue, then delete the file(s) before opening a PR." >&2
  exit "$EXIT_GENERAL_ERROR"
fi

# Warn if implementation plan files are present in .local-artifacts/
mapfile -t PLAN_FILES < <(find .local-artifacts -maxdepth 1 \( -name 'Plan-*.md' -o -name 'Implementation_plan-*.md' \) 2>/dev/null | sort)
if [ ${#PLAN_FILES[@]} -gt 0 ]; then
  echo "Warning: Implementation plan file(s) found in .local-artifacts/:" >&2
  for f in "${PLAN_FILES[@]}"; do
    echo "  ${f#./}" >&2
  done
  echo "Make sure these are synced and then eliminate them from the .local-artifacts folder" >&2
fi

if ! git diff-index --quiet HEAD --; then
  echo "There are uncommitted or staged changes." >&2
  exit "$EXIT_GENERAL_ERROR"
fi

CURRENT_BRANCH=${SOURCE_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
if [[ "$CURRENT_BRANCH" == "review/"* ]]; then
  echo "This script cannot be run on a review/* branch." >&2
  exit "$EXIT_GENERAL_ERROR"
fi

if [ -z "$TARGET_BRANCH" ]; then
  TARGET_BRANCH=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
  TARGET_BRANCH=${TARGET_BRANCH:-main}
fi
if ! git show-ref --quiet "refs/remotes/origin/$TARGET_BRANCH"; then
  echo "Target branch origin/$TARGET_BRANCH not found." >&2
  exit $EXIT_API_FAILURE
fi
if [ "$CURRENT_BRANCH" = "$TARGET_BRANCH" ]; then
  echo "Current branch matches target ($TARGET_BRANCH); switch to a feature branch first." >&2
  exit "$EXIT_GENERAL_ERROR"
fi

# Fail fast: reject PR creation when the merge range carries WIP commits
# (docs/Commit-Conventions.md — WIP never reaches master). Partial-branch
# merge branches (merge/<short-hash>-*) scan their own range instead.
# Partial-branch mode (--at) skips the feature-branch guard by design: its
# whole purpose is opening a PR from a ready prefix while WIP continues past
# it on the feature branch. The merge branch it creates carries only the
# prefix commits and gets its own strict guard below — a merge branch must
# never carry WIP (docs/Commit-Conventions.md).
if [ -z "$AT_COMMIT" ]; then
  if [[ "$CURRENT_BRANCH" == merge/* ]]; then
    GUARD_RANGE="${TARGET_BRANCH}..${CURRENT_BRANCH}"
  else
    GUARD_RANGE="${TARGET_BRANCH}..HEAD"
  fi
  if ! wip_range_guard "$GUARD_RANGE" "PR creation range"; then
    exit "$EXIT_GENERAL_ERROR"
  fi
fi

# --at: open the PR from a merge branch created at the chosen commit
# (merge/<short-hash>-<branch>), so a ready prefix can merge while work
# continues on the feature branch.
if [ -n "$AT_COMMIT" ]; then
  if [ "$AT_COMMIT" = "pick" ]; then
    mapfile -t COMMITS < <(git log "${TARGET_BRANCH}..${CURRENT_BRANCH}" --format='%h%x09%s' 2>/dev/null)
    if [ ${#COMMITS[@]} -eq 0 ]; then
      echo "No commits found in ${TARGET_BRANCH}..${CURRENT_BRANCH} to pick from." >&2
      exit "$EXIT_GENERAL_ERROR"
    fi
    if [ -t 0 ] && command -v fzf >/dev/null 2>&1; then
      AT_COMMIT="$(printf '%s\n' "${COMMITS[@]}" | fzf --with-nth=2 --delimiter='\t' --header='Pick the commit to merge up to' | cut -f1)"
    else
      echo "Non-interactive mode — pick a commit:" >&2
      for i in "${!COMMITS[@]}"; do
        echo "  $((i + 1)). ${COMMITS[$i]}" >&2
      done
      echo "Re-run with --at <hash> (non-interactive pick is not supported)." >&2
      exit "$EXIT_GENERAL_ERROR"
    fi
  fi
  # Resolve hash-or-title to a full hash
  RESOLVED_HASH="$(git rev-parse --verify --quiet "${AT_COMMIT}^{commit}" || true)"
  if [ -z "$RESOLVED_HASH" ]; then
    RESOLVED_HASH="$(git log "${TARGET_BRANCH}..${CURRENT_BRANCH}" --format='%H %s' 2>/dev/null | awk -v t="$AT_COMMIT" 'index($0, t){print $1; exit}')"
  fi
  [ -n "$RESOLVED_HASH" ] || { echo "Error: --at '$AT_COMMIT' does not resolve to a commit in ${TARGET_BRANCH}..${CURRENT_BRANCH}." >&2; exit "$EXIT_GENERAL_ERROR"; }
  # Remember where the user was and put them back on EVERY exit path (guard
  # failure, push failure, existing PR, create failure, success): the merge
  # branch is a vehicle for the PR, and their next commit must not silently
  # land on it.
  ORIGINAL_BRANCH="$CURRENT_BRANCH"
  restore_original_branch() {
    local now
    now="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [ -n "$now" ] && [ "$now" != "$ORIGINAL_BRANCH" ]; then
      git checkout -q "$ORIGINAL_BRANCH" 2>/dev/null || true
    fi
  }
  trap restore_original_branch EXIT
  SHORT_HASH="$(git rev-parse --short "$RESOLVED_HASH")"
  MERGE_BRANCH="merge/${SHORT_HASH}-${CURRENT_BRANCH}"
  if git show-ref --verify --quiet "refs/heads/${MERGE_BRANCH}"; then
    echo "Merge branch ${MERGE_BRANCH} already exists — reusing it." >&2
    git checkout -q "$MERGE_BRANCH"
  else
    git checkout -q -b "$MERGE_BRANCH" "$RESOLVED_HASH"
  fi
  CURRENT_BRANCH="$MERGE_BRANCH"
  if ! wip_range_guard "${TARGET_BRANCH}..${CURRENT_BRANCH}" "merge-branch range"; then
    exit "$EXIT_GENERAL_ERROR"   # the EXIT trap restores the original branch
  fi
  # The merge branch exists only locally; the provider opens a PR from a
  # remote head, so it must be pushed first (a PR from an unpushed head fails).
  if ! git push -q -u origin "$MERGE_BRANCH"; then
    echo "Error: could not push $MERGE_BRANCH to origin — no PR was created." >&2
    exit "$EXIT_API_FAILURE"
  fi
fi

# Get repo spec
read -ra repo_spec <<< "$(get_repo_spec)"

existing_url=$(provider_prs_list "${repo_spec[0]:-}" --state open --head "$CURRENT_BRANCH" --json url --jq '.[0].url' 2>/dev/null || true)
if [ -n "$existing_url" ]; then
  echo "An open PR already exists for $CURRENT_BRANCH: $existing_url" >&2
  echo "$existing_url"
  exit 0
fi

# Add issue reference to PR body if provided
if [ -n "$ISSUE_NUMBER" ]; then
  if [ -n "$PR_BODY" ]; then
    PR_BODY="Closes #${ISSUE_NUMBER}

${PR_BODY}"
  else
    PR_BODY="Closes #${ISSUE_NUMBER}"
  fi
fi

args=(--title "$PR_TITLE" --body "$PR_BODY" --base "$TARGET_BRANCH" --head "$CURRENT_BRANCH")
[ "$DRAFT" = "true" ] && args+=(--draft)
for reviewer in "${REVIEWERS[@]}"; do
  args+=(--reviewer "$reviewer")
done
for assignee in "${ASSIGNEES[@]}"; do
  args+=(--assignee "$assignee")
done
for label in "${LABELS[@]}"; do
  ensure_label "$label" "${repo_spec[@]}"
  args+=(--label "$label")
done

echo "Creating PR from $CURRENT_BRANCH -> $TARGET_BRANCH..." >&2
# The creator's own status decides success, and its stderr never feeds the URL
# scan: a warning or error text containing a URL must not become "the PR".
create_err="$(mktemp)"
set +e
create_out="$(provider_prs_create "${repo_spec[0]:-}" "${args[@]}" 2>"$create_err")"
status=$?
set -e
if [ $status -eq 0 ]; then
  PR_URL="$(printf '%s\n' "$create_out" | provider_extract_url)" || status=$?
  [ $status -eq 0 ] || echo "The provider reported success but printed no PR URL." >&2
fi

if [ $status -ne 0 ]; then
  cat "$create_err" >&2
  [ -z "${create_out:-}" ] || echo "$create_out" >&2
  rm -f "$create_err"
  echo "Failed to create PR." >&2
  exit $status
fi
rm -f "$create_err"

# Fire skill event signals for issues linked in the PR body (best-effort).
if [ -n "$PR_URL" ]; then
  PR_NUM=$(basename "$PR_URL")
  source "$(dirname "$0")/../lib/pr-events.bash" 2>/dev/null || true
  pr_events_signal_for_pr created "$PR_NUM" 2>/dev/null || true
fi

# --at mode: the EXIT trap returns the user to the branch they started on.

echo "$PR_URL"