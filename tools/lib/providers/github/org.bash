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

if ! declare -F provider_declare_capability >/dev/null; then
    # Standalone-sourcing fallback: the capability registry lives
    # in provider-core; source it when this module is loaded alone.
    _cap_core_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    # shellcheck disable=SC1091
    source "$_cap_core_dir/provider-core.bash"
    unset _cap_core_dir
fi
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
provider_org_issue_types() {
    provider_require_capability native-issue-types || return 1
    gh api graphql -f query="query { organization(login: \"$1\") { issueTypes(first: 100) { edges { node { id name } } } } }" 2>/dev/null
}
