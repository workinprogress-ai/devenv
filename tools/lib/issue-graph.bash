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

# Provider layer: graph traversals route through the abstraction via the
# one canonical loader.
_ig_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$_ig_lib_dir/providers/provider-core.bash" ]; then
    # shellcheck disable=SC1091
    source "$_ig_lib_dir/providers/provider-core.bash"
    provider_load repos issues
fi
unset _ig_lib_dir

_issue_graph_repo_spec() {
    # Resolution (env override → cwd identity) is provider_repo_target's
    # contract; this wrapper keeps the graph-local naming.
    local spec
    spec=$(provider_repo_target)
    if [ -n "$spec" ]; then
        printf '%s' "$spec"
    else
        local owner repo
        owner=$(provider_repos_view "" --json owner -q .owner.login 2>/dev/null)
        repo=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        printf '%s/%s' "$owner" "$repo"
    fi
}

# Link child to parent via native sub-issues.
# Usage: issue_link_subissue <parent> <child>
issue_link_subissue() {
    local parent="$1" child="$2"
    [ -n "$parent" ] && [ -n "$child" ] || {
        echo "Usage: issue_link_subissue <parent> <child>" >&2
        return 1
    }
    provider_issue_graph_link "$parent" "$child"
}

# List a parent's native sub-issue children (numbers, one per line).
# Usage: issue_children <parent>
issue_children() {
    local parent="$1"
    [ -n "$parent" ] || return 1
    # 50-cap rationale: beyond any planned decomposition; larger trees should
    # be split rather than queried deeper.
    provider_issue_graph_children "$parent"
}

# Resolve an issue's parent: native sub-issue linkage first, legacy
# 'Part of #N' body text as fallback for pre-native-linking issues. Empty
# output when no parent is recorded either way.
# Usage: issue_parent <issue>
issue_parent() {
    local issue="$1"
    [ -n "$issue" ] || return 1
    local native
    native=$(provider_issue_graph_parent "$issue" 2>/dev/null)
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
