#!/usr/bin/env bash
# github/prs.bash - GitHub implementation of the pull-request domain facade.
#
# Implements provider_prs_* functions (live contract: tools/lib/providers/README.md):
# list / view / create / merge / diff / comment / review-thread reply+resolve /
# merge-link lookup. Review-thread operations use the REST/GraphQL surfaces the
# current pr-* wrappers use today. Contract: return non-zero + log_error on
# failure; never exit. Requires provider-core.bash sourced first.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_GITHUB_PRS_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_GITHUB_PRS_LOADED=1

# Logging fallback when error-handling.bash isn't loaded (keeps the no-exit,
# logged-error contract self-contained).
if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi
if ! declare -F log_warn >/dev/null; then
    log_warn() { echo "WARN: $*" >&2; }
fi

# Reuse the shared repo-args helper from the issues module when present; define
# it locally otherwise so modules are independently sourceable.
if ! declare -F provider_repo_args >/dev/null; then
    provider_repo_args() {
        local -n __arr="$1"
        local __repo="${2:-}"
        if [ -n "$__repo" ]; then
            __arr=("-R" "$__repo")
        else
            __arr=()
        fi
    }
fi

if ! declare -F _gh_repo_vars >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repos.bash"
fi

# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

# List PRs.
# Usage: provider_prs_list [repo] [--state S] [--head B] [--base B] [--json F]
provider_prs_list() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh pr list "${repo_args[@]}" "$@"
}

# View a PR.
# Usage: provider_prs_view [repo] NUMBER [FLAGS]
provider_prs_view() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* && ! "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh pr view "$@" "${repo_args[@]}"
}

# Diff a PR.
# Usage: provider_prs_diff [repo] NUMBER
provider_prs_diff() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* && ! "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh pr diff "$1" "${repo_args[@]}"
}

# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

# Create a PR.
# Usage: provider_prs_create [repo] --title T --body B --head H --base B
provider_prs_create() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh pr create "${repo_args[@]}" "$@"
}

# Merge a PR (callers pass the method explicitly; the tooling policy default is rebase).
# Usage: provider_prs_merge [repo] NUMBER [--squash|--merge|--rebase] [--delete-branch]
provider_prs_merge() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* && ! "$1" =~ ^[0-9]+$ ]]; then
        repo="$1"; shift
    fi
    local number="${1:-}"
    shift 2>/dev/null || true
    if [ -z "$number" ]; then
        log_error "provider_prs_merge: PR number is required"
        return 1
    fi
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh pr merge "$number" "${repo_args[@]}" "$@"
}

# Comment on a PR.
# Usage: provider_prs_comment [repo] NUMBER --comment-body TEXT
provider_prs_comment() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh pr comment "$number" "${repo_args[@]}" "$@"
}

# Reply to a PR review comment thread (REST surface, per pr-thread-reply).
# Usage: provider_prs_thread_reply REPO PR_NUMBER COMMENT_ID BODY
provider_prs_thread_reply() {
    # Reply to a PR review comment thread. Emits the created comment as seam-shaped
    # JSON ({id, url, ...}) on stdout; fails defined.
    local repo="$1" pr="$2" comment_id="$3" body="$4"
    if [ -z "$repo" ] || [[ "$repo" != */* ]]; then
        log_error "provider_prs_thread_reply: repo must be owner/repo form"
        return 1
    fi
    if [ -z "$pr" ] || [ -z "$comment_id" ] || [ -z "$body" ]; then
        log_error "provider_prs_thread_reply: pr, comment-id and body are required"
        return 1
    fi
    local owner="${repo%%/*}" name="${repo##*/}"
    gh api -X POST \
        "/repos/$owner/$name/pulls/$pr/comments/$comment_id/replies" \
        -f body="$body" | _gh_neutral_comment
    return "${PIPESTATUS[0]}"
}
# Create a PR review thread — general comment, or inline when --path/--line
# are given. Emits gh-shaped JSON ({thread:{url}}); the caller extracts the
# URL. Absorbs the graphql mutation that used to live in pr-review-comment.
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
    local pr_id repo_node_id vars owner name
    pr_id=$(provider_prs_view "$repo" "$number" --json id -q .id) || return 1
    # The repository rides GraphQL variables: gh does not fill {owner}/{repo}
    # placeholders inside a -f query.
    vars=$(_gh_repo_vars "$repo") || return 1
    owner=$(printf '%s' "$vars" | sed -n 1p); name=$(printf '%s' "$vars" | sed -n 2p)
    # shellcheck disable=SC2016  # GraphQL variables must not be shell-expanded
    repo_node_id=$(gh api graphql -f 'query=query($o:String!,$r:String!){repository(owner:$o,name:$r){id}}' -f o="$owner" -f r="$name" --jq '.data.repository.id')
    [ -n "$repo_node_id" ] && [ "$repo_node_id" != "null" ] || { log_error "provider_prs_thread_create: cannot resolve repository node id"; return 1; }
    # shellcheck disable=SC2016  # GraphQL variables must not be shell-expanded
    local query='mutation($pr: ID!, $body: String!, $repo: ID!$extra) {
        addPullRequestReviewThread(input: {
            pullRequestId: $pr,
            body: $body,
            repositoryId: $repo$extra
        }) { thread { url } }
    }'
    local -a args=(gh api graphql -f query="$query" -f pr="$pr_id" -f body="$body" -f repo="$repo_node_id")
    if [ -n "$path" ]; then
        [ -n "$line" ] || { log_error "provider_prs_thread_create: --path requires --line"; return 1; }
        args+=(-f path="$path" -F line="$line" -f side="${side:-RIGHT}")
    fi
    # Normalize to the verb's gh-shaped contract ({thread:{url}}) — the raw
    # graphql envelope stays provider-internal.
    local raw
    raw=$("${args[@]}" 2>/dev/null) || return 1
    printf '%s' "$raw" | jq -c '{thread: {url: (.data.addPullRequestReviewThread.thread.url // "")}}'
}
# Resolve a PR review thread (GraphQL surface, per pr-thread-resolve).
# Usage: provider_prs_thread_resolve THREAD_NODE_ID
provider_prs_thread_resolve() {
    # Resolve a PR review thread by node ID. Prints the resolved thread's
    # isResolved state on stdout (true/false/unknown); fails defined on
    # transport or GraphQL errors. The mutation passes the thread ID as a
    # GraphQL variable — never interpolated into the query string.
    local thread_id="$1"
    if [ -z "$thread_id" ]; then
        log_error "provider_prs_thread_resolve: thread node ID is required"
        return 1
    fi
    local mutation response
    mutation='mutation($threadId: ID!) {
      resolveReviewThread(input: {threadId: $threadId}) {
        thread { id isResolved }
      }
    }'
    if ! response=$(gh api graphql -f query="$mutation" -f threadId="$thread_id" 2>&1); then
        log_error "provider_prs_thread_resolve: transport failure resolving $thread_id"
        printf '%s\n' "$response" >&2
        return 1
    fi
    if echo "$response" | jq -e '.errors' >/dev/null 2>&1; then
        log_error "provider_prs_thread_resolve: GraphQL error resolving $thread_id"
        return 1
    fi
    printf '%s\n' "$(echo "$response" | jq -r '.data.resolveReviewThread.thread.isResolved // "unknown"')"
}

# One page of review threads for a PR (threads-get's pagination loop calls
# this per cursor). Emits the raw GraphQL response JSON; empty response with
# rc 1 on transport failure.
# Usage: provider_prs_threads_page REPO PR_NUMBER [CURSOR]
provider_prs_threads_page() {
    local repo="$1" pr="$2" cursor="${3:-}"
    if [ -z "$repo" ] || [[ "$repo" != */* ]]; then
        log_error "provider_prs_threads_page: repo must be owner/repo form"
        return 1
    fi
    if [ -z "$pr" ] || ! [[ "$pr" =~ ^[0-9]+$ ]]; then
        log_error "provider_prs_threads_page: PR number must be numeric"
        return 1
    fi
    local owner="${repo%%/*}" name="${repo##*/}"
    local gh_args=(-f query="$QUERY_PR_THREADS")
    gh_args+=(-f owner="$owner")
    gh_args+=(-f repo="$name")
    gh_args+=(-F pr="$pr")
    [ -n "$cursor" ] && gh_args+=(-f cursor="$cursor")
    local response
    response=$(gh api graphql "${gh_args[@]}") || return 1
    # A thread's comments are read 50 at a time; more than that truncates silently.
    if printf '%s' "$response" | jq -e '[.data.repository.pullRequest.reviewThreads.nodes[]?.comments.pageInfo.hasNextPage // false] | any' >/dev/null 2>&1; then
        log_warn "provider_prs_threads_page: a thread of PR #$pr has more comments than the query returns (50); its conversation is incomplete"
    fi
    # Comment ids in the seam's shape: `id` is the id a reply addresses (GitHub's
    # databaseId) and `nodeId` the GraphQL node id.
    printf '%s' "$response" | jq -c '
        .data.repository.pullRequest.reviewThreads.nodes |= map(
            .comments.nodes |= map({id: .databaseId, nodeId: .id} + del(.id, .databaseId)))'
}

# The threads-page query document (single definition; the verb passes it as
# a GraphQL variable payload).
QUERY_PR_THREADS='query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          path
          line
          startLine
          diffSide
          comments(first: 50) {
            pageInfo { hasNextPage }
            nodes {
              id
              databaseId
              author { login }
              body
              createdAt
              url
            }
          }
        }
      }
    }
  }
}'
