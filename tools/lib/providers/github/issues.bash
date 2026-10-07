#!/usr/bin/env bash
# github/issues.bash - GitHub implementation of the issues domain facade.
#
# Implements provider_issues_* functions (live contract: tools/lib/providers/README.md):
# list / view / create / close / reopen / edit / comment / label ops /
# milestone list / artifact comments. Repo targeting accepts -R owner/repo,
# GH_REPO= env, or args-array pass-through (normalized by provider_repo_target
# from the repos module; when this module is used standalone, callers pass
# repo specs explicitly).
#
# Contract: library functions return non-zero + log_error on failure; this
# module never exits. Type mapping delegates to normalize_issue_type
# (issues-config/issue-operations) — no new policy here. Requires
# provider-core.bash to be sourced first.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_GITHUB_ISSUES_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_GITHUB_ISSUES_LOADED=1

# Logging fallback when error-handling.bash isn't loaded (keeps the no-exit,
# logged-error contract self-contained).
if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi

# Native issue-type editing is GH-specific (gh issue edit --type).
# Standalone-sourcing contract: the capability registry lives in
# provider-core; source it unconditionally (its own loaded-guard makes
# re-sourcing a no-op) so this module loads alone or under provider_load.
# shellcheck disable=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/provider-core.bash"
provider_declare_capability native-issue-types

# ---------------------------------------------------------------------------
# Internal targeting helper
# ---------------------------------------------------------------------------

# Build the repo-target args array for gh. Accepts:
#   provider_repo_args VARNAME [owner/repo]
# Sets VARNAME as a bash array: (-R owner/repo) or empty. Use
# "${VARNAME[@]}" at the gh call site.
provider_repo_args() {
    # nameref + printf -v: inert by construction — repo content is never
    # re-parsed as shell syntax (the historical eval form executed $(...)
    # embedded in repo values).
    local -n __arr="$1"
    local __repo="${2:-}"
    if [ -n "$__repo" ]; then
        __arr=("-R" "$__repo")
    else
        __arr=()
    fi
}

if ! declare -F _gh_repo_vars >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repos.bash"
fi


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

# List issues.
# Flag contract: options are consumed strictly as `--opt value` pairs; use
# separate arguments (not `--opt=value`), and only options that take a value.
# Usage: provider_issues_list [repo] [--state S] [--label L] [--assignee A]
#        [--limit N] [--json FIELD,...]
provider_issues_list() {
    # Flag contract: valued flags are --opt value pairs; the known boolean
    # flags below take no value (a blind "shift 2" would swallow whatever
    # followed a valueless flag, silently corrupting the arg stream).
    # Unknown flags fail defined instead of guessing.
    local repo=""
    local args=()
    local repo_args=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --web|--lock)
                args+=("$1"); shift
                ;;
            --*)
                if [ $# -lt 2 ]; then
                    log_error "provider_issues_list: flag '$1' requires a value"
                    return 1
                fi
                args+=("$1" "$2"); shift 2
                ;;
            *) repo="$1"; shift ;;
        esac
    done
    provider_repo_args repo_args "$repo"
    gh issue list "${repo_args[@]}" "${args[@]}"
}

# View a single issue (JSON by default).
# Usage: provider_issues_view [repo] NUMBER [--json FIELDS]
provider_issues_view() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh issue view "$@" "${repo_args[@]}"
}

# Check an issue exists (presence test; no output).
# Usage: provider_issues_exists [repo] NUMBER
provider_issues_exists() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh issue view "$1" "${repo_args[@]}" --json number >/dev/null 2>&1
}

# List issue comments (paginated JSON).
# Usage: provider_issues_comments REPO NUMBER   (REPO may be "")
provider_issues_comments() {
    local repo="${1-}" number="${2:?issue number required}"
    if [ -n "$repo" ]; then
        gh api "repos/${repo}/issues/${number}/comments" --paginate 2>/dev/null | _gh_neutral_comment
    else
        gh api "repos/{owner}/{repo}/issues/${number}/comments" --paginate 2>/dev/null | _gh_neutral_comment
    fi
    # the status that matters is gh's, not the filter's
    return "${PIPESTATUS[0]}"
}

# List milestones.
# Usage: provider_issues_milestones [repo]
provider_issues_milestones() {
    local repo="$1"
    shift
    if [ -n "$repo" ]; then
        gh api "repos/$repo/milestones" "$@" 2>/dev/null
    else
        gh api "repos/{owner}/{repo}/milestones" "$@" 2>/dev/null
    fi
}

# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

# Create an issue.
# Usage: provider_issues_create [repo] --title T [--body B] [--label L]...
provider_issues_create() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh issue create "${repo_args[@]}" "$@"
}

# Comment on an issue.
# Usage: provider_issues_comment [repo] NUMBER --comment-body TEXT
provider_issues_comment() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh issue comment "$number" "${repo_args[@]}" "$@"
}

# Close an issue.
# Usage: provider_issues_close [repo] NUMBER [--reason R] [--comment TEXT]
provider_issues_close() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh issue close "$number" "${repo_args[@]}" "$@"
}

# Reopen an issue.
# Usage: provider_issues_reopen [repo] NUMBER [gh-args...]
provider_issues_reopen() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh issue reopen "$number" "${repo_args[@]}" "$@"
}

# Edit an issue.
# Usage: provider_issues_edit [repo] NUMBER [--title T] [--body B] ...
provider_issues_edit() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local repo_args=()
    provider_repo_args repo_args "$repo"
    gh issue edit "$number" "${repo_args[@]}" "$@"
}

# Set an issue's native type (GH-only capability).
# Normalizes the type through normalize_issue_type when available (policy
# stays in issues-config land); falls back to the raw name.
# Usage: provider_issues_set_type REPO_OWNER REPO_NAME NUMBER TYPE_NAME
provider_issues_set_type() {
    if ! provider_require_capability native-issue-types; then
        return 1
    fi
    local repo_owner="$1" repo_name="$2" number="$3" type_name="$4"
    local normalized="$type_name"
    if declare -F normalize_issue_type >/dev/null; then
        normalized=$(normalize_issue_type "$type_name") || return 1
    fi
    GH_REPO="${repo_owner}/${repo_name}" gh issue edit "$number" --type "$normalized" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Label operations
# ---------------------------------------------------------------------------

# List labels (JSON).
# Usage: provider_issues_label_list [repo]
provider_issues_label_list() {
    local repo_args=()
    provider_repo_args repo_args "$1"
    shift
    # Pure pass-through: callers own their --json field list. (The verb used
    # to append "--json name", silently corrupting caller-specified field
    # lists with a duplicate flag that worked only by undocumented gh
    # last-wins tolerance.)
    gh label list "${repo_args[@]}" "$@" 2>/dev/null
}

# Create a label if absent (idempotent; mirrors ensure_label semantics).
# Usage: provider_issues_label_ensure [repo] NAME [COLOR] [DESCRIPTION]
provider_issues_label_ensure() {
    local repo="$1"; shift
    local name="$1" color="${2:-ededed}" desc="${3:-Automated process}"
    local repo_args=()
    provider_repo_args repo_args "$repo"
    # Distinguish "cannot list" from "not listed": a permissions failure
    # must not masquerade as absent-label and produce a confusing create
    # failure downstream.
    local listed
    # gh lists 30 labels unless told otherwise; a repository with more would have
    # an existing label look absent and the create then fail "already exists".
    if ! listed=$(gh label list "${repo_args[@]}" --limit 1000 --json name --jq '.[].name' 2>/dev/null); then
        log_error "provider_issues_label_ensure: cannot list labels in '${repo:-cwd repo}' — check credentials/permissions"
        return 1
    fi
    # Fixed-string, whole-line match: a name is text, not a pattern.
    if printf '%s\n' "$listed" | grep -Fqx -- "$name"; then
        return 0
    fi
    gh label create "$name" "${repo_args[@]}" --color "$color" --description "$desc"
}

# ---------------------------------------------------------------------------
# Comment + label contract verbs (call sites use these instead of raw REST)
# ---------------------------------------------------------------------------

# Fetch one issue comment as seam-shaped JSON ({id, url, body, ...}).
# Fails defined when the comment does not exist. COMMENT_REF is the
# provider-opaque id (a bare numeric id under GitHub).
# Usage: provider_issues_comment_get [repo] COMMENT_REF
provider_issues_comment_get() {
    local repo="${1-}"
    [ $# -gt 0 ] && shift
    local comment_id="$1"
    if [ -n "$repo" ]; then
        gh api "repos/${repo}/issues/comments/${comment_id}" 2>/dev/null | _gh_neutral_comment
    else
        gh api "repos/{owner}/{repo}/issues/comments/${comment_id}" 2>/dev/null | _gh_neutral_comment
    fi
    return "${PIPESTATUS[0]}"
}

# ---------------------------------------------------------------------------
# Sub-issue graph (graphql; consumed via issue-graph.bash)
# ---------------------------------------------------------------------------

# Link a child issue under a parent via native sub-issues.
# Usage: provider_issue_graph_link REPO PARENT CHILD  (issue numbers; REPO may be "")
provider_issue_graph_link() {
    local repo="${1-}" parent="${2:?parent number required}" child="${3:?child number required}"
    local pid cid
    pid=$(_gh_issue_node_id "$parent" "$repo") || return 1
    cid=$(_gh_issue_node_id "$child" "$repo") || return 1
    [ -n "$pid" ] && [ -n "$cid" ] || { log_error "provider_issue_graph_link: could not resolve the issue node ids"; return 1; }
    # shellcheck disable=SC2016  # GraphQL variables must not be shell-expanded
    provider_api graphql \
        -f "query=mutation(\$p:ID!,\$c:ID!){addSubIssue(input:{issueId:\$p,subIssueId:\$c}){issue{number}}}" \
        -f p="$pid" -f c="$cid" >/dev/null
}

# Unlink a child issue from its parent.
# Usage: provider_issue_graph_unlink REPO PARENT CHILD
provider_issue_graph_unlink() {
    local repo="${1-}" parent="${2:?parent number required}" child="${3:?child number required}"
    local pid cid
    pid=$(_gh_issue_node_id "$parent" "$repo") || return 1
    cid=$(_gh_issue_node_id "$child" "$repo") || return 1
    [ -n "$pid" ] && [ -n "$cid" ] || { log_error "provider_issue_graph_unlink: could not resolve the issue node ids"; return 1; }
    # shellcheck disable=SC2016  # GraphQL variables must not be shell-expanded
    provider_api graphql \
        -f "query=mutation(\$p:ID!,\$c:ID!){removeSubIssue(input:{issueId:\$p,subIssueId:\$c}){issue{number}}}" \
        -f p="$pid" -f c="$cid" >/dev/null
}

# List a parent's sub-issue children (numbers, one per line). Up to 50: beyond any
# planned decomposition; a larger tree should be split rather than queried deeper.
# Usage: provider_issue_graph_children REPO PARENT
provider_issue_graph_children() {
    local repo="${1-}" parent="${2:?parent number required}"
    local vars owner name
    vars=$(_gh_repo_vars "$repo") || return 1
    owner=$(printf '%s' "$vars" | sed -n 1p); name=$(printf '%s' "$vars" | sed -n 2p)
    # shellcheck disable=SC2016  # GraphQL variables must not be shell-expanded
    provider_api graphql \
        -f 'query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){subIssues(first:50){nodes{number}}}}}' \
        -f o="$owner" -f r="$name" -F n="$parent" \
        --jq '.data.repository.issue.subIssues.nodes[].number'
}

# Resolve an issue's native parent (number) or empty.
# Usage: provider_issue_graph_parent REPO ISSUE
provider_issue_graph_parent() {
    local repo="${1-}" issue="${2:?issue number required}"
    local vars owner name
    vars=$(_gh_repo_vars "$repo") || return 1
    owner=$(printf '%s' "$vars" | sed -n 1p); name=$(printf '%s' "$vars" | sed -n 2p)
    # shellcheck disable=SC2016  # GraphQL variables must not be shell-expanded
    provider_api graphql \
        -f 'query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){parent{number}}}}' \
        -f o="$owner" -f r="$name" -F n="$issue" \
        --jq '.data.repository.issue.parent.number'
}

# Resolve an issue's graphql node id in the target repository.
# Usage: _gh_issue_node_id NUMBER [REPO] -> prints node id
_gh_issue_node_id() {
    local issue="$1" repo="${2:-}"
    local vars owner name
    vars=$(_gh_repo_vars "$repo") || return 1
    owner=$(printf '%s' "$vars" | sed -n 1p); name=$(printf '%s' "$vars" | sed -n 2p)
    # shellcheck disable=SC2016  # GraphQL variables must not be shell-expanded
    provider_api graphql \
        -f 'query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}' \
        -f o="$owner" -f r="$name" -F n="$issue" \
        --jq '.data.repository.issue.id'
}

# Replace a comment's body; emits the updated gh comment JSON. COMMENT_REF
# is the provider-opaque id (bare numeric under GitHub).
# Usage: provider_issues_comment_edit [repo] COMMENT_REF --body TEXT
provider_issues_comment_edit() {
    local repo="${1-}"
    [ $# -gt 0 ] && shift
    local comment_id="$1"; shift
    local body=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body="$2"; shift 2 ;;
            --body-file) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body=$(cat "$2"); shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    [ -n "$body" ] || { log_error "provider_issues_comment_edit requires --body"; return 1; }
    local endpoint
    if [ -n "$repo" ]; then
        endpoint="repos/${repo}/issues/comments/${comment_id}"
    else
        endpoint="repos/{owner}/{repo}/issues/comments/${comment_id}"
    fi
    gh api -X PATCH "$endpoint" -f "body=${body}" 2>/dev/null | _gh_neutral_comment
    return "${PIPESTATUS[0]}"
}

# Create a comment on an issue; emits the created gh comment JSON
# ({id, url, ...}) — unlike provider_issues_comment, which emits the
# bare id for interactive callers.
# Usage: provider_issues_comment_add [repo] ISSUE_NUMBER --body TEXT
provider_issues_comment_add() {
    local repo="${1-}"
    [ $# -gt 0 ] && shift
    local number="$1"; shift
    local body=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body="$2"; shift 2 ;;
            --body-file) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body=$(cat "$2"); shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    [ -n "$body" ] || { log_error "provider_issues_comment_add requires --body"; return 1; }
    local endpoint
    if [ -n "$repo" ]; then
        endpoint="repos/${repo}/issues/${number}/comments"
    else
        endpoint="repos/{owner}/{repo}/issues/${number}/comments"
    fi
    gh api -X POST "$endpoint" -f "body=${body}" 2>/dev/null | _gh_neutral_comment
    return "${PIPESTATUS[0]}"
}

# Create a label (fails defined when it already exists or on API error).
# Color/description are GitHub-native; other providers accept-and-ignore
# unsupported fields per their mapping.
# Usage: provider_issues_label_create [repo] NAME [COLOR] [DESCRIPTION]
provider_issues_label_create() {
    local repo="${1-}"
    [ $# -gt 0 ] && shift
    local name="${1:?name required}" color="${2:-ededed}" desc="${3:-}"
    local repo_args=()
    provider_repo_args repo_args "$repo"
    local args=(gh label create "$name" "${repo_args[@]}" --color "$color")
    [ -n "$desc" ] && args+=(--description "$desc")
    "${args[@]}" 2>/dev/null
}

# Update an existing label's color/description.
# Usage: provider_issues_label_update [repo] NAME [COLOR] [DESCRIPTION]
provider_issues_label_update() {
    local repo="${1-}"
    [ $# -gt 0 ] && shift
    local name="${1:?name required}" color="${2:-}" desc="${3:-}"
    local repo_args=()
    provider_repo_args repo_args "$repo"
    local args=(gh label edit "$name" "${repo_args[@]}")
    [ -n "$color" ] && args+=(--color "$color")
    [ -n "$desc" ] && args+=(--description "$desc")
    "${args[@]}" 2>/dev/null
}
