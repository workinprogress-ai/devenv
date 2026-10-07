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

# Capability: this module maps the pipelines seam onto Azure Pipelines.
if declare -F provider_declare_capability >/dev/null; then
    provider_declare_capability pipelines
fi

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
if ! declare -F azure_apply_list_flags >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/urls.bash"
fi
if ! declare -F azure_repo_flag_spec >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repo-flag.bash"
fi
if ! declare -F azure_repo_parts >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repos.bash"
fi
if ! declare -F azure_http_request >/dev/null; then
    log_error "azure/pipelines.bash: providers/azure/http.bash failed to load"
    return 1
fi

# Build API root for a repo spec's org and project (org/project/repo,
# project/repo, a bare repo name, or empty for the configured project), every
# component encoded.
# Usage: azure_build_root SPEC -> https://dev.azure.com/<org>/<project>/_apis/build
azure_build_root() {
    local parts org project
    parts=$(azure_repo_parts "${1:-}") || return 1
    org=$(printf '%s' "$parts" | sed -n 1p); project=$(printf '%s' "$parts" | sed -n 2p)
    printf 'https://dev.azure.com/%s/%s/_apis/build' "$(azure_uri "$org")" "$(azure_uri "$project")"
}

# Resolve a pipeline (build definition) to its numeric id(s): a number is the id
# already; a name is looked up (the definitions API filters by name, and the
# match here is exact). Several definitions may share a name across folders, so
# the ids come back comma-joined, the form the builds filter takes.
# Usage: azure_definition_ids SPEC NAME_OR_ID -> prints ids
azure_definition_ids() {
    local spec="$1" name="$2" root response ids
    if [[ "$name" =~ ^[0-9]+$ ]]; then
        printf '%s' "$name"
        return 0
    fi
    root=$(azure_build_root "$spec") || return 1
    response=$(azure_http_request GET "${root}/definitions?name=$(azure_uri "$name")") || return 1
    ids=$(printf '%s' "$response" | jq -r --arg n "$name" '[.value[]? | select(.name == $n) | .id | tostring] | join(",")')
    [ -n "$ids" ] || { log_error "no pipeline named '$name' in this project"; return 1; }
    printf '%s' "$ids"
}

# Map an Azure build status to the seam's status dialect (seam-shaped).
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

# The fields a run record carries (the seam's run dialect). A --json list naming
# anything else is an error, as on gh, never a null.
readonly AZURE_BUILD_FIELDS="id workflowName name event status conclusion headBranch headSha createdAt updatedAt url"

# Check a --json field list against the run record's fields.
# Usage: azure_build_fields_check VERB FIELDS   (returns 1 with a named error)
azure_build_fields_check() {
    local verb="$1" fields="$2" f
    [ -n "$fields" ] || return 0
    azure_json_fields_check "$verb" "$fields" || return 1
    local IFS=','
    for f in $fields; do
        case " $AZURE_BUILD_FIELDS " in
            *" $f "*) ;;
            *) log_error "$verb: unknown JSON field '$f'"; return 1 ;;
        esac
    done
}

# Map one Azure build record to the seam's run shape (seam-shaped fields,
# including the alias fields consumers project: headBranch, updatedAt,
# id). Optional argv: FIELD_LIST (comma-separated seam dialect) —
# when present, the projection emits only those keys (--json shape).
azure_map_build() {
    local field_list="${1:-}"
    local base='{
        id: .id,
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
        headBranch: (.sourceBranch | ltrimstr("refs/heads/")),
        headSha: (.sourceVersion // ""),
        createdAt: (.queueTime // ""),
        updatedAt: (.finishTime // .queueTime // ""),
        url: ((.url // "") )
    }'
    local prog="$base"
    if [ -n "$field_list" ]; then
        # Project to the requested seam-dialect keys (unknown keys -> null).
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
# --json, --status (seam dialect: -L is --limit's shorthand).
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
            --branch) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; branch="$2"; shift 2 ;;
            --workflow) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; workflow="$2"; shift 2 ;;
            --limit|-L) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; provider_need_count "${FUNCNAME[0]}" "$1" "$2" || return 1; limit="$2"; shift 2 ;;
            --json) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; field_list="$2"; shift 2 ;;
            --status) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; status="$2"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_filter="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done

    azure_build_fields_check "${FUNCNAME[0]}" "$field_list" || return 1

    # --status takes the gh vocabulary and maps onto Azure's statusFilter and
    # resultFilter: a status word (in_progress, queued, completed) or a conclusion
    # (success, failure, cancelled). A word with no Azure analog is an error: an
    # unfiltered list would answer "is the latest run failing?" with the wrong runs.
    local status_filter="" result_filter=""
    case "$status" in
        in_progress) status_filter="inProgress" ;;
        queued|requested|waiting|pending) status_filter="notStarted" ;;
        completed) status_filter="completed" ;;
        success) status_filter="completed"; result_filter="succeeded" ;;
        failure|timed_out|startup_failure) status_filter="completed"; result_filter="failed" ;;
        cancelled) status_filter="completed"; result_filter="canceled" ;;
        "") : ;;
        *) log_error "run_list: --status '$status' has no Azure analog (use in_progress, queued, completed, success, failure or cancelled)"; return 1 ;;
    esac

    local root
    root=$(azure_build_root "$repo") || return 1
    local query="${root}/builds?\$top=${limit}&queryOrder=queueTimeDescending"
    # The builds filter takes the repository's GUID, not its name.
    if [ -n "$repo" ]; then
        local repo_guid
        repo_guid=$(azure_repo_guid "$repo") || return 1
        [ -n "$repo_guid" ] || { log_error "run_list: repository '$repo' not found"; return 1; }
        query="${query}&repositoryId=${repo_guid}&repositoryType=TfsGit"
    fi
    [ -n "$branch" ] && query="${query}&branchName=$(azure_uri "refs/heads/${branch}")"
    # --workflow names a workflow; Azure's builds filter takes definition ids.
    if [ -n "$workflow" ]; then
        local def_ids
        def_ids=$(azure_definition_ids "$repo" "$workflow") || return 1
        query="${query}&definitions=${def_ids}"
    fi
    [ -n "$status_filter" ] && query="${query}&statusFilter=${status_filter}"
    [ -n "$result_filter" ] && query="${query}&resultFilter=${result_filter}"

    local response
    # Error contract: paginate's error JSON lands on stdout — emit it, the
    # caller asserts rc. $top pages the server; --limit stops the paging, so a
    # long build history is not read to the end.
    if ! response=$(azure_http_paginate "$query" "$limit"); then
        printf '%s' "$response"
        return 1
    fi
    # Map each record (with the optional --json projection), assemble one
    # JSON array, then apply -q/--jq ONCE over the whole array — list
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
    azure_apply_list_flags "$assembled" "" "$jq_filter"
}

# View a workflow run (build).
# Usage: provider_pipelines_run_view [repo] RUN_ID [--json FIELDS] [-q JQ]
provider_pipelines_run_view() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local run_id="$1"; shift
    local fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --json) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; fields="${2:-}"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="${2:-}"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    azure_build_fields_check "${FUNCNAME[0]}" "$fields" || return 1

    local root
    root=$(azure_build_root "$repo") || return 1
    local response
    if ! response=$(azure_http_request GET "${root}/builds/${run_id}"); then
        return 1
    fi
    local mapped
    mapped=$(printf '%s' "$response" | azure_map_build "$fields") || return 1
    if [ -n "$jq_expr" ]; then
        printf '%s' "$mapped" | azure_jq_query "$jq_expr"
    else
        printf '%s\n' "$mapped"
    fi
}

# Watch a run to completion (polling at the domain layer, matching the seam).
# Usage: provider_pipelines_run_watch [repo] RUN_ID [--exit-status]
# Polls to completion. With --exit-status (seam dialect), a completed run
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
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
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

# List workflows (build definitions). Supports --json FIELDS / -q J (seam
# dialect); every definition is active unless disabled (the seam's state field).
# Usage: provider_pipelines_workflow_list [repo] [--json F] [-q J]
provider_pipelines_workflow_list() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local json_fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --json) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; json_fields="$2"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    local api
    api="$(azure_build_root "$repo")/definitions" || return 1
    if [ -n "$repo" ]; then
        # The definitions endpoint filters by repository GUID, not name —
        # specs arrive as org/project/repo, project/repo or bare NAME, so
        # resolve through azure_repo_guid before composing the filter.
        local repo_guid
        repo_guid=$(azure_repo_guid "$repo") || return 1
        api="${api}?repositoryId=${repo_guid}&repositoryType=TfsGit"
    fi
    local response
    if ! response=$(azure_http_paginate "$api"); then
        printf '%s' "$response"
        return 1
    fi
    # One JSON array; state maps from the definition's enabled flag (the seam's
    # active/disabled vocabulary).
    local mapped
    mapped=$(printf '%s' "$response" | jq -c '[.[] | {id: (.id | tostring), name: .name, path: .path, state: (if .enabled == false then "disabled" else "active" end)}]')
    azure_apply_list_flags "$mapped" "$json_fields" "$jq_expr"
}

# Fetch run artifacts metadata.
# Usage: provider_pipelines_run_artifacts REPO RUN_ID
provider_pipelines_run_artifacts() {
    local repo="$1" run_id="$2"
    local root
    root=$(azure_build_root "$repo") || return 1
    local response
    if ! response=$(azure_http_request GET "${root}/builds/${run_id}/artifacts"); then
        return 1
    fi
    # size_in_bytes must be a number, not the download URL (the seam's artifact
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
            --ref) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; ref="$2"; shift 2 ;;
            # pipelines-run sends dispatch inputs as --field k=v; azure
            # queues take parameters{} — collected here, applied below.
            --field|-f|-F) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; run_inputs+=("$2"); shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    [ -n "$workflow" ] || { log_error "provider_pipelines_workflow_run requires a workflow (definition id or name)"; return 1; }

    # The default is the repo's default branch — resolve it instead of
    # guessing a ref name (a main-default fork would queue on a
    # nonexistent branch).
    if [ -z "$ref" ]; then
        ref=$(provider_repos_default_branch "$repo" 2>/dev/null) || {
            log_error "provider_pipelines_workflow_run: could not resolve the default branch for '$repo' — pass --ref explicitly"
            return 1
        }
    fi

    local root
    root=$(azure_build_root "$repo") || return 1

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
    if ! response=$(azure_http_request POST "${root}/builds" "$body"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.id'
}

# Rerun a run: Azure retries the build in place with PATCH ?retry=true (a POST
# to the build's own URL is not a retry).
# Usage: provider_pipelines_run_rerun [repo] RUN_ID
provider_pipelines_run_rerun() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local run_id="$1"; shift
    # Azure retries the whole build in place; there is no failed-jobs-only or debug rerun.
    [ $# -eq 0 ] || { provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1; }

    local root
    root=$(azure_build_root "$repo") || return 1
    azure_http_request PATCH "${root}/builds/${run_id}?retry=true" '{}' >/dev/null
}

# Cancel a run.
# Usage: provider_pipelines_run_cancel REPO RUN_ID
provider_pipelines_run_cancel() {
    local repo="$1" run_id="$2"
    local root
    root=$(azure_build_root "$repo") || return 1
    local patch_body='{"status":"cancelling"}'
    azure_http_request PATCH "${root}/builds/${run_id}" "$patch_body" >/dev/null
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

    # seam-dialect flags: -n NAME downloads only that artifact; -D DIR is the
    # destination directory (created when missing). Defaults: all artifacts
    # to the current directory.
    local only_name="" dest_dir="."
    while [ $# -gt 0 ]; do
        case "$1" in
            -n) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; only_name="$2"; shift 2 ;;
            -D) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; dest_dir="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    [ -d "$dest_dir" ] || mkdir -p "$dest_dir" || return 1

    local root
    root=$(azure_build_root "$repo") || return 1
    local response
    if ! response=$(azure_http_request GET "${root}/builds/${run_id}/artifacts"); then
        return 1
    fi
    local name url downloaded=0
    while IFS=$'\t' read -r name url; do
        [ -n "$name" ] || continue
        # -n restricts the download to the named artifact (seam dialect).
        [ -n "$only_name" ] && [ "$name" != "$only_name" ] && continue
        # The zip is a binary body: the transport's download helper applies the
        # same authentication (credential off argv) and api-version rules and
        # checks the status.
        if ! azure_http_download "$url" "${dest_dir}/${name}.zip" >/dev/null; then
            log_error "failed downloading artifact $name"
            return 1
        fi
        downloaded=$((downloaded + 1))
    done < <(printf '%s' "$response" | jq -r '.value[] | [.name, .resource.downloadUrl] | @tsv')
    # Like gh, a run with nothing to download (or no artifact of the requested name) fails.
    if [ "$downloaded" -eq 0 ]; then
        if [ -n "$only_name" ]; then
            log_error "run_download: run $run_id has no artifact named '$only_name'"
        else
            log_error "run_download: run $run_id has no artifacts"
        fi
        return 1
    fi
}
