#!/bin/bash
set -euo pipefail

# Update all repositories under ./repos using the GitHub-focused repo-get.sh

script_folder="${DEVENV_TOOLS:-.}/scripts"
repos_dir="$DEVENV_ROOT/repos"

readonly MAX_PARALLEL_JOBS=4
readonly DEFAULT_PARALLEL_JOBS=2

parallel_jobs=$DEFAULT_PARALLEL_JOBS
while [[ $# -gt 0 ]]; do
    case "$1" in
        -j|--jobs)
            [[ -n "${2:-}" && "$2" =~ ^[0-9]+$ ]] || { echo "ERROR: --jobs requires a numeric argument" >&2; exit 1; }
            parallel_jobs="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $(basename "$0") [--jobs N]"; echo "Update all repositories in $repos_dir in parallel."; exit 0 ;;
        *)
            echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
    esac
done

if [ "$parallel_jobs" -gt "$MAX_PARALLEL_JOBS" ]; then
    echo "WARNING: Requested $parallel_jobs jobs, limiting to $MAX_PARALLEL_JOBS." >&2
    parallel_jobs=$MAX_PARALLEL_JOBS
fi

if [ ! -d "$repos_dir" ]; then
  echo "Target directory '$repos_dir' does not exist." >&2
  exit 1
fi

repo_dirs=()
for repo in "$repos_dir"/*; do
    if [ -d "$repo/.git" ]; then
        repo_dirs+=("$repo")
    fi
done

repo_count=${#repo_dirs[@]}
if [ "$repo_count" -eq 0 ]; then
    echo "No git repositories found in $repos_dir" >&2
    exit 0
fi

echo "Updating $repo_count repositories with $parallel_jobs parallel jobs..." >&2
start_time=$(date +%s)

REPO_GET_SCRIPT="$script_folder/repo-get.sh"

update_single_repo() {
    local repo="$1"
    local repo_name
    repo_name=$(basename "$repo")
    echo "[$repo_name] Starting update..." >&2
    if cd "$repo" 2>/dev/null; then
        if "$REPO_GET_SCRIPT" 2>&1 | sed "s/^/[$repo_name] /"; then
            echo "[$repo_name] ✓ Update completed" >&2
            return 0
        else
            echo "[$repo_name] ✗ Update failed" >&2
            return 1
        fi
    else
        echo "[$repo_name] ✗ Failed to cd into directory" >&2
        return 1
    fi
}

export REPO_GET_SCRIPT
export -f update_single_repo

printf '%s\n' "${repo_dirs[@]}" | xargs -P "$parallel_jobs" -I {} bash -c 'update_single_repo "$@"' _ {}
exit_code=$?

end_time=$(date +%s)
echo "" >&2
echo "All repositories processed in $((end_time - start_time))s using $parallel_jobs parallel jobs." >&2

exit $exit_code