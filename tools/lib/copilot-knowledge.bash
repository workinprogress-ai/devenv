#!/bin/bash

# Guard against multiple sourcing.
if [ -n "${_COPILOT_KNOWLEDGE_LOADED:-}" ]; then
    return 0
fi
readonly _COPILOT_KNOWLEDGE_LOADED=1

# Build GitHub-compatible basic auth header for git HTTPS operations.
build_github_basic_auth_header() {
    local token="$1"
    local auth
    auth=$(printf 'x-access-token:%s' "$token" | base64 -w0)
    echo "AUTHORIZATION: basic $auth"
}

# Pull latest Copilot knowledge on container start (non-blocking).
# No-op when copilot/knowledge is not an initialized git repository.
pull_copilot_knowledge_on_container_start() {
    local toolbox_root="$1"
    local repo_dir="$toolbox_root/copilot/knowledge"
    local branch

    [ -d "$repo_dir/.git" ] || return 0

    branch=$(git -C "$repo_dir" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
    [ -n "$branch" ] || branch=$(git -C "$repo_dir" symbolic-ref --short HEAD 2>/dev/null)
    [ -n "$branch" ] || branch="main"

    if [ -n "${GH_TOKEN:-}" ]; then
        local header
        header=$(build_github_basic_auth_header "$GH_TOKEN")
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
