#!/usr/bin/env bash
# github/org.bash - GitHub implementation of the org-level domain facade:
# rulesets, releases, and org issue-types.
#
# Rulesets and native issue-types are GitHub-only capabilities (AC-3): the
# module declares them and every gated verb degrades with the defined error
# via provider_require_capability. Releases are broadly portable and ungated.
# Contract: return non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_GITHUB_ORG_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_GITHUB_ORG_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi

# Standalone-sourcing contract: the capability registry lives in
# provider-core; source it unconditionally (its own loaded-guard makes
# re-sourcing a no-op) so this module loads alone or under provider_load.
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/provider-core.bash"
provider_declare_capability rulesets
provider_declare_capability native-issue-types

# ---------------------------------------------------------------------------
# Rulesets (GH-only capability; REST CRUD per repo-types/policy-export)
# ---------------------------------------------------------------------------

# List rulesets for a repo (paginated).
# Usage: provider_org_rulesets_list REPO
provider_org_rulesets_list() {
    provider_require_capability rulesets || return 1
    gh api "repos/$1/rulesets" --paginate 2>/dev/null
}

# Get a single ruleset.
# Usage: provider_org_ruleset_get REPO RULESET_ID
provider_org_ruleset_get() {
    provider_require_capability rulesets || return 1
    gh api "repos/$1/rulesets/$2" 2>/dev/null
}

# Create a ruleset from a JSON payload.
# Usage: provider_org_ruleset_create REPO PAYLOAD_FILE
provider_org_ruleset_create() {
    provider_require_capability rulesets || return 1
    gh api --input "$2" -X POST "repos/$1/rulesets" >/dev/null 2>&1
}

# Update a ruleset from a JSON payload.
# Usage: provider_org_ruleset_update REPO RULESET_ID PAYLOAD_FILE
provider_org_ruleset_update() {
    provider_require_capability rulesets || return 1
    gh api --input "$3" -X PUT "repos/$1/rulesets/$2" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Releases (portable; ungated)
# ---------------------------------------------------------------------------

# List releases.
# Usage: provider_org_releases_list [repo] [FLAGS]
provider_org_releases_list() {
    local repo="${1:-}"
    shift
    if [ -z "$repo" ] || [[ "$repo" != */* ]]; then
        log_error "provider_org_releases_list: repo must be owner/repo form"
        return 1
    fi
    gh release list -R "$repo" "$@"
}

# ---------------------------------------------------------------------------
# Org issue-types (GH-only capability; GraphQL lookup per issues-config)
# ---------------------------------------------------------------------------

# List an org's native issue types.
# Usage: provider_org_issue_types ORG
# Returns the neutral seam shape: one JSON array of {id, name} entries.
# (The raw GraphQL envelope is mapped here — provider wire formats never
# cross the seam.)
provider_org_issue_types() {
    provider_require_capability native-issue-types || return 1
    # Capture gh's own status first: piping straight into jq reports jq's, so an
    # auth or network failure would read as an empty list.
    local response
    # shellcheck disable=SC2016  # GraphQL variables must not be shell-expanded
    if ! response=$(gh api graphql -f 'query=query($o:String!){organization(login:$o){issueTypes(first:100){edges{node{id name}} pageInfo{hasNextPage}}}}' -f o="$1" 2>&1); then
        log_error "provider_org_issue_types: gh failed for '$1': $response"
        return 1
    fi
    if printf '%s' "$response" | jq -e '.errors' >/dev/null 2>&1; then
        log_error "provider_org_issue_types: GraphQL error for '$1': $(printf '%s' "$response" | jq -r '.errors[0].message // "unknown"')"
        return 1
    fi
    if [ "$(printf '%s' "$response" | jq -r '.data.organization.issueTypes.pageInfo.hasNextPage // false')" = "true" ]; then
        log_warn "provider_org_issue_types: '$1' has more than 100 issue types; only the first 100 are listed"
    fi
    printf '%s' "$response" | jq -c '[.data.organization.issueTypes.edges[].node | {id: .id, name: .name}]'
}
