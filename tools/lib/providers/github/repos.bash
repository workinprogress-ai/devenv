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

# ============================================================================
# Repo-targeting normalization: the canonical owner/repo resolver
# ============================================================================

# Normalize a repo target to owner/repo (or empty when cwd-resolved).
# Resolution order:
#   1. explicit owner/repo argument (passes through)
#   2. GITHUB_REPO env
#   3. GH_REPO env (gh's own variable; may be basename-only which is invalid
#      for -R, so only full owner/repo forms pass through)
#   4. org identity (provider_org_get) + current git repo basename
#   5. empty when no git root (caller decides the error)
#
# Usage:
#   repo=$(provider_repo_target org/repo)   # org/repo
#   repo=$(provider_repo_target)            # env chain, then cwd resolution
provider_repo_target() {
    # Repo-targeting env contract: DEVENV_REPO is the single override; no
    # other devenv env var participates. (GH_REPO below is gh's own variable,
    # consumed provider-internally, not a devenv alias.)
    local repo="${1:-}"
    if [ -n "$repo" ]; then
        echo "$repo"
        return 0
    fi
    if [ -n "${DEVENV_REPO:-}" ]; then
        echo "$DEVENV_REPO"
        return 0
    fi
    if [ -n "${GH_REPO:-}" ] && [[ "$GH_REPO" == */* ]]; then
        echo "$GH_REPO"
        return 0
    fi
    # Cwd resolution: org identity + git root basename. Both legs must
    # resolve; a missing git root leaves the result empty (not an error) so
    # callers keep their own exit semantics.
    local org repo_name
    org=$(provider_org_get 2>/dev/null) || org=""
    repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
    if [ -n "$org" ] && [ -n "$repo_name" ]; then
        echo "${org}/${repo_name}"
        return 0
    fi
    echo ""
    return 0
}

# Split owner/repo into parts. Fails when the spec has no owner part.
# Usage: provider_repo_split org/repo OWNER_VAR NAME_VAR
provider_repo_split() {
    local spec="$1" __owner="$2" __name="$3"
    if [[ "$spec" != */* ]]; then
        log_error "provider_repo_split: '$spec' is not owner/repo form"
        return 1
    fi
    # printf -v performs the assignment without eval, so spec content can
    # never be interpreted as shell syntax.
    printf -v "$__owner" '%s' "${spec%%/*}"
    printf -v "$__name" '%s' "${spec#*/}"
}

# ============================================================================
# Reads
# ============================================================================

# View a repo.
# Usage: provider_repos_view [repo] [--json FIELDS]
provider_repos_view() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh repo view "${repo_args[@]}" "$@"
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
