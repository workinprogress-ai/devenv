#!/bin/bash
# azure/projects.bash - Azure DevOps implementation of the projects domain
# verbs (the Boards mapping).
#
# Mapping (MAPPING.md, research-verified): the GH "project" is the Azure
# BOARD; the "Status" single-select is the work item's System.State —
# System.BoardColumn is ReadOnly (TF401326), so the board column follows
# the state mapping automatically. Work items are born on their type's
# board (item_add is a no-op-success); the "item id" is the work item id.
#
# Board status vocabulary: the fork's status_workflow words alias onto
# process states via the CONFIG ALIASES table (azure_status_alias below);
# option-id = the state name. Unmappable words fail defined.
#
# Transport: azure_http_request. Team ids are ROUTE segments on the
# boards API (the ?team= query form fails TF10158). Contract: return
# non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_PROJECTS_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_PROJECTS_LOADED=1

# Capability: this module maps the projects seam onto Azure Boards.
if declare -F provider_declare_capability >/dev/null; then
    provider_declare_capability project-boards
fi

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
    log_error "azure/projects.bash: providers/azure/http.bash failed to load"
    return 1
fi
if ! declare -F azure_issue_patch_state >/dev/null; then
    # field_set delegates to the state patch on the issues module.
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/issues.bash"
fi

# The default team's GUID (the boards API's route segment). Resolved via
# the project's teams list; cached in-process per org/project.
azure_default_team_id() {
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local guid
    local response
    if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/_apis/projects?api-version=7.1"); then
        return 1
    fi
    guid=$(printf '%s' "$response" | jq -r --arg name "$project" '.value[] | select(.name == $name) | .id') || return 1
    [ -n "$guid" ] || { log_error "azure_default_team_id: project '$project' not found"; return 1; }
    if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/_apis/projects/${guid}/teams?api-version=7.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.value[0].id // empty'
}

# Map a status_workflow vocabulary word onto a process state via the
# config alias table. Resolution order: (1) the word already names a
# process state (live set fetched by caller context; pass-through),
# (2) the [azure_status_aliases] config block maps it, (3) fail defined
# (vocabulary drift is surfaced, never guessed).
# Usage: azure_status_alias WORD STATE_LIST -> prints the state name
azure_status_alias() {
    local word="$1" states="${2:-}"
    # (1) exact state match passes through.
    if [ -n "$states" ] && printf '\t%s\t' "$(printf '%s' "$states" | tr '\n' '\t')" | grep -q "\t$word\t"; then
        printf '%s' "$word"
        return 0
    fi
    # (2) config alias block: [azure_status_aliases] <word>=<state>
    if declare -F config_init >/dev/null; then
        local config_file="${DEVENV_ROOT:-}/devenv.config"
        if [ -f "$config_file" ] && config_init "$config_file" 2>/dev/null; then
            local mapped
            mapped=$(config_read_value "azure_status_aliases" "$word" 2>/dev/null) || mapped=""
            if [ -n "$mapped" ]; then
                printf '%s' "$mapped"
                return 0
            fi
        fi
    fi
    # (3) no states known (caller passed none): pass through and let the
    # state PATCH validate; with states known and no match, fail defined.
    if [ -z "$states" ]; then
        printf '%s' "$word"
        return 0
    fi
    log_error "azure_status_alias: '$word' maps onto no process state — add an [azure_status_aliases] entry or use a state name (MAPPING.md Boards section)"
    return 1
}

# List boards (gh shape: one {name, number, id} object per line).
# Usage: provider_projects_list [repo] [FLAGS...]
provider_projects_list() {
    local op team
    op=$(azure_org_project) || return 1
    team=$(azure_default_team_id) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local response
    if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/${team}/_apis/work/boards?api-version=7.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -c '.value[] | {name: .name, number: .id, id: .id}'
}

# Resolve a board by name (prints the board id). Numeric input passes
# through (work-item ids and board ids are both GUIDs/ids here).
# Usage: provider_projects_id_by_name OWNER PROJECT-NAME-OR-NUMBER
provider_projects_id_by_name() {
    local _owner="$1" name="$2"
    [ -n "$name" ] || { log_error "provider_projects_id_by_name: project name required"; return 1; }
    local op team
    op=$(azure_org_project) || return 1
    team=$(azure_default_team_id) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local response
    if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/${team}/_apis/work/boards?api-version=7.1"); then
        return 1
    fi
    local id
    id=$(printf '%s' "$response" | jq -r --arg n "$name" '.value[] | select(.name == $n) | .id')
    [ -n "$id" ] && [ "$id" != "null" ] || { log_error "provider_projects_id_by_name: no board named '$name'"; return 1; }
    printf '%s\n' "$id"
}

# Add a work item to a board: work items are born on their type's board —
# no-op success for interface parity.
# Usage: provider_projects_item_add [repo] PROJECT_NUMBER ISSUE_URL_OR_ID
provider_projects_item_add() {
    return 0
}

# The "item id" for a work item is the work item id itself.
# Usage: provider_projects_item_id_for_issue PROJECT-ID ISSUE-NUMBER OWNER REPO
provider_projects_item_id_for_issue() {
    local _project_id="$1" issue="$2"
    [ -n "$issue" ] || { log_error "provider_projects_item_id_for_issue: issue number required"; return 1; }
    printf '%s\n' "$issue"
}

# List the Status field's options: the union of the work-item states
# (the settable surface) plus the board's column names. Emits gh-shaped
# field/option JSON per line.
# Usage: provider_projects_field_list [repo] PROJECT_NUMBER
provider_projects_field_list() {
    shift 2 2>/dev/null || true   # repo, PROJECT_NUMBER (board implied by type)
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    # WIT states read at plain 7.1 (research-verified; no preview pin).
    local response
    if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/wit/workitemtypes/Issue/states?api-version=7.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -c '.value[] | {name: "Status", option: .name, settable: true}'
}

# Resolve a Status word to (field_id, option_id) — both are the literal
# string "Status"/state-name under azure (option-id = the state name).
# Fails defined when the word aliases onto no state.
# Usage: provider_projects_field_option_ids PROJECT-ID FIELD-NAME OPTION-NAME
provider_projects_field_option_ids() {
    local _project_id="$1" field="$2" word="$3"
    [ -n "$word" ] || { log_error "provider_projects_field_option_ids: option name required"; return 1; }
    local op states
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local states_response
    states_response=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/wit/workitemtypes/Issue/states?api-version=7.1" 2>/dev/null) || states_response=""
    states=$(printf '%s' "$states_response" | jq -r '.value[].name' 2>/dev/null) || states=""
    local state
    state=$(azure_status_alias "$word" "$states") || return 1
    printf '%s\t%s\n' "$field" "$state"
}

# Set the Status field = patch the work item's System.State.
# Usage: provider_projects_field_set PROJECT-ID ITEM-ID FIELD-ID OPTION-ID
provider_projects_field_set() {
    local _project_id="$1" item="$2" _field="$3" option="$4"
    [ -n "$item" ] && [ -n "$option" ] || { log_error "provider_projects_field_set: item and option required"; return 1; }
    azure_issue_patch_state "$item" "$option"
}

# Which boards hold a work item: emits title\tnumber\tstatus rows in the
# GH shape (status = System.State; column follows the state mapping).
# Usage: provider_projects_for_issue ISSUE-URL OWNER
provider_projects_for_issue() {
    local _issue_url="$1" _owner="$2"
    local issue="${3:-}"
    # The issue number rides the URL under azure callers; parse it out.
    issue="${issue:-$(printf '%s' "$_issue_url" | grep -oE '(/issues/|/_workitems/edit/)[0-9]+' | grep -oE '[0-9]+')}"
    [ -n "$issue" ] || { log_error "provider_projects_for_issue: issue number unresolvable from '$_issue_url'"; return 1; }
    local base op org project
    op=$(azure_org_project) || return 1
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    base="https://dev.azure.com/${org}/${project}/_apis/wit"
    local response
    if ! response=$(azure_http_request GET "$base/workitems/$issue?\$fields=System.State,System.WorkItemType&api-version=7.1"); then
        return 1
    fi
    local state type
    state=$(printf '%s' "$response" | jq -r '.fields["System.State"] // "-"')
    type=$(printf '%s' "$response" | jq -r '.fields["System.WorkItemType"] // "Issue"')
    printf '%s\t%s\t%s\n' "${type} Board" "$issue" "$state"
}
