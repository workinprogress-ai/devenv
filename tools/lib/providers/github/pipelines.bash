#!/usr/bin/env bash
# github/pipelines.bash - GitHub implementation of the pipelines domain
# facade.
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

if ! declare -F provider_repo_args >/dev/null; then
    provider_repo_args() {
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

if ! declare -F _gh_json_run >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repos.bash"
fi

# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

# List workflow runs. --json/-q use the seam's field names (id, not gh's databaseId).
# Usage: provider_pipelines_run_list [repo] [--branch B] [--limit N] [FLAGS]
provider_pipelines_run_list() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_repo_args repo_args "$repo"
    _gh_json_run '{"id":"databaseId"}' run list "${repo_args[@]}" "$@"
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
    provider_repo_args repo_args "$repo"
    _gh_json_run '{"id":"databaseId"}' run view "$run_id" "${repo_args[@]}" "$@"
}

# Watch a run to completion (polling belongs here, at the domain layer).
# Usage: provider_pipelines_run_watch [repo] RUN_ID [FLAGS]
# Extra gh-dialect flags (e.g. --exit-status) forward to gh run watch.
provider_pipelines_run_watch() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* && ! "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local run_id="$1"; shift
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh run watch "$run_id" "${repo_args[@]}" "$@"
}

# List workflows. Flags (--json FIELDS, -q EXPR, --all, ...) forward to gh.
# Usage: provider_pipelines_workflow_list [repo] [FLAGS]
provider_pipelines_workflow_list() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != -* ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh workflow list "${repo_args[@]}" "$@"
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
    provider_repo_args repo_args "$repo"
    gh workflow run "$workflow" "${repo_args[@]}" "$@"
}

# Rerun a workflow run. Flags (--failed, --debug, ...) forward to gh.
# Usage: provider_pipelines_run_rerun [repo] RUN_ID [FLAGS]
provider_pipelines_run_rerun() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* && ! "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local run_id="$1"; shift
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh run rerun "$run_id" "${repo_args[@]}" "$@"
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
    provider_repo_args repo_args "$repo"
    gh run download "$run_id" "${repo_args[@]}" "$@"
}
