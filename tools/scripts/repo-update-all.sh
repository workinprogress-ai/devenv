#!/bin/bash
set -euo pipefail
source "$DEVENV_TOOLS/lib/repo-operations.bash"

# Update all repositories under ./repos using the GitHub-focused repo-get.sh

script_folder="${DEVENV_TOOLS:-.}/scripts"

# Source repo-operations library

readonly MAX_PARALLEL_JOBS=4
readonly DEFAULT_PARALLEL_JOBS=2

parallel_jobs=$DEFAULT_PARALLEL_JOBS
while [[ $# -gt 0 ]]; do
    case "$1" in
        -j|--jobs)
            [[ -n "${2:-}" && "$2" =~ ^[0-9]+$ ]] || { echo "ERROR: --jobs requires a numeric argument" >&2; exit 1; }
            parallel_jobs="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $(basename "$0") [--jobs N]"
            echo "Update all repositories in repos directory in parallel."
            exit 0 ;;
        *)
            echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
    esac
done

if [ "$parallel_jobs" -gt "$MAX_PARALLEL_JOBS" ]; then
    echo "WARNING: Requested $parallel_jobs jobs, limiting to $MAX_PARALLEL_JOBS." >&2
    parallel_jobs=$MAX_PARALLEL_JOBS
fi

# Get repos directory using library function
repos_dir=$(get_or_create_repos_directory) || {
    echo "ERROR: Could not access repos directory" >&2
    exit 1
}

# Get list of local repositories using library function
repo_list=$(list_local_repositories "$repos_dir")

if [ -z "$repo_list" ]; then
    echo "No git repositories found in $repos_dir" >&2
    exit 0
fi

repo_count=$(echo "$repo_list" | wc -l)
echo "Updating $repo_count repositories with $parallel_jobs parallel jobs..." >&2
start_time=$(date +%s)

REPO_GET_SCRIPT="$script_folder/repo-get.sh"

update_single_repo() {
    local repo_name="$1"
    local repos_base="$2"
    local repo_path="$repos_base/$repo_name"
    
    echo "[$repo_name] Starting update..." >&2
    if cd "$repo_path" 2>/dev/null; then
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
export repos_dir
export -f update_single_repo

echo "$repo_list" | xargs -P "$parallel_jobs" -I {} bash -c 'update_single_repo "$1" "$2"' _ {} "$repos_dir"
exit_code=$?

end_time=$(date +%s)
echo "" >&2
echo "All repositories processed in $((end_time - start_time))s using $parallel_jobs parallel jobs." >&2

exit $exit_code