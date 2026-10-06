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

# Publication date of one tag. The Git Refs API gives an identity-only `creator`
# (no date), so the date is looked up: the annotated-tag object's taggedBy.date
# first; for a lightweight tag (no such object) the commit's committer.date.
# Prints the date, or nothing when neither lookup yields one (never fails: the
# date is best-effort metadata).
# Usage: _azure_release_tag_date ORG PROJECT REPO OBJECT_ID
_azure_release_tag_date() {
    local org="$1" project="$2" repo="$3" oid="$4" resp date
    local base="https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}"
    if resp=$(azure_http_request GET "${base}/annotatedtags/${oid}?api-version=7.1" 2>/dev/null); then
        date=$(printf '%s' "$resp" | jq -r '.taggedBy.date // empty' 2>/dev/null)
        if [ -n "$date" ]; then printf '%s' "$date"; return 0; fi
    fi
    if resp=$(azure_http_request GET "${base}/commits/${oid}?api-version=7.1" 2>/dev/null); then
        date=$(printf '%s' "$resp" | jq -r '.committer.date // empty' 2>/dev/null)
        [ -n "$date" ] && printf '%s' "$date"
    fi
    return 0
}

# List releases. The azure release unit is a git tag; the GH dialect's
# --json fields map as: tagName <- tag name, name <- tag name,
# publishedAt <- annotated-tag taggedBy.date (lightweight tag: commit date; empty
# when unavailable — one extra request per tag, skipped unless the field is
# requested), isPrerelease <-
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
    # Dates cost one lookup per tag (see _azure_release_tag_date): only when the
    # caller can see the field (no --json projection, or one naming publishedAt).
    local dates='{}' ref_name ref_oid ref_date
    if [ -z "$fields" ] || [[ ",${fields}," == *",publishedAt,"* ]]; then
        while IFS=$'\t' read -r ref_name ref_oid; do
            [ -n "$ref_name" ] && [ -n "$ref_oid" ] || continue
            ref_date=$(_azure_release_tag_date "$org" "$project" "$repo_name" "$ref_oid")
            [ -n "$ref_date" ] || continue
            dates=$(jq -c --arg n "$ref_name" --arg d "$ref_date" '. + {($n): $d}' <<<"$dates")
        done < <(printf '%s' "$response" | jq -r '.value[] | [.name, (.objectId // "")] | @tsv')
    fi
    local mapped
    mapped=$(printf '%s' "$response" | jq -c --argjson dates "$dates" '[.value[] | {
        tagName: (.name | sub("^refs/tags/"; "")),
        name: (.name | sub("^refs/tags/"; "")),
        publishedAt: ($dates[.name] // ""),
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
