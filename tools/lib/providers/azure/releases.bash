#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Releases (tag + pipeline-artifact release unit; owner decision) and
# Artifacts feeds (org-level packaging surface).
# ---------------------------------------------------------------------------

# Self-heal the list-flags helper (canonical load order may source this
# module before urls.bash; see the sibling modules' identical guards).
if ! declare -F azure_apply_gh_list_flags >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/urls.bash"
fi

# List releases. The azure release unit is a git tag; the GH dialect's
# --json fields map as: tagName <- tag name, name <- tag name,
# publishedAt <- tagger date (commit date fallback), isPrerelease <-
# semver-prerelease heuristic, isDraft <- false (azure has no draft tag).
# --json/-q follow gh list semantics (projection + whole-list filter).
# Usage: provider_org_releases_list REPO_OR_SPEC [GH-DIALECT FLAGS]
provider_org_releases_list() {
    local repo="${1:?repo required}"; shift
    local limit="30" fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --limit) limit="$2"; shift 2 ;;
            --json) fields="$2"; shift 2 ;;
            -q|--jq) jq_expr="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    local op org project repo_name
    op=$(azure_org_project) || return 1
    org=$(printf '%s' "$op" | sed -n 1p); project=$(printf '%s' "$op" | sed -n 2p)
    repo_name="${repo##*/}"
    local response
    if ! response=$(azure_http_request GET "https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo_name}/refs?filter=tags/&\$top=${limit}&api-version=7.1"); then
        return 1
    fi
    # One JSON array (gh release list --json emits an array; release-list's
    # table/json modes select with .[] over it).
    local mapped
    mapped=$(printf '%s' "$response" | jq -c '[.value[] | {
        tagName: (.name | sub("^refs/tags/"; "")),
        name: (.name | sub("^refs/tags/"; "")),
        publishedAt: (.creator.date // ""),
        isPrerelease: ((.name | sub("^refs/tags/"; "")) | test("-[0-9A-Za-z.]+")),
        isDraft: false
    }]')
    azure_apply_gh_list_flags "$mapped" "$fields" "$jq_expr"
}

# List org-level Artifacts feeds (the packaging surface). GH Packages is
# per-user; azure feeds are org-scoped — the mapping documents the
# difference (MAPPING.md packaging section).
# Usage: provider_org_feeds_list [FLAGS]
provider_org_feeds_list() {
    local op
    op=$(azure_org_project) || return 1
    local org
    org=$(printf '%s' "$op" | sed -n 1p)
    local response
    if ! response=$(azure_http_request GET "https://feeds.dev.azure.com/${org}/_apis/packaging/feeds?api-version=7.1-preview.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -c '[.value[] | {name: .name, id: .id, url: .url}]'
}
