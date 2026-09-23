#!/usr/bin/env bash
# github/urls.bash - GitHub implementation of the provider URL/host seam.
#
# Single sanctioned home for host-literal URL work: git transport URLs,
# web-UI URL construction, URL extraction from provider/gh output, and host
# detection/normalization of remotes. Scripts and generic libs route through
# these helpers instead of hard-coding github.com; swapping the provider
# swaps this file. Contract: return non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_GITHUB_URLS_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_GITHUB_URLS_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi

# ============================================================================
# Host & transport URLs
# ============================================================================

# The provider's web host (no scheme). Single definition point.
#
# Usage:
#   host=$(provider_web_host)   # github.com
provider_web_host() {
    printf 'github.com\n'
}

# Git transport URL for a repo: https://<host>/<org>/<repo>.git. Clean URL —
# credentials never embed; auth rides gh's credential helper (gh auth
# setup-git).
#
# Usage:
#   url=$(provider_git_transport_url org repo)
#
# Returns:
#   Prints the URL; returns 1 when org or repo is missing.
provider_git_transport_url() {
    local org="${1:-}"
    local repo="${2:-}"
    if [ -z "$org" ] || [ -z "$repo" ]; then
        log_error "provider_git_transport_url requires org and repo"
        return 1
    fi
    printf 'https://github.com/%s/%s.git\n' "$org" "$repo"
}

# Git remote base for an org: https://<host>/<org> — the prefix for
# per-repo transport URLs built as "<base>/<repo>.git".
#
# Usage:
#   base=$(provider_git_remote_base org)
#
# Returns:
#   Prints the base URL; returns 1 when org is missing.
provider_git_remote_base() {
    local org="${1:-}"
    if [ -z "$org" ]; then
        log_error "provider_git_remote_base requires org"
        return 1
    fi
    printf 'https://github.com/%s\n' "$org"
}

# Web-UI URL for a repo-relative path (e.g. "pull/12", "issues/7").
#
# Usage:
#   url=$(provider_web_url org/repo pull/12)
#
# Returns:
#   Prints the URL; returns 1 when repo spec or path is missing.
provider_web_url() {
    local repo="${1:-}"
    local path="${2:-}"
    if [ -z "$repo" ] || [ -z "$path" ]; then
        log_error "provider_web_url requires repo (owner/name) and path"
        return 1
    fi
    printf 'https://github.com/%s/%s\n' "$repo" "$path"
}

# ============================================================================
# URL extraction & host detection
# ============================================================================

# Extract the first host URL from provider/gh output, optionally filtered to
# a path prefix (e.g. "issues/" to pull issue URLs only). Replaces per-script
# `grep -oE 'https://github.com…'` pipelines; the host literal lives here.
#
# Usage:
#   url=$(printf '%s' "$output" | provider_extract_url)          # any URL
#   url=$(printf '%s' "$output" | provider_extract_url issues/)  # path filter
#
# Returns:
#   Prints the first matching URL; returns 1 when none found.
provider_extract_url() {
    local path_prefix="${1:-}"
    # Host comes from provider_web_host (single point of definition): the
    # dots are escaped for the ERE. A provider swapping its host changes
    # provider_web_host and this derivation follows.
    local host_rx
    host_rx=$(provider_web_host | sed 's/\./\\./g')
    local pattern="https://${host_rx}[^[:space:]]+"
    if [ -n "$path_prefix" ]; then
        pattern="https://${host_rx}/[^[:space:]]*/${path_prefix}[^[:space:]]*"
    fi
    local url
    url=$(grep -Eo "$pattern" | head -n1)
    if [ -z "$url" ]; then
        return 1
    fi
    printf '%s\n' "$url"
}

# Normalize a git remote URL to the provider's clean https web form:
# SSH (git@host:owner/repo.git) and https (with or without .git) both
# collapse to https://host/owner/repo. Non-matching input returns 1.
#
# Usage:
#   web=$(provider_remote_to_web "$remote_url") || echo "not ours"
#
# Returns:
#   Prints the normalized URL; returns 1 when the remote is not this
#   provider's host.
provider_remote_to_web() {
    # Matching derives from provider_web_host too — ssh/scp-style, https, and
    # http forms all normalize to the provider's clean https web form.
    local remote="${1:-}"
    local host
    host=$(provider_web_host)
    case "$remote" in
        "git@${host}:"*)
            remote="${remote#git@${host}:}"
            ;;
        "https://${host}/"*)
            remote="${remote#https://${host}/}"
            ;;
        "http://${host}/"*)
            remote="${remote#http://${host}/}"
            ;;
        *)
            return 1
            ;;
    esac
    remote="${remote%.git}"
    printf 'https://%s/%s\n' "$host" "$remote"
}
