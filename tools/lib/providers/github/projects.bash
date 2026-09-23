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
        local -n __arr="$1"
        local __repo="${2:-}"
        if [ -n "$__repo" ]; then
            __arr=("-R" "$__repo")
        else
            __arr=()
        fi
    }
fi

if ! declare -F provider_declare_capability >/dev/null; then
    # Standalone-sourcing fallback: the capability registry lives
    # in provider-core; source it when this module is loaded alone.
    _cap_core_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    # shellcheck disable=SC1091
    source "$_cap_core_dir/provider-core.bash"
    unset _cap_core_dir
fi
provider_declare_capability project-boards

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

# Resolve a project's GraphQL node ID from its title or numeric number.
# Counterpart to provider-loader's legacy project_id_by_name.
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

    # Title match: scan the org's project list, paginated (a >50-project org
    # must not silently lose tail projects from the scan). One gh call per
    # page: line 1 is pageInfo ("true CURSOR"), remaining non-empty lines are
    # matching project IDs. First call omits the cursor variable.
    local query='query($o:String!,$c:String){
        organization(login:$o){ projectsV2(first:50, after:$c){ pageInfo{ hasNextPage endCursor } nodes{ id title } } }
    }'
    # gh api's --jq program cannot receive --arg variables, so the title is
    # interpolated into the program. Reject embedded quotes first — a title
    # containing a double quote cannot be safely expressed here. Logged so
    # the caller can distinguish "unusable input" from "no such project".
    case "$name_or_number" in
        *'"'*)
            log_error "provider_projects_id_by_name: project title must not contain double quotes ('$name_or_number')"
            return 1
            ;;
    esac
    local -a ids=()
    local cursor="" has_more=true
    local -a page_lines
    local line
    while [ "$has_more" = "true" ]; do
        local -a cursor_args=()
        [ -n "$cursor" ] && cursor_args=(-f c="$cursor")
        local page
        page=$(gh api graphql -f "query=$query" -f o="$owner" "${cursor_args[@]}" \
            --jq '.data.organization.projectsV2 as $p
                  | "\($p.pageInfo.hasNextPage) \($p.pageInfo.endCursor // "")",
                    ($p.nodes[] | select(.title == "'"$name_or_number"'") | .id)' \
            2>/dev/null) || return 1
        mapfile -t page_lines <<< "$page"
        has_more="${page_lines[0]%% *}"
        cursor="${page_lines[0]#* }"
        for line in "${page_lines[@]:1}"; do
            [ -n "$line" ] && ids+=("$line")
        done
    done
    [ "${#ids[@]}" -gt 0 ] && { printf '%s\n' "${ids[@]}"; return 0; }
    return 1
}

# Resolve the project item ID for an issue inside a project.
# Counterpart to provider-loader's legacy project_item_id_for_issue.
# Repo-strict: issue numbers are only unique per repository, so the owner/name
# pair must match exactly — a board holding cards from several repos can carry
# the same issue number many times, and resolving those ambiguously either
# corrupts the mutation payload (multi-ID blob) or writes the wrong card.
# Usage: provider_projects_item_id_for_issue PROJECT-ID ISSUE-NUMBER OWNER REPO
# stdout: item node ID (PVTI_...)  |  rc=1 when absent, ambiguous, or arg-mismatch
provider_projects_item_id_for_issue() {
    provider_require_capability project-boards || return 1
    local project_id="$1"
    local issue_number="$2"
    local owner="$3"
    local repo="$4"

    if [ -z "$project_id" ] || [ -z "$issue_number" ] || [ -z "$owner" ] || [ -z "$repo" ]; then
        log_error "provider_projects_item_id_for_issue: project-id, issue-number, owner and repo required"
        return 1
    fi
    if ! [[ "$issue_number" =~ ^[0-9]+$ ]]; then
        log_error "provider_projects_item_id_for_issue: issue number must be numeric"
        return 1
    fi

    local query='query($p:ID!,$c:String){
        node(id:$p){
            ... on ProjectV2 {
                items(first:100, after:$c){
                    pageInfo{ hasNextPage endCursor }
                    nodes{ id content{ ... on Issue{ number repository{ nameWithOwner } } } }
                }
            }
        }
    }'

    # Owner/repo are shell-quoted into the jq program (gh api's --jq cannot
    # receive --arg variables); embedded double quotes would break the quoting.
    case "$owner$repo" in
        *'"'*)
            log_error "provider_projects_item_id_for_issue: owner/repo must not contain double quotes"
            return 1
            ;;
    esac
    local full_name="$owner/$repo"

    # One gh call per page: line 1 is pageInfo ("true CURSOR"), remaining
    # non-empty lines are matching item IDs. First call omits the cursor
    # variable entirely (an empty after:"" is not a valid page cursor).
    local -a ids=()
    local cursor="" has_more=true
    local -a page_lines
    local line
    while [ "$has_more" = "true" ]; do
        local -a cursor_args=()
        [ -n "$cursor" ] && cursor_args=(-f c="$cursor")
        local page
        page=$(gh api graphql -f "query=$query" -f p="$project_id" "${cursor_args[@]}" \
            --jq '.data.node.items as $items
                  | "\($items.pageInfo.hasNextPage) \($items.pageInfo.endCursor // "")",
                    ($items.nodes[]
                     | select(.content.number == '"$issue_number"'
                              and .content.repository.nameWithOwner == "'"$full_name"'")
                     | .id)' 2>/dev/null) || return 1
        mapfile -t page_lines <<< "$page"
        has_more="${page_lines[0]%% *}"
        cursor="${page_lines[0]#* }"
        for line in "${page_lines[@]:1}"; do
            [ -n "$line" ] && ids+=("$line")
        done
    done

    # Uniqueness: exactly one card may match. Zero = not in project; more than
    # one is a data-integrity condition we refuse to guess at.
    if [ "${#ids[@]}" -eq 0 ]; then
        log_error "provider_projects_item_id_for_issue: $full_name#$issue_number is not in project $project_id"
        return 1
    fi
    if [ "${#ids[@]}" -ne 1 ]; then
        log_error "provider_projects_item_id_for_issue: expected exactly 1 card for $full_name#$issue_number, got ${#ids[@]}"
        return 1
    fi
    echo "${ids[0]}"
    return 0
}

# Resolve the single-select field ID and option ID for a field/value pair.
# Counterpart to provider-loader's legacy project_field_and_option_ids.
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
# Counterpart to provider-loader's legacy update_project_item_field.
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
# Counterpart to provider-loader's legacy projects_for_issue.
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
    # (jq extraction shared with the provider-loader legacy implementation.)
    jq -r --arg owner "$owner" '
        .data.resource.projectItems.nodes[]
        | select(.project.owner.login == $owner)
        | .project as $p
        | ([.fieldValues.nodes[] | select(.__typename == "ProjectV2ItemFieldSingleSelectValue" and .field.name == "Status") | .name] | first // "-") as $status
        | "\($p.title)\t\($p.number)\t\($status)"
    ' <<< "$json" 2>/dev/null
}
