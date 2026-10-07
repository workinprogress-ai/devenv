#!/bin/bash
# azure/policies.bash - Azure DevOps implementation of the org-ruleset
# verbs (repo-scoped policy configurations; Azure has no org-level
# ruleset surface).
#
# Mapping (MAPPING.md): the seam's ruleset JSON is translated to Azure
# policy configurations per rule type. seam-dialect JSON in, azure policy
# CRUD out — the shared consumers (repo-types provisioning,
# policy-export) stay untouched.
#
# Rule translation (what the code does):
#   pull_request -> a Minimum number of reviewers policy on the target branch
#     (required_approving_review_count, default 1).
#   every other rule type (deletion, non_fast_forward, update, creation,
#     required_linear_history, code-review and *_pattern rules) has no policy
#     configuration analog here; a payload with no pull_request rule translates
#     to nothing and says so in a warning.
# The target branch is the ruleset's own conditions.ref_name include when it
# names a branch (refs/heads/<name>), else the repository's default branch.
#
# Transport: azure_http_request. Contract: non-zero + log_error; never
# exit. seam-dialect list output shape: JSON array of {id, name,
# enforcement}.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_POLICIES_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_POLICIES_LOADED=1

# Capabilities: this module carries the ruleset analog (repo-scoped policy
# configurations) and native work-item-type administration.
if declare -F provider_declare_capability >/dev/null; then
    provider_declare_capability rulesets
    provider_declare_capability native-issue-types
fi

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi
if ! declare -F azure_http_request >/dev/null; then
    # Self-heal sourcing: module order never matters.
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/http.bash"
fi
if ! declare -F azure_apply_list_flags >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/urls.bash"
fi
if ! declare -F azure_repo_guid >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repos.bash"
fi
if ! declare -F azure_http_request >/dev/null; then
    log_error "azure/policies.bash: providers/azure/http.bash failed to load"
    return 1
fi

# Project-scoped policy base for a repo spec's org and project.
# Usage: azure_policy_base [REPO_SPEC]
azure_policy_base() {
    local parts org project
    parts=$(azure_repo_parts "${1:-}") || return 1
    org=$(printf '%s' "$parts" | sed -n 1p)
    project=$(printf '%s' "$parts" | sed -n 2p)
    printf 'https://dev.azure.com/%s/%s/_apis/policy' "$(azure_uri "$org")" "$(azure_uri "$project")"
}

# The Minimum number of reviewers policy type id.
readonly AZURE_POLICY_MIN_REVIEWERS_TYPE="fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"

# The error for a ruleset that leaves no branch to protect.
# Usage: azure_ruleset_no_branch_error VERB
azure_ruleset_no_branch_error() {
    log_error "$1: the ruleset names no branch an Azure policy can protect; use refs/heads/<name>, ~DEFAULT_BRANCH or ~ALL (a branch pattern with a wildcard, a tag ref or a bare name does not qualify)"
}

# The branches a ruleset applies to. A ruleset with no ref condition applies to the
# repository's default branch (which the caller resolves). Otherwise: every explicit
# refs/heads/<name> in conditions.ref_name.include, plus the default branch when the
# list carries ~DEFAULT_BRANCH or ~ALL. A wildcard pattern (refs/heads/release/*) has
# no single branch an Azure policy of this kind can name, so it is skipped with a
# warning; a list that leaves no branch prints nothing and the caller fails.
# Usage: azure_ruleset_branches PAYLOAD_JSON DEFAULT_BRANCH -> prints one branch per line
azure_ruleset_branches() {
    local payload="$1" default_branch="$2"
    local includes
    includes=$(printf '%s' "$payload" | jq -r '[.conditions.ref_name.include[]?] | .[]')
    if [ -z "$includes" ]; then
        printf '%s\n' "$default_branch"
        return 0
    fi
    local wildcards
    wildcards=$(printf '%s' "$includes" | grep -E '^refs/heads/.*\*' || true)
    if [ -n "$wildcards" ]; then
        log_warn "azure ruleset: skipping a branch pattern with no single branch to protect: $(printf '%s' "$wildcards" | paste -sd, -)"
    fi
    {
        printf '%s\n' "$includes" | grep -E '^refs/heads/' | grep -v '\*' | sed 's|^refs/heads/||' || true
        if printf '%s\n' "$includes" | grep -qx '~ALL'; then
            log_warn "azure ruleset: ~ALL protects the default branch only (an Azure policy names one branch)"
        fi
        if printf '%s\n' "$includes" | grep -qxE '~DEFAULT_BRANCH|~ALL'; then
            printf '%s\n' "$default_branch"
        fi
    } | awk 'NF && !seen[$0]++'
}

# Translate a ruleset JSON payload into azure policy configuration
# documents. Emits one JSON object per policy (NDJSON). Rules with no
# azure analog are skipped with a warning.
# Usage: azure_translate_ruleset PAYLOAD_JSON REPO_GUID BRANCH -> policies NDJSON
azure_translate_ruleset() {
    local payload="$1" repo_guid="$2" branch="$3"
    [ -n "$repo_guid" ] || { log_error "azure_translate_ruleset: repo guid required"; return 1; }
    [ -n "$branch" ] || { log_error "azure_translate_ruleset: target branch required"; return 1; }
    local emitted=0
    # pull_request -> minimum reviewers (count from parameters if present).
    local min_reviewers
    min_reviewers=$(printf '%s' "$payload" | jq -r '[.rules[] | select(.type == "pull_request") | (.parameters.required_approving_review_count // 1)][0] // 1')
    if printf '%s' "$payload" | jq -e '.rules[] | select(.type == "pull_request")' >/dev/null 2>&1; then
        jq -cn --arg rg "$repo_guid" --arg ref "refs/heads/${branch}" --argjson mr "$min_reviewers" --arg t "$AZURE_POLICY_MIN_REVIEWERS_TYPE" '{
            type: {id: $t},
            isEnabled: true,
            isBlocking: true,
            settings: {
                scope: [{repositoryId: $rg, matchKind: "exact", refName: $ref}],
                minimumApproverCount: $mr,
                creatorVoteCounts: false,
                allowDownvotes: false,
                resetOnSourcePush: false
            }
        }'
        emitted=1
    fi
    if [ "$emitted" -eq 0 ]; then
        log_warn "azure_translate_ruleset: no translatable rules in payload (only pull_request maps to an azure policy)"
    fi
}

# List a repo's policy configurations (seam-shaped [{id,name,enforcement}]).
# Usage: provider_org_rulesets_list REPO [--paginate]
provider_org_rulesets_list() {
    local repo="${1:?repo required}"
    local repo_guid base
    repo_guid=$(azure_repo_guid "$repo") || return 1
    base=$(azure_policy_base "$repo") || return 1
    local response
    if ! response=$(azure_http_request GET "${base}/configurations?api-version=7.1"); then
        return 1
    fi
    # The policy's name is its type's (Minimum number of reviewers, Build, ...);
    # a configuration carries no name of its own.
    printf '%s' "$response" | jq -c --arg rg "$repo_guid" '[.value[] | select(.settings.scope[0].repositoryId == $rg) | {id: (.id | tostring), name: (.type.displayName // .settings.displayName // "policy"), enforcement: (if .isEnabled then "active" else "disabled" end)}]'
}

# Get one policy configuration (raw JSON, seam-ruleset-shaped best effort).
# Usage: provider_org_ruleset_get REPO RULESET_ID
provider_org_ruleset_get() {
    local repo="${1:?repo required}" policy_id="${2:?policy id required}"
    local base
    base=$(azure_policy_base "$repo") || return 1
    azure_http_request GET "${base}/configurations/${policy_id}?api-version=7.1"
}

# Create policies from a ruleset payload file (translate, then POST each). Azure
# rejects a second policy on the same repository and branch, so a branch that already
# has one (a retry after a partial failure) is updated in place instead; creating the
# same ruleset twice is therefore safe.
# Usage: provider_org_ruleset_create REPO PAYLOAD_FILE
provider_org_ruleset_create() {
    local repo="${1:?repo required}" payload_file="${2:?payload file required}"
    local repo_guid base
    repo_guid=$(azure_repo_guid "$repo") || return 1
    base=$(azure_policy_base "$repo") || return 1
    local payload
    payload=$(cat "$payload_file") || return 1
    printf '%s' "$payload" | jq -e . >/dev/null 2>&1 || {
        log_error "provider_org_ruleset_create: payload is not valid JSON"
        return 1
    }
    local default_branch branch branches existing
    default_branch=$(provider_repos_default_branch "$repo") || return 1
    branches=$(azure_ruleset_branches "$payload" "$default_branch")
    [ -n "$branches" ] || { azure_ruleset_no_branch_error "provider_org_ruleset_create"; return 1; }
    if ! existing=$(azure_http_request GET "${base}/configurations?api-version=7.1"); then
        printf '%s' "$existing"
        return 1
    fi
    local created=0 policy ref match_id write_response
    while IFS= read -r branch; do
        [ -n "$branch" ] || continue
        while IFS= read -r policy; do
            [ -n "$policy" ] || continue
            ref=$(printf '%s' "$policy" | jq -r '.settings.scope[0].refName')
            match_id=$(printf '%s' "$existing" | jq -r --arg rg "$repo_guid" --arg t "$AZURE_POLICY_MIN_REVIEWERS_TYPE" --arg ref "$ref" \
                '[.value[]? | select(.type.id == $t and .settings.scope[0].repositoryId == $rg and .settings.scope[0].refName == $ref) | .id][0] // empty')
            # Error contract: emit the transport's error JSON on failure —
            # silent skips made policy 403s indistinguishable from code bugs.
            if [ -n "$match_id" ]; then
                if ! write_response=$(azure_http_request PUT "${base}/configurations/${match_id}?api-version=7.1" "$policy"); then
                    printf '%s' "$write_response"
                    return 1
                fi
            elif ! write_response=$(azure_http_request POST "${base}/configurations?api-version=7.1" "$policy"); then
                printf '%s' "$write_response"
                return 1
            fi
            created=$((created + 1))
        done < <(azure_translate_ruleset "$payload" "$repo_guid" "$branch")
    done <<< "$branches"
    [ "$created" -gt 0 ]
}

# Update: write the payload's policies. Azure rejects a second policy on the same
# repository and branch, so a policy that already exists for a translated branch is
# updated in place (PUT) and a branch with none gets a new policy (POST). Every
# explicit branch the payload names is written. Only after every write has
# succeeded is the policy RULESET_ID (the one being replaced) retired, when it is a
# reviewers policy no write reused; policies on other branches, including ones made
# in the portal, and other policy types such as build validation are never touched.
# A failed write leaves the previous protection in place.
# Usage: provider_org_ruleset_update REPO RULESET_ID PAYLOAD_FILE
provider_org_ruleset_update() {
    local repo="${1:?repo required}" _policy_id="${2:-}" payload_file="${3:?payload file required}"
    # Validate the payload before touching anything.
    local payload
    payload=$(cat "$payload_file") || return 1
    printf '%s' "$payload" | jq -e . >/dev/null 2>&1 || {
        log_error "provider_org_ruleset_update: payload is not valid JSON"
        return 1
    }
    local repo_guid base
    repo_guid=$(azure_repo_guid "$repo") || return 1
    base=$(azure_policy_base "$repo") || return 1
    local default_branch branch branches
    default_branch=$(provider_repos_default_branch "$repo") || return 1
    branches=$(azure_ruleset_branches "$payload" "$default_branch")
    [ -n "$branches" ] || { azure_ruleset_no_branch_error "provider_org_ruleset_update"; return 1; }
    local existing
    existing=$(azure_http_request GET "${base}/configurations?api-version=7.1") || return 1
    local policy ref match_id wrote=0
    local -a kept_ids=()
    while IFS= read -r branch; do
        [ -n "$branch" ] || continue
        while IFS= read -r policy; do
            [ -n "$policy" ] || continue
            ref=$(printf '%s' "$policy" | jq -r '.settings.scope[0].refName')
            match_id=$(printf '%s' "$existing" | jq -r --arg rg "$repo_guid" --arg t "$AZURE_POLICY_MIN_REVIEWERS_TYPE" --arg ref "$ref" \
                '[.value[]? | select(.type.id == $t and .settings.scope[0].repositoryId == $rg and .settings.scope[0].refName == $ref) | .id][0] // empty')
            if [ -n "$match_id" ]; then
                azure_http_request PUT "${base}/configurations/${match_id}?api-version=7.1" "$policy" >/dev/null || {
                    log_error "provider_org_ruleset_update: could not update policy $match_id"
                    return 1
                }
                kept_ids+=("$match_id")
            else
                azure_http_request POST "${base}/configurations?api-version=7.1" "$policy" >/dev/null || {
                    log_error "provider_org_ruleset_update: could not create the policy for $ref"
                    return 1
                }
            fi
            wrote=1
        done < <(azure_translate_ruleset "$payload" "$repo_guid" "$branch")
    done <<< "$branches"
    [ "$wrote" -eq 1 ] || return 1
    # Retire the policy being replaced when no write reused it (its branch moved).
    [ -n "$_policy_id" ] || return 0
    for match_id in "${kept_ids[@]:-}"; do [ "$match_id" = "$_policy_id" ] && return 0; done
    if printf '%s' "$existing" | jq -e --arg id "$_policy_id" --arg rg "$repo_guid" --arg t "$AZURE_POLICY_MIN_REVIEWERS_TYPE" \
        '.value[]? | select((.id | tostring) == $id and .settings.scope[0].repositoryId == $rg and .type.id == $t)' >/dev/null; then
        log_warn "provider_org_ruleset_update: retiring policy ${_policy_id} on $(printf '%s' "$existing" | jq -r --arg id "$_policy_id" '[.value[]? | select((.id | tostring) == $id) | .settings.scope[0].refName][0] // "an unnamed branch"'): the payload no longer covers it"
        if ! azure_http_request DELETE "${base}/configurations/${_policy_id}?api-version=7.1" >/dev/null 2>&1; then
            log_error "provider_org_ruleset_update: could not delete the previous policy $_policy_id"
            return 1
        fi
    fi
    return 0
}
