#!/usr/bin/env bash
# github/projects.bash - GitHub implementation of the projects (board) domain
# facade.
#
# Project boards are GraphQL surfaces and a GitHub-only capability (AC-3):
# the module declares the project-boards capability, and every verb gates on
# it via provider_require_capability so a provider without boards degrades
# with the defined error instead of failing mid-command. Verbs per inventory:
# list / field-list / item-add (+ the workflow stages lookup project tooling
# uses). Contract: return non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_GITHUB_PROJECTS_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_GITHUB_PROJECTS_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi

if ! declare -F provider_gh_repo_args >/dev/null; then
    provider_gh_repo_args() {
        local __var="$1"
        local __repo="${2:-}"
        if [ -n "$__repo" ]; then
            eval "$__var=(-R \"$__repo\")"
        else
            eval "$__var=()"
        fi
    }
fi

PROVIDER_CAPABILITIES="${PROVIDER_CAPABILITIES:-}"
case " $PROVIDER_CAPABILITIES " in
    *" project-boards "*) ;;
    *) PROVIDER_CAPABILITIES="${PROVIDER_CAPABILITIES:+$PROVIDER_CAPABILITIES }project-boards" ;;
esac

# List project boards for a repo.
# Usage: provider_projects_list [repo] [FLAGS...]
provider_projects_list() {
    provider_require_capability project-boards || return 1
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh project list "${repo_args[@]}" "$@"
}

# List a project's fields.
# Usage: provider_projects_field_list [repo] PROJECT_NUMBER
provider_projects_field_list() {
    provider_require_capability project-boards || return 1
    local repo=""
    if [ $# -gt 1 ] && [[ "$1" != --* && "$1" != ^[0-9]*$ ]]; then
        repo="$1"; shift
    fi
    local project="$1"; shift
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh project field-list "$project" "${repo_args[@]}"
}

# Add an issue to a project.
# Usage: provider_projects_item_add [repo] PROJECT_NUMBER ISSUE_URL_OR_ID
provider_projects_item_add() {
    provider_require_capability project-boards || return 1
    local repo=""
    if [ $# -gt 2 ] && [[ "$1" != --* && "$1" != ^[0-9]*$ ]]; then
        repo="$1"; shift
    fi
    local project="$1" item="$2"; shift 2
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh project item-add "$project" "${repo_args[@]}" --url "$item" "$@"
}

# Workflow stages lookup (project-update tooling dependency).
# Usage: provider_projects_workflow_stages [repo]
provider_projects_workflow_stages() {
    provider_require_capability project-boards || return 1
    local repo="$1"
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh workflow list "${repo_args[@]}" --all
}

# Resolve a project's GraphQL node ID from its title or numeric number.
# Replacement for github-helpers' project_id_by_name.
# Usage: provider_projects_id_by_name OWNER PROJECT-NAME-OR-NUMBER
# stdout: project node ID (PVT_...)  |  rc=1 when not found
provider_projects_id_by_name() {
    provider_require_capability project-boards || return 1
    local owner="$1"
    local name_or_number="$2"

    if [ -z "$owner" ] || [ -z "$name_or_number" ]; then
        log_error "provider_projects_id_by_name: owner and project required"
        return 1
    fi

    # Numeric input maps directly to projectV2(number:) — no list scan needed.
    if [[ "$name_or_number" =~ ^[0-9]+$ ]]; then
        local query='query($o:String!,$n:Int!){
            organization(login:$o){ projectV2(number:$n){ id } }
        }'
        local id
        id=$(gh api graphql -f "query=$query" -f o="$owner" -F n="$name_or_number" \
            --jq '.data.organization.projectV2.id' 2>/dev/null) || return 1
        [ -n "$id" ] && [ "$id" != "null" ] && { echo "$id"; return 0; }
        return 1
    fi

    # Title match: scan the org's project list (small; fresh call, no cache).
    local query='query($o:String!){
        organization(login:$o){ projectsV2(first:50){ nodes{ id title } } }
    }'
    # gh api's --jq program cannot receive --arg variables, so the title is
    # interpolated into the program. Reject embedded quotes first — a title
    # containing a double quote cannot be safely expressed here.
    case "$name_or_number" in
        *'"'*) return 1 ;;
    esac
    local id
    id=$(gh api graphql -f "query=$query" -f o="$owner" \
        --jq ".data.organization.projectsV2.nodes[] | select(.title == \"$name_or_number\") | .id" \
        2>/dev/null) || return 1
    [ -n "$id" ] && { echo "$id"; return 0; }
    return 1
}

# Resolve the project item ID for an issue inside a project.
# Replacement for github-helpers' project_item_id_for_issue.
# Usage: provider_projects_item_id_for_issue PROJECT-ID ISSUE-NUMBER
# stdout: item node ID (PVTI_...)  |  rc=1 when the issue is not in the project
provider_projects_item_id_for_issue() {
    provider_require_capability project-boards || return 1
    local project_id="$1"
    local issue_number="$2"

    if [ -z "$project_id" ] || [ -z "$issue_number" ]; then
        log_error "provider_projects_item_id_for_issue: project-id and issue-number required"
        return 1
    fi
    if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
        log_error "provider_projects_item_id_for_issue: issue number must be numeric"
        return 1
    fi

    local query='query($p:ID!){
        node(id:$p){
            ... on ProjectV2 {
                items(first:100){ nodes{ id content{ ... on Issue{ number } } } }
            }
        }
    }'
    # Number is validated numeric above; interpolate into the jq program
    # (gh api's --jq cannot receive --arg variables).
    local id
    id=$(gh api graphql -f "query=$query" -f p="$project_id" \
        --jq ".data.node.items.nodes[] | select(.content.number == $issue_number) | .id" \
        2>/dev/null) || return 1
    [ -n "$id" ] && { echo "$id"; return 0; }
    return 1
}

# Resolve the single-select field ID and option ID for a field/value pair.
# Replacement for github-helpers' project_field_and_option_ids.
# Usage: provider_projects_field_option_ids PROJECT-ID FIELD-NAME OPTION-NAME
# stdout: "<field-id> <option-id>"  |  rc=1 when field or option not found
provider_projects_field_option_ids() {
    provider_require_capability project-boards || return 1
    local project_id="$1"
    local field_name="$2"
    local option_name="$3"

    if [ -z "$project_id" ] || [ -z "$field_name" ] || [ -z "$option_name" ]; then
        log_error "provider_projects_field_option_ids: project-id, field, option required"
        return 1
    fi

    local query='query($p:ID!,$f:String!){
        node(id:$p){
            ... on ProjectV2 {
                field(name:$f){
                    ... on ProjectV2SingleSelectField{ id options{ id name } }
                }
            }
        }
    }'
    local json
    json=$(gh api graphql -f "query=$query" -f p="$project_id" -f f="$field_name" 2>/dev/null) || return 1

    # Option match is case-insensitive (user decision): config vocabulary is
    # canonical To-Groom while real projects carry To-groom and similar drift.
    local field_id option_id
    read -r field_id option_id <<< "$(jq -r --arg opt "$option_name" '
        .data.node.field as $f
        | ($f.id) as $fid
        | [$f.options[] | select((.name | ascii_downcase) == ($opt | ascii_downcase)) | .id] as $matches
        | if ($matches | length) == 1 then "\($fid) \($matches[0])" else empty end
    ' <<< "$json" 2>/dev/null)"
    [ -n "$field_id" ] && [ -n "$option_id" ] && { echo "$field_id $option_id"; return 0; }
    return 1
}

# Set a single-select field value on a project item.
# Replacement for github-helpers' update_project_item_field.
# Usage: provider_projects_field_set PROJECT-ID ITEM-ID FIELD-ID OPTION-ID
# rc=0 on success (idempotent same-value writes succeed silently)
provider_projects_field_set() {
    provider_require_capability project-boards || return 1
    local project_id="$1"
    local item_id="$2"
    local field_id="$3"
    local option_id="$4"

    if [ -z "$project_id" ] || [ -z "$item_id" ] || [ -z "$field_id" ] || [ -z "$option_id" ]; then
        log_error "provider_projects_field_set: all four IDs required"
        return 1
    fi

    local query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){
        updateProjectV2ItemFieldValue(input:{
            projectId:$p, itemId:$i, fieldId:$f,
            value:{ singleSelectOptionId:$o }
        }){ projectV2Item{ id } }
    }'
    gh api graphql -f "query=$query" -f p="$project_id" -f i="$item_id" -f f="$field_id" -f o="$option_id" >/dev/null 2>&1
}

# List projects containing an issue, with the issue's current Status in each.
# Replacement for github-helpers' projects_for_issue.
# Usage: provider_projects_for_issue ISSUE-URL OWNER
# stdout: "<project-title>\t<project-number>\t<status-or-dash>" per project
# rc=0 always; empty output when the issue is in no projects (read path)
provider_projects_for_issue() {
    provider_require_capability project-boards || return 1
    local issue_url="$1"
    local owner="$2"

    if [ -z "$issue_url" ] || [ -z "$owner" ]; then
        log_error "provider_projects_for_issue: issue-url and owner required"
        return 1
    fi

    # Reverse lookup via the issue's own projectItems (read-only, one call):
    # a fresh gh api graphql per invocation, no caching — house pattern.
    local query='query($u:URI!){
        resource(url:$u){
            ... on Issue {
                projectItems(first:20){
                    nodes{
                        project{ id number title owner{ ... on Organization{ login } ... on User{ login } } }
                        fieldValues(first:20){
                            nodes{
                                __typename
                                ... on ProjectV2ItemFieldSingleSelectValue{
                                    name
                                    field{ ... on ProjectV2FieldCommon{ name } }
                                }
                            }
                        }
                    }
                }
            }
        }
    }'

    local json
    if ! json=$(gh api graphql -f "query=$query" -f u="$issue_url" 2>/dev/null); then
        log_error "provider_projects_for_issue: GraphQL query failed for $issue_url"
        return 1
    fi

    # Extract per-project: title, number, and the Status single-select value.
    # (jq extraction shared with the github-helpers implementation.)
    jq -r --arg owner "$owner" '
        .data.resource.projectItems.nodes[]
        | select(.project.owner.login == $owner)
        | .project as $p
        | ([.fieldValues.nodes[] | select(.__typename == "ProjectV2ItemFieldSingleSelectValue" and .field.name == "Status") | .name] | first // "-") as $status
        | "\($p.title)\t\($p.number)\t\($status)"
    ' <<< "$json" 2>/dev/null
}
