#!/usr/bin/env bash
# azure-setup.sh (azure provider) - One-time project setup per MAPPING.md.
#
# Points at the configured Azure project (devenv.config [provider]
# azure_org/azure_project) and configures it for the devenv tooling:
#
#   1. Area paths     — one per repo in the project (MAPPING.md: the
#                       area-path convention; per-repo issue scoping).
#   2. Board columns  — the default team's boards get the [workflows]
#                       status_workflow vocabulary (config-read, never
#                       hard-coded) as column names, mapped onto the
#                       work-item states the process provides.
#   3. Config block   — prints the devenv.config [provider] block for the
#                       fork's own config (org/project/name keys).
#
# Idempotent: existing area paths are retained; boards converge to the
# configured workflow even when their columns were previously customized.
# Dry-run mode prints the plan without applying anything.
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

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat <<'HELP'
azure-setup.sh — one-time Azure project setup per MAPPING.md

Configures the configured Azure project for the devenv tooling: per-repo
area paths (the GitHub per-repo issue mapping), board columns from the
[workflows] status_workflow vocabulary, and emits the fork's
devenv.config [provider] block.

USAGE
  AZURE_SETUP=1 bash tools/lib/providers/azure/azure-setup.sh [--dry-run]

REQUIRED
  1. PAT stored via key-update-azure (0600 file).
  2. devenv.config [provider]: azure_org + azure_project (the target).
  3. devenv.config [workflows]: status_workflow (column vocabulary).

WHAT IT DOES
  - Area path per repo found in the project (skips existing).
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
    exit 0
fi

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

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
TEAM_ID="$(azure_http_request GET "https://dev.azure.com/${ORG}/_apis/projects/${PROJECT_GUID}?includeCapabilities=true&api-version=7.1-preview.4" \
    | jq -r '.defaultTeam.id // empty')"
if [ -z "$TEAM_ID" ]; then
    # Fallback: first team on the project.
    TEAM_ID="$(azure_http_request GET "https://dev.azure.com/${ORG}/_apis/projects/${PROJECT_GUID}/teams" \
        | jq -r '.value[0].id // empty')"
fi
[ -n "$TEAM_ID" ] || { echo "no team resolvable for project '$PROJECT'." >&2; exit 1; }
echo "  team: ${TEAM_ID}"

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
        "{\"name\":\"${repo}\"}" >/dev/null 2>&1; then
        echo "  created area path: ${PROJECT}\\${repo}"
        created=$((created + 1))
    else
        echo "  warn: area path creation failed for '$repo'" >&2
    fi
done <<< "$repo_names"
echo "  area paths: ${created} created, ${skipped} already present"

# ---------------------------------------------------------------------------
# 3. Board columns — default team's boards get the status vocabulary.
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
        if printf '%s' "$payload" | jq -e 'map(.stateMappings) | length > (unique | length)' >/dev/null; then
            echo "  warn: board '$board' shares process-state mappings; its workflow columns are not independently settable states" >&2
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
