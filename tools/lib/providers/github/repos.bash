#!/usr/bin/env bash
# github/repos.bash - GitHub implementation of the repos domain facade.
#
# Implements provider_repos_* functions (live contract: tools/lib/providers/README.md):
# view / list / create / edit / default-branch probe / protection / perms,
# plus provider_repo_target — the canonical repo-targeting normalizer the
# other domain modules and slice-3 routing build on (five idiom families:
# -R flag, GH_REPO= env, args-array pass-through, URL interpolation, cwd
# resolution). Contract: return non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_GITHUB_REPOS_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_GITHUB_REPOS_LOADED=1

# Logging fallback when error-handling.bash isn't loaded.
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

# Self-heal: the neutral repo-target resolver (provider_repo_target /
# provider_repo_split) lives in provider-core; source it when this module
# is loaded standalone (the canonical loader sources core first and the
# guard is a no-op there).
if ! declare -F provider_repo_target >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/provider-core.bash"
fi

# ============================================================================
# Repo-target normalization: provider hooks over the core resolver
# ============================================================================
# provider_repo_target / provider_repo_split live in provider-core (the
# neutral chain). GitHub's two provider-specific legs live here as hooks.

# GH's own env variable: consumed provider-internally (not a devenv alias).
# Only full owner/repo forms pass through; a basename-only GH_REPO is
# invalid for -R and yields empty.
_provider_repo_env_extra() {
    if [ -n "${GH_REPO:-}" ] && [[ "$GH_REPO" == */* ]]; then
        echo "$GH_REPO"
        return 0
    fi
    return 0
}

# Cwd leg: org identity + git root basename, both legs must resolve.
_provider_repo_cwd_spec() {
    local org repo_name
    org=$(provider_org_get 2>/dev/null) || org=""
    repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
    if [ -n "$org" ] && [ -n "$repo_name" ]; then
        echo "${org}/${repo_name}"
        return 0
    fi
    return 0
}

# ============================================================================
# Reads
# ============================================================================

# View a repo.
# Usage: provider_repos_view [repo] [--json FIELDS]
# gh ≥2.95 takes the repository positionally on `gh repo view`; `-R` is no
# longer accepted on the repo command family (it remains valid on the
# issue/pr/run families).
provider_repos_view() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    if [ -n "$repo" ]; then
        gh repo view "$repo" "$@"
    else
        gh repo view "$@"
    fi
}

# List an org's repos.
# Usage: provider_repos_list ORG [--limit N] [--json FIELDS]
provider_repos_list() {
    local org="$1"; shift
    gh repo list "$org" "$@"
}

# Probe default branch (returns non-zero when the repo is unreachable).
# Usage: provider_repos_default_branch REPO
provider_repos_default_branch() {
    gh api "repos/$1" --jq '.default_branch' 2>/dev/null
}

# Whether a repository has at least one commit (templates may 409 while
# syncing; the caller polls).
# Usage: provider_repos_commits_count REPO  -> exit 0 non-empty, 1 empty/unready
provider_repos_commits_count() {
    local response
    response=$(gh api "repos/$1/commits?per_page=1" 2>/dev/null) || return 1
    # jq locally: gh --jq availability aside, the response is an array whose
    # length is the page size (<= per_page); >=1 means the repo has commits.
    [ "$(printf '%s' "$response" | jq 'length' 2>/dev/null)" -ge 1 ]
}

# ============================================================================
# Mutations
# ============================================================================

# Create a repo.
# Usage: provider_repos_create NAME [FLAGS]
provider_repos_create() {
    local name="$1"; shift
    gh repo create "$name" "$@"
}

# Edit a repo (settings flips: template, visibility, etc.).
# Usage: provider_repos_edit REPO [FLAGS]
provider_repos_edit() {
    local repo="$1"; shift
    gh repo edit "$repo" "$@"
}

# Protect a branch (REST PUT, per git-operations).
# Usage: provider_repos_protect_branch REPO BRANCH PAYLOAD_FILE
provider_repos_protect_branch() {
    local repo="$1" branch="$2" payload="$3"
    if [[ "$repo" != */* ]]; then
        log_error "provider_repos_protect_branch: '$repo' is not owner/repo form"
        return 1
    fi
    gh api -X PUT --input "$payload" "repos/$repo/branches/$branch/protection" >/dev/null 2>&1
}

# Grant team access to a repo (REST PUT, per repo-types).
# Usage: provider_repos_team_put ORG TEAM_SLUG REPO [PERMISSION]
provider_repos_team_put() {
    local org="$1" team="$2" repo="$3"
    local perm_args=()
    [ -n "${4:-}" ] && perm_args=(-f "permission=$4")
    gh api -X PUT "orgs/$org/teams/$team/repos/$repo" "${perm_args[@]}" >/dev/null 2>&1
}

# Grant collaborator access to a repo (REST PUT, per repo-types).
# Usage: provider_repos_collaborator_put REPO USERNAME [FLAGS...]
provider_repos_collaborator_put() {
    local repo="$1" user="$2"
    shift 2
    gh api -X PUT "repos/$repo/collaborators/$user" "$@" >/dev/null 2>&1
}

# Patch repo settings (REST PATCH, per repo-types/git-operations).
# Usage: provider_repos_patch REPO -f KEY=VALUE ...
provider_repos_patch() {
    local repo="$1"; shift
    gh api -X PATCH "repos/$repo" "$@"
}

# Generic REST API escape hatch for provider-specific surfaces without a
# dedicated verb (repo-types PATCH flows, artifact reads, graphql traversals).
# Usage: provider_api METHOD ENDPOINT [FLAGS...]
# METHOD "graphql" maps to `gh api graphql` (no -X, matching gh's native form).
provider_api() {
    local method="$1"
    local endpoint="$2"
    shift 2
    if [ "$method" = "graphql" ]; then
        gh api graphql "$endpoint" "$@"
    else
        gh api -X "$method" "$endpoint" "$@"
    fi
}

# Paginated GET for REST surfaces that page (artifact/package reads).
# Usage: provider_api_paginate ENDPOINT [--jq JQPROG]
provider_api_paginate() {
    local endpoint="$1"
    shift
    gh api "$endpoint" --paginate "$@"
}

# List packages via a resolved endpoint (org or repo scope). Domain verb for
# the artifact layer — neutral code never rides provider_api directly; the
# caller owns endpoint/filter semantics, the provider owns transport.
# Usage: provider_org_packages_list ENDPOINT [-f KEY=VALUE ...]
provider_org_packages_list() {
    local endpoint="${1:?endpoint required}"
    shift
    gh api "$endpoint" --paginate --method GET "$@"
}

# List versions of one package via a resolved endpoint. Same contract as the
# packages list verb.
# Usage: provider_org_package_versions ENDPOINT
provider_org_package_versions() {
    local endpoint="${1:?endpoint required}"
    shift
    gh api "$endpoint" --paginate "$@"
}
