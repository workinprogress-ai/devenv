#!/usr/bin/env bash
# azure/prs.bash - Azure DevOps implementation of the PR domain verbs.
#
# Maps the PR seam onto Azure pull-request APIs. Verbs mirror the gh-backed
# flag contracts the wrappers use: list (--state/--head/--base/--json/--jq),
# view (--json title,body,isDraft,state,author / headRefOid / id / url),
# create (--title/--body/--base/--head/--draft/--reviewer/--assignee/--label),
# merge (--squash|--merge|--rebase + --delete-branch + --subject/--body),
# comment, diff (--name-only), and the review-thread verbs.
#
# Field mapping:
#   number -> pullRequestId        title -> title        body -> description
#   state  -> status (active/completed/abandoned)
#   isDraft -> isDraft             headRefOid -> lastMergeSourceCommit.commitId
#   author -> createdBy.displayName
#
# Transport: azure_http_request / azure_http_paginate. Contract: return
# non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_PRS_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_PRS_LOADED=1

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
    log_error "azure/prs.bash: providers/azure/http.bash failed to load"
    return 1
fi

# Resolve the PR-list API base for org/project. When repo is non-empty it is
# org/project/repo (Azure-native 3-part) or "project/repo" (config org);
# empty repo uses the org-wide all-PRs endpoint the pr-list wrapper wants.
# Usage: azure_pr_base REPO -> prints base URL
azure_pr_base() {
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
        printf 'https://dev.azure.com/%s/%s/_apis/git/repositories/%s' "$org" "$project" "$repo"
    else
        printf 'https://dev.azure.com/%s/%s/_apis/git' "$org" "$project"
    fi
}

# Map a seam state word to the Azure status filter (empty = all).
azure_pr_status_filter() {
    case "$1" in
        open) printf 'active' ;;
        closed) printf 'completed' ;;
        merged) printf 'completed' ;;
        all) printf '' ;;
        *) printf 'active' ;;
    esac
}

# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

# List PRs. Output mirrors gh's shape: JSON array of {number,title,state,
# headRefName,baseRefName,isDraft,url} objects.
# Usage: provider_prs_list [repo] [--state S] [--head B] [--base B] [--json F] [--jq J]
provider_prs_list() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local state="open" head="" base="" search="" limit=""
    local json_fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --state) state="$2"; shift 2 ;;
            --head) head="$2"; shift 2 ;;
            --base) base="$2"; shift 2 ;;
            --search) search="$2"; shift 2 ;;
            --limit|-L) limit="$2"; shift 2 ;;
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

    local base_url
    base_url=$(azure_pr_base "$repo") || return 1
    local api="${base_url}/pullrequests"
    local status
    status=$(azure_pr_status_filter "$state")

    # The all-PRs endpoint is org-wide; filter by target repository name only
    # when it was explicit, and by source/target branch via $filter params.
    local query=""
    [ -n "$status" ] && query="status=${status}"
    [ -n "$head" ] && query="${query:+$query&}searchCriteria.sourceRefName=refs/heads/${head}"
    [ -n "$base" ] && query="${query:+$query&}searchCriteria.targetRefName=refs/heads/${base}"
    # gh --limit caps the result count server-side.
    [ -n "$limit" ] && query="${query:+$query&}\$top=${limit}"
    [ -n "$query" ] && api="${api}?${query}"

    local response
    if ! response=$(azure_http_paginate "$api"); then
        return 1
    fi
    local mapped
    mapped=$(printf '%s' "$response" | jq -c '[.[] | {
        number: .pullRequestId,
        title: .title,
        state: (if .status == "active" then "OPEN" elif .status == "completed" then "MERGED" else "CLOSED" end),
        headRefName: (.sourceRefName | ltrimstr("refs/heads/")),
        baseRefName: (.targetRefName | ltrimstr("refs/heads/")),
        isDraft: .isDraft,
        author: {login: (.createdBy.displayName // "unknown")},
        createdAt: .creationDate,
        updatedAt: (.closedDate // .creationDate),
        labels: [],
        url: (.repository.webUrl + "/pullrequest/" + (.pullRequestId | tostring))
    }]')
    # gh --search dialect: "head:branch" filters on the source branch;
    # anything else filters on title contains. Applied to the mapped list
    # before --json/--jq so consumers' selects see the filtered set.
    if [ -n "$search" ]; then
        case "$search" in
            head:*)
                mapped=$(printf '%s' "$mapped" | jq -c --arg h "${search#head:}" '[.[] | select(.headRefName == $h)]')
                ;;
            *)
                mapped=$(printf '%s' "$mapped" | jq -c --arg t "$search" '[.[] | select((.title // "") | contains($t))]')
                ;;
        esac
    fi
    # gh list semantics: --json projects per record, --jq applies to the
    # whole array ('.[0].url' must select from the list).
    azure_apply_gh_list_flags "$mapped" "$json_fields" "$jq_expr"
}

# View a PR. Honors --json FIELD,... and -q/--jq projections in the gh
# dialect callers use (title,body,isDraft,state,author,headRefOid,id,url).
# Usage: provider_prs_view [repo] NUMBER [FLAGS]
provider_prs_view() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    [ -n "$number" ] || { log_error "provider_prs_view requires a PR number"; return 1; }

    local base_url
    base_url=$(azure_pr_base "$repo") || return 1
    local response
    if ! response=$(azure_http_request GET "${base_url}/pullrequests/${number}"); then
        return 1
    fi

    # Parse the projection flags (both --json F[,F..] and -q/--jq J).
    local fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --json) fields="$2"; shift 2 ;;
            -q|--jq) jq_expr="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local mapped
    mapped=$(printf '%s' "$response" | jq -c '{
        number: .pullRequestId,
        id: .pullRequestId,
        title: .title,
        body: (.description // ""),
        state: (if .status == "active" then "OPEN" elif .status == "completed" then "MERGED" else "CLOSED" end),
        isDraft: .isDraft,
        author: {login: (.createdBy.displayName // "unknown")},
        headRefName: (.sourceRefName | ltrimstr("refs/heads/")),
        baseRefName: (.targetRefName | ltrimstr("refs/heads/")),
        headRefOid: (.lastMergeSourceCommit.commitId // ""),
        url: (.repository.webUrl + "/pullrequest/" + (.pullRequestId | tostring))
    }')

    if [ -n "$jq_expr" ]; then
        printf '%s' "$mapped" | jq -r "$jq_expr"
        return 0
    fi
    if [ -n "$fields" ]; then
        # Emit the requested subset as one object.

        printf '%s' "$mapped" | jq -c "{${fields}}"
        return 0
    fi
    printf '%s\n' "$mapped"
}

# Diff a PR. Azure exposes iterations; --name-only lists changed paths.
# Usage: provider_prs_diff [repo] NUMBER [--name-only]
provider_prs_diff() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local name_only="false"
    while [ $# -gt 0 ]; do
        case "$1" in
            --name-only) name_only="true"; shift ;;
            *) shift ;;
        esac
    done

    local base_url
    base_url=$(azure_pr_base "$repo") || return 1
    local response
    if ! response=$(azure_http_request GET "${base_url}/pullrequests/${number}/iterations"); then
        return 1
    fi
    local latest_iter
    latest_iter=$(printf '%s' "$response" | jq -r '[.value[] | .id] | max // 1')
    local changes
    if ! changes=$(azure_http_request GET "${base_url}/pullrequests/${number}/iterations/${latest_iter}/changes"); then
        return 1
    fi
    if [ "$name_only" = "true" ]; then
        printf '%s' "$changes" | jq -r '.changes[].item.path'
    else
        printf '%s' "$changes" | jq -c '.changes[] | {path: .item.path, changeType: .changeType}'
    fi
}

# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

# Create a PR. Reviewers/assignees/labels accepted and mapped where Azure has
# an equivalent (reviewers list); labels map onto the work-item link tags —
# recorded as no-ops for interface parity in the first cut.
# Usage: provider_prs_create [repo] --title T --body B --head H --base B [--draft]
provider_prs_create() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local title="" body="" head="" base="" draft="false"
    local -a reviewers=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --title) title="$2"; shift 2 ;;
            --body) body="$2"; shift 2 ;;
            --body-file) body=$(cat "$2"); shift 2 ;;
            --head) head="$2"; shift 2 ;;
            --base) base="$2"; shift 2 ;;
            --draft) draft="true"; shift ;;
            --reviewer) reviewers+=("$2"); shift 2 ;;
            --assignee|--label) shift; if [[ "${1:-}" != --* ]] && [ $# -gt 0 ]; then shift; fi ;;
            *) shift ;;
        esac
    done
    if [ -z "$title" ] || [ -z "$head" ] || [ -z "$base" ]; then
        log_error "provider_prs_create requires --title, --head and --base"
        return 1
    fi
    # PR creation is repo-scoped in Azure; an empty repo would POST to the
    # org-wide base, which is not a valid create endpoint.
    [ -n "$repo" ] || { log_error "provider_prs_create: a repository is required"; return 1; }

    local base_url
    base_url=$(azure_pr_base "$repo") || return 1

    local body_json
    body_json=$(jq -n \
        --arg t "$title" --arg d "$body" \
        --arg h "refs/heads/${head}" --arg b "refs/heads/${base}" \
        --argjson draft "$draft" \
        '{title: $t, description: $d, sourceRefName: $h, targetRefName: $b, isDraft: $draft}')

    local response
    if ! response=$(azure_http_request POST "${base_url}/pullrequests" "$body_json"); then
        return 1
    fi

    # Reviewers added post-create (Azure takes them on the PR resource).
    local pr_id
    pr_id=$(printf '%s' "$response" | jq -r '.pullRequestId')
    local r
    for r in "${reviewers[@]:-}"; do
        [ -n "$r" ] || continue
        local rev_body
        rev_body=$(printf '[{"id":"%s","isRequired":false}]' "$r")
        azure_http_request POST "${base_url}/pullrequests/${pr_id}/reviewers" "$rev_body" >/dev/null 2>&1 || true
    done

    printf '%s' "$response" | jq -r '"\(.repository.webUrl)/pullrequest/\(.pullRequestId)"'
}

# Merge a PR. Callers pass the method explicitly; rebase is the org policy
# default. --delete-branch maps to deleteSourceBranch on completion.
# Usage: provider_prs_merge [repo] NUMBER [--squash|--merge|--rebase] [--delete-branch] [--subject S] [--body B]
provider_prs_merge() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]] && ! [[ "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local number="${1:-}"
    shift 2>/dev/null || true
    [ -n "$number" ] || { log_error "provider_prs_merge: PR number is required"; return 1; }
    # Merging is repo-scoped in Azure; an empty repo would PATCH the org-wide
    # base, which is not a valid update endpoint.
    [ -n "$repo" ] || { log_error "provider_prs_merge: a repository is required"; return 1; }

    local method="rebase" delete_branch="false" subject="" body="" force="false"
    while [ $# -gt 0 ]; do
        case "$1" in
            --rebase) method="rebase"; shift ;;
            --squash) method="squash"; shift ;;
            --merge) method="noFastForward"; shift ;;
            --delete-branch) delete_branch="true"; shift ;;
            --admin) force="true"; shift ;;
            --subject) subject="$2"; shift 2 ;;
            --body) body="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local base_url
    base_url=$(azure_pr_base "$repo") || return 1

    # PR endpoints take plain JSON documents (unlike work-item endpoints,
    # they reject JSON-Patch bodies with a 415).

    # mergeStrategy must be set before completion (Azure two-step: PATCH the
    # policy, then PATCH status=completed).
    local strategy_body
    strategy_body=$(jq -n --arg m "$method" '{mergeStrategy: $m}')
    azure_http_request PATCH "${base_url}/pullrequests/${number}" "$strategy_body" >/dev/null || return 1

    # Completion guards against source-branch movement: Azure requires the
    # current lastMergeSourceCommit echoed back. Without it Azure accepts
    # the PATCH but the PR silently stays active — so a missing commitId is
    # a hard failure, not a degraded completion.
    local pr_json commit_id=""
    if pr_json=$(azure_http_request GET "${base_url}/pullrequests/${number}"); then
        commit_id=$(printf '%s' "$pr_json" | jq -r '.lastMergeSourceCommit.commitId // empty')
    fi
    if [ -z "$commit_id" ]; then
        log_error "provider_prs_merge: could not resolve lastMergeSourceCommit for PR $number — refusing to complete without it (Azure would accept the PATCH but leave the PR active)"
        return 1
    fi

    local complete_body
    complete_body=$(jq -n \
        --arg status "completed" \
        --argjson delete "$delete_branch" \
        --argjson bypass "$force" \
        --arg s "${subject:-}" --arg b "${body:-}" \
        --arg cid "$commit_id" '
        {status: $status, deleteSourceBranch: $delete, lastMergeSourceCommit: {commitId: $cid}}
        + (if $bypass then {completionOptions: ({bypassPolicy: true}
            + (if $s != "" then {mergeCommitTitle: $s} else {} end)
            + (if $b != "" then {mergeCommitMessage: $b} else {} end))}
          elif ($s != "" or $b != "") then
            {completionOptions:
                ((if $s != "" then {mergeCommitTitle: $s} else {} end)
                + (if $b != "" then {mergeCommitMessage: $b} else {} end))}
          else {} end)')
    [ "$force" = "true" ] && log_info "azure merge: --admin mapped to completionOptions.bypassPolicy (policy checks bypassed)"
    azure_http_request PATCH "${base_url}/pullrequests/${number}" "$complete_body"
}

# Comment on a PR (PR-level comment via the threads API, status-less).
# Usage: provider_prs_comment [repo] NUMBER --body TEXT
provider_prs_comment() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local text=""
    local body_file=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --body) text="$2"; shift 2 ;;
            --body-file) body_file="$2"; shift 2 ;;
            --comment-body) text="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    # --body-file carries a path: read the file so the comment body is its
    # contents (posting the filename itself would be silent garbage).
    [ -n "$body_file" ] && text=$(cat "$body_file")
    [ -n "$text" ] || { log_error "provider_prs_comment requires --body"; return 1; }

    local base_url
    base_url=$(azure_pr_base "$repo") || return 1
    local thread_body
    thread_body=$(jq -n --arg t "$text" \
        '{comments: [{parentCommentId: 0, content: $t, commentType: 1}], status: 1}')
    local response
    if ! response=$(azure_http_request POST "${base_url}/pullrequests/${number}/threads" "$thread_body"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.id'
}

# ---------------------------------------------------------------------------
# Review threads
# ---------------------------------------------------------------------------

# One page of review threads for a PR. Emits a gh-threads-shaped JSON page
# (nodes with id/isResolved/comments) plus pageInfo, mapping Azure threads.
# Usage: provider_prs_threads_page REPO PR_NUMBER [CURSOR]
provider_prs_threads_page() {
    local repo="$1" pr="$2" cursor="${3:-}"
    [ -n "$repo" ] || { log_error "provider_prs_threads_page: repo is required"; return 1; }
    [ -n "$pr" ] || { log_error "provider_prs_threads_page: PR number is required"; return 1; }

    local base_url
    base_url=$(azure_pr_base "$repo") || return 1

    local api="${base_url}/pullrequests/${pr}/threads"
    # Azure returns threads in one array (no cursor pagination on this
    # endpoint); honor the cursor contract by emitting an empty page when a
    # continuation was requested.
    if [ -n "$cursor" ]; then
        printf '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}}}'
        return 0
    fi

    local response
    if ! response=$(azure_http_request GET "$api"); then
        return 1
    fi
    printf '%s' "$response" | jq -c --argjson pr "$pr" '{
        data: {repository: {pullRequest: {reviewThreads: {
            pageInfo: {hasNextPage: false, endCursor: null},
            nodes: [.value[] | {
                id: (($pr | tostring) + "/" + (.threadId | tostring)),
                isResolved: (.status == 2),
                path: (.threadProperties["CodeReviewThread.FilePath"] // null),
                line: ((.threadProperties["CodeReviewThread.Line"] // 0) | tonumber),
                comments: {nodes: [(.comments // [])[] | {
                    databaseId: (.id | tostring),
                    body: .content,
                    author: {login: (.author.displayName // "unknown")}
                }]}
            }]
        }}}}
    }'
}

# Reply to a review thread.
# Usage: provider_prs_thread_reply REPO PR_NUMBER COMMENT_ID BODY
provider_prs_thread_reply() {
    local repo="$1" pr="$2" thread_id="$3" body="$4"
    [ -n "$repo" ] && [ -n "$pr" ] && [ -n "$thread_id" ] && [ -n "$body" ] || {
        log_error "provider_prs_thread_reply: repo, pr, thread-id and body are required"
        return 1
    }
    local base_url
    base_url=$(azure_pr_base "$repo") || return 1
    local reply_body
    reply_body=$(jq -n --arg t "$body" --arg tid "$thread_id" \
        '{comments: [{parentCommentId: 0, content: $t, commentType: 1}], status: 1}')
    local response
    if ! response=$(azure_http_request POST "${base_url}/pullrequests/${pr}/threads/${thread_id}/comments" "$reply_body"); then
        return 1
    fi
    printf '%s' "$response" | jq -c '{id: (.id | tostring)}'
}

# Create a PR review thread — general comment, or inline via threadContext
# when --path/--line are given. Emits gh-shaped JSON ({thread:{url}}).
# Live-shape note: threadContext field names (filePath/rightFileStart) come
# from MAPPING.md and are declared-red until live-verified.
# Usage: provider_prs_thread_create [repo] PR_NUMBER --body TEXT
#        [--path FILE --line N --side LEFT|RIGHT]
provider_prs_thread_create() {
    local repo=""
    if [ $# -gt 0 ]; then
        case "$1" in
            */*) repo="$1"; shift ;;
        esac
    fi
    local number="$1"; shift
    local body="" path="" line="" side=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --body) body="$2"; shift 2 ;;
            --path) path="$2"; shift 2 ;;
            --line) line="$2"; shift 2 ;;
            --side) side="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    [ -n "$body" ] || { log_error "provider_prs_thread_create requires --body"; return 1; }
    local base_url
    base_url=$(azure_pr_base "$repo") || return 1
    local thread_payload
    if [ -n "$path" ]; then
        [ -n "$line" ] || { log_error "provider_prs_thread_create: --path requires --line"; return 1; }
        # Azure tracks line ranges, not single lines: rightFileStart covers
        # the RIGHT-side line N (1-based); LEFT side maps to leftFileStart.
        # Live-verified shape: line positions need offset >= 1 (offset 0 is
        # rejected with a 400 range error); right side is the default view.
        if [ "$side" = "LEFT" ]; then
            thread_payload=$(jq -n --arg t "$body" --arg p "$path" --argjson l "$line" \
                '{comments: [{parentCommentId: 0, content: $t, commentType: 1}], status: 1,
                  threadContext: {filePath: $p, leftFileStart: {line: $l, offset: 1}}}')
        else
            thread_payload=$(jq -n --arg t "$body" --arg p "$path" --argjson l "$line" \
                '{comments: [{parentCommentId: 0, content: $t, commentType: 1}], status: 1,
                  threadContext: {filePath: $p, rightFileStart: {line: $l, offset: 1}}}')
        fi
    else
        thread_payload=$(jq -n --arg t "$body" \
            '{comments: [{parentCommentId: 0, content: $t, commentType: 1}], status: 1}')
    fi
    local response
    if ! response=$(azure_http_request POST "${base_url}/pullrequests/${number}/threads" "$thread_payload"); then
        return 1
    fi
    local thread_id
    thread_id=$(printf '%s' "$response" | jq -r '.id')
    # Opaque thread ref (<pr>/<thread>) — the token pr-thread-resolve takes.
    printf '{"thread":{"id":"%s/%s"}}\n' "$number" "${thread_id:-}"
}

# Resolve a review thread. Azure thread status 2 = resolved (fixed).
# THREAD_REF is the provider-opaque id (<pr>/<thread>) exactly as emitted
# by pr-threads-get's thread list — no separate PR context is needed.
# Usage: provider_prs_thread_resolve THREAD_REF
provider_prs_thread_resolve() {
    local ref="${1:?thread ref required}"
    local pr thread_id
    case "$ref" in
        [0-9]*/[0-9]*) pr="${ref%/*}"; thread_id="${ref#*/}" ;;
        *)
            log_error "provider_prs_thread_resolve: azure thread refs are '<pr>/<thread>' — take the id from pr-threads-get output"
            return 1
            ;;
    esac
    local base_url
    base_url=$(azure_pr_base "") || return 1
    local patch_body
    patch_body=$(printf '[{"op":"replace","path":"/status","value":2}]')
    local response
    if ! response=$(azure_http_request PATCH "${base_url}/pullrequests/${pr}/threads/${thread_id}" "$patch_body"); then
        return 1
    fi
    printf '%s' "$response" | jq -r 'if .status == 2 then "true" else "unknown" end'
}
