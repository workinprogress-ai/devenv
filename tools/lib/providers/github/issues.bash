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
if ! declare -F provider_declare_capability >/dev/null; then
    # Standalone-sourcing fallback: the capability registry lives
    # in provider-core; source it when this module is loaded alone.
    _cap_core_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    # shellcheck disable=SC1091
    source "$_cap_core_dir/provider-core.bash"
    unset _cap_core_dir
fi
provider_declare_capability native-issue-types

# ---------------------------------------------------------------------------
# Internal targeting helper
# ---------------------------------------------------------------------------

# Build the repo-target args array for gh. Accepts:
#   provider_gh_repo_args VARNAME [owner/repo]
# Sets VARNAME as a bash array: (-R owner/repo) or empty. Use
# "${VARNAME[@]}" at the gh call site.
provider_gh_repo_args() {
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
    # flags below take no value (the historical blind "shift 2" swallowed
    # whatever followed a valueless flag — silently corrupting the arg
    # stream, audit F019). Unknown flags fail defined instead of guessing.
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
    provider_gh_repo_args repo_args "$repo"
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
    provider_gh_repo_args repo_args "$repo"
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
    provider_gh_repo_args repo_args "$repo"
    gh issue view "$1" "${repo_args[@]}" --json number >/dev/null 2>&1
}

# List issue comments (paginated JSON).
# Usage: provider_issues_comments [repo] NUMBER
provider_issues_comments() {
    local number="$1"
    local repo=""
    if [ $# -gt 1 ] && [[ "$2" != --* ]]; then
        repo="$2"
    fi
    if [ -n "$repo" ]; then
        gh api "repos/${repo}/issues/${number}/comments" --paginate 2>/dev/null
    else
        gh api "repos/{owner}/{repo}/issues/${number}/comments" --paginate 2>/dev/null
    fi
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
    provider_gh_repo_args repo_args "$repo"
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
    provider_gh_repo_args repo_args "$repo"
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
    provider_gh_repo_args repo_args "$repo"
    gh issue close "$number" "${repo_args[@]}" "$@"
}

# Reopen an issue.
# Usage: provider_issues_reopen [repo] NUMBER
provider_issues_reopen() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh issue reopen "$1" "${repo_args[@]}"
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
    provider_gh_repo_args repo_args "$repo"
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
    provider_gh_repo_args repo_args "$1"
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
    provider_gh_repo_args repo_args "$repo"
    # Distinguish "cannot list" from "not listed": a permissions failure
    # must not masquerade as absent-label and produce a confusing create
    # failure downstream.
    local listed
    if ! listed=$(gh label list "${repo_args[@]}" --json name --jq '.[].name' 2>/dev/null); then
        log_error "provider_issues_label_ensure: cannot list labels in '${repo:-cwd repo}' — check credentials/permissions"
        return 1
    fi
    if printf '%s\n' "$listed" | grep -qx "$name"; then
        return 0
    fi
    gh label create "$name" "${repo_args[@]}" --color "$color" --description "$desc" 2>/dev/null
}
