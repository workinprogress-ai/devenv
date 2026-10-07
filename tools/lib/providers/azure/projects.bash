#!/bin/bash
# azure/projects.bash - Azure DevOps implementation of the projects domain
# verbs (the Boards mapping).
#
# Mapping (MAPPING.md): the seam's "project" is the Azure BOARD; the "Status"
# single-select is the work item's board column, stored in its Kanban column
# field (WEF_<guid>_Kanban.Column — the read-only System.BoardColumn mirrors it),
# so each of the workflow's words is distinct even though the process has fewer
# states. Writing the column moves System.State by the board's column-to-state
# mapping. Work items are born on their type's board (item_add is a
# no-op-success); the "item id" is the work item id. A work item of a type with
# no board (an Issue) has no column: its Status is its System.State.
#
# Board status vocabulary: the fork's status_workflow words are the column names;
# a word that differs from its column maps through the [azure_status_aliases]
# config block (azure_status_alias below); option-id = the column name.
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
if ! declare -F azure_apply_list_flags >/dev/null; then
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

# The default team's GUID (the boards API's route segment). The project is
# looked up by its configured value, which may be its name or its GUID (the
# projects API takes either), then its teams are listed; the first is the default.
azure_default_team_id() {
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local response guid
    if ! response=$(azure_http_request GET "https://dev.azure.com/$(azure_uri "$org")/_apis/projects/$(azure_uri "$project")?api-version=7.1"); then
        return 1
    fi
    guid=$(printf '%s' "$response" | jq -r '.id // empty')
    [ -n "$guid" ] || { log_error "azure_default_team_id: project '$project' not found"; return 1; }
    if ! response=$(azure_http_request GET "https://dev.azure.com/$(azure_uri "$org")/_apis/projects/${guid}/teams?api-version=7.1"); then
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
    # (1) exact state match passes through. Tab-delimited framing (real
    # tabs via tr) — a literal "\t" in the pattern would be read as the
    # character 't' by grep and never match.
    if [ -n "$states" ] && printf '\t%s\t' "$(printf '%s' "$states" | tr '\n' '\t')" | grep -q "$(printf '\t')$word$(printf '\t')"; then
        printf '%s' "$word"
        return 0
    fi
    # (2) config alias block: [azure_status_aliases] <word>=<state>
    local mapped
    mapped=$(azure_config_get azure_status_aliases "$word")
    if [ -n "$mapped" ]; then
        printf '%s' "$mapped"
        return 0
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

# List boards. By default one {name, number, id} object per line. With --format json
# the result is the seam's envelope, {"projects":[{title, number, id}], "totalCount":N},
# and --jq applies to that envelope. --owner is accepted and not consulted: the owner
# of an Azure board is the configured organization.
# Usage: provider_projects_list [repo] [--owner O] [--format json] [--jq J]
provider_projects_list() {
    if [ $# -gt 0 ] && [[ "$1" != -* ]]; then
        shift   # repo: boards are project-wide
    fi
    local format="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --owner) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; shift 2 ;;
            --format) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; format="${2:-}"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="${2:-}"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    [ -z "$format" ] || [ "$format" = "json" ] || { log_error "provider_projects_list: --format must be json"; return 1; }
    local op team
    op=$(azure_org_project) || return 1
    team=$(azure_default_team_id) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local response
    if ! response=$(azure_http_request GET "https://dev.azure.com/$(azure_uri "$org")/$(azure_uri "$project")/$(azure_uri "$team")/_apis/work/boards?api-version=7.1"); then
        return 1
    fi
    if [ "$format" = "json" ] || [ -n "$jq_expr" ]; then
        local envelope
        envelope=$(printf '%s' "$response" | jq -c '{projects: [.value[] | {title: .name, number: .id, id: .id}], totalCount: (.value | length)}')
        if [ -n "$jq_expr" ]; then
            printf '%s' "$envelope" | jq -r "($jq_expr) | select(. != null)"
        else
            printf '%s\n' "$envelope"
        fi
        return
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
    if ! response=$(azure_http_request GET "https://dev.azure.com/$(azure_uri "$org")/$(azure_uri "$project")/$(azure_uri "$team")/_apis/work/boards?api-version=7.1"); then
        return 1
    fi
    local id
    id=$(printf '%s' "$response" | jq -r --arg n "$name" '.value[] | select(.name == $n) | .id')
    [ -n "$id" ] && [ "$id" != "null" ] || { log_error "provider_projects_id_by_name: no board named '$name'"; return 1; }
    printf '%s\n' "$id"
}

# Add a work item to a board: work items are born on their type's board —
# no-op success for interface parity.
# --owner is accepted and not consulted (the owner is the configured organization).
# Usage: provider_projects_item_add [repo] PROJECT_NUMBER ISSUE_URL_OR_ID [--owner O]
provider_projects_item_add() {
    if [ $# -gt 2 ] && [[ "$1" != -* ]] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
        shift   # repo
    fi
    [ $# -ge 2 ] || { log_error "provider_projects_item_add: a project and an issue are required"; return 1; }
    shift 2
    while [ $# -gt 0 ]; do
        case "$1" in
            --owner) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    return 0
}

# The "item id" for a work item is the work item id itself.
# Usage: provider_projects_item_id_for_issue PROJECT-ID ISSUE-NUMBER OWNER REPO
provider_projects_item_id_for_issue() {
    local _project_id="$1" issue="$2"
    [ -n "$issue" ] || { log_error "provider_projects_item_id_for_issue: issue number required"; return 1; }
    printf '%s\n' "$issue"
}

# Board name for a work item type: User Story and Bug share the Stories board
# (whether Bug is on it is a team setting), Feature and Epic have their own.
# Usage: azure_board_name_for_type TYPE
azure_board_name_for_type() {
    case "$1" in
        "User Story"|Bug) printf 'Stories' ;;
        Feature) printf 'Features' ;;
        Epic) printf 'Epics' ;;
        *) printf '%s Board' "$1" ;;
    esac
}

# The Kanban column field of a work item (WEF_<guid>_Kanban.Column) — its
# reference name carries the board's guid, so it is found on the item itself.
# Usage: azure_kanban_field ITEM_JSON -> prints the field reference name, or nothing
azure_kanban_field() {
    printf '%s' "$1" | jq -r '[.fields | keys[] | select(test("^WEF_.*_Kanban\\.Column$"))][0] // empty'
}

# List the Status field's options: the column names of the project's boards
# (in board order, each name once). Emits seam-shaped field/option JSON per line.
# Usage: provider_projects_field_list [repo] PROJECT_NUMBER [--owner O]
provider_projects_field_list() {
    if [ $# -gt 1 ] && [[ "$1" != -* ]] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
        shift   # repo
    fi
    [ $# -gt 0 ] && shift   # PROJECT_NUMBER: the board is implied by the work item type
    while [ $# -gt 0 ]; do
        case "$1" in
            --owner) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    local op team org project
    op=$(azure_org_project) || return 1
    team=$(azure_default_team_id) || return 1
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local boards_url
    boards_url="https://dev.azure.com/$(azure_uri "$org")/$(azure_uri "$project")/$(azure_uri "$team")/_apis/work/boards"
    local boards
    boards=$(azure_http_request GET "${boards_url}?api-version=7.1") || return 1
    local id cols
    local -a names=()
    while IFS= read -r id; do
        [ -n "$id" ] || continue
        cols=$(azure_http_request GET "${boards_url}/${id}/columns?api-version=7.1") || return 1
        names+=("$(printf '%s' "$cols" | jq -c '[.value[].name]')")
    done < <(printf '%s' "$boards" | jq -r '.value[].id')
    [ "${#names[@]}" -gt 0 ] || return 0
    printf '%s\n' "${names[@]}" | jq -sc 'add | reduce .[] as $n ([]; if index($n) then . else . + [$n] end) | .[]' \
        | jq -c '{name: "Status", option: ., settable: true}'
}

# Resolve a Status word to (field_id, option_id): the literal "Status" and the
# board column the word names (the word itself, or its [azure_status_aliases]
# entry). The column is validated when it is written — Azure rejects a value the
# board does not carry.
# Usage: provider_projects_field_option_ids PROJECT-ID FIELD-NAME OPTION-NAME
provider_projects_field_option_ids() {
    local _project_id="$1" field="$2" word="$3"
    [ -n "$word" ] || { log_error "provider_projects_field_option_ids: option name required"; return 1; }
    local column
    column=$(azure_status_alias "$word" "") || return 1
    printf '%s\t%s\n' "$field" "$column"
}

# Set the Status field: write the work item's Kanban column field. Azure moves
# System.State by the board's column-to-state mapping. A work item with no
# column field (its type has no board) takes the word as a state instead.
# Usage: provider_projects_field_set PROJECT-ID ITEM-ID FIELD-ID OPTION-ID
provider_projects_field_set() {
    local _project_id="$1" item="$2" _field="$3" option="$4"
    [ -n "$item" ] && [ -n "$option" ] || { log_error "provider_projects_field_set: item and option required"; return 1; }
    local base op org project
    op=$(azure_org_project) || return 1
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    base="https://dev.azure.com/$(azure_uri "$org")/$(azure_uri "$project")/_apis/wit"
    local response
    response=$(azure_http_request GET "$base/workitems/$item?api-version=7.1") || return 1
    local kanban
    kanban=$(azure_kanban_field "$response")
    if [ -z "$kanban" ]; then
        azure_issue_patch_state "$item" "$option"
        return
    fi
    local patch_body
    patch_body=$(jq -cn --arg f "/fields/$kanban" --arg v "$option" '[{op: "add", path: $f, value: $v}]')
    azure_http_request PATCH "$base/workitems/$item" "$patch_body" "application/json-patch+json" >/dev/null
}

# Which boards hold a work item: emits title\tnumber\tstatus rows in the seam's
# shape. The status is the Kanban column (so every workflow word reads back as
# itself); an item with no column reports its System.State.
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
    base="https://dev.azure.com/$(azure_uri "$org")/$(azure_uri "$project")/_apis/wit"
    local response
    if ! response=$(azure_http_request GET "$base/workitems/$issue?api-version=7.1"); then
        return 1
    fi
    local kanban status type
    kanban=$(azure_kanban_field "$response")
    if [ -n "$kanban" ]; then
        status=$(printf '%s' "$response" | jq -r --arg f "$kanban" '.fields[$f] // "-"')
    else
        status=$(printf '%s' "$response" | jq -r '.fields["System.State"] // "-"')
    fi
    type=$(printf '%s' "$response" | jq -r '.fields["System.WorkItemType"] // "Issue"')
    printf '%s\t%s\t%s\n' "$(azure_board_name_for_type "$type")" "$issue" "$status"
}
