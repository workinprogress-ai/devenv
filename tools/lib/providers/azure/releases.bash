#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Releases (tag + pipeline-artifact release unit; owner decision) and
# Artifacts feeds (org-level packaging surface).
# ---------------------------------------------------------------------------

# Self-heal the list-flags helper (canonical load order may source this
# module before urls.bash; see the sibling modules' identical guards).
if ! declare -F azure_apply_list_flags >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/urls.bash"
fi
if ! declare -F azure_git_repo_url >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repos.bash"
fi

# Publication date of one tag. The Git Refs API gives an identity-only `creator`
# (no date), so the date is looked up: the annotated-tag object's taggedBy.date
# first; for a lightweight tag (no such object) the commit's committer.date.
# Prints the date, or nothing when neither lookup yields one (never fails: the
# date is best-effort metadata).
# Usage: _azure_release_tag_date REPO_URL OBJECT_ID   (REPO_URL: azure_git_repo_url)
_azure_release_tag_date() {
    local base="$1" oid="$2" resp date
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

# List releases, newest first. The azure release unit is a git tag; the seam's
# dialect's --json fields map as: tagName <- tag name, name <- tag name,
# publishedAt <- annotated-tag taggedBy.date (lightweight tag: commit date; empty
# when unavailable — one extra request per listed tag, skipped unless the field
# is requested), isPrerelease <- a semver prerelease suffix (1.2.3-rc.1; a tag
# that is not a version is not a prerelease), isDraft <- false (azure has no
# draft tag). The refs API returns tags alphabetically and cannot sort by date,
# so every tag is fetched and ordered by version (a release above its own
# prereleases, 1.10.0 above 1.9.0) before --limit is applied.
# --json/-q follow list semantics (projection + whole-list filter).
# Usage: provider_org_releases_list REPO_OR_SPEC [SEAM-DIALECT FLAGS]
provider_org_releases_list() {
    local repo="${1:?repo required}"; shift
    local limit="30" fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --limit) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; limit="$2"; shift 2 ;;
            --json) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; fields="$2"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    local repo_url
    repo_url=$(azure_git_repo_url "$repo") || return 1
    local response
    if ! response=$(azure_http_paginate "${repo_url}/refs?filter=tags/"); then
        return 1
    fi
    # Newest first by version: numeric core, then "not a prerelease" above
    # "prerelease", then the name; tags that are no version sort last.
    local tags
    tags=$(printf '%s' "$response" | jq -c --argjson n "$limit" '
        def semver: sub("^refs/tags/v?"; "");
        def core: semver | split("-")[0] | split(".") | map(tonumber? // -1);
        def is_version: semver | test("^[0-9]+(\\.[0-9]+)*(-|$)");
        [.[] | . + {_ver: (.name | is_version)}]
        | sort_by([._ver, (.name | core), (.name | semver | contains("-") | not), .name])
        | reverse | .[0:$n]')
    # One JSON array (the seam's release list is one array; release-list's
    # table/json modes select with .[] over it).
    # Dates cost one lookup per tag (see _azure_release_tag_date): only when the
    # caller can see the field (no --json projection, or one naming publishedAt).
    local dates='{}' ref_name ref_oid ref_date
    if [ -z "$fields" ] || [[ ",${fields}," == *",publishedAt,"* ]]; then
        while IFS=$'\t' read -r ref_name ref_oid; do
            [ -n "$ref_name" ] && [ -n "$ref_oid" ] || continue
            ref_date=$(_azure_release_tag_date "$repo_url" "$ref_oid")
            [ -n "$ref_date" ] || continue
            dates=$(jq -c --arg n "$ref_name" --arg d "$ref_date" '. + {($n): $d}' <<<"$dates")
        done < <(printf '%s' "$tags" | jq -r '.[] | [.name, (.objectId // "")] | @tsv')
    fi
    local mapped
    mapped=$(printf '%s' "$tags" | jq -c --argjson dates "$dates" '[.[] | {
        tagName: (.name | sub("^refs/tags/"; "")),
        name: (.name | sub("^refs/tags/"; "")),
        publishedAt: ($dates[.name] // ""),
        isPrerelease: ((.name | sub("^refs/tags/"; "")) | test("^v?[0-9]+(\\.[0-9]+)*-[0-9A-Za-z]")),
        isDraft: false
    }]')
    azure_apply_list_flags "$mapped" "$fields" "$jq_expr"
}

# List org-level Artifacts feeds (the packaging surface). GitHub Packages is
# per-user; azure feeds are org-scoped — the mapping documents the
# difference (MAPPING.md packaging section).
# Usage: provider_org_feeds_list
provider_org_feeds_list() {
    [ $# -eq 0 ] || { provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1; }
    local op
    op=$(azure_org_project) || return 1
    local org
    org=$(printf '%s' "$op" | sed -n 1p)
    local response
    if ! response=$(azure_http_request GET "https://feeds.dev.azure.com/$(azure_uri "$org")/_apis/packaging/feeds?api-version=7.1-preview.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -c '[.value[] | {name: .name, id: .id, url: .url}]'
}
