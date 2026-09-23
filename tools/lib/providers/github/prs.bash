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

# Reuse the shared repo-args helper from the issues module when present; define
# it locally otherwise so modules are independently sourceable.
if ! declare -F provider_gh_repo_args >/dev/null; then
    provider_gh_repo_args() {
        local -n __arr="$1"
        local __repo="${2:-}"
        if [ -n "$__repo" ]; then
            __arr=("-R" "$__repo")
        else
            __arr=()
        fi
    }
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
    provider_gh_repo_args repo_args "$repo"
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
    provider_gh_repo_args repo_args "$repo"
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
    provider_gh_repo_args repo_args "$repo"
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
    provider_gh_repo_args repo_args "$repo"
    gh pr create "${repo_args[@]}" "$@"
}

# Merge a PR (squash default, matching current tooling).
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
    provider_gh_repo_args repo_args "$repo"
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
    provider_gh_repo_args repo_args "$repo"
    gh pr comment "$number" "${repo_args[@]}" "$@"
}

# Reply to a PR review comment thread (REST surface, per pr-thread-reply).
# Usage: provider_prs_thread_reply REPO PR_NUMBER COMMENT_ID BODY
provider_prs_thread_reply() {
    # Reply to a PR review comment thread. Emits the raw REST response JSON
    # on stdout (callers extract html_url etc.); fails defined.
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
        -f body="$body"
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
    gh api graphql "${gh_args[@]}"
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
