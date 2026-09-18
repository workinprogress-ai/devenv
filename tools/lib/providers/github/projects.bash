#!/usr/bin/env bash
# github/projects.bash - GitHub implementation of the projects (board) domain
# facade.
#
# Project boards are GraphQL surfaces and a GitHub-only capability (AC-3):
# the module declares the project-boards capability, and every verb gates on
# it via provider_require_capability so a provider without boards degrades
# with the defined error instead of failing mid-command. Verbs per inventory:
# list / field-list / item-add (+ the workflow stages lookup project tooling
# uses). Contract: return non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_GITHUB_PROJECTS_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_GITHUB_PROJECTS_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi

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

PROVIDER_CAPABILITIES="${PROVIDER_CAPABILITIES:-}"
case " $PROVIDER_CAPABILITIES " in
    *" project-boards "*) ;;
    *) PROVIDER_CAPABILITIES="${PROVIDER_CAPABILITIES:+$PROVIDER_CAPABILITIES }project-boards" ;;
esac

# List project boards for a repo.
# Usage: provider_projects_list [repo]
provider_projects_list() {
    provider_require_capability project-boards || return 1
    local repo="$1"
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh project list "${repo_args[@]}"
}

# List a project's fields.
# Usage: provider_projects_field_list [repo] PROJECT_NUMBER
provider_projects_field_list() {
    provider_require_capability project-boards || return 1
    local repo=""
    if [ $# -gt 1 ] && [[ "$1" != --* && "$1" != ^[0-9]*$ ]]; then
        repo="$1"; shift
    fi
    local project="$1"; shift
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh project field-list "$project" "${repo_args[@]}"
}

# Add an issue to a project.
# Usage: provider_projects_item_add [repo] PROJECT_NUMBER ISSUE_URL_OR_ID
provider_projects_item_add() {
    provider_require_capability project-boards || return 1
    local repo=""
    if [ $# -gt 2 ] && [[ "$1" != --* && "$1" != ^[0-9]*$ ]]; then
        repo="$1"; shift
    fi
    local project="$1" item="$2"; shift 2
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh project item-add "$project" "${repo_args[@]}" --url "$item"
}

# Workflow stages lookup (project-update tooling dependency).
# Usage: provider_projects_workflow_stages [repo]
provider_projects_workflow_stages() {
    provider_require_capability project-boards || return 1
    local repo="$1"
    local repo_args=()
    provider_gh_repo_args repo_args "$repo"
    gh workflow list "${repo_args[@]}" --all
}
