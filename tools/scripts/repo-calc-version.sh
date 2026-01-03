#!/usr/bin/env bash
set -euo pipefail

# == Config ==
# Start at 1.0.0 if there are no tags yet (matches your prior behavior)
DEFAULT_START_VERSION="1.0.0"

# == Helpers ==
get_latest_version_tag() {
  # Highest vX.Y.Z tag (lexicographically sorted as versions)
  git tag --list "v[0-9]*.[0-9]*.[0-9]*" \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V \
    | tail -n 1
}

strip_v() {
  sed -E 's/^v//'
}

parse_semver() {
  local v="$1"
  IFS='.' read -r MAJ MIN PAT <<<"$v"
  echo "${MAJ:-0} ${MIN:-0} ${PAT:-0}"
}

# Detects if a commit message is breaking (header "!" OR BREAKING footer)
is_breaking_commit() {
  local msg="$1"

  # Header: type(scope)!: subject  OR type!: subject
  # ^([a-z]+)(\([^)]+\))?(!)?:\s
  if [[ "$msg" =~ ^([a-zA-Z]+)(\([^\)]+\))?(!)?:[[:space:]] ]]; then
    # BASH_REMATCH[3] is "!" if present
    if [[ "${BASH_REMATCH[3]:-}" == "!" ]]; then
      return 0
    fi
  fi

  # Footers: BREAKING CHANGE(S) or BREAKING:
  # Look anywhere in the body
  if grep -qiE '(^|\n)BREAKING (CHANGE|CHANGES):' <<<"$msg"; then
    return 0
  fi
  if grep -qiE '(^|\n)BREAKING:' <<<"$msg"; then
    return 0
  fi

  return 1
}

# Maps a commit header type/scope to bump level: echo "major|minor|patch|none"
commit_bump_from_header() {
  local header="$1"

  # Pull type, optional scope, optional "!"
  if [[ "$header" =~ ^([a-zA-Z]+)(\(([^\)]+)\))?(!)?:[[:space:]] ]]; then
    local type_lc scope bang
    type_lc="$(tr '[:upper:]' '[:lower:]' <<<"${BASH_REMATCH[1]}")"
    scope="${BASH_REMATCH[3]:-}"
    bang="${BASH_REMATCH[4]:-}"

    # Explicit bang always means major (handled earlier as well)
    if [[ "$bang" == "!" ]]; then
      echo "major"; return 0
    fi

    case "$type_lc" in
      # Your explicit types
      major)   echo "major"; return 0 ;;
      minor|feat)    echo "minor"; return 0 ;;
      patch|fix|perf|refactor|style) echo "patch"; return 0 ;;
      breaking) echo "major"; return 0 ;;
      docs)
        # Only docs(README) => patch
        if [[ -n "$scope" && "$(tr '[:lower:]' '[:upper:]' <<<"$scope")" == "README" ]]; then
          echo "patch"; return 0
        fi
        ;;
    esac
  fi

  echo "none"
}

calculate_next_version() {
  local latest_tag="$1"

  local base_version commits_range
  if [[ -n "$latest_tag" ]]; then
    base_version="$(strip_v <<<"$latest_tag")"
    commits_range="${latest_tag}..HEAD"
  else
    base_version="$DEFAULT_START_VERSION"
    commits_range=""
  fi

  read -r major minor patch < <(parse_semver "$base_version")

  # No commits since tag? Just echo base version.
  if [[ -n "$commits_range" ]] && [[ -z "$(git log --oneline "$commits_range")" ]]; then
    echo "$base_version"
    return 0
  fi

  # Bump flags
  local bump_major=0 bump_minor=0 bump_patch=0

  # Iterate commit messages (full body), separated by unit separator (0x1E)
  local sep=$'\x1E'
  local log_format="%B${sep}"
  local log_range="${commits_range:-HEAD}"

  # shellcheck disable=SC2034
  while IFS= read -r -d $'\x1E' commit_msg; do
    # Fast path: any breaking indicator wins
    if is_breaking_commit "$commit_msg"; then
      bump_major=1
      continue
    fi

    # Otherwise look at the header only (first line)
    local header
    header="$(sed -n '1p' <<<"$commit_msg")"

    case "$(commit_bump_from_header "$header")" in
      major) bump_major=1 ;;
      minor) bump_minor=1 ;;
      patch) bump_patch=1 ;;
      *) : ;;
    esac
  done < <(git log "$log_range" --pretty=format:"$log_format")

  if (( bump_major )); then
    major=$((major + 1)); minor=0; patch=0
  elif (( bump_minor )); then
    minor=$((minor + 1)); patch=0
  elif (( bump_patch )); then
    patch=$((patch + 1))
  else
    # No qualifying changes; keep current version
    :
  fi

  echo "${major}.${minor}.${patch}"
}

# == Main ==
latest_tag="$(get_latest_version_tag || true)"
next_version="$(calculate_next_version "${latest_tag:-}")"
echo "$next_version"
