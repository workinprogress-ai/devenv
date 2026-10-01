#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

################################################################################
# repo-reset-merge-config.sh
#
# One-time org-wide reset of merge configuration to the rebase-only policy
# (docs/Commit-Conventions.md). For every repository in the organization it
# re-applies the type ruleset and merge-method settings from the current
# tools/config surfaces, and reports repositories that need attention before
# the policy can apply cleanly (open PRs, WIP-bearing merge ranges).
#
# Usage:
#   ./repo-reset-merge-config.sh [--apply] [--all | <name>...] [--limit <n>] [--help]
#
# Options:
#   --apply            Actually apply the configuration (default is dry-run:
#                      report only, no mutations)
#   --all              Sweep every repository in the organization
#   <name>...          Restrict the run to the named repositories (positional)
#   --limit <n>        Max org repositories to scan in --all mode (default 1000)
#   --help             Show this help message
#
# Dry-run report per repository:
#   - detected repo type
#   - open PR count
#   - WIP-bearing merge ranges among open PRs (local clone required; repos
#     without a local clone under repos/ are reported as unscannable)
#
# Exit codes:
#   0 — completed (dry-run report produced, or apply finished)
#   1 — environment failure (no org identity, provider unavailable)
#
################################################################################

set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/provider-loader.bash"
# repo/org enumeration and type configuration helpers
# shellcheck source=tools/lib/repo-operations.bash
source "$DEVENV_TOOLS/lib/repo-operations.bash"
# shellcheck source=tools/lib/repo-types.bash
source "$DEVENV_TOOLS/lib/repo-types.bash"
# shellcheck source=tools/lib/git-operations.bash
source "$DEVENV_TOOLS/lib/git-operations.bash"

APPLY="false"
ALL_REPOS="false"
TARGET_REPOS=()
LIMIT="1000"

usage() {
    cat << 'EOF' >&2
Usage: repo-reset-merge-config [--apply] [--all | <name>...] [--limit <n>]

One-time reset of merge configuration to the rebase-only policy.
Default mode is dry-run (report only). --apply performs the configuration.

Target selection (exactly one of):
  --all              Sweep every repository in the organization
  <name>...          Restrict to the named repositories (positional)

Options:
  --apply            Apply the configuration (default: dry-run report only)
  --limit <n>        Max org repositories to scan in --all mode (default 1000)
  --help             Show this help message
EOF
    exit "$EXIT_GENERAL_ERROR"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply)  APPLY="true"; shift ;;
        --all)    ALL_REPOS="true"; shift ;;
        --limit)  LIMIT="$2"; shift 2 ;;
        -h|--help) usage ;;
        --*) log_error "Unknown argument: $1"; usage ;;
        *)    TARGET_REPOS+=("$1"); shift ;;
    esac
done

# Target selection: --all for the org sweep, or positional names for a subset.
if [ "$ALL_REPOS" = "true" ] && [ ${#TARGET_REPOS[@]} -gt 0 ]; then
    log_error "Choose one target mode: --all for the org sweep, or positional repo names."
    usage
fi
if [ "$ALL_REPOS" != "true" ] && [ ${#TARGET_REPOS[@]} -eq 0 ]; then
    log_error "No target selected — pass --all for the org-wide sweep, or positional repo names."
    usage
fi

# Org identity resolves through the policy layer (config → seed → provider);
# there is no GH_ORG env leg.
ORG="$(policy_org 2>/dev/null || true)"
if [ -z "$ORG" ]; then
    ORG="$(provider_org_get 2>/dev/null || true)"
fi
if [ -z "$ORG" ]; then
    log_error "No organization identity resolved (policy layer + provider). Aborting."
    exit "$EXIT_GENERAL_ERROR"
fi

MODE_LABEL="dry-run (report only)"
[ "$APPLY" = "true" ] && MODE_LABEL="APPLY"

log_info "repo-reset-merge-config — org: ${ORG} — mode: ${MODE_LABEL}"

# Named targeting (positional) bypasses org enumeration entirely:
# the requested names are the list, so unknown names surface in the per-repo
# loop as failures rather than aborting the run. --limit is an org-sweep knob.
if [ ${#TARGET_REPOS[@]} -gt 0 ]; then
    REPOS_LIST=$(printf '%s\n' "${TARGET_REPOS[@]}")
else
    REPOS_LIST="$(list_organization_repositories "$ORG" "$LIMIT")" || {
        log_error "Failed to enumerate org repositories."
        exit "$EXIT_API_FAILURE"
    }
fi

if [ -z "$REPOS_LIST" ]; then
    log_info "No repositories found in org '${ORG}'."
    exit 0
fi

REPORT_FILE="$(mktemp /tmp/repo-reset-merge-config.XXXXXX)"
trap 'rm -f "$REPORT_FILE"' EXIT

REPO_COUNT=0
ATTENTION_COUNT=0
APPLIED_COUNT=0

while IFS= read -r repo_name; do
    [ -n "$repo_name" ] || continue
    REPO_COUNT=$((REPO_COUNT + 1))
    FULL_NAME="${ORG}/${repo_name}"

    repo_type="$(detect_repo_type "$FULL_NAME" "" silent || true)"
    [ -z "$repo_type" ] && repo_type="none"

    attention=""

    # Open PR count (best-effort; provider outage should not kill the run)
    open_prs="$(provider_prs_list "$FULL_NAME" --state open --limit 100 --json number --jq 'length' 2>/dev/null || echo "?")"

    # WIP-range scan needs a local clone; report unscannable repos. Scope
    # note: this checks only the locally checked-out branch — feature
    # branches that aren't checked out are not scanned (the open-PR count
    # is the broader signal).
    LOCAL_CLONE="${DEVENV_REPOS_DIR:-$DEVENV_ROOT/repos}/${repo_name}"
    wip_note=""
    if [ -d "$LOCAL_CLONE/.git" ]; then
        default_branch="$(git -C "$LOCAL_CLONE" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
        default_branch="${default_branch:-master}"
        if wip_range_scan "${default_branch}..HEAD" >/dev/null 2>&1; then
            wip_note="clean(checked-out)"
        else
            wip_note="WIP in checked-out branch (${default_branch}..HEAD)"
            attention="yes"
        fi
    else
        wip_note="no local clone (unscanned)"
    fi

    [ "$open_prs" != "0" ] && [ "$open_prs" != "?" ] && attention="yes"

    line="${FULL_NAME}: type=${repo_type} open_prs=${open_prs} wip(checked-out)=${wip_note}"
    if [ -n "$attention" ]; then
        echo "ATTENTION ${line}" >> "$REPORT_FILE"
        ATTENTION_COUNT=$((ATTENTION_COUNT + 1))
    else
        echo "ok        ${line}" >> "$REPORT_FILE"
    fi

    if [ "$APPLY" = "true" ]; then
        if configure_rulesets_for_type "$FULL_NAME" "$repo_type" && \
           configure_merge_types_for_type "$FULL_NAME" "$repo_type"; then
            APPLIED_COUNT=$((APPLIED_COUNT + 1))
            log_info "Applied rebase-only config to ${FULL_NAME} (type: ${repo_type})"
        else
            log_warn "Failed to apply config to ${FULL_NAME} — check provider connectivity and type mapping."
        fi
    fi
done <<< "$REPOS_LIST"

echo ""
echo "=== repo-reset-merge-config report (${MODE_LABEL}) ==="
sort "$REPORT_FILE"
echo "=== end report — repos: ${REPO_COUNT}, attention: ${ATTENTION_COUNT}, applied: ${APPLIED_COUNT} ==="

if [ "$APPLY" = "false" ]; then
    log_info "Dry-run only — re-run with --apply to enforce the rebase-only policy."
fi
