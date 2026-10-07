#!/usr/bin/env bash
# azure/prs.bash - Azure DevOps implementation of the PR domain verbs.
#
# Maps the PR seam onto Azure pull-request APIs. Verbs mirror the seam
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
if ! declare -F log_warn >/dev/null; then
    log_warn() { echo "WARN: $*" >&2; }
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
if ! declare -F azure_org_project >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repos.bash"
fi
if ! declare -F azure_http_request >/dev/null; then
    log_error "azure/prs.bash: providers/azure/http.bash failed to load"
    return 1
fi

# Resolve the PR API base for a repo spec (org/project/repo, project/repo or a
# bare repo name; the configured org and project fill the gaps), every component
# encoded. An empty spec gives the project-wide endpoint the pr-list wrapper
# wants.
# Usage: azure_pr_base REPO -> prints base URL
azure_pr_base() {
    local repo="${1:-}"
    if [ -n "$repo" ]; then
        azure_git_repo_url "$repo"
        return
    fi
    local parts org project
    parts=$(azure_repo_parts "") || return 1
    org=$(printf '%s' "$parts" | sed -n 1p); project=$(printf '%s' "$parts" | sed -n 2p)
    printf 'https://dev.azure.com/%s/%s/_apis/git' "$(azure_uri "$org")" "$(azure_uri "$project")"
}

# Map a seam state word to the Azure status filter (empty = all).
azure_pr_status_filter() {
    case "$1" in
        open) printf 'active' ;;
        # The seam's closed covers both completed and abandoned, which no single status
        # value selects: fetch all and drop the active ones (provider_prs_list).
        # 'merged' maps to completed only (abandoned PRs are not merged).
        closed) printf 'all' ;;
        merged) printf 'completed' ;;
        all) printf 'all' ;;
        # Unknown state words fail defined instead of silently degrading to
        # 'active' — a typo would otherwise read as a filtered list.
        *)
            log_error "azure_pr_status_filter: unknown state '$1' (valid: open, closed, merged, all)"
            return 1
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

# List PRs. Output follows the seam's shape: JSON array of {number,title,state,
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
            --state) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; state="$2"; shift 2 ;;
            --head) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; head="$2"; shift 2 ;;
            --base) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; base="$2"; shift 2 ;;
            --search) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; search="$2"; shift 2 ;;
            --limit|-L) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; provider_need_count "${FUNCNAME[0]}" "$1" "$2" || return 1; limit="$2"; shift 2 ;;
            --json) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; json_fields="$2"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done

    local base_url
    base_url=$(azure_pr_base "$repo") || return 1
    local api="${base_url}/pullrequests"
    local status
    status=$(azure_pr_status_filter "$state") || return 1

    # The all-PRs endpoint is org-wide; filter by target repository name only
    # when it was explicit, and by source/target branch via $filter params.
    local query="status=${status}"
    [ -n "$head" ] && query="${query}&searchCriteria.sourceRefName=$(azure_uri "refs/heads/${head}")"
    [ -n "$base" ] && query="${query}&searchCriteria.targetRefName=$(azure_uri "refs/heads/${base}")"
    api="${api}?${query}"

    # The PR list API pages with $top/$skip (not continuation tokens) and caps a
    # page at its server default, so page until a short page; --limit stops the
    # paging once enough PRs are in hand. state=closed is fetched as all and the
    # still-active PRs are dropped per page.
    local page_size="${AZURE_PR_PAGE_SIZE:-100}"
    local skip=0 top got
    local response page collected="[]"
    while :; do
        top="$page_size"
        if [ -n "$limit" ]; then
            local remaining=$((limit - $(printf '%s' "$collected" | jq 'length')))
            [ "$remaining" -gt 0 ] || break
            [ "$remaining" -lt "$top" ] && top="$remaining"
        fi
        if ! response=$(azure_http_request GET "${api}&\$top=${top}&\$skip=${skip}"); then
            printf '%s' "$response"
            return 1
        fi
        page=$(printf '%s' "$response" | jq -c '.value // []') || return 1
        got=$(printf '%s' "$page" | jq 'length')
        if [ "$state" = "closed" ]; then
            page=$(printf '%s' "$page" | jq -c '[.[] | select(.status != "active")]')
        fi
        collected=$(jq -c -n --argjson a "$collected" --argjson b "$page" '$a + $b')
        skip=$((skip + got))
        [ "$got" -lt "$top" ] && break
    done
    response="$collected"
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
        labels: [(.labels // [])[] | select(.active != false) | {name: .name}],
        url: (.repository.webUrl + "/pullrequest/" + (.pullRequestId | tostring))
    }]')
    # seam --search dialect: "head:branch" filters on the source branch;
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
    # list semantics: --json projects per record, --jq applies to the
    # whole array ('.[0].url' must select from the list).
    azure_apply_list_flags "$mapped" "$json_fields" "$jq_expr"
}

# View a PR. Honors --json FIELD,... and -q/--jq projections in the seam
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
            --json) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; fields="$2"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done

    # Projection contract: every field in pr-get's DEFAULT_FIELDS must be
    # present and non-null — absent Azure data maps to typed empties
    # ([] / "" / false), never null. mergeable/mergeStateStatus map from
    # Azure's mergeStatus: conflicts -> CONFLICTING/DIRTY; succeeded ->
    # MERGEABLE/CLEAN; not-yet-set -> UNKNOWN/UNKNOWN (per pr-get's docs).
    # labels are the PR's own labels (the inactive ones are removed labels);
    # reviewRequests/milestone/comments/reviews are typed empties without
    # supplementary fetches (documented in MAPPING.md).
    local mapped
    mapped=$(printf '%s' "$response" | jq -c '{
        number: .pullRequestId,
        id: .pullRequestId,
        title: (.title // ""),
        body: (.description // ""),
        state: (if .status == "active" then "OPEN" elif .status == "completed" then "MERGED" else "CLOSED" end),
        isDraft: (.isDraft // false),
        headRefName: (.sourceRefName | ltrimstr("refs/heads/")),
        baseRefName: (.targetRefName | ltrimstr("refs/heads/")),
        headRefOid: (.lastMergeSourceCommit.commitId // ""),
        author: {login: (.createdBy.displayName // "unknown")},
        labels: [(.labels // [])[] | select(.active != false) | {name: .name}],
        assignees: [],
        reviewRequests: [],
        milestone: "",
        mergeable: (if .mergeStatus == "conflicts" then "CONFLICTING" elif .mergeStatus == "succeeded" then "MERGEABLE" else "UNKNOWN" end),
        mergeStateStatus: (if .mergeStatus == "conflicts" then "DIRTY" elif .mergeStatus == "succeeded" then "CLEAN" else "UNKNOWN" end),
        url: ((.repository.webUrl // "") + "/pullrequest/" + (.pullRequestId | tostring)),
        createdAt: (.creationDate // ""),
        updatedAt: (.closedDate // .creationDate // ""),
        closedAt: (.closedDate // ""),
        mergedAt: (if .status == "completed" then (.closedDate // "") else "" end),
        comments: [],
        reviews: []
    }')

    if [ -n "$jq_expr" ]; then
        printf '%s' "$mapped" | azure_jq_query "$jq_expr"
        return 0
    fi
    if [ -n "$fields" ]; then
        # Emit the requested subset as one object.

        azure_json_fields_check "${FUNCNAME[0]}" "$fields" "$mapped" || return 1
        printf '%s' "$mapped" | jq -c "{${fields}}"
        return 0
    fi
    printf '%s\n' "$mapped"
}

# Page size for the changed-files listing of a PR iteration.
readonly _AZURE_PR_CHANGES_PAGE=100

# Diff a PR. Azure has no endpoint that returns patch text, so this verb reports
# the changed files of the PR's latest iteration: --name-only prints one path per
# line; without it, one {"path","changeType"} JSON object per line. It is a file
# list, not a unified diff — a caller that needs patch text diffs the two commits
# in a local clone.
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
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
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
    # The changes endpoint pages ($top/$skip); each page names where the next starts
    # (nextSkip, 0 when done). Every page is read, so a large PR is never truncated.
    local changes='{"changes":[]}' page skip=0 next_skip
    while :; do
        if ! page=$(azure_http_request GET "${base_url}/pullrequests/${number}/iterations/${latest_iter}/changes?\$top=${_AZURE_PR_CHANGES_PAGE}&\$skip=${skip}"); then
            return 1
        fi
        changes=$(jq -cn --argjson all "$changes" --argjson page "$page" '{changes: ($all.changes + ($page.changes // []))}') || return 1
        next_skip=$(printf '%s' "$page" | jq -r '.nextSkip // 0')
        # A server that keeps answering the same position would loop forever.
        [[ "$next_skip" =~ ^[0-9]+$ ]] && [ "$next_skip" -gt "$skip" ] || break
        skip="$next_skip"
    done
    if [ "$(printf '%s' "$changes" | jq -r '.changes | length')" = "0" ]; then
        return 0
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

# Azure refuses a PR description over this many characters.
readonly _AZURE_PR_DESCRIPTION_MAX=4000

# Resolve a reviewer to the identity id Azure takes. A GUID is used as is; an
# email, account or display name is looked up through the identities API, and must
# match exactly one identity.
# Usage: azure_pr_reviewer_id REVIEWER -> prints the identity id
azure_pr_reviewer_id() {
    local who="$1"
    if [[ "$who" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
        printf '%s' "$who"
        return 0
    fi
    local op org response
    op=$(azure_org_project) || return 1
    org=$(printf '%s' "$op" | sed -n 1p)
    response=$(azure_http_request GET "https://vssps.dev.azure.com/$(azure_uri "$org")/_apis/identities?searchFilter=General&filterValue=$(jq -rn --arg v "$who" '$v|@uri')&queryMembership=None&api-version=7.1") || return 1
    local count
    count=$(printf '%s' "$response" | jq -r '(.value // []) | length')
    [ "$count" = "1" ] || return 1
    printf '%s' "$response" | jq -r '.value[0].id'
}

# Create a PR. --reviewer takes a person (see azure_pr_reviewer_id); --label
# becomes a PR label. Azure has no PR assignee, so --assignee is accepted and
# reported as ignored. A description past Azure's limit is cut to fit and the
# full text is posted as the PR's first comment, so nothing is lost.
# Usage: provider_prs_create [repo] --title T --body B --head H --base B [--draft]
provider_prs_create() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local title="" body="" head="" base="" draft="false"
    local -a reviewers=() labels=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --title) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; title="$2"; shift 2 ;;
            --body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body="$2"; shift 2 ;;
            --body-file) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body=$(cat "$2"); shift 2 ;;
            --head) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; head="$2"; shift 2 ;;
            --base) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; base="$2"; shift 2 ;;
            --draft) draft="true"; shift ;;
            --reviewer) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; reviewers+=("$2"); shift 2 ;;
            --label) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; labels+=("$2"); shift 2 ;;
            --assignee)
                log_warn "provider_prs_create: Azure pull requests have no assignee; --assignee '${2:-}' ignored"
                shift; if [[ "${1:-}" != --* ]] && [ $# -gt 0 ]; then shift; fi
                ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
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

    local description="$body" overflow=false
    if [ "${#body}" -gt "$_AZURE_PR_DESCRIPTION_MAX" ]; then
        description="${body:0:$((_AZURE_PR_DESCRIPTION_MAX - 3))}..."
        overflow=true
        log_warn "provider_prs_create: description is ${#body} characters; Azure allows $_AZURE_PR_DESCRIPTION_MAX — it is cut and the full text is posted as a PR comment"
    fi

    local labels_json="[]"
    if [ "${#labels[@]}" -gt 0 ]; then
        labels_json=$(printf '%s\n' "${labels[@]}" | jq -R '{name: .}' | jq -sc '.')
    fi
    local body_json
    body_json=$(jq -n \
        --arg t "$title" --arg d "$description" \
        --arg h "refs/heads/${head}" --arg b "refs/heads/${base}" \
        --argjson draft "$draft" --argjson labels "$labels_json" \
        '{title: $t, description: $d, sourceRefName: $h, targetRefName: $b, isDraft: $draft}
         + (if ($labels | length) > 0 then {labels: $labels} else {} end)')

    local response
    if ! response=$(azure_http_request POST "${base_url}/pullrequests" "$body_json"); then
        return 1
    fi

    local pr_id
    pr_id=$(printf '%s' "$response" | jq -r '.pullRequestId')

    if [ "$overflow" = true ]; then
        provider_prs_comment "$repo" "$pr_id" --body "$body" >/dev/null \
            || log_warn "provider_prs_create: could not post the full description as a comment on PR $pr_id"
    fi

    # Reviewers are added after create (Azure takes them on the PR resource). A
    # reviewer that cannot be resolved or added is reported; the PR stands.
    local r reviewer_id rev_body
    for r in "${reviewers[@]:-}"; do
        [ -n "$r" ] || continue
        if ! reviewer_id=$(azure_pr_reviewer_id "$r"); then
            log_warn "provider_prs_create: reviewer '$r' did not match exactly one identity; not added to PR $pr_id"
            continue
        fi
        rev_body=$(jq -nc --arg id "$reviewer_id" '[{id: $id, isRequired: false}]')
        azure_http_request POST "${base_url}/pullrequests/${pr_id}/reviewers" "$rev_body" >/dev/null \
            || log_warn "provider_prs_create: could not add reviewer '$r' to PR $pr_id"
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
            --subject) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; subject="$2"; shift 2 ;;
            --body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done

    local base_url pr_url
    base_url=$(azure_pr_base "$repo") || return 1
    pr_url="${base_url}/pullrequests/${number}"

    # Completion guards against source-branch movement: Azure requires the
    # current lastMergeSourceCommit echoed back. Without it Azure accepts
    # the PATCH but the PR silently stays active — so a missing commitId is
    # a hard failure, not a degraded completion.
    local pr_json commit_id=""
    if pr_json=$(azure_http_request GET "$pr_url"); then
        commit_id=$(printf '%s' "$pr_json" | jq -r '.lastMergeSourceCommit.commitId // empty')
    fi
    if [ -z "$commit_id" ]; then
        log_error "provider_prs_merge: could not resolve lastMergeSourceCommit for PR $number — refusing to complete without it (Azure would accept the PATCH but leave the PR active)"
        return 1
    fi

    # The strategy, branch deletion and commit message all ride completionOptions
    # on the one completion PATCH (a top-level mergeStrategy is ignored). PR
    # endpoints take plain JSON documents (unlike work-item endpoints, they
    # reject JSON-Patch bodies with a 415).
    local message="$subject"
    if [ -n "$subject" ] && [ -n "$body" ]; then message="${subject}"$'\n\n'"${body}"; elif [ -n "$body" ]; then message="$body"; fi
    local complete_body
    complete_body=$(jq -n \
        --arg m "$method" \
        --argjson delete "$delete_branch" \
        --argjson bypass "$force" \
        --arg msg "$message" \
        --arg cid "$commit_id" '
        {status: "completed", lastMergeSourceCommit: {commitId: $cid},
         completionOptions: ({mergeStrategy: $m, deleteSourceBranch: $delete}
            + (if $bypass then {bypassPolicy: true} else {} end)
            + (if $msg != "" then {mergeCommitMessage: $msg} else {} end))}')
    [ "$force" = "true" ] && log_info "azure merge: --admin mapped to completionOptions.bypassPolicy (policy checks bypassed)"
    local response
    response=$(azure_http_request PATCH "$pr_url" "$complete_body") || return 1

    # Completion is asynchronous: right after the PATCH the PR is still active
    # with mergeStatus queued. Poll until it is completed, or fails.
    local attempts="${AZURE_PR_MERGE_POLL_ATTEMPTS:-30}" interval="${AZURE_PR_MERGE_POLL_INTERVAL:-2}" polled=0
    local pr_status merge_status failure
    while :; do
        pr_status=$(printf '%s' "$response" | jq -r '.status // ""')
        merge_status=$(printf '%s' "$response" | jq -r '.mergeStatus // ""')
        case "$pr_status" in
            completed) printf '%s\n' "$response"; return 0 ;;
            abandoned) log_error "provider_prs_merge: PR $number is abandoned, not completed"; return 1 ;;
        esac
        case "$merge_status" in
            conflicts|failure|rejectedByPolicy)
                failure=$(printf '%s' "$response" | jq -r '.mergeFailureMessage // empty')
                log_error "provider_prs_merge: PR $number could not be completed (mergeStatus: $merge_status)${failure:+: $failure}"
                return 1
                ;;
        esac
        if [ "$polled" -ge "$attempts" ]; then
            log_error "provider_prs_merge: PR $number is not completed after $polled checks (status: $pr_status, mergeStatus: ${merge_status:-unset}); the merge may still finish — check the PR"
            return 1
        fi
        polled=$((polled + 1))
        sleep "$interval"
        response=$(azure_http_request GET "$pr_url") || return 1
    done
}

# Comment on a PR (PR-level comment via the threads API). The thread is created with
# no status: a GitHub PR comment has no resolution state, so it is neither an Active
# thread (which counts against a "comments must be resolved" merge policy) nor a
# resolved one (which a consumer of unresolved threads would skip).
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
            --body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; text="$2"; shift 2 ;;
            --body-file) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body_file="$2"; shift 2 ;;
            --comment-body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; text="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
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
        '{comments: [{parentCommentId: 0, content: $t, commentType: 1}]}')
    local response
    if ! response=$(azure_http_request POST "${base_url}/pullrequests/${number}/threads" "$thread_body"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.id'
}

# ---------------------------------------------------------------------------
# Review threads
# ---------------------------------------------------------------------------

# One page of review threads for a PR. Emits a seam-threads-shaped JSON page
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
    # Recorded shapes: the thread's own id is .id, its status is a string
    # (active/pending are open; fixed, wontFix, closed and byDesign are resolved),
    # and an inline thread carries threadContext{filePath, rightFileStart|
    # leftFileStart{line}} (null for a general thread). Azure's own notes are
    # threads whose comments are all commentType "system"; those and deleted
    # threads are not review conversation and are dropped. So is a thread with no
    # status, no file context and a single comment: a plain PR comment (pr-comment
    # creates them status-less), which a GitHub PR comment is not a review thread
    # either. Once someone replies in it, it is a conversation and is listed. Each comment id is
    # <thread>/<comment>, the token pr-thread-reply takes (a comment id alone does
    # not name its thread).
    printf '%s' "$response" | jq -c --argjson pr "$pr" '{
        data: {repository: {pullRequest: {reviewThreads: {
            pageInfo: {hasNextPage: false, endCursor: null},
            nodes: [.value[]
                | select((.isDeleted // false) | not)
                | select([(.comments // [])[] | select((.commentType // "text") != "system")] | length > 0)
                | select(((.status // "unknown") != "unknown") or (.threadContext != null)
                         or ([(.comments // [])[] | select((.commentType // "text") != "system")] | length > 1))
                | . as $t | {
                    id: (($pr | tostring) + "/" + ($t.id | tostring)),
                    isResolved: (($t.status // "") as $s | ($s == "fixed" or $s == "wontFix" or $s == "closed" or $s == "byDesign")),
                    path: ($t.threadContext.filePath // null),
                    line: ($t.threadContext.rightFileStart.line // $t.threadContext.leftFileStart.line // 0),
                    comments: {nodes: [($t.comments // [])[] | select((.commentType // "text") != "system") | {
                        id: (($t.id | tostring) + "/" + (.id | tostring)),
                        nodeId: null,
                        body: .content,
                        author: {login: (.author.displayName // "unknown")}
                    }]}
                }]
        }}}}
    }'
}

# Reply to a review thread. COMMENT_REF is what pr-threads-get prints as a
# comment id: <thread>/<comment> (the reply nests under that comment), or a bare
# <thread> id (the reply nests under the thread's first comment).
# Usage: provider_prs_thread_reply REPO PR_NUMBER COMMENT_REF BODY
provider_prs_thread_reply() {
    local repo="$1" pr="$2" ref="$3" body="$4"
    [ -n "$repo" ] && [ -n "$pr" ] && [ -n "$ref" ] && [ -n "$body" ] || {
        log_error "provider_prs_thread_reply: repo, pr, comment ref and body are required"
        return 1
    }
    local thread_id parent
    case "$ref" in
        [0-9]*/[0-9]*) thread_id="${ref%/*}"; parent="${ref#*/}" ;;
        [0-9]*) thread_id="$ref"; parent=1 ;;
        *) thread_id="" ;;
    esac
    if ! [[ "$thread_id" =~ ^[0-9]+$ && "${parent:-}" =~ ^[0-9]+$ ]]; then
        log_error "provider_prs_thread_reply: azure comment refs are '<thread>/<comment>' — take the id from pr-threads-get output"
        return 1
    fi
    local base_url
    base_url=$(azure_pr_base "$repo") || return 1
    local reply_body
    # The comments endpoint takes a bare comment object — the threads
    # envelope (comments:[…], status) is rejected here as empty content.
    reply_body=$(jq -n --arg t "$body" --argjson p "$parent" '{content: $t, commentType: 1, parentCommentId: $p, format: "markdown"}')
    local response
    if ! response=$(azure_http_request POST "${base_url}/pullrequests/${pr}/threads/${thread_id}/comments" "$reply_body"); then
        printf '%s' "$response"
        return 1
    fi
    printf '%s' "$response" | jq -c '{id: (.id | tostring)}'
}

# Create a PR review thread — general comment, or inline via threadContext
# when --path/--line are given. Emits seam-shaped JSON ({thread:{url}}).
# Live-shape note: threadContext field names (filePath/rightFileStart) come
# from MAPPING.md and are declared-red until live-verified.
# Usage: provider_prs_thread_create [repo] PR_NUMBER --body TEXT
#        [--path FILE --line N --side LEFT|RIGHT]
provider_prs_thread_create() {
    local repo="${1-}"
    [ $# -gt 0 ] && shift
    local number="$1"; shift
    local body="" path="" line="" side=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body="$2"; shift 2 ;;
            --path) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; path="$2"; shift 2 ;;
            --line) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; line="$2"; shift 2 ;;
            --side) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; side="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
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
    local thread_id parts org project repo_name thread_url
    thread_id=$(printf '%s' "$response" | jq -r '.id')
    # The thread's URL is the contract's output: the PR page opened at the
    # discussion when the repository resolves, else the thread's own REST resource.
    parts=$(azure_repo_parts "$repo" 2>/dev/null) || parts=""
    org=$(printf '%s' "$parts" | sed -n 1p); project=$(printf '%s' "$parts" | sed -n 2p); repo_name=$(printf '%s' "$parts" | sed -n 3p)
    if [ -n "$repo_name" ]; then
        thread_url="$(provider_pr_web_url "$org/$project/$repo_name" "$number")?discussionId=${thread_id:-}"
    else
        thread_url="${base_url}/pullrequests/${number}/threads/${thread_id:-}"
    fi
    # id is the opaque thread ref (<pr>/<thread>) pr-thread-resolve takes.
    jq -nc --arg url "$thread_url" --arg id "$number/${thread_id:-}" '{thread: {url: $url, id: $id}}'
}

# Resolve a review thread (status "fixed"). THREAD_REF is the provider-opaque
# id pr-threads-get prints. Accepted forms:
#   <pr>/<thread>             the repository is the resolved target (DEVENV_REPO,
#                             else the working directory's repository)
#   <repo>/<pr>/<thread>      explicit repo (project/repo or org/project/repo)
#   REPO <pr>/<thread>        two arguments
# Usage: provider_prs_thread_resolve [REPO] THREAD_REF
provider_prs_thread_resolve() {
    local repo="" ref pr thread_id
    if [ $# -eq 1 ]; then
        ref="$1"
        # Split the trailing /<pr>/<thread> off the END: repo specs may be
        # org/project/repo (two slashes) — first-slash parsing would mangle
        # them.
        case "$ref" in
            */*/*)
                thread_id="${ref##*/}"
                pr="${ref%/*}"; pr="${pr##*/}"
                repo="${ref%/*}"; repo="${repo%/*}"
                ref="${pr}/${thread_id}"
                ;;
        esac
    else
        repo="$1"; shift
        ref="$1"
    fi
    case "$ref" in
        [0-9]*/[0-9]*) pr="${ref%/*}"; thread_id="${ref#*/}" ;;
        *)
            log_error "provider_prs_thread_resolve: azure thread refs are '<pr>/<thread>' — take the id from pr-threads-get output"
            return 1
            ;;
    esac
    # A ref without a repo routes to the resolved target, the same one every
    # other wrapper uses.
    [ -n "$repo" ] || repo=$(provider_repo_target "")
    [ -n "$repo" ] || {
        log_error "provider_prs_thread_resolve: azure thread routes are repositories-qualified and no repository could be resolved — set DEVENV_REPO or pass '<repo>/<pr>/<thread>'"
        return 1
    }
    # Thread routes are repositories-qualified: /_apis/git/repositories/
    # {repo}/pullrequests/{pr}/threads/{thread}. The project-git base
    # (no repositories segment) is an MVC 404 — live-verified.
    local base_url
    base_url=$(azure_pr_base "$repo") || return 1
    # The status PATCH takes the thread object under plain application/json — a
    # JSON-Patch array fails with "Value cannot be null. Parameter name:
    # commentThread" (live-verified). Azure answers with the status as a string.
    local response
    if ! response=$(azure_http_request PATCH "${base_url}/pullrequests/${pr}/threads/${thread_id}" '{"status": "fixed"}'); then
        printf '%s' "$response"
        return 1
    fi
    printf '%s' "$response" | jq -r '(.status // "" | tostring) as $s | if $s != "" and $s != "active" and $s != "pending" then "true" else "unknown" end'
}
