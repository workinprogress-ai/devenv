#!/usr/bin/env bash
# azure-setup.sh - One-time Azure DevOps project setup per MAPPING.md.
#
# Points at the configured Azure project (devenv.config [provider]
# azure_org/azure_project) and configures it for the devenv tooling:
#
#   1. Area paths     — one per repo in the project (MAPPING.md: the
#                       area-path convention; per-repo issue scoping).
#   2. Bugs on boards — the default team manages Bugs as requirements, so a
#                       Bug sits on the Stories board next to User Stories and
#                       carries a Kanban column like them.
#   3. Board columns  — the default team's boards get the [workflows]
#                       status_workflow vocabulary (config-read, never
#                       hard-coded) as column names, mapped onto the
#                       work-item states the process provides.
#   4. Config block   — prints the devenv.config [provider] block for the
#                       fork's own config (org/project/name keys).
#
# Idempotent: existing area paths are retained; boards converge to the
# configured workflow even when their columns were previously customized.
# Dry-run mode prints the plan without applying anything.
#
# Preflight (before anything is written): the project's process must be Agile
# (the status and state mappings below assume its states), and the PAT must be
# able to read what the setup reads (projects, repositories, area paths, team
# settings and boards). A write permission cannot be probed without writing, so a
# missing write scope shows up as a warning at the first write that needs it.
#
# Gate: refuses to run without AZURE_SETUP=1 (same opt-in pattern as
# azure-smoke-test.sh). Never targets an org other than the configured
# one; never invoked by tests or CI.
#
# Usage:
#   AZURE_SETUP=1 bash tools/lib/providers/azure/azure-setup.sh [--dry-run]
#
# Requires: key-update-azure has stored the PAT (0600 file); devenv.config
# carries [provider] azure_org / azure_project; config-read can reach the
# [workflows] status_workflow vocabulary.

set -euo pipefail
# shellcheck source=../../self-root.bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/lib/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
export PROVIDER_NAME="azure"
provider_load auth
source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"

show_usage() {
    cat <<'HELP'
azure-setup — one-time Azure project setup per MAPPING.md

Configures the configured Azure project for the devenv tooling: per-repo
area paths (the per-repo issue mapping), Bugs as board items, board columns
from the [workflows] status_workflow vocabulary, and emits the fork's
devenv.config [provider] block.

USAGE
  AZURE_SETUP=1 bash tools/lib/providers/azure/azure-setup.sh [--dry-run]

REQUIRED
  1. PAT stored via key-update-azure (0600 file).
  2. devenv.config [provider]: azure_org + azure_project (the target).
  3. devenv.config [workflows]: status_workflow (column vocabulary).

WHAT IT DOES
  - Preflight: the project's process must be Agile and the PAT must be able to
    read projects, repositories, area paths, team settings and boards; otherwise it
    stops before writing anything.
  - Area path per repo found in the project (skips existing).
  - Default team: manages Bugs as requirements (bugsBehavior), so a Bug sits
    on the Stories board and carries a status column like a User Story.
    - Default team's boards: replaces customized column names and adjusts
        the column count to status_workflow, preserving supported state mappings.
        Extra columns are removed; new middle columns reuse an in-progress mapping.
  - Prints the [provider] config block for the fork's own devenv.config.

SAFETY
  Opt-in gate (AZURE_SETUP=1); idempotent (re-run converges); --dry-run
  prints the plan without applying. Never targets another org.
    Shared state mappings do not create distinct settable workflow states;
    those require inherited-process customization by a process administrator.
HELP
}

DRY_RUN=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        -h|--help) show_usage; exit 0 ;;
        --dry-run) DRY_RUN=1 ;;
        *) echo "unknown option: $1 (see --help)" >&2; exit "$EXIT_MISUSE" ;;
    esac
    shift
done

if [ "${AZURE_SETUP:-0}" != "1" ]; then
    echo "refusing to run: set AZURE_SETUP=1 to opt in (see --help)." >&2
    exit 1
fi

# PAT resolution (never printed). set -e does not guard command
# substitutions in assignments on all bash versions — capture rc.
AZURE_PAT=""
if ! AZURE_PAT="$(provider_secret_get token 2>/dev/null)" || [ -z "$AZURE_PAT" ]; then
    echo "no PAT resolvable — run key-update-azure first." >&2
    exit 1
fi
export AZURE_PAT

op="$(azure_org_project)" || { echo "azure_org_project failed — check [provider] azure_org/azure_project." >&2; exit 1; }
ORG="$(printf '%s' "$op" | sed -n 1p)"
PROJECT="$(printf '%s' "$op" | sed -n 2p)"
BASE="https://dev.azure.com/${ORG}/${PROJECT}"

echo "azure setup — target: org=${ORG} project=${PROJECT}"
[ "$DRY_RUN" = "1" ] && echo "(dry run: nothing will be applied)"

# ---------------------------------------------------------------------------
# Status vocabulary from config (never hard-code workflow words).
# The library form is preferred: bootstrap sources it, but a bare shell
# (no tools/ on PATH) must still read the fork's configured vocabulary —
# a silent miss here would skip board columns with stock names instead
# of the user's configured statuses.
# ---------------------------------------------------------------------------
STATUS_WORKFLOW=""
# shellcheck source=../../../config-reader.bash
source "$DEVENV_TOOLS/lib/config-reader.bash" 2>/dev/null || true
if declare -F config_read_value >/dev/null 2>&1; then
    config_init "${DEVENV_ROOT:-}/devenv.config" 2>/dev/null || true
    STATUS_WORKFLOW="$(config_read_value workflows status_workflow 2>/dev/null || true)"
else
    # Fallback: the config-read CLI wrapper (requires tools/ on PATH).
    STATUS_WORKFLOW="$(config-read workflows status_workflow 2>/dev/null || true)"
fi
if [ -z "$STATUS_WORKFLOW" ]; then
    echo "  warn: [workflows] status_workflow not configured — board columns skipped" >&2
fi

# ---------------------------------------------------------------------------
# 1. Project GUID + default team (teams route requires the GUID).
# ---------------------------------------------------------------------------
PROJECT_GUID="$(azure_http_request GET "https://dev.azure.com/${ORG}/_apis/projects" \
    | jq -r --arg p "$PROJECT" '.value[] | select(.name == $p) | .id // empty')"
[ -n "$PROJECT_GUID" ] || { echo "project '$PROJECT' not found or not readable." >&2; exit 1; }
PROJECT_JSON="$(azure_http_request GET "https://dev.azure.com/${ORG}/_apis/projects/${PROJECT_GUID}?includeCapabilities=true&api-version=7.1-preview.4")"
TEAM_ID="$(printf '%s' "$PROJECT_JSON" | jq -r '.defaultTeam.id // empty')"
if [ -z "$TEAM_ID" ]; then
    # Fallback: first team on the project.
    TEAM_ID="$(azure_http_request GET "https://dev.azure.com/${ORG}/_apis/projects/${PROJECT_GUID}/teams" \
        | jq -r '.value[0].id // empty')"
fi
[ -n "$TEAM_ID" ] || { echo "no team resolvable for project '$PROJECT'." >&2; exit 1; }
echo "  team: ${TEAM_ID}"

# ---------------------------------------------------------------------------
# Preflight: the process and the PAT, before anything is written.
# ---------------------------------------------------------------------------
PROCESS_NAME="$(printf '%s' "$PROJECT_JSON" | jq -r '.capabilities.processTemplate.templateName // empty')"
if [ -z "$PROCESS_NAME" ]; then
    echo "  warn: the project's process could not be read — Agile not confirmed" >&2
elif [ "$PROCESS_NAME" != "Agile" ]; then
    echo "project '$PROJECT' uses the '$PROCESS_NAME' process; this setup maps the board onto the Agile process's work-item states." >&2
    echo "Use an Agile project, or adapt the state mappings in MAPPING.md before running it." >&2
    exit 1
else
    echo "  process: Agile"
fi

preflight_failed=0
preflight_read() {   # <what the PAT must read> <url>
    if ! azure_http_request GET "$2" >/dev/null 2>&1; then
        echo "PAT preflight: cannot read $1 — grant the PAT the matching read scope, then re-run." >&2
        preflight_failed=1
    fi
}
preflight_read "repositories (Code: Read)" "${BASE}/_apis/git/repositories"
preflight_read "area paths (Work Items: Read)" "${BASE}/_apis/wit/classificationnodes?structureGroup=areas&\$depth=1"
preflight_read "team settings (Work Items: Read)" "${BASE}/${TEAM_ID}/_apis/work/teamsettings"
preflight_read "boards (Work Items: Read)" "${BASE}/${TEAM_ID}/_apis/work/boards"
[ "$preflight_failed" -eq 0 ] || exit 1

# ---------------------------------------------------------------------------
# 2. Area paths — one per repo.
# ---------------------------------------------------------------------------
AREAS_API="${BASE}/_apis/wit/classificationnodes?structureGroup=areas&\$depth=1"
existing_areas="$(azure_http_request GET "$AREAS_API" 2>/dev/null | jq -r '.children[]?.name' | sort -u || true)"
repos_json="$(azure_http_paginate "${BASE}/_apis/git/repositories" 2>/dev/null || true)"
repo_names="$(printf '%s' "$repos_json" | jq -r '.[].name' 2>/dev/null | sort -u || true)"

created=0; skipped=0
while IFS= read -r repo; do
    [ -n "$repo" ] || continue
    if printf '%s\n' "$existing_areas" | grep -qxF "$repo"; then
        skipped=$((skipped + 1)); continue
    fi
    if [ "$DRY_RUN" = "1" ]; then
        echo "  [dry] would create area path: ${PROJECT}\\${repo}"
        created=$((created + 1)); continue
    fi
    if azure_http_request POST "${BASE}/_apis/wit/classificationnodes/areas" \
        "$(jq -nc --arg n "$repo" '{name: $n}')" >/dev/null 2>&1; then
        echo "  created area path: ${PROJECT}\\${repo}"
        created=$((created + 1))
    else
        echo "  warn: area path creation failed for '$repo'" >&2
    fi
done <<< "$repo_names"
echo "  area paths: ${created} created, ${skipped} already present"

# ---------------------------------------------------------------------------
# 3. Bugs on the board — the team's bugsBehavior decides whether a Bug is a
#    backlog item of its own (asRequirements: it sits on the Stories board with
#    a Kanban column), a task under its story (asTasks, the default), or hidden.
#    The status column of a Bug exists only in the first case.
# ---------------------------------------------------------------------------
team_settings_url="${BASE}/${TEAM_ID}/_apis/work/teamsettings"
bugs_behavior="$(azure_http_request GET "$team_settings_url" 2>/dev/null | jq -r '.bugsBehavior // empty' 2>/dev/null || true)"
bugs_on_board=0
if [ -z "$bugs_behavior" ]; then
    echo "  warn: team settings unreadable — Bugs behavior not checked" >&2
elif [ "$bugs_behavior" = "asRequirements" ]; then
    echo "  bugs: already managed as requirements (on the Stories board)"
    bugs_on_board=1
elif [ "$DRY_RUN" = "1" ]; then
    echo "  [dry] would set the team's bugsBehavior: ${bugs_behavior} -> asRequirements"
    bugs_on_board=1
elif azure_http_request PATCH "$team_settings_url" '{"bugsBehavior":"asRequirements"}' >/dev/null 2>&1; then
    echo "  bugs: team bugsBehavior set ${bugs_behavior} -> asRequirements"
    bugs_on_board=1
else
    echo "  warn: could not set the team's bugsBehavior — Bugs will not carry a board column" >&2
fi

# ---------------------------------------------------------------------------
# 3b. Board columns — default team's boards get the status vocabulary.
#    Constraint (MAPPING.md): columns map onto the work-item states the
#    process provides; custom state CREATION is a process-admin change the
#    script does not attempt. Existing column customization is overwritten
#    to converge to the configured vocabulary and column count.
# ---------------------------------------------------------------------------
boards="$(azure_http_request GET "${BASE}/${TEAM_ID}/_apis/work/boards" 2>/dev/null | jq -r '.value[]?.name // empty' || true)"
if [ -n "$STATUS_WORKFLOW" ] && [ -n "$boards" ]; then
    new_cols="$(printf '%s' "$STATUS_WORKFLOW" | jq -Rc 'split(",") | map(gsub("^\\s+|\\s+$"; ""))')"
    if ! printf '%s' "$new_cols" | jq -e 'length >= 2 and all(.[]; length > 0) and (unique | length) == length' >/dev/null; then
        echo "status_workflow must contain at least two distinct, non-empty column names." >&2
        exit 1
    fi
    vocab_count="$(printf '%s' "$new_cols" | jq 'length')"
    while IFS= read -r board; do
        [ -n "$board" ] || continue
        board_id="$(azure_http_request GET "${BASE}/${TEAM_ID}/_apis/work/boards" 2>/dev/null | jq -r --arg b "$board" '.value[] | select(.name == $b) | .id' || true)"
        [ -n "$board_id" ] || { echo "  warn: board id unresolvable for '$board'" >&2; continue; }
        cols_json="$(azure_http_request GET "${BASE}/${TEAM_ID}/_apis/work/boards/${board_id}/columns" 2>/dev/null || true)"
        col_count="$(printf '%s' "$cols_json" | jq -r '.value | length' 2>/dev/null || echo 0)"
        if ! payload="$(printf '%s' "$cols_json" | jq -c --argjson names "$new_cols" '
            .value as $columns |
            if ($columns | length) < 2 then
                error("board has no reusable incoming/outgoing columns")
            else
                ($columns | map(select(.columnType == "inProgress")) | first) as $template |
                [range(0; $names | length) | . as $index |
                    (if $index == 0 then $columns[0]
                     elif $index == ($names | length) - 1 then $columns[-1]
                     elif $index < ($columns | length) - 1 then $columns[$index]
                     elif $template != null then $template + {id: null}
                     else error("new middle columns require an existing in-progress state mapping")
                     end) + {name: $names[$index]}
                ]
            end
        ')"; then
            echo "  warn: board '$board' column configuration could not be constructed" >&2
            continue
        fi
        # A Bug on the board needs a state mapping per column, like a User Story: a
        # column write on a Bug is rejected without one. Bugs use the User Story's
        # mapping (the Agile process gives both the same states).
        if [ "$bugs_on_board" = "1" ]; then
            payload="$(printf '%s' "$payload" | jq -c 'map(if (.stateMappings["User Story"] != null and .stateMappings.Bug == null) then .stateMappings.Bug = .stateMappings["User Story"] else . end)')"
        fi
        if printf '%s' "$payload" | jq -e 'map(.stateMappings) | length > (unique | length)' >/dev/null; then
            echo "  note: board '$board' maps several columns onto one process state; each column is still its own status (stored in the Kanban column field), and System.State follows the board's mapping" >&2
        fi
        if printf '%s' "$cols_json" | jq -e --argjson columns "$payload" '.value == $columns' >/dev/null; then
            echo "  board '$board': already configured to status_workflow"
            continue
        fi
        if [ "$DRY_RUN" = "1" ]; then
            echo "  [dry] would configure board '$board' columns (${col_count} -> ${vocab_count}) to status_workflow"
            continue
        fi
        if azure_http_request PUT "${BASE}/${TEAM_ID}/_apis/work/boards/${board_id}/columns" \
            "$payload" >/dev/null 2>&1; then
            echo "  board '$board': columns configured to status_workflow (${col_count} -> ${vocab_count})"
        else
            echo "  warn: board '$board' column configuration failed" >&2
        fi
    done <<< "$boards"
fi

# ---------------------------------------------------------------------------
# 4. Config-block emission.
# ---------------------------------------------------------------------------
echo
echo "devenv.config [provider] block for this project's fork:"
cat <<BLOCK
[provider]
name=azure
azure_org=${ORG}
azure_project=${PROJECT}

# Status-word aliases: fork-local board column name → workflow state.
# Any column not stock and not aliased fails defined at use time.
[azure_status_aliases]
#inprogress=active
#done=closed

# Iteration path: milestone READS resolve per work item
# (System.IterationLevel2) — no config needed. Reserved for a future
# milestone WRITE path.
#iteration_path=${PROJECT}\\Sprint 1
BLOCK
echo
echo "done."
