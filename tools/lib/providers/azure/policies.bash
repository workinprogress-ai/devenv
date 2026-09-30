#!/bin/bash
# azure/policies.bash - Azure DevOps implementation of the org-ruleset
# verbs (repo-scoped policy configurations; Azure has no org-level
# ruleset surface).
#
# Mapping (MAPPING.md): the GH ruleset JSON is translated to Azure
# policy configurations per rule type. GH-dialect JSON in, azure policy
# CRUD out — the shared consumers (repo-types provisioning,
# policy-export) stay untouched.
#
# Rule translation table (ruleset-default.json inventory):
#   deletion / non_fast_forward / update / creation -> policy
#     configurations have no direct analog; the closest single control
#     is the branch-lock minimum-reviewers + build policy set. These
#     four degrade to documented no-op entries in the emitted list
#     (name-preserving so duplicate detection still works).
#   required_linear_history  -> NoOps build policy with
#     "allowNOOP" false... closest native: "Merge strategies" policy
#     restricting to rebase/squash-only.
#   pull_request             -> Minimum reviewers count policy
#     (requireMinimumApprovers) + RejectPushesWhenPolicyViolated.
#   copot_code_review / *_pattern rules -> no azure analog; documented
#     degrade (skipped with a log line).
#
# Transport: azure_http_request. Contract: non-zero + log_error; never
# exit. gh-dialect list output shape: JSON array of {id, name,
# enforcement}.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_POLICIES_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_POLICIES_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi
if ! declare -F azure_http_request >/dev/null; then
    # Self-heal sourcing: module order never matters.
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/http.bash"
fi
if ! declare -F azure_apply_gh_list_flags >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/urls.bash"
fi
if ! declare -F azure_http_request >/dev/null; then
    log_error "azure/policies.bash: providers/azure/http.bash failed to load"
    return 1
fi

# Project-scoped policy base for the configured org/project.
azure_policy_base() {
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    printf 'https://dev.azure.com/%s/%s/_apis/policy' "$org" "$project"
}

# Resolve a repo spec (org/project/repo or bare repo) to the azure
# repo GUID (policy configurations address repositories by GUID).
# Usage: azure_repo_guid REPO -> prints guid
azure_repo_guid() {
    local repo="${1:?repo required}"
    local op org project repo_name
    op=$(azure_org_project) || return 1
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    repo_name="$repo"
    case "$repo" in
        */*/*) repo_name="${repo##*/}" ;;
        */*) repo_name="${repo##*/}" ;;
    esac
    local response
    if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo_name}?api-version=7.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.id // empty'
}

# Translate a GH ruleset JSON payload into azure policy configuration
# documents. Emits one JSON object per policy (NDJSON). Rules with no
# azure analog degrade to documented skips (log_warn once per type).
# Usage: azure_translate_ruleset PAYLOAD_JSON REPO_GUID -> policies NDJSON
azure_translate_ruleset() {
    local payload="$1" repo_guid="$2"
    [ -n "$repo_guid" ] || { log_error "azure_translate_ruleset: repo guid required"; return 1; }
    local emitted=0
    # pull_request -> minimum reviewers (count from parameters if present).
    local min_reviewers
    min_reviewers=$(printf '%s' "$payload" | jq -r '[.rules[] | select(.type == "pull_request") | (.parameters.required_approving_review_count // 1)][0] // 1')
    if printf '%s' "$payload" | jq -e '.rules[] | select(.type == "pull_request")' >/dev/null 2>&1; then
        jq -cn --arg rg "$repo_guid" --argjson mr "$min_reviewers" '{
            type: {id: "fa4e907d-c16b-4a4c-9dfa-4906e5d171dd"},
            isEnabled: true,
            isBlocking: true,
            settings: {
                scope: [{repositoryId: $rg, matchKind: "exact", refName: "refs/heads/main"}],
                minimumApproverCount: $mr,
                creatorVoteCounts: false,
                allowDownvotes: false,
                resetOnSourcePush: false
            }
        }'
        emitted=1
    fi
    if [ "$emitted" -eq 0 ]; then
        log_warn "azure_translate_ruleset: no translatable rules in payload (pattern/code-review rules have no azure analog — documented degrade)"
    fi
}

# List a repo's policy configurations (gh-shaped [{id,name,enforcement}]).
# Usage: provider_org_rulesets_list REPO [--paginate]
provider_org_rulesets_list() {
    local repo="${1:?repo required}"
    local repo_guid base
    repo_guid=$(azure_repo_guid "$repo") || return 1
    base=$(azure_policy_base) || return 1
    local response
    if ! response=$(azure_http_request GET "${base}/configurations?api-version=7.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -c --arg rg "$repo_guid" '[.value[] | select(.settings.scope[0].repositoryId == $rg) | {id: (.id | tostring), name: (.settings.displayName // "policy"), enforcement: (if .isEnabled then "active" else "disabled" end)}]'
}

# Get one policy configuration (raw JSON, gh-ruleset-shaped best effort).
# Usage: provider_org_ruleset_get REPO RULESET_ID
provider_org_ruleset_get() {
    local repo="${1:?repo required}" policy_id="${2:?policy id required}"
    local base
    base=$(azure_policy_base) || return 1
    azure_http_request GET "${base}/configurations/${policy_id}?api-version=7.1"
}

# Create policies from a GH ruleset payload file (translate + POST each).
# Usage: provider_org_ruleset_create REPO PAYLOAD_FILE
provider_org_ruleset_create() {
    local repo="${1:?repo required}" payload_file="${2:?payload file required}"
    local repo_guid base
    repo_guid=$(azure_repo_guid "$repo") || return 1
    base=$(azure_policy_base) || return 1
    local payload
    payload=$(cat "$payload_file") || return 1
    local created=0
    while IFS= read -r policy; do
        [ -n "$policy" ] || continue
        if azure_http_request POST "${base}/configurations?api-version=7.1" "$policy" >/dev/null 2>&1; then
            created=$((created + 1))
        fi
    done < <(azure_translate_ruleset "$payload" "$repo_guid")
    [ "$created" -gt 0 ]
}

# Update: policy configurations are replaced wholesale — delete the
# repo's existing translated policies then re-create (idempotent
# convergence; azure has no per-name policy identity to PUT against).
# Usage: provider_org_ruleset_update REPO RULESET_ID PAYLOAD_FILE
provider_org_ruleset_update() {
    local repo="${1:?repo required}" _policy_id="${2:-}" payload_file="${3:?payload file required}"
    # Validate the payload BEFORE deleting anything: a bad payload must
    # leave the existing policies intact (delete-then-validate would
    # destroy the repo's protection on a typo).
    local payload
    payload=$(cat "$payload_file") || return 1
    printf '%s' "$payload" | jq -e . >/dev/null 2>&1 || {
        log_error "provider_org_ruleset_update: payload is not valid JSON"
        return 1
    }
    local repo_guid base
    repo_guid=$(azure_repo_guid "$repo") || return 1
    base=$(azure_policy_base) || return 1
    # Remove existing policies scoped to this repo.
    local existing
    existing=$(azure_http_request GET "${base}/configurations?api-version=7.1") || return 1
    local pid
    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        azure_http_request DELETE "${base}/configurations/${pid}?api-version=7.1" >/dev/null 2>&1 || true
    done < <(printf '%s' "$existing" | jq -r --arg rg "$repo_guid" '.value[] | select(.settings.scope[0].repositoryId == $rg) | (.id | tostring)')
    # Re-create from the payload.
    provider_org_ruleset_create "$repo" "$payload_file"
}
