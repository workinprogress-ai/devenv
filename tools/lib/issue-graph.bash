#!/bin/bash
# issue-graph.bash - Native sub-issue hierarchy reads/writes + legacy
# body-text parent resolution.
#
# All I/O lives here (and in the wrappers it invokes); workflow-core.bash
# stays policy-only by calling THESE helpers.
#
# API shapes (live-verified against GitHub):
#   node IDs:      repository(owner,name){ issue(number){ id } }
#   link:          addSubIssue(input:{issueId, subIssueId})
#   unlink:        removeSubIssue(input:{issueId, subIssueId})
#   children:      repository(owner,name){ issue(number){ subIssues(first:N){
#                      nodes{ number } } } }
#   parent:        repository(owner,name){ issue(number){ parent{ number } } }
#
# Parent resolution reads the native sub-issue graph FIRST (Issue.parent is
# live-verified to reflect addSubIssue linkage); the legacy 'Part of #N'
# body text is the fallback for issues linked before native linking. Keep
# the fallback: existing subtrees may rely on it. Removing the body-text
# line on a legacy issue silently stops parent rollup for that subtree.

# Prevent multiple sourcing
if [ -n "${_ISSUE_GRAPH_LOADED:-}" ]; then return 0; fi
readonly _ISSUE_GRAPH_LOADED=1

# Provider layer: graph traversals route through the abstraction (slice 3/#36).
if [ -z "${_PROVIDER_CORE_LOADED:-}" ]; then
    _ig_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "$_ig_lib_dir/providers/provider-core.bash" ]; then
        # shellcheck disable=SC1091
        source "$_ig_lib_dir/providers/provider-core.bash"
        provider_detect "${DEVENV_ROOT:-$(dirname "$(dirname "$_ig_lib_dir")")}/devenv.config" 2>/dev/null || PROVIDER_NAME="${PROVIDER_NAME:-github}"
        # shellcheck disable=SC1091
        # shellcheck disable=SC1090
        source "$_ig_lib_dir/providers/${PROVIDER_NAME}/repos.bash"
        # shellcheck disable=SC1091
        # shellcheck disable=SC1090
        source "$_ig_lib_dir/providers/${PROVIDER_NAME}/issues.bash"
    fi
    unset _ig_lib_dir
fi

_issue_graph_repo_spec() {
    if [ -n "${GITHUB_REPO:-}" ]; then
        printf '%s' "$GITHUB_REPO"
    else
        local owner repo
        owner=$(provider_repos_view "" --json owner -q .owner.login 2>/dev/null)
        repo=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        printf '%s/%s' "$owner" "$repo"
    fi
}

# Resolve the repo spec once and split it; callers use the two globals
# IG_OWNER / IG_REPO instead of invoking _issue_graph_repo_spec repeatedly
# (each call can spawn gh + git when GITHUB_REPO is unset).
_issue_graph_repo_parts() {
    local spec
    spec="$(_issue_graph_repo_spec)"
    IG_OWNER="${spec%%/*}"
    IG_REPO="${spec#*/}"
}

_issue_graph_node_id() {
    local issue="$1"
    local owner repo
    _issue_graph_repo_parts
    owner="$IG_OWNER"; repo="$IG_REPO"
    provider_api graphql \
        -f "query=query(\$o:String!,\$r:String!,\$n:Int!){repository(owner:\$o,name:\$r){issue(number:\$n){id}}}" \
        -f o="$owner" -f r="$repo" -F n="$issue" \
        --jq '.data.repository.issue.id' 2>/dev/null
}

# Link child to parent via native sub-issues.
# Usage: issue_link_subissue <parent> <child>
issue_link_subissue() {
    local parent="$1" child="$2"
    [ -n "$parent" ] && [ -n "$child" ] || {
        echo "Usage: issue_link_subissue <parent> <child>" >&2
        return 1
    }
    local pid cid
    pid="$(_issue_graph_node_id "$parent")" || return 1
    cid="$(_issue_graph_node_id "$child")" || return 1
    [ -n "$pid" ] && [ -n "$cid" ] || return 1
    provider_api graphql \
        -f "query=mutation(\$p:ID!,\$c:ID!){addSubIssue(input:{issueId:\$p,subIssueId:\$c}){issue{number}}}" \
        -f p="$pid" -f c="$cid" >/dev/null 2>&1
}

# List a parent's native sub-issue children (numbers, one per line).
# Usage: issue_children <parent>
issue_children() {
    local parent="$1"
    [ -n "$parent" ] || return 1
    local owner repo
    _issue_graph_repo_parts
    owner="$IG_OWNER"; repo="$IG_REPO"
    # Pagination deliberately omitted: 50 children is far beyond any planned
    # decomposition; larger trees should be split rather than queried deeper.
    provider_api graphql \
        -f "query=query(\$o:String!,\$r:String!,\$n:Int!){repository(owner:\$o,name:\$r){issue(number:\$n){subIssues(first:50){nodes{number}}}}}" \
        -f o="$owner" -f r="$repo" -F n="$parent" \
        --jq '.data.repository.issue.subIssues.nodes[].number' 2>/dev/null
}

# Resolve an issue's parent: native sub-issue linkage first, legacy
# 'Part of #N' body text as fallback for pre-native-linking issues. Empty
# output when no parent is recorded either way.
# Usage: issue_parent <issue>
issue_parent() {
    local issue="$1"
    [ -n "$issue" ] || return 1
    local owner repo native
    _issue_graph_repo_parts
    owner="$IG_OWNER"; repo="$IG_REPO"
    native=$(provider_api graphql \
        -f "query=query(\$o:String!,\$r:String!,\$n:Int!){repository(owner:\$o,name:\$r){issue(number:\$n){parent{number}}}}" \
        -f o="$owner" -f r="$repo" -F n="$issue" \
        --jq '.data.repository.issue.parent.number' 2>/dev/null)
    if [ -n "$native" ] && [ "$native" != "null" ]; then
        printf '%s' "$native"
        return 0
    fi
    local spec body
    spec="$(_issue_graph_repo_spec)"
    body=$(provider_issues_view "$spec" "$issue" --json body -q '.body' 2>/dev/null) || return 0
    printf '%s' "$body" | grep -oE '^Part of #[0-9]+' | head -1 | grep -oE '[0-9]+'
    return 0
}

# Read an issue's current Status from the project cards (first project with
# a readable Status; dash/unset reads as empty). Empty output when unknown.
# Usage: issue_read_status <issue>
issue_read_status() {
    local issue="$1"
    [ -n "$issue" ] || return 1
    local spec st
    spec="$(_issue_graph_repo_spec)"
    while IFS=$'\t' read -r _proj _num st; do
        # Skip values outside the configured vocabulary: boards with a
        # foreign Status field (or dash/unset) must not shadow a canonical
        # project's value; a foreign value is as unreadable as none.
        if [ -n "$st" ] && [ "$st" != "-" ] && _ig_in_vocab "$st"; then
            printf '%s' "$st"
            return 0
        fi
    done < <(bash "${ISSUE_GRAPH_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/scripts/project-list-for-issue.sh" "$issue" 2>/dev/null)
    return 0
}

_ig_in_vocab() {
    local token="$1"
    local order t
    # shellcheck source=workflow-core.bash
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/workflow-core.bash" 2>/dev/null || return 1
    order="$(workflow_order)"
    for t in $order; do
        [ "$t" = "$token" ] && return 0
    done
    return 1
}
