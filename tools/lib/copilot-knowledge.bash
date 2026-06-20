#!/bin/bash

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

    [ -d "$repo_dir/.git" ] || return 0

    (
        local branch header
        branch=$(git -C "$repo_dir" symbolic-ref --short HEAD 2>/dev/null)
        [ -n "$branch" ] || branch="master"

        if [ -n "${GH_TOKEN:-}" ]; then
            header=$(build_github_basic_auth_header "$GH_TOKEN")
            git -C "$repo_dir" -c http.extraheader="$header" fetch --prune origin >/dev/null 2>&1 || exit 0
            git -C "$repo_dir" -c http.extraheader="$header" pull --ff-only origin "$branch" >/dev/null 2>&1 || true
        else
            git -C "$repo_dir" fetch --prune origin >/dev/null 2>&1 || exit 0
            git -C "$repo_dir" pull --ff-only origin "$branch" >/dev/null 2>&1 || true
        fi
    ) >/dev/null 2>&1 &
}
