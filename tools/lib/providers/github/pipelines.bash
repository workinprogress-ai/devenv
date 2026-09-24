#!/usr/bin/env bash
# github/pipelines.bash - GitHub implementation of the pipelines domain
# facade (formerly the "actions" domain; renamed to match the tool vocabulary).
#
# Implements the provider_pipelines_* verb set (live contract: providers README):
# run list/view/watch/rerun/cancel/artifacts + workflow list/run. Polling
# (wait_for_workflow_runs-style) stays at the domain layer, never core.
# Contract: return non-zero + log_error on failure; never exit. Requires
# provider-core.bash sourced first.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_GITHUB_ACTIONS_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_GITHUB_ACTIONS_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi

if ! declare -F provider_gh_repo_args >/dev/null; then
    provider_gh_repo_args() {
        local -n __arr="$1"
        local __repo="${2:-}"
        if [ -n "$__repo" ]; then
            __arr=("-R" "$__repo")
        else
            __arr=()
        fi
    }
fi

# Standalone-sourcing contract: the capability registry lives in
# provider-core; source it unconditionally (its own loaded-guard makes
# re-sourcing a no-op) so this module loads alone or under provider_load.
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/provider-core.bash"
provider_declare_capability pipelines

# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

# List workflow runs.
# Usage: provider_pipelines_run_list [repo] [--branch B] [--limit N] [FLAGS]
provider_pipelines_run_list() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh run list "${repo_args[@]}" "$@"
}

# View a workflow run.
# Usage: provider_pipelines_run_view [repo] RUN_ID
provider_pipelines_run_view() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* && ! "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local run_id="$1"
    shift
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh run view "$run_id" "${repo_args[@]}" "$@"
}

# Watch a run to completion (polling belongs here, at the domain layer).
# Usage: provider_pipelines_run_watch [repo] RUN_ID
provider_pipelines_run_watch() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* && ! "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh run watch "$1" "${repo_args[@]}"
}

# List workflows.
# Usage: provider_pipelines_workflow_list [repo]
provider_pipelines_workflow_list() {
    local repo="$1"
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh workflow list "${repo_args[@]}"
}

# Fetch run artifacts metadata (REST surface, per pipelines-artifacts).
# Usage: provider_pipelines_run_artifacts REPO RUN_ID
provider_pipelines_run_artifacts() {
    local repo="$1" run_id="$2"
    gh api "/repos/$repo/actions/runs/$run_id/artifacts" --jq '.artifacts' 2>/dev/null
}

# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

# Trigger a workflow.
# Usage: provider_pipelines_workflow_run [repo] WORKFLOW [--ref REF] [FLAGS]
provider_pipelines_workflow_run() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local workflow="$1"; shift
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh workflow run "$workflow" "${repo_args[@]}" "$@"
}

# Rerun a workflow run.
# Usage: provider_pipelines_run_rerun [repo] RUN_ID
provider_pipelines_run_rerun() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* && ! "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local run_id="$1"; shift
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh run rerun "$run_id" "${repo_args[@]}"
}

# Cancel a run.
# Usage: provider_pipelines_run_cancel REPO RUN_ID
provider_pipelines_run_cancel() {
    local repo="$1" run_id="$2"
    gh run cancel -R "$repo" "$run_id"
}

# Download run artifacts.
# Usage: provider_pipelines_run_download [repo] RUN_ID [FLAGS]
provider_pipelines_run_download() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* && ! "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local run_id="$1"; shift
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh run download "$run_id" "${repo_args[@]}" "$@"
}

# ---------------------------------------------------------------------------
# Domain-local polling helper (provider-loader parity, facade-shaped)
# ---------------------------------------------------------------------------

# Wait until no runs on a branch are queued/in_progress. Returns 0 when the
# branch settles; 1 on timeout. Sleep loop lives here by design.
# Usage: provider_pipelines_wait_for_branch REPO BRANCH [TIMEOUT_POLLS]
provider_pipelines_wait_for_branch() {
    local repo="$1" branch="$2" max_polls="${3:-30}"
    local poll active
    for ((poll = 1; poll <= max_polls; poll++)); do
        active=$(gh run list -R "$repo" --branch "$branch" --limit 10 --json status --jq '[.[] | select(.status == "queued" or .status == "in_progress")] | length' 2>/dev/null) || {
            log_error "provider_pipelines_wait_for_branch: could not query runs for $repo@$branch"
            return 1
        }
        [ "${active:-0}" -eq 0 ] && return 0
        sleep 2
    done
    log_error "provider_pipelines_wait_for_branch: $repo@$branch did not settle within $max_polls polls"
    return 1
}
