#!/bin/bash

################################################################################
# release-operations.bash
# 
# Library for version management, semantic versioning, and release operations.
# Handles version parsing, calculation, bumping, and release configuration.
#
# Dependencies:
#   - error-handling.bash (logging and error utilities)
#   - git-config.bash (git repository utilities)
#   - validation.bash (general validation functions)
#
# Functions exported:
#   - get_latest_version_tag()
#   - parse_semver()
#   - is_breaking_commit()
#   - is_feature_commit()
#   - is_fix_commit()
#   - commit_bump_from_header()
#   - calculate_next_version()
#   - validate_semver()
#   - bump_semver()
#   - check_release_config_supports_custom_types()
#   - get_conventional_commit_type()
#   - get_version_change_type()
#   - strip_version_prefix()
#   - compare_versions()
#
################################################################################

# Prevent double-sourcing this library
if [[ "${_RELEASE_OPERATIONS_LOADED:-}" == "true" ]]; then
  return
fi
_RELEASE_OPERATIONS_LOADED="true"

# Source dependencies
# shellcheck source=/dev/null
source "${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/tools/lib/error-handling.bash"
# shellcheck source=/dev/null
source "${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/tools/lib/git-config.bash"
# shellcheck source=/dev/null
source "${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/tools/lib/validation.bash"

################################################################################
# Get latest version tag from git repository
# Returns highest vX.Y.Z tag (semver sorted)
################################################################################
get_latest_version_tag() {
  git tag --list "v[0-9]*.[0-9]*.[0-9]*" 2>/dev/null \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | sort -V \
    | tail -n 1
}

################################################################################
# Parse semantic version into major, minor, patch components
# Usage: parse_semver "1.2.3"
# Output: "1 2 3"
################################################################################
parse_semver() {
  local version="$1"
  local major minor patch
  
  # Remove leading 'v' if present
  version="${version#v}"
  
  # Parse semver format (X.Y.Z with optional prerelease/metadata)
  if [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
    major="${BASH_REMATCH[1]}"
    minor="${BASH_REMATCH[2]}"
    patch="${BASH_REMATCH[3]}"
  else
    major=0
    minor=0
    patch=0
  fi
  
  echo "${major} ${minor} ${patch}"
}

################################################################################
# Check if commit message indicates breaking changes
# Returns 0 if breaking, 1 otherwise
################################################################################
is_breaking_commit() {
  local msg="$1"
  
  # Check for breaking change header: type(scope)!: subject
  if [[ "$msg" =~ ^([a-zA-Z]+)(\([^\)]+\))?(!)?:[[:space:]] ]]; then
    if [[ "${BASH_REMATCH[3]:-}" == "!" ]]; then
      return 0
    fi
  fi
  
  # Check for BREAKING CHANGE footer
  if grep -qiE '(^|\n)BREAKING[[:space:]]+(CHANGE|CHANGES):' <<<"$msg"; then
    return 0
  fi
  
  # Check for BREAKING footer
  if grep -qiE '(^|\n)BREAKING:' <<<"$msg"; then
    return 0
  fi
  
  return 1
}

################################################################################
# Check if commit is a feature commit
# Returns 0 if feature, 1 otherwise
################################################################################
is_feature_commit() {
  local header="$1"
  
  # shellcheck disable=SC2015
  [[ "$header" =~ ^feat(\([^\)]+\))?:[[:space:]] ]] && return 0 || return 1
}

################################################################################
# Check if commit is a fix commit
# Returns 0 if fix, 1 otherwise
################################################################################
is_fix_commit() {
  local header="$1"
  
  # shellcheck disable=SC2015
  [[ "$header" =~ ^(fix|perf|refactor|style)(\([^\)]+\))?:[[:space:]] ]] && return 0 || return 1
}

################################################################################
# Determine version bump level from commit header
# Returns: "major", "minor", "patch", or "none"
################################################################################
commit_bump_from_header() {
  local header="$1"
  
  # Extract type, scope, and breaking indicator
  if [[ "$header" =~ ^([a-zA-Z]+)(\(([^\)]+)\))?(!)?:[[:space:]] ]]; then
    local type_lc bang
    type_lc="$(tr '[:upper:]' '[:lower:]' <<<"${BASH_REMATCH[1]}")"
    bang="${BASH_REMATCH[4]:-}"
    
    # Explicit bang always means major
    if [[ "$bang" == "!" ]]; then
      echo "major"
      return 0
    fi
    
    # Type-based bumping
    case "$type_lc" in
      major) echo "major"; return 0 ;;
      breaking) echo "major"; return 0 ;;
      minor|feat) echo "minor"; return 0 ;;
      patch|fix|perf|refactor|style) echo "patch"; return 0 ;;
      *) echo "none"; return 0 ;;
    esac
  fi
  
  echo "none"
}

################################################################################
# Calculate next version based on commits since last tag
# Usage: calculate_next_version "v1.0.0" OR calculate_next_version ""
# Returns next semver version without 'v' prefix
################################################################################
calculate_next_version() {
  local latest_tag="$1"
  local default_start_version="${2:-1.0.0}"
  
  local base_version commits_range
  if [[ -n "$latest_tag" ]]; then
    base_version="$(strip_version_prefix "$latest_tag")"
    commits_range="${latest_tag}..HEAD"
  else
    base_version="$default_start_version"
    commits_range=""
  fi
  
  # Parse base version
  local major minor patch
  read -r major minor patch < <(parse_semver "$base_version")
  
  # No commits since tag? Return base version
  if [[ -n "$commits_range" ]] && [[ -z "$(git log --oneline "$commits_range" 2>/dev/null)" ]]; then
    echo "$base_version"
    return 0
  fi
  
  # Track what bumps are needed
  local bump_major=0 bump_minor=0 bump_patch=0
  
  # Iterate through commits
  local sep=$'\x1E'
  local log_format="%B${sep}"
  local log_range="${commits_range:-HEAD}"
  
  # shellcheck disable=SC2034
  while IFS= read -r -d $'\x1E' commit_msg; do
    # Check for breaking changes first
    if is_breaking_commit "$commit_msg"; then
      bump_major=1
      continue
    fi
    
    # Check header for commit type
    local header
    header="$(sed -n '1p' <<<"$commit_msg")"
    
    case "$(commit_bump_from_header "$header")" in
      major) bump_major=1 ;;
      minor) bump_minor=1 ;;
      patch) bump_patch=1 ;;
      *) : ;;
    esac
  done < <(git log "$log_range" --pretty=format:"$log_format" 2>/dev/null)
  
  # Apply bumps in priority order
  if (( bump_major )); then
    major=$((major + 1))
    minor=0
    patch=0
  elif (( bump_minor )); then
    minor=$((minor + 1))
    patch=0
  elif (( bump_patch )); then
    patch=$((patch + 1))
  fi
  
  echo "${major}.${minor}.${patch}"
}

################################################################################
# Validate semantic version format
# Returns 0 if valid, 1 otherwise
################################################################################
validate_semver() {
  local version="$1"
  
  # Remove leading 'v' if present
  version="${version#v}"
  
  # Check semver format: X.Y.Z with optional prerelease and metadata
  if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+((-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?)?$ ]]; then
    return 0
  fi
  
  return 1
}

################################################################################
# Bump semantic version based on change type
# Usage: bump_semver "1.2.3" "minor"
# Returns bumped version without prefix
################################################################################
bump_semver() {
  local version="$1"
  local change_type="$2"
  
  local major minor patch
  read -r major minor patch < <(parse_semver "$version")
  
  case "$change_type" in
    major)
      major=$((major + 1))
      minor=0
      patch=0
      ;;
    minor)
      minor=$((minor + 1))
      patch=0
      ;;
    patch)
      patch=$((patch + 1))
      ;;
    *)
      error_msg "Invalid change type: $change_type (must be major, minor, or patch)"
      return 1
      ;;
  esac
  
  echo "${major}.${minor}.${patch}"
}

################################################################################
# Check if release config supports custom bump types
# Returns 0 if supports custom types, 1 otherwise
################################################################################
check_release_config_supports_custom_types() {
  local repo_path="$1"
  local config_file=""
  
  # Find release config file
  if [[ -f "$repo_path/release.config.js" ]]; then
    config_file="$repo_path/release.config.js"
  elif [[ -f "$repo_path/release.config.cjs" ]]; then
    config_file="$repo_path/release.config.cjs"
  else
    return 1
  fi
  
  # Check for custom type rules
  if grep -q "type: 'patch'" "$config_file" && \
     grep -q "type: 'minor'" "$config_file" && \
     grep -q "type: 'major'" "$config_file"; then
    return 0
  fi
  
  return 1
}

################################################################################
# Get conventional commit type based on change type
# Maps patch/minor/major to conventional commit types
################################################################################
get_conventional_commit_type() {
  local change_type="$1"
  local supports_custom="$2"
  
  if [[ "$supports_custom" == "true" ]]; then
    # Use change type directly if custom types supported
    echo "$change_type"
  else
    # Map to conventional commit types
    case "$change_type" in
      patch) echo "fix" ;;
      minor) echo "feat" ;;
      major) echo "feat!" ;;
      *) error_msg "Invalid change type: $change_type"; return 1 ;;
    esac
  fi
}

################################################################################
# Get version change type description and emoji
# Usage: get_version_change_type "1.0.0" "2.0.0"
# Returns: emoji and color code
################################################################################
get_version_change_type() {
  local version="$1"
  local major minor patch
  
  major=$(echo "$version" | cut -d. -f1)
  minor=$(echo "$version" | cut -d. -f2)
  patch=$(echo "$version" | cut -d. -f3 | cut -d- -f1)
  
  # Determine change type by looking at which component changed
  if [[ "${major:-0}" == "0" ]]; then
    echo "🔴" # Major version 0
  elif [[ "${minor:-0}" == "0" ]] && [[ "${patch:-0}" == "0" ]]; then
    echo "🔷" # Major version bump
  elif [[ "${patch:-0}" == "0" ]]; then
    echo "🟡" # Minor version bump
  else
    echo "🟢" # Patch version bump
  fi
}

################################################################################
# Strip version prefix (v or V) from version string
# Usage: strip_version_prefix "v1.2.3"
# Returns: "1.2.3"
################################################################################
strip_version_prefix() {
  local version="$1"
  echo "${version#v}" | sed 's/^V//'
}

################################################################################
# Compare two semantic versions
# Returns: -1 if first < second, 0 if equal, 1 if first > second
################################################################################
compare_versions() {
  local version1 version2
  version1="$(strip_version_prefix "$1")"
  version2="$(strip_version_prefix "$2")"
  
  # Use sort -V for version comparison
  if [[ "$version1" == "$version2" ]]; then
    echo 0
  elif [[ "$(printf '%s\n' "$version1" "$version2" | sort -V | head -n1)" == "$version1" ]]; then
    echo -1  # version1 < version2
  else
    echo 1   # version1 > version2
  fi
}

# Export all functions
export -f get_latest_version_tag
export -f parse_semver
export -f is_breaking_commit
export -f is_feature_commit
export -f is_fix_commit
export -f commit_bump_from_header
export -f calculate_next_version
export -f validate_semver
export -f bump_semver
export -f check_release_config_supports_custom_types
export -f get_conventional_commit_type
export -f get_version_change_type
export -f strip_version_prefix
export -f compare_versions
