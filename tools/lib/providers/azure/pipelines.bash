#!/usr/bin/env bash
# azure/pipelines.bash - Azure DevOps implementation of the pipelines domain.
#
# Maps the pipelines seam onto Azure Pipelines: builds (runs), definitions
# (workflows), artifacts, trigger/rerun/cancel. Field mapping:
#   run id -> buildId            status -> status (inProgress/completed/...)
#   conclusion -> result (succeeded/failed/canceled/partiallySucceeded)
#   branch -> sourceBranch       workflow -> definition.id/name
#
# Transport: azure_http_request / azure_http_paginate. Contract: return
# non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_PIPELINES_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_PIPELINES_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi
if ! declare -F azure_http_request >/dev/null; then
    # Self-heal: the canonical loader (provider-load order) may source this
    # module before http.bash; source the transport ourselves instead of
    # failing, so module order never matters.
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/http.bash"
fi
if ! declare -F azure_apply_gh_list_flags >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/urls.bash"
fi
if ! declare -F azure_http_request >/dev/null; then
    log_error "azure/pipelines.bash: providers/azure/http.bash failed to load"
    return 1
fi

# Build API base for org/project/repo (repo forms: org/project/repo,
# project/repo with config org, or empty for project-wide).
# Usage: azure_build_base REPO -> prints base URL
azure_build_base() {
    local repo="${1:-}"
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    if [ -n "$repo" ]; then
        case "$repo" in
            */*/*) org="${repo%%/*}"; local rest="${repo#*/}"; project="${rest%%/*}"; repo="${rest#*/}" ;;
            */*) project="${repo%%/*}"; repo="${repo#*/}" ;;
        esac
        printf 'https://dev.azure.com/%s/%s/_apis/build/builds?repositoryId=%s&repositoryType=TfsGit' "$org" "$project" "$repo"
    else
        printf 'https://dev.azure.com/%s/%s/_apis/build/builds' "$org" "$project"
    fi
}

# Map an Azure build status to the seam's status dialect (gh-shaped).
azure_build_status_to_seam() {
    case "$1" in
        inProgress) printf 'in_progress' ;;
        notStarted) printf 'queued' ;;
        cancelling) printf 'in_progress' ;;
        completed) printf 'completed' ;;
        *) printf 'unknown' ;;
    esac
}

# Map an Azure build result to the seam's conclusion dialect.
azure_build_result_to_seam() {
    case "$1" in
        succeeded) printf 'success' ;;
        partiallySucceeded) printf 'success' ;;
        failed) printf 'failure' ;;
        canceled) printf 'cancelled' ;;
        *) printf 'unknown' ;;
    esac
}

# Map one Azure build record to the seam's run shape (gh-shaped fields,
# including the gh alias fields consumers project: headBranch, updatedAt,
# databaseId). Optional argv: FIELD_LIST (comma-separated gh dialect) —
# when present, the projection emits only those keys (gh --json shape).
azure_map_build() {
    local field_list="${1:-}"
    local base='{
        id: (.id | tostring),
        databaseId: .id,
        workflowName: (.definition.name // ""),
        name: (.buildNumber // ""),
        event: (.reason // ""),
        status: (if .status == "inProgress" or .status == "cancelling" then "in_progress"
                  elif .status == "notStarted" then "queued"
                  elif .status == "completed" then "completed"
                  else "unknown" end),
        conclusion: (if .status != "completed" then null
                     elif .result == "succeeded" then "success"
                     elif .result == "partiallySucceeded" then "success"
                     elif .result == "failed" then "failure"
                     elif .result == "canceled" then "cancelled"
                     else "unknown" end),
        branch: (.sourceBranch | ltrimstr("refs/heads/")),
        headBranch: (.sourceBranch | ltrimstr("refs/heads/")),
        headSha: (.sourceVersion // ""),
        createdAt: (.queueTime // ""),
        updatedAt: (.finishTime // .queueTime // ""),
        url: ((.url // "") )
    }'
    local prog="$base"
    if [ -n "$field_list" ]; then
        # Project to the requested gh-dialect keys (unknown keys -> null).
        local keys
        keys=$(printf '%s' "$field_list" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | awk '{printf "%s%s", (NR>1 ? "," : ""), $0}')
        prog="($base) | {$keys}"
    fi
    jq -c "$prog"
}

# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

# List workflow runs (builds). Supports --branch, --workflow, --limit,
# --json, --status (gh dialect: -L is --limit's shorthand).
# Usage: provider_pipelines_run_list [repo] [--branch B] [--workflow W] [--limit N] [FLAGS]
provider_pipelines_run_list() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local branch="" workflow="" limit="30" status=""
    local field_list=""
    local jq_filter=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --branch) branch="$2"; shift 2 ;;
            --workflow) workflow="$2"; shift 2 ;;
            --limit|-L) limit="$2"; shift 2 ;;
            --json)
                shift
                if [[ ${1:-} != --* ]] && [ $# -gt 0 ]; then field_list="$1"; shift; fi
                ;;
            --status)
                shift
                if [[ ${1:-} != --* ]] && [ $# -gt 0 ]; then status="$1"; shift; fi
                ;;
            -q|--jq)
                shift
                if [[ ${1:-} != --* ]] && [ $# -gt 0 ]; then jq_filter="$1"; shift; fi
                ;;
            *) shift ;;
        esac
    done

    # gh --status words map onto Azure's statusFilter vocabulary.
    local status_filter=""
    case "$status" in
        in_progress) status_filter="inProgress" ;;
        queued) status_filter="notStarted" ;;
        completed) status_filter="completed" ;;
        "") : ;;
        *) log_warn "run_list: --status '$status' has no azure statusFilter analog — unfiltered" ;;
    esac

    local base_query
    base_query=$(azure_build_base "$repo") || return 1
    local query="${base_query}"
    [ -n "$branch" ] && query="${query}&branchName=refs/heads/${branch}"
    # gh --workflow filters by workflow name; azure's builds list takes a
    # definitions= name filter (server-side, exact name).
    [ -n "$workflow" ] && query="${query}&definitions=${workflow}"
    [ -n "$status_filter" ] && query="${query}&statusFilter=${status_filter}"
    query="${query}&\$top=${limit}&queryOrder=queueTimeDescending"

    local response
    if ! response=$(azure_http_paginate "$query"); then
        return 1
    fi
    # Map each record (with the optional gh --json projection), assemble one
    # JSON array, then apply -q/--jq ONCE over the whole array — gh list
    # semantics ('[.[] | select(...)] | length' filters the list, not each
    # record).
    local -a mapped=()
    while IFS= read -r build; do
        mapped+=("$(printf '%s' "$build" | azure_map_build "$field_list")")
    done < <(printf '%s' "$response" | jq -c '.[]')
    local assembled="[]"
    if [ "${#mapped[@]}" -gt 0 ]; then
        assembled=$(printf '%s\n' "${mapped[@]}" | jq -s '.')
    fi
    azure_apply_gh_list_flags "$assembled" "" "$jq_filter"
}

# View a workflow run (build).
# Usage: provider_pipelines_run_view [repo] RUN_ID
provider_pipelines_run_view() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local run_id="$1"; shift

    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    if [ -n "$repo" ]; then
        case "$repo" in
            */*/*) org="${repo%%/*}"; local rest="${repo#*/}"; project="${rest%%/*}" ;;
            */*) project="${repo%%/*}" ;;
        esac
    fi
    local response
    if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/build/builds/${run_id}"); then
        return 1
    fi
    printf '%s' "$response" | azure_map_build
}

# Watch a run to completion (polling at the domain layer, matching the seam).
# Usage: provider_pipelines_run_watch [repo] RUN_ID [--exit-status]
# Polls to completion. With --exit-status (gh dialect), a completed run
# whose conclusion is not success exits non-zero — the CI semantic.
provider_pipelines_run_watch() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local run_id="$1"; shift
    local exit_status=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --exit-status) exit_status=1; shift ;;
            *) shift ;;
        esac
    done

    local poll interval_s=10 max_polls=120
    for ((poll = 1; poll <= max_polls; poll++)); do
        local mapped
        if ! mapped=$(provider_pipelines_run_view "$repo" "$run_id"); then
            log_error "provider_pipelines_run_watch: could not query run $run_id"
            return 1
        fi
        local status
        status=$(printf '%s' "$mapped" | jq -r '.status')
        printf '%s\n' "$mapped"
        case "$status" in
            completed)
                if [ "$exit_status" -eq 1 ]; then
                    local conclusion
                    conclusion=$(printf '%s' "$mapped" | jq -r '.conclusion // ""')
                    case "$conclusion" in
                        success) return 0 ;;
                        *) return 1 ;;
                    esac
                fi
                return 0
                ;;
        esac
        sleep "$interval_s"
    done
    log_error "provider_pipelines_run_watch: timed out waiting for run $run_id"
    return 1
}

# List workflows (build definitions). Supports --json FIELDS / -q J (gh
# dialect); every definition is active unless disabled (gh's state field).
# Usage: provider_pipelines_workflow_list [repo] [--json F] [-q J]
provider_pipelines_workflow_list() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local json_fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --json)
                shift
                if [[ ${1:-} != --* ]] && [ $# -gt 0 ]; then json_fields="$1"; shift; fi
                ;;
            -q|--jq)
                shift
                if [[ ${1:-} != --* ]] && [ $# -gt 0 ]; then jq_expr="$1"; shift; fi
                ;;
            *) shift ;;
        esac
    done
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local api="https://dev.azure.com/${org}/${project}/_apis/build/definitions"
    if [ -n "$repo" ]; then
        local repo_name="${repo##*/}"
        api="${api}?repositoryId=${repo_name}&repositoryType=TfsGit"
    fi
    local response
    if ! response=$(azure_http_paginate "$api"); then
        return 1
    fi
    # One JSON array; state maps from the definition's enabled flag (gh's
    # active/disabled vocabulary).
    local mapped
    mapped=$(printf '%s' "$response" | jq -c '[.[] | {id: (.id | tostring), name: .name, path: .path, state: (if .enabled == false then "disabled" else "active" end)}]')
    azure_apply_gh_list_flags "$mapped" "$json_fields" "$jq_expr"
}

# Fetch run artifacts metadata.
# Usage: provider_pipelines_run_artifacts REPO RUN_ID
provider_pipelines_run_artifacts() {
    local repo="$1" run_id="$2"
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local response
    if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/build/builds/${run_id}/artifacts"); then
        return 1
    fi
    # size_in_bytes must be a number, not the download URL (gh artifact
    # shape); the download link survives under url; created_at carries the
    # artifact's date (the shared table mode splits it on "T").
    printf '%s' "$response" | jq -c '[.value[] | {id: (.id | tostring), name: .name, size_in_bytes: (.resource.properties."file Size" | tonumber? // 0), created_at: (.createdDate // ""), url: .resource.downloadUrl}]'
}

# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

# Trigger a workflow (queue a build against a definition).
# Usage: provider_pipelines_workflow_run [repo] WORKFLOW [--ref REF] [FLAGS]
provider_pipelines_workflow_run() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local workflow="$1"; shift
    local ref=""
    local -a run_inputs=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --ref) ref="$2"; shift 2 ;;
            # pipelines-run sends dispatch inputs as --field k=v; azure
            # queues take parameters{} — collected here, applied below.
            --field|-f|-F) run_inputs+=("$2"); shift 2 ;;
            *) shift ;;
        esac
    done
    [ -n "$workflow" ] || { log_error "provider_pipelines_workflow_run requires a workflow (definition id or name)"; return 1; }

    # gh's default is the repo's default branch — resolve it instead of
    # guessing a ref name (a main-default fork would queue on a
    # nonexistent branch).
    if [ -z "$ref" ]; then
        ref=$(provider_repos_default_branch "$repo" 2>/dev/null) || {
            log_error "provider_pipelines_workflow_run: could not resolve the default branch for '$repo' — pass --ref explicitly"
            return 1
        }
    fi

    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)

    local body
    # Dispatch inputs (--field k=v) become the queue's parameters. The REST
    # Build contract types parameters as a STRING holding serialized JSON
    # ({"parameters":"{\"k\":\"v\"}"}), and keys may contain characters jq's
    # --arg binding rejects (e.g. dashes) — so each pair becomes its own
    # one-key object literal, merged by jq.
    local params_json="{}"
    if [ "${#run_inputs[@]}" -gt 0 ]; then
        local kv
        params_json=$(for kv in "${run_inputs[@]}"; do
                jq -cn --arg k "${kv%%=*}" --arg v "${kv#*=}" '{($k): $v}'
            done | jq -cs 'add // {}')
    fi
    body=$(jq -n --arg workflow_id "$workflow" --arg ref "refs/heads/${ref}" --argjson params "$params_json" \
        '{definition: {id: ($workflow_id | tonumber? // null), name: (if ($workflow_id | tonumber?) != null then null else $workflow_id end)}, sourceBranch: $ref} + (if ($params | length) > 0 then {parameters: ($params | tostring)} else {} end)')
    local response
    if ! response=$(azure_http_request POST "https://dev.azure.com/${org}/${project}/_apis/build/builds" "$body"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.id'
}

# Rerun a workflow run.
# Usage: provider_pipelines_run_rerun [repo] RUN_ID
provider_pipelines_run_rerun() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local run_id="$1"; shift

    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    azure_http_request POST "https://dev.azure.com/${org}/${project}/_apis/build/builds/${run_id}" >/dev/null
}

# Cancel a run.
# Usage: provider_pipelines_run_cancel REPO RUN_ID
provider_pipelines_run_cancel() {
    local repo="$1" run_id="$2"
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local patch_body='{"status":"cancelling"}'
    azure_http_request PATCH "https://dev.azure.com/${org}/${project}/_apis/build/builds/${run_id}" "$patch_body" >/dev/null
}

# Download run artifacts. Azure serves artifacts as zip downloads; this verb
# fetches to the current directory with the artifact's name.
# Usage: provider_pipelines_run_download [repo] RUN_ID [FLAGS]
provider_pipelines_run_download() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local run_id="$1"; shift

    # gh-dialect flags: -n NAME downloads only that artifact; -D DIR is the
    # destination directory (created when missing). Defaults: all artifacts
    # to the current directory.
    local only_name="" dest_dir="."
    while [ $# -gt 0 ]; do
        case "$1" in
            -n) only_name="$2"; shift 2 ;;
            -D) dest_dir="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    [ -d "$dest_dir" ] || mkdir -p "$dest_dir" || return 1

    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local response
    if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/build/builds/${run_id}/artifacts"); then
        return 1
    fi
    local name url
    while IFS=$'\t' read -r name url; do
        [ -n "$name" ] || continue
        # -n restricts the download to the named artifact (gh dialect).
        [ -n "$only_name" ] && [ "$name" != "$only_name" ] && continue
        # Artifact download goes through the same authenticated transport
        # contract as every other call (Authorization header; the PAT never
        # rides curl argv) — binary body, so the JSON transport is bypassed
        # but the auth + api-version rules are identical.
        if ! curl -sS -H "$(printf 'Authorization: Basic %s' "$(printf ':%s' "${AZURE_PAT}" | base64 | tr -d '\r\n')")" \
            -o "${dest_dir}/${name}.zip" "${url}?api-version=7.1"; then
            log_error "failed downloading artifact $name"
            return 1
        fi
    done < <(printf '%s' "$response" | jq -r '.value[] | [.name, .resource.downloadUrl] | @tsv')
}

# Wait until no runs are queued/in_progress on a branch (GH polling
# semantics; azure statuses map to the same vocabulary).
# Usage: provider_pipelines_wait_for_branch REPO BRANCH [TIMEOUT_POLLS]
provider_pipelines_wait_for_branch() {
    local repo="${1:?repo required}" branch="${2:?branch required}" max_polls="${3:-30}"
    local poll active
    for ((poll = 1; poll <= max_polls; poll++)); do
        # run_list emits one JSON array; select over it directly.
        active=$(provider_pipelines_run_list "$repo" --branch "$branch" --limit 10 2>/dev/null \
            | jq '[.[] | select(.status == "queued" or .status == "in_progress")] | length') || {
            log_error "provider_pipelines_wait_for_branch: could not query runs for $repo@$branch"
            return 1
        }
        [ "${active:-0}" -eq 0 ] && return 0
        sleep 2
    done
    log_error "provider_pipelines_wait_for_branch: $repo@$branch did not settle within $max_polls polls"
    return 1
}
