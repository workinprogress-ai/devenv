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
# Idempotent: existing area paths/board columns are left untouched (the
# run reports them as "already present" and converges around them).
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
  - Default team's boards: renames columns to the status_workflow
    vocabulary where columns are still stock (New/Active/Resolved/Closed).
  - Prints the [provider] config block for the fork's own devenv.config.

SAFETY
  Opt-in gate (AZURE_SETUP=1); idempotent (re-run converges); --dry-run
  prints the plan without applying. Never targets another org.
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
#    script does not attempt. Stock column names are replaced 1:1 with the
#    workflow vocabulary; non-stock columns are left alone (idempotency).
# ---------------------------------------------------------------------------
boards="$(azure_http_request GET "${BASE}/${TEAM_ID}/_apis/work/boards" 2>/dev/null | jq -r '.value[]?.name // empty' || true)"
if [ -n "$STATUS_WORKFLOW" ] && [ -n "$boards" ]; then
    # Stock Agile/Basic column names — the rename targets.
    # grep -c . counts actual entries (tr ',' emits no trailing newline,
    # so wc -l undercounts by one).
    vocab_count="$(printf '%s' "$STATUS_WORKFLOW" | tr ',' '\n' | grep -c .)"
    while IFS= read -r board; do
        [ -n "$board" ] || continue
        board_id="$(azure_http_request GET "${BASE}/${TEAM_ID}/_apis/work/boards" 2>/dev/null | jq -r --arg b "$board" '.value[] | select(.name == $b) | .id' || true)"
        [ -n "$board_id" ] || { echo "  warn: board id unresolvable for '$board'" >&2; continue; }
        cols_json="$(azure_http_request GET "${BASE}/${TEAM_ID}/_apis/work/boards/${board_id}/columns" 2>/dev/null || true)"
        col_count="$(printf '%s' "$cols_json" | jq -r '.value | length' 2>/dev/null || echo 0)"
        # Only rename when the board still has stock columns AND the vocab
        # count matches the column count (1:1 rename keeps stateMappings).
        stock_count=0
        while IFS= read -r cname; do
            [ -n "$cname" ] || continue
            # Stock names one per line: grep -x is WHOLE-line, so a single
            # space-separated line can never match an individual name.
            printf '%s\n' New Active Resolved Closed | grep -qxF "$cname" && stock_count=$((stock_count + 1))
        done <<< "$(printf '%s' "$cols_json" | jq -r '.value[].name')"
        if [ "$stock_count" -eq "$col_count" ] && [ "$col_count" -gt 0 ] && [ "$vocab_count" -eq "$col_count" ]; then
            if [ "$DRY_RUN" = "1" ]; then
                echo "  [dry] would rename board '$board' columns to the status_workflow vocabulary"
                continue
            fi
            new_cols="$(printf '%s' "$STATUS_WORKFLOW" | tr ',' '\n' | jq -Rsc 'split("\n") | map(select(length > 0))')"
            # Explicit range/map form: inside map(.value.name = $names[.key])
            # the .key reference misbinds under the |= update path (jq
            # precedence); this form names the index unambiguously. The PUT
            # body is the BARE column array (a {value: ...} wrapper is a 400
            # "boardColumns cannot be null" — live-verified).
            patched="$(printf '%s' "$cols_json" | jq -c --argjson names "$new_cols" \
                '[.value[]] as $cols | .value = ([range(0; $cols | length)] | map($cols[.] + {name: $names[.]}))')"
            [ -n "$patched" ] || { echo "  warn: board '$board' column recompute failed" >&2; continue; }
            payload="$(printf '%s' "$patched" | jq -c '.value')"
            if azure_http_request PUT "${BASE}/${TEAM_ID}/_apis/work/boards/${board_id}/columns" \
                "$payload" >/dev/null 2>&1; then
                echo "  board '$board': columns renamed to status_workflow vocabulary"
            else
                echo "  warn: board '$board' column rename failed" >&2
            fi
        else
            echo "  board '$board': columns left as-is (non-stock or count mismatch vs vocabulary)"
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

# Iteration stub (sprint path) for milestone lookups:
#iteration_path=${PROJECT}\\Sprint 1
BLOCK
echo
echo "done."
