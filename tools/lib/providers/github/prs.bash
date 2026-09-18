#!/usr/bin/env bash
# github/prs.bash - GitHub implementation of the pull-request domain facade.
#
# Implements provider_prs_* functions per tools/lib/providers/INVENTORY.md:
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
        local __var="$1"
        local __repo="${2:-}"
        if [ -n "$__repo" ]; then
            eval "$__var=(-R \"$__repo\")"
        else
            eval "$__var=()"
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
    if [ $# -gt 0 ] && [[ "$1" != --* && "$1" != ^[0-9]*$ ]]; then
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
    if [ $# -gt 0 ] && [[ "$1" != --* && "$1" != ^[0-9]*$ ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh pr diff "$1" "${repo_args[@]}"
}

# Look up the merge/commit status of a PR branch (merge-link lookups).
# Usage: provider_prs_list_open_for_head REPO HEAD BRANCH_BASE
# Prints open PRs matching head->base; empty output means none.
provider_prs_list_open_for_head() {
    local repo="$1" head="$2" base="$3"
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh pr list "${repo_args[@]}" --head "$head" --base "$base" --state open
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
    if [ $# -gt 0 ] && [[ "$1" != --* && "$1" != ^[0-9]*$ ]]; then
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
    local repo="$1" pr="$2" comment_id="$3" body="$4"
    local owner="${repo%%/*}" name="${repo##*/}"
    gh api -X POST \
        "/repos/$owner/$name/pulls/$pr/comments/$comment_id/replies" \
        -f body="$body" >/dev/null 2>&1
}

# Resolve a PR review thread (GraphQL surface, per pr-thread-resolve).
# Usage: provider_prs_thread_resolve THREAD_NODE_ID
provider_prs_thread_resolve() {
    local thread_id="$1"
    gh api graphql -f query="mutation { resolveReviewThread(input: {threadId: \\\"$thread_id\\\"}) { thread { isResolved } } }" >/dev/null 2>&1
}
