#!/bin/bash
# azure/urls.bash - Azure DevOps URL primitives for the url seam.
#
# Host and URL-shape definitions for Azure DevOps Services (cloud). All URL
# construction derives from provider_web_host so a fork retargeting its host
# (Server/on-prem later) edits one function.
#
# URL forms handled:
#   https://dev.azure.com/{org}/{project}/_git/{repo}   (https remote)
#   git@ssh.dev.azure.com:v3/{org}/{project}/{repo}     (ssh remote)
# Web UI: https://dev.azure.com/{org}/{project}/{path}

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_URLS_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_URLS_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi

# Web host for Azure DevOps Services. Single point of host definition:
# provider_extract_url derives its matcher from this.
# Usage: provider_web_host
provider_web_host() {
    printf 'dev.azure.com\n'
}

# Git transport URL for a repo: https://dev.azure.com/{org}/{project}/_git/{repo}.
# Clean URL — the PAT never embeds; auth rides the transport's header or the
# git credential helper.
# Usage: provider_git_transport_url ORG PROJECT REPO
#                             or:  provider_git_transport_url ORG REPO
# The 2-arg form (the shape neutral callers like repo-get use against the
# github seam) is accepted: the project injects from AZURE_DEVOPS_PROJECT
# or the configured [provider] azure_project. Callers MAY pass the resolved
# 3-part spec; providers own arity normalization.
provider_git_transport_url() {
    local org="$1" project="$2" repo="$3"
    if [ -z "$org" ]; then
        log_error "provider_git_transport_url requires org"
        return 1
    fi
    if [ -z "$project" ]; then
        log_error "provider_git_transport_url requires repo (2-arg form: ORG REPO) or a project (3-arg form: ORG PROJECT REPO)"
        return 1
    fi
    if [ -z "$repo" ]; then
        # 2-arg form: $2 was the repo; re-slot it and inject the configured
        # project.
        repo="$project"
        project="${AZURE_DEVOPS_PROJECT:-}"
        if [ -z "$project" ] && [ -f "${DEVENV_TOOLS:-}/lib/config-reader.bash" ] && [ -f "${DEVENV_ROOT:-}/devenv.config" ]; then
            # shellcheck disable=SC1091
            source "${DEVENV_TOOLS}/lib/config-reader.bash"
            if config_init "${DEVENV_ROOT}/devenv.config" 2>/dev/null; then
                project=$(config_read_value "provider" "azure_project" "" 2>/dev/null)
            fi
        fi
        if [ -z "$project" ]; then
            log_error "provider_git_transport_url: 2-arg form requires a configured project (AZURE_DEVOPS_PROJECT or [provider] azure_project)"
            return 1
        fi
    fi
    printf 'https://dev.azure.com/%s/%s/_git/%s\n' "$org" "$project" "$repo"
}

# Org-level base URL (compatibility with the github url seam's shape).
# Usage: provider_git_remote_base ORG [PROJECT]
provider_git_remote_base() {
    local org="${1:-}"
    if [ -z "$org" ]; then
        log_error "provider_git_remote_base requires org"
        return 1
    fi
    printf 'https://dev.azure.com/%s\n' "$org"
}

# Web-UI URL. The repo argument carries org/project/repo in the remote form
# "org/project/repo" (Azure nests one level deeper than GitHub's owner/repo);
# path is repo-relative ("pull/12", "issue/7").
# Usage: provider_web_url ORG/PROJECT/REPO PATH
provider_web_url() {
    local repo="${1:-}"
    local path="${2:-}"
    if [ -z "$repo" ] || [ -z "$path" ]; then
        log_error "provider_web_url requires repo (org/project/repo) and path"
        return 1
    fi
    printf 'https://dev.azure.com/%s/%s\n' "$repo" "$path"
}

# Extract the first web URL from provider output, optionally filtered to a
# path prefix. Mirrors the github seam's derivation: host from
# provider_web_host (single point of definition).
# Usage: printf '%s' "$output" | provider_extract_url [path_prefix]
provider_extract_url() {
    local path_prefix="${1:-}"
    local host_rx
    host_rx=$(provider_web_host | sed 's/\./\\./g')
    local pattern="https://${host_rx}[^[:space:]]+"
    if [ -n "$path_prefix" ]; then
        pattern="https://${host_rx}/[^[:space:]]*/${path_prefix}[^[:space:]]*"
    fi
    local url
    url=$(grep -oE "$pattern" | head -n1)
    [ -n "$url" ] && printf '%s\n' "$url"
}

# Parse an Azure DevOps git remote URL into org/project/repo.
# Accepts https and ssh forms (with or without a .git suffix).
#   https://dev.azure.com/org/project/_git/repo
#   git@ssh.dev.azure.com:v3/org/project/repo
# Usage: azure_parse_remote URL  -> prints "org/project/repo"
azure_parse_remote() {
    local url="$1"
    local org project repo
    case "$url" in
        *dev.azure.com/*_git/*)
            local tail="${url#*dev.azure.com/}"
            tail="${tail#.git}"
            tail="${tail%.git}"
            org="${tail%%/*}"
            local rest="${tail#*/}"
            project="${rest%%/*}"
            rest="${rest#*/_git/}"
            repo="$rest"
            ;;
        git@ssh.dev.azure.com:*)
            local tail="${url#git@ssh.dev.azure.com:v3/}"
            org="${tail%%/*}"
            local rest="${tail#*/}"
            project="${rest%%/*}"
            repo="${rest#*/}"
            repo="${repo%.git}"
            ;;
        *)
            log_error "azure_parse_remote: not a recognized Azure DevOps remote: $url"
            return 1
            ;;
    esac
    if [ -z "$org" ] || [ -z "$project" ] || [ -z "$repo" ]; then
        log_error "azure_parse_remote: could not split $url into org/project/repo"
        return 1
    fi
    printf '%s/%s/%s\n' "$org" "$project" "$repo"
}

# Normalize a git remote URL to the provider's clean https web form.
# Azure remotes (both https dev.azure.com and ssh v3 forms, with or
# without .git) collapse to
# https://dev.azure.com/{org}/{project}/_git/{repo}. Non-matching input
# returns 1.
#
# Usage:
#   web=$(provider_remote_to_web "$remote_url") || echo "not ours"
provider_remote_to_web() {
    local remote="${1:-}"
    local parsed
    if ! parsed=$(azure_parse_remote "$remote" 2>/dev/null); then
        # Not an azure remote — the seam contract: return 1 and let the
        # caller fall back (provider-hosted repos are the caller's concern).
        return 1
    fi
    local org project repo
    org="${parsed%%/*}"
    local rest="${parsed#*/}"
    project="${rest%%/*}"
    repo="${rest#*/}"
    printf 'https://dev.azure.com/%s/%s/_git/%s\n' "$org" "$project" "$repo"
}

# ----------------------------------------------------------------------------
# gh-dialect list projections (shared by every list verb)
# ----------------------------------------------------------------------------

# Apply gh CLI list semantics to a mapped JSON array of records:
#   1. --json FIELD,FIELD  -> per-record projection {field: .field, ...}
#      (unknown fields become null, matching gh's behavior of only emitting
#      known keys — callers that ask for aliases a verb lacks get nulls,
#      never a hard failure, mirroring gh's tolerant projection)
#   2. --jq/-q PROGRAM     -> applied ONCE to the whole array (gh list
#      semantics: '.[0].url' selects from the list, not per record)
# Order matches gh: projection first, then the jq program over the result.
# Usage: azure_apply_gh_list_flags INPUT_JSON [FIELDS] [JQ_PROGRAM]
#   Prints the final output; empty FIELDS and JQ_PROGRAM echo INPUT unchanged.
azure_apply_gh_list_flags() {
    local input="$1" fields="${2:-}" jq_program="${3:-}"
    if [ -n "$fields" ]; then
        input=$(printf '%s' "$input" | jq -c "[.[] | {${fields}}]") || return 1
    fi
    if [ -n "$jq_program" ]; then
        # gh suppresses null jq results (empty output for no-match selects
        # like '.[0].url' over an empty list); raw jq would print "null",
        # which consumers test with [ -n ] — empty means "no PR" to them.
        printf '%s' "$input" | jq -r "$jq_program | if . == null then empty else . end"
        return $?
    fi
    printf '%s' "$input"
}
