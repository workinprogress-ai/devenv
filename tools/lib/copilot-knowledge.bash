#!/bin/bash

# Guard against multiple sourcing.
if [ -n "${_COPILOT_KNOWLEDGE_LOADED:-}" ]; then
    return 0
fi
readonly _COPILOT_KNOWLEDGE_LOADED=1

# Provider layer: token resolution routes through the auth seam (#35/#36).
# Best-effort load; the fallback branch below covers stripped environments.
if [ -z "${_PROVIDER_CORE_LOADED:-}" ]; then
    _ck_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "$_ck_lib_dir/providers/provider-core.bash" ]; then
        # shellcheck disable=SC1091
        source "$_ck_lib_dir/providers/provider-core.bash"
        provider_detect "${DEVENV_ROOT:-$(dirname "$(dirname "$_ck_lib_dir")")}/devenv.config" 2>/dev/null || PROVIDER_NAME="${PROVIDER_NAME:-github}"
    fi
    unset _ck_lib_dir
fi

# Build GitHub-compatible basic auth header for git HTTPS operations.
build_github_basic_auth_header() {
    local token="$1"
    local auth
    auth=$(printf 'x-access-token:%s' "$token" | base64 -w0)
    echo "AUTHORIZATION: basic $auth"
}

# Background non-blocking --ff-only pull for one synced Copilot-side repo.
# No-op when the checkout dir is not an initialized git repository.
# Usage: pull_copilot_side_repo_on_container_start <repo-dir> <label>
pull_copilot_side_repo_on_container_start() {
    local repo_dir="$1"
    local branch

    [ -d "$repo_dir/.git" ] || return 0

    branch=$(git -C "$repo_dir" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
    [ -n "$branch" ] || branch=$(git -C "$repo_dir" symbolic-ref --short HEAD 2>/dev/null)
    [ -n "$branch" ] || branch="main"

    # Resolve the token through the provider auth seam — never from env,
    # never via raw gh. Same resolution as provider_secret_get (keychain
    # first; falls back to env only when the env token predates the seam
    # and no provider layer is loadable in this stripped context).
    local token=""
    if declare -F provider_secret_get >/dev/null; then
        token=$(provider_secret_get token 2>/dev/null) || true
    else
        token=$(gh auth token 2>/dev/null) || true
    fi
    if [ -n "$token" ]; then
        local header
        header=$(build_github_basic_auth_header "$token")
        nohup env REPO_DIR="$repo_dir" BRANCH="$branch" HEADER="$header" bash -c '
            git -C "$REPO_DIR" -c http.extraheader="$HEADER" fetch --prune origin >/dev/null 2>&1 || exit 0
            git -C "$REPO_DIR" -c http.extraheader="$HEADER" pull --ff-only origin "$BRANCH" >/dev/null 2>&1 || true
        ' >/dev/null 2>&1 &
    else
        nohup env REPO_DIR="$repo_dir" BRANCH="$branch" bash -c '
            git -C "$REPO_DIR" fetch --prune origin >/dev/null 2>&1 || exit 0
            git -C "$REPO_DIR" pull --ff-only origin "$BRANCH" >/dev/null 2>&1 || true
        ' >/dev/null 2>&1 &
    fi
}

# Pull latest Copilot knowledge on container start (non-blocking).
# No-op when copilot/knowledge is not an initialized git repository.
pull_copilot_knowledge_on_container_start() {
    pull_copilot_side_repo_on_container_start "$1/copilot/knowledge"
}

# Pull latest engineering standards on container start (non-blocking).
# No-op when copilot/engineering is not an initialized git repository.
pull_copilot_engineering_on_container_start() {
    pull_copilot_side_repo_on_container_start "$1/copilot/engineering"
}
