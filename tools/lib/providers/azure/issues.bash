#!/bin/bash
# azure/issues.bash - Azure DevOps implementation of the issues domain verbs.
#
# Maps the issue seam onto Azure Boards work items. Verbs mirror the seam
# flag contracts callers use (parity per the plan's grep-derived list):
# list/view/exists/comments/create/comment/close/reopen/edit plus
# label_list/label_ensure (Azure tags stand in for labels) and milestones
# (Azure iterations, config-mapped — no milestone API parity claimed).
#
# Work-item mapping:
#   number            -> work item id
#   state open/closed -> every state but Closed/Removed/Done is open (Resolved
#                        is still open); close and reopen resolve the target
#                        state from the item's own type and its state categories
#   labels            -> System.Tags ("a; b", trimmed on read)
#   title/body        -> System.Title / System.Description (stored as markdown)
#   type              -> the Azure work item type for the devenv type
#                        (azure_work_item_type_for: Epic/Feature/Bug native,
#                        Task and untyped -> User Story)
#
# Transport: azure_http_request / azure_http_paginate. Contract: return
# non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_ISSUES_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_ISSUES_LOADED=1

# Capability: this module maps the issue seam onto Azure Boards work items,
# including native work-item types (issue-type queries resolve through
# provider_org_issue_types below).
if declare -F provider_declare_capability >/dev/null; then
    provider_declare_capability native-issue-types
fi

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi
if ! declare -F azure_http_request >/dev/null; then
    # Self-heal: the canonical loader (provider-load order) may source this
    # module before http.bash; source the transport ourselves instead of
    # failing, so module order never matters.
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/http.bash"
fi
if ! declare -F azure_apply_list_flags >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/urls.bash"
fi
if ! declare -F azure_repo_flag_spec >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/repo-flag.bash"
fi
if ! declare -F azure_http_request >/dev/null; then
    log_error "azure/issues.bash: providers/azure/http.bash failed to load"
    return 1
fi

# Work-item comments are a preview resource: the API rejects the stable
# 7.1 version and requires a pinned -preview api-version on the URL.
# 7.2-preview.4 is required for the comment `format` attribute: create/edit
# take `?format=markdown` as a QUERY parameter (a body `format` field is
# silently ignored), which stores the comment as real markdown — the portal
# renders it via renderedText. Without it the portal shows raw markdown as
# unrendered text.
readonly AZURE_COMMENTS_API_VERSION="7.2-preview.4"

# Project-scoped WIQL API path for the configured org/project.
azure_wit_base() {
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    printf 'https://dev.azure.com/%s/%s/_apis/wit' "$(azure_uri "$org")" "$(azure_uri "$project")"
}

# Long-text fields (comment text, System.Description) come back entity-encoded
# when the store holds them as HTML — a comment posted without ?format=markdown,
# or a description written without the markdown multiline format (quotes become
# &quot; etc., verified live) — plus one trailing newline the store appends.
# Descriptions written here carry the markdown multiline format; the read paths
# still un-escape entities (azure_text_decode) so items last edited in the
# portal, whose descriptions are HTML, read back as text too. A description the
# store reports as markdown (multilineFieldsFormat) is raw text and is not decoded.
# Command-substitution capture strips the trailing newline on read, and the
# write paths pre-trim one trailing newline (azure_text_normalize) — the pairing
# keeps round trips byte-stable without per-read newline surgery.
# jq program for the decode — defined once as a constant; the single-quoted
# body needs no shell-quote gymnastics at call sites.
# shellcheck disable=SC2016  # intentional: jq program, not shell expansion
AZURE_TEXT_DECODE_JQ='gsub("&quot;"; "\u0022")
| gsub("&apos;"; "\u0027")
| gsub("&#39;"; "\u0027")
| gsub("&lt;"; "\u003c")
| gsub("&gt;"; "\u003e")
| gsub("&amp;"; "\u0026")'

# Batch variant: decode bodies across an array of mapped items.
# shellcheck disable=SC2016
AZURE_DECODE_BATCH_JQ='map(
    (.markdown // false) as $md
    | del(.markdown)
    | .body |= (
        @base64d
        | if $md then . else
            gsub("&quot;"; "\u0022")
            | gsub("&apos;"; "\u0027")
            | gsub("&#39;"; "\u0027")
            | gsub("&lt;"; "\u003c")
            | gsub("&gt;"; "\u003e")
            | gsub("&amp;"; "\u0026")
          end
    ))'

# Comment variant: decode comment bodies AND rtim one trailing newline
# (comments keep their own trailing-newline contract, distinct from items).
# shellcheck disable=SC2016
AZURE_COMMENT_DECODE_JQ='map(.body |= (
    @base64d
    | gsub("&quot;"; "\u0022")
    | gsub("&apos;"; "\u0027")
    | gsub("&#39;"; "\u0027")
    | gsub("&lt;"; "\u003c")
    | gsub("&gt;"; "\u003e")
    | gsub("&amp;"; "\u0026")
    | if endswith("\n") then .[0:-1] else . end
))'
# Usage: azure_text_decode <<< html-ish text -> markdown on stdout
azure_text_decode() {
    # jq port of html.unescape over the entity set Azure actually emits
    # (&quot; &amp; &lt; &gt; &apos;/&#39; + numeric refs) — no python3
    # dependency. &amp; decodes LAST so &quot; never double-decodes to &.
    jq -rR "$AZURE_TEXT_DECODE_JQ"
}
# Normalize text for storage: drop ONE trailing newline (the store re-adds
# it), keeping interior formatting untouched. Must pair with decode on read.
# Usage: azure_text_normalize TEXT -> normalized text on stdout
azure_text_normalize() {
    printf '%s' "$1" | jq -rR 'if endswith("\n") then .[0:-1] else . end'
}

# Tag handling. System.Tags is one string, "a; b" as Azure returns it (a space
# after each separator); every read trims each tag, and writes join with "; ".
# Usage: azure_tags_split STRING -> JSON array of trimmed, non-empty tags
azure_tags_split() {
    # --arg, not stdin: jq -R emits nothing at all for empty input, which would
    # turn "no tags yet" into an empty value that a write then silently drops.
    jq -nc --arg s "${1:-}" '[$s | split(";")[] | gsub("^\\s+|\\s+$"; "") | select(length > 0)]'
}
# Usage: azure_tags_join JSON_ARRAY -> "a; b"
azure_tags_join() {
    printf '%s' "$1" | jq -r 'join("; ")'
}
# jq definition shared by the mapped-record programs: the same trim on read.
# shellcheck disable=SC2016  # intentional: jq program, not shell expansion
AZURE_TAGS_JQ_DEF='def azure_tags: (. // "") | [split(";")[] | gsub("^\\s+|\\s+$"; "") | select(length > 0)];'

# POST/GET one chunk size at a time: workitemsbatch accepts at most 200 ids.
readonly AZURE_BATCH_MAX=200

# Fetch work items by id, 200 per request. Emits {"value":[...]} with the items
# in id-list order.
# Usage: azure_workitems_batch BASE IDS_JSON_ARRAY
azure_workitems_batch() {
    local base="$1" ids="$2"
    local total offset=0 chunk resp
    local -a pages=()
    total=$(printf '%s' "$ids" | jq 'length')
    while [ "$offset" -lt "$total" ]; do
        chunk=$(printf '%s' "$ids" | jq -c --argjson o "$offset" --argjson n "$AZURE_BATCH_MAX" '{ids: .[$o:($o + $n)], "$expand": "fields"}')
        resp=$(azure_http_request POST "$base/workitemsbatch" "$chunk" application/json idempotent) || return 1
        pages+=("$resp")
        offset=$((offset + AZURE_BATCH_MAX))
    done
    if [ "${#pages[@]}" -eq 0 ]; then
        printf '{"value":[]}'
        return 0
    fi
    printf '%s\n' "${pages[@]}" | jq -sc '{value: (map(.value // []) | add)}'
}

# Map a devenv issue type onto the Azure work item type. The built-in map puts
# Epic, Feature and Bug on their own types and Task (and an untyped issue) on
# User Story, so every item lands on a board; a [azure_issue_types] block in
# devenv.config overrides or extends it (<devenv type, lower-case>=<Azure type>).
# Usage: azure_work_item_type_for TYPE -> prints the Azure type name
azure_work_item_type_for() {
    local type="${1:-}" key mapped=""
    key=$(printf '%s' "$type" | tr '[:upper:]' '[:lower:]')
    [ -z "$key" ] || mapped=$(azure_config_get azure_issue_types "$key")
    if [ -z "$mapped" ]; then
        case "$key" in
            epic) mapped="Epic" ;;
            feature) mapped="Feature" ;;
            bug) mapped="Bug" ;;
            task|"") mapped="User Story" ;;
            *)
                log_error "azure_work_item_type_for: no Azure work item type is mapped for '$type' — add '${key}=<Azure type>' under [azure_issue_types] in devenv.config"
                return 1
                ;;
        esac
    fi
    printf '%s' "$mapped"
}

# The work item's own type (System.WorkItemType).
# Usage: azure_work_item_type NUMBER -> prints the type name
azure_work_item_type() {
    local number="$1" base response type
    base=$(azure_wit_base) || return 1
    response=$(azure_http_request GET "$base/workitems/$number?\$fields=System.WorkItemType&api-version=7.1") || return 1
    type=$(printf '%s' "$response" | jq -r '.fields["System.WorkItemType"] // empty')
    [ -n "$type" ] || { log_error "azure_work_item_type: work item $number has no readable type"; return 1; }
    printf '%s' "$type"
}

# The first state of a work item type whose category is one of CATEGORIES
# (tried in the order given; matched case-insensitively — Azure names them
# Proposed, InProgress, Resolved, Completed, Removed).
# Usage: azure_state_by_category TYPE CATEGORY... -> prints the state name
azure_state_by_category() {
    local type="$1"; shift
    local op org project states cat state
    op=$(azure_org_project) || return 1
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    states=$(azure_http_request GET "https://dev.azure.com/$(azure_uri "$org")/$(azure_uri "$project")/_apis/wit/workitemtypes/$(azure_uri "$type")/states?api-version=7.1") || return 1
    for cat in "$@"; do
        state=$(printf '%s' "$states" | jq -r --arg c "$cat" '[.value[] | select((.category | ascii_downcase) == ($c | ascii_downcase)) | .name][0] // empty')
        if [ -n "$state" ]; then
            printf '%s' "$state"
            return 0
        fi
    done
    log_error "azure_state_by_category: type '$type' has no state in category $*"
    return 1
}

# All comments of a work item, following the continuation token.
# Usage: azure_work_item_comments_all NUMBER -> JSON array of comment objects
azure_work_item_comments_all() {
    local number="$1" base url token="" response
    base=$(azure_wit_base) || return 1
    local -a pages=()
    while :; do
        url="$base/workitems/$number/comments?\$top=200&api-version=${AZURE_COMMENTS_API_VERSION}"
        [ -n "$token" ] && url="${url}&continuationToken=$(jq -rn --arg t "$token" '$t|@uri')"
        response=$(azure_http_request GET "$url") || return 1
        pages+=("$(printf '%s' "$response" | jq -c '.comments // []')")
        token=$(printf '%s' "$response" | jq -r '.continuationToken // empty')
        [ -n "$token" ] || break
    done
    printf '%s\n' "${pages[@]}" | jq -sc 'add'
}

# Web UI base for a work item's page (comments anchor included by callers).
azure_web_items_base() {
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    printf 'https://dev.azure.com/%s/%s/_workitems/edit/' "$(azure_uri "$org")" "$(azure_uri "$project")"
}

# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

# List issues (work items) via WIQL. Supports the seam's valued flags:
# --state (open/closed/all), --label (tag contains), --type (work-item
# type: Bug/Feature/Task/Epic), --milestone (documented degrade), --limit,
# --json FIELDS, -q/--jq J (list semantics).
# Output: one JSON array of seam-shaped objects.
# Usage: provider_issues_list [repo] [--state S] [--label L] [--type T] [FLAGS]
provider_issues_list() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != -* ]]; then
        repo="$1"; shift   # work items are project-wide: the repo is not a filter here
    fi
    local state="open" label="" type="" limit="200"
    local json_fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --state) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; state="$2"; shift 2 ;;
            --label) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; label="$2"; shift 2 ;;
            --type) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; type="$2"; shift 2 ;;
            --limit) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; provider_need_count "${FUNCNAME[0]}" "$1" "$2" || return 1; limit="$2"; shift 2 ;;
            --json) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; json_fields="$2"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done

    local state_filter=""
    case "$state" in
        open) state_filter="AND [System.State] NOT IN ('Closed','Removed','Done')" ;;
        closed) state_filter="AND [System.State] IN ('Closed','Removed','Done')" ;;
        all) : ;;
        *) log_error "provider_issues_list: --state must be open, closed or all, got '$state'"; return 1 ;;
    esac
    local label_filter=""
    [ -n "$label" ] && label_filter="@@LABEL@@"
    local type_filter=""
    if [ -n "$type" ]; then
        type=$(azure_work_item_type_for "$type") || return 1
        type_filter="@@TYPE@@"
    fi

    # jq composes the query string: the label/type values ride as --arg
    # variables substituted INSIDE the jq program (WIQL single quotes are
    # doubled per the WIQL escape rule), so a label containing a quote
    # cannot break out of the literal — shell-level interpolation into the
    # query string is how that class of breakage happened.
    # NOTE: the arg names avoid `label` — a reserved word in jq 1.6's
    # grammar ($label is a syntax error there); $ARGS.named reads them.
    local wiql
    # `-n`: the program's data comes from --arg q — jq with no input
    # redirect would block reading stdin (hangs under bats). The program
    # reads $q (the --arg), not `.q` (null input has no fields).
    wiql=$(jq -cn \
        --arg lbl "$label" \
        --arg typ "$type" \
        --arg q "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project $state_filter $label_filter $type_filter ORDER BY [System.Id] DESC" \
        'def q2: "\u0027";
         def wiql_str: gsub("\u0027"; "\u0027\u0027");
         def lbl: $ARGS.named.lbl // "";
         def typ: $ARGS.named.typ // "";
         $q
         | sub("@@LABEL@@"; if lbl != "" then "AND [System.Tags] CONTAINS " + q2 + (lbl | wiql_str) + q2 else "" end)
         | sub("@@TYPE@@"; if typ != "" then "AND [System.WorkItemType] = " + q2 + (typ | wiql_str) + q2 else "" end)
         | {query: .}')

    local base
    base=$(azure_wit_base) || return 1
    local ids_response
    if ! ids_response=$(azure_http_request POST "$base/wiql" "$wiql" application/json idempotent); then
        return 1
    fi
    local ids_json
    ids_json=$(printf '%s' "$ids_response" | jq -c --argjson n "$limit" '[.workItems[].id] | .[0:$n]') || return 1
    if [ -z "$ids_json" ] || [ "$ids_json" = "[]" ]; then
        # Empty result still honors the caller's -q program (list semantics:
        # '.[0].x' over [] is empty output, not an error).
        azure_apply_list_flags '[]' "$json_fields" "$jq_expr"
        return $?
    fi

    # Batch-fetch the identified work items, 200 ids per request (the endpoint's
    # cap). The id list rides jq as numbers, never a string interpolation.
    local details
    if ! details=$(azure_workitems_batch "$base" "$ids_json"); then
        return 1
    fi

    # One JSON array on stdout (the shared issue-list wrapper selects with
    # .[] over the whole output; NDJSON lines would truncate that select).
    # The record carries the seam-dialect field set wrappers project with
    # --json (body included — issue-search matches on it); description is
    # entity-encoded html, carried base64 so jq never mangles it, decoded
    # once per record here.
    local enriched
    enriched=$(printf '%s' "$details" | jq -c "$AZURE_TAGS_JQ_DEF"'[.value[] | {
        number: .id,
        title: (.fields["System.Title"] // ""),
        state: (if (.fields["System.State"] == "Closed" or .fields["System.State"] == "Removed" or .fields["System.State"] == "Done") then "CLOSED" else "OPEN" end),
        labels: (.fields["System.Tags"] | azure_tags | map({name: .})),
        body: ((.fields["System.Description"] // "") | @base64),
        markdown: ((.multilineFieldsFormat["System.Description"] // "") == "markdown"),
        url: ((.url // "") ),
        createdAt: (.fields["System.CreatedDate"] // ""),
        updatedAt: (.fields["System.ChangedDate"] // ""),
        closedAt: (.fields["Microsoft.VSTS.Common.ClosedDate"] // ""),
        author: {login: (.fields["System.CreatedBy"].displayName // "unknown")},
        assignees: (if (.fields["System.AssignedTo"] == null) then [] else [{login: (.fields["System.AssignedTo"].displayName // "unknown")}] end),
        milestone: (.fields["System.IterationLevel2"] // "" | if . == "" then "" else {title: .} end)
    }]')
    if [ -z "$enriched" ] || [ "$enriched" = "null" ]; then
        enriched='[]'
    fi
    local decoded
    # jq port: base64-decode each body, then unescape over the Azure entity
    # set (same program as azure_text_decode; &amp; last). @base64d tolerates
    # the padded payloads Azure emits; the decode order prevents
    # double-unescape.
    decoded=$(printf '%s' "$enriched" | jq -c "$AZURE_DECODE_BATCH_JQ") || return 1
    [ -n "$decoded" ] || decoded='[]'
    azure_apply_list_flags "$decoded" "$json_fields" "$jq_expr"
}

# View a single issue. Mirrors the seam's --json field projection and -q/--jq
# filter: --json FIELDS emits the subset object, -q EXPR applies the jq
# program to the mapped record (a scalar for .field programs). Without
# projection flags the full mapped object is emitted.
# Usage: provider_issues_view [repo] NUMBER [--json FIELDS] [-q EXPR]
provider_issues_view() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    [ -n "$number" ] || { log_error "provider_issues_view requires an issue number"; return 1; }

    local fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --json) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; fields="$2"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done

    local base
    base=$(azure_wit_base) || return 1
    local response
    if ! response=$(azure_http_request GET "$base/workitems/$number"); then
        return 1
    fi

    # The description passes through the markdown restore (the store
    # entity-encodes long text and appends one trailing newline).
    local decoded_desc
    # Stored markdown is raw text: only a description held as HTML is entity-decoded,
    # so a body that literally contains "&lt;" survives a read and a write back.
    if [ "$(printf '%s' "$response" | jq -r '(.multilineFieldsFormat["System.Description"] // "") == "markdown"')" = "true" ]; then
        decoded_desc=$(printf '%s' "$response" | jq -r '.fields["System.Description"] // ""')
    else
        decoded_desc=$(printf '%s' "$response" | jq -r '.fields["System.Description"] // ""' | azure_text_decode)
    fi
    # The decoded text must also be the mapped body: consumers feed
    # view --json body -q .body straight back into edit --body-file.
    local mapped_body
    mapped_body=$(printf '%s' "$decoded_desc" | jq -Rs '.')
    local mapped
    # Projection contract: every field in issue-get's DEFAULT_FIELDS
    # (number,title,body,state,labels,assignees,milestone,author,createdAt,
    # updatedAt,closedAt,url,comments) must be present and non-null —
    # absent Azure data maps to typed empties ([] / ""), never null.
    # comments: count lives on the threads resource; without a supplementary
    # call the typed empty [] is emitted (documented in MAPPING.md).
    mapped=$(printf '%s' "$response" | jq -c --argjson body "$mapped_body" --argjson wid "$number" --arg web "$(azure_web_items_base)" "$AZURE_TAGS_JQ_DEF"'{
        number: .id,
        title: (.fields["System.Title"] // ""),
        state: (if (.fields["System.State"] == "Closed" or .fields["System.State"] == "Removed" or .fields["System.State"] == "Done") then "CLOSED" else "OPEN" end),
        body: $body,
        labels: (.fields["System.Tags"] | azure_tags | map({name: .})),
        assignees: (if (.fields["System.AssignedTo"] == null) then [] else [{login: (.fields["System.AssignedTo"].displayName // "unknown")}] end),
        milestone: (.fields["System.IterationLevel2"] // "" | if . == "" then "" else {title: .} end),
        author: {login: (.fields["System.CreatedBy"].displayName // "unknown")},
        createdAt: (.fields["System.CreatedDate"] // ""),
        updatedAt: (.fields["System.ChangedDate"] // ""),
        closedAt: (.fields["Microsoft.VSTS.Common.ClosedDate"] // ""),
        url: ($web + ($wid | tostring)),
        comments: []
    }')

    if [ -n "$jq_expr" ]; then
        printf '%s' "$mapped" | azure_jq_query "$jq_expr"
        return 0
    fi
    if [ -n "$fields" ]; then
        azure_json_fields_check "${FUNCNAME[0]}" "$fields" "$mapped" || return 1
        printf '%s' "$mapped" | jq -c "{${fields}}"
        return 0
    fi
    printf '%s\n' "$mapped"
}

# Check an issue exists (presence test; no output).
# Usage: provider_issues_exists [repo] NUMBER
provider_issues_exists() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"
    local base
    base=$(azure_wit_base) || return 1
    azure_http_request GET "$base/workitems/$number" >/dev/null 2>&1
}

# List issue comments. Azure work-item comments live under the comments API.
# Usage: provider_issues_comments REPO NUMBER   (REPO may be "")
provider_issues_comments() {
    local repo="${1-}" number="${2:?issue number required}"
    local comments
    comments=$(azure_work_item_comments_all "$number") || return 1
    # Raw REST comment shape: {id, url, user: {login}, body,
    # created_at, updated_at} — the shared formatter (and every seam-dialect
    # consumer) projects these names. id is the opaque comment ref
    # (<issue>/<comment>) — the exact token issue-comment-update and the
    # get/edit verbs accept. Bodies pass through the markdown restore below
    # (the store entity-encodes text and appends one trailing newline;
    # base64 carries bodies through jq safely). Azure comment objects carry
    # no html link (verified live): the web URL is constructed.
    printf '%s' "$comments" \
        | jq -c --arg web "$(azure_web_items_base)" '[.[] | {
            id: ((.workItemId | tostring) + "/" + (.id | tostring)),
            url: ($web + (.workItemId | tostring) + "?_a=comments"),
            user: {login: (.createdBy.displayName // "unknown")},
            body: (.text | @base64),
            created_at: .createdDate,
            updated_at: (.modifiedDate // .createdDate)
        }] | .[]' \
        | jq -cs "$AZURE_COMMENT_DECODE_JQ"
}

# ---------------------------------------------------------------------------
# Comment + label contract verbs (call sites use these instead of raw REST)
# ---------------------------------------------------------------------------

# Split an opaque comment ref into work item + comment id. Refs come from
# provider_issues_comments / comment_add output ("<issue>/<comment>"); a
# bare number is rejected with guidance so callers never guess scope.
# Usage: azure_split_comment_ref REF -> sets _AZ_WI and _AZ_CID
azure_split_comment_ref() {
    local ref="${1:?comment ref required}"
    case "$ref" in
        *[!0-9/]* | "" | */*/*)
            log_error "azure comment ref '$ref' is malformed — take the id from issue-comment-list output"
            return 1
            ;;
        */*)
            _AZ_WI="${ref%/*}"; _AZ_CID="${ref#*/}"
            ;;
        *)
            log_error "azure comment ids are scoped per work item — use the '<issue>/<comment>' ref from issue-comment-list"
            return 1
            ;;
    esac
}

# Fetch one work-item comment as seam-shaped JSON ({id, url, body}).
# COMMENT_REF is the provider-opaque id (issue/comment composite).
# Usage: provider_issues_comment_get [repo] COMMENT_REF
provider_issues_comment_get() {
    local repo="${1-}"
    [ $# -gt 0 ] && shift
    local ref="$1"; shift
    [ $# -eq 0 ] || { provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1; }
    local number comment_id
    azure_split_comment_ref "$ref" || return 1
    number="$_AZ_WI"; comment_id="$_AZ_CID"
    local base web
    base=$(azure_wit_base) || return 1
    web=$(azure_web_items_base) || return 1
    local comments
    comments=$(azure_work_item_comments_all "$number") || return 1
    # body decoded through the shared restore so callers read markdown, not
    # the store's entity-encoded form; the mapped object is emitted (github's
    # comment_get passes the JSON through — a missing comment is the empty
    # output the caller fails on).
    local mapped
    mapped=$(printf '%s' "$comments" | jq -c --argjson id "$comment_id" --arg web "$web" '
        [.[] | select(.id == $id) | {
            id: ((.workItemId | tostring) + "/" + (.id | tostring)),
            url: ($web + (.workItemId | tostring) + "?_a=comments"),
            body: (.text | @base64)
        }]') || return 1
    [ -n "$mapped" ] && [ "$mapped" != "[]" ] || return 1
    printf '%s' "$mapped" | jq -c "$AZURE_COMMENT_DECODE_JQ" | jq -c '.[0]'
}

# Replace a comment's body; emits seam-shaped JSON ({id, url}).
# COMMENT_REF is the provider-opaque id.
# Usage: provider_issues_comment_edit [repo] COMMENT_REF --body TEXT
provider_issues_comment_edit() {
    local repo="${1-}"
    [ $# -gt 0 ] && shift
    local ref="$1"; shift
    local number comment_id
    azure_split_comment_ref "$ref" || return 1
    number="$_AZ_WI"; comment_id="$_AZ_CID"
    local body=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body="$2"; shift 2 ;;
            --body-file) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body=$(cat "$2"); shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    [ -n "$body" ] || { log_error "provider_issues_comment_edit requires --body"; return 1; }
    local base web
    base=$(azure_wit_base) || return 1
    web=$(azure_web_items_base) || return 1
    local payload
    payload=$(jq -n --arg t "$(azure_text_normalize "$body")" '{text: $t}')
    local response
    if ! response=$(azure_http_request PATCH "$base/workitems/$number/comments/$comment_id?format=markdown&api-version=${AZURE_COMMENTS_API_VERSION}" "$payload"); then
        return 1
    fi
    printf '%s' "$response" | jq -c --arg web "$web" '{
        id: ((.workItemId | tostring) + "/" + (.id | tostring)),
        url: ($web + (.workItemId | tostring) + "?_a=comments")
    }'
}

# Create a comment on a work item; emits seam-shaped JSON ({id, url}) —
# unlike provider_issues_comment, which emits the bare id.
# Usage: provider_issues_comment_add [repo] ISSUE_NUMBER --body TEXT
provider_issues_comment_add() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
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
    local base web
    base=$(azure_wit_base) || return 1
    web=$(azure_web_items_base) || return 1
    local payload
    payload=$(jq -n --arg t "$(azure_text_normalize "$body")" '{text: $t}')
    local response
    if ! response=$(azure_http_request POST "$base/workitems/$number/comments?format=markdown&api-version=${AZURE_COMMENTS_API_VERSION}" "$payload"); then
        return 1
    fi
    printf '%s' "$response" | jq -c --arg web "$web" '{
        id: ((.workItemId | tostring) + "/" + (.id | tostring)),
        url: ($web + (.workItemId | tostring) + "?_a=comments")
    }'
}

# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

# Create an issue (work item). The Azure work item type is the mapped type of
# --type (azure_work_item_type_for; Task and untyped -> User Story), so the item
# is born on a board. The description is written with the markdown multiline
# format.
# Usage: provider_issues_create [repo] --title T [--body B] [--label L]... [--type T]
provider_issues_create() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local title="" body="" type=""
    local -a labels=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --title) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; title="$2"; shift 2 ;;
            --body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body="$2"; shift 2 ;;
            --body-file) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body=$(cat "$2"); shift 2 ;;
            --label) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; labels+=("$2"); shift 2 ;;
            --type) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; type="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    [ -n "$title" ] || { log_error "provider_issues_create requires --title"; return 1; }

    local wit_type
    wit_type=$(azure_work_item_type_for "$type") || return 1

    local tags=""
    if [ "${#labels[@]}" -gt 0 ]; then
        tags=$(azure_tags_join "$(printf '%s\n' "${labels[@]}" | jq -Rsc 'split("\n") | map(select(length > 0))')")
    fi

    # jq builds every patch op: user text (title/body/tags) never sits in a
    # JSON string literal, so quotes/backslashes cannot break the document.
    local -a ops=()
    ops+=("$(jq -cn --arg v "$title" '{op:"add",path:"/fields/System.Title",from:null,value:$v}')")
    if [ -n "$body" ]; then
        # normalize: drop one trailing newline (the store re-adds it) so a
        # write->read cycle is byte-stable
        local desc_val
        desc_val=$(azure_text_normalize "$body")
        ops+=("$(jq -cn --arg v "$desc_val" '{op:"add",path:"/fields/System.Description",from:null,value:$v}')")
        ops+=('{"op":"add","path":"/multilineFieldsFormat/System.Description","value":"markdown"}')
    fi
    [ -n "$tags" ] && ops+=("$(jq -cn --arg v "$tags" '{op:"add",path:"/fields/System.Tags",from:null,value:$v}')")

    local patch_body
    patch_body=$(printf '%s\n' "${ops[@]}" | jq -s '.')

    local base
    base=$(azure_wit_base) || return 1
    local response
    # Work-item APIs require the JSON-Patch content type; the type rides the
    # URL path (a work-item type name, percent-encoded: "User Story").
    if ! response=$(azure_http_request POST "$base/workitems/\$$(azure_uri "$wit_type")" "$patch_body" "application/json-patch+json"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.id'
}

# Comment on an issue (work-item comment).
# Usage: provider_issues_comment [repo] NUMBER [--body TEXT | --body-file FILE]
provider_issues_comment() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local text=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; text="$2"; shift 2 ;;
            --body-file) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; text=$(cat "$2"); shift 2 ;;
            --comment-body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; text="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    [ -n "$text" ] || { log_error "provider_issues_comment requires --body"; return 1; }

    local base
    base=$(azure_wit_base) || return 1
    local body
    body=$(jq -n --arg t "$text" '{text: $t}')
    local response
    if ! response=$(azure_http_request POST "$base/workitems/$number/comments?format=markdown&api-version=${AZURE_COMMENTS_API_VERSION}" "$body"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.id'
}

# Close an issue: move it to the Completed-category state of its own type
# (Closed on User Story, Bug, Feature and Epic; Closed on an Issue; Done on a
# Basic-process Issue). --comment is posted first. Azure has no close reason, so
# --reason is accepted and dropped.
# Usage: provider_issues_close [repo] NUMBER [--reason R] [--comment TEXT]
provider_issues_close() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local comment=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --comment) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; comment="$2"; shift 2 ;;
            --reason) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    local type closed_state
    type=$(azure_work_item_type "$number") || return 1
    closed_state=$(azure_state_by_category "$type" Completed) || return 1
    if [ -n "$comment" ]; then
        provider_issues_comment "$repo" "$number" --comment-body "$comment" >/dev/null || return 1
    fi
    azure_issue_patch_state "$number" "$closed_state"
}

# Reopen an issue: move it to the first Proposed-category state of its own type
# (New on a User Story), else its first InProgress state — the state names
# differ per process, so they are read from the type, never assumed.
# Usage: provider_issues_reopen [repo] NUMBER [--comment TEXT]
provider_issues_reopen() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local comment=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --comment) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; comment="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    local type open_state
    type=$(azure_work_item_type "$number") || return 1
    open_state=$(azure_state_by_category "$type" Proposed InProgress) \
        || { log_error "provider_issues_reopen: no open state resolvable for type '$type'"; return 1; }
    if [ -n "$comment" ]; then
        provider_issues_comment "$repo" "$number" --comment-body "$comment" >/dev/null || return 1
    fi
    azure_issue_patch_state "$number" "$open_state"
}

# Edit an issue: --title, --body/--body-file ('-' reads stdin), --add-label and
# --remove-label. Removal reads the current tags, drops the named ones and writes
# the rest back; adds alone send just the new tags, which Azure appends to the
# existing ones. Any other option (--milestone, --add-assignee, ...) has no
# Azure write path here and fails rather than being dropped.
# Usage: provider_issues_edit [repo] NUMBER [--title T] [--body B] ...
provider_issues_edit() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local title="" body="" have_body=false
    local -a add_labels=() remove_labels=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --title) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; title="$2"; shift 2 ;;
            --body) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; body="$2"; have_body=true; shift 2 ;;
            --body-file)
                provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1
                if [ "$2" = "-" ]; then body=$(cat); else body=$(cat "$2"); fi
                have_body=true; shift 2 ;;
            --add-label) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; add_labels+=("$2"); shift 2 ;;
            --remove-label) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; remove_labels+=("$2"); shift 2 ;;
            *)
                log_error "provider_issues_edit: option '$1' is not supported on Azure (supported: --title, --body, --body-file, --add-label, --remove-label)"
                return 1
                ;;
        esac
    done

    local requested=false
    # jq builds every patch op (see provider_issues_create).
    local -a ops=()
    if [ -n "$title" ]; then
        requested=true
        ops+=("$(jq -cn --arg v "$title" '{op:"add",path:"/fields/System.Title",from:null,value:$v}')")
    fi
    if [ "$have_body" = true ] && [ -n "$body" ]; then
        requested=true
        ops+=("$(jq -cn --arg v "$(azure_text_normalize "$body")" '{op:"add",path:"/fields/System.Description",from:null,value:$v}')")
        ops+=('{"op":"add","path":"/multilineFieldsFormat/System.Description","value":"markdown"}')
    fi
    local base
    base=$(azure_wit_base) || return 1
    if [ "${#remove_labels[@]}" -gt 0 ]; then
        requested=true
        local view existing final adds removes
        view=$(azure_http_request GET "$base/workitems/$number?\$fields=System.Tags&api-version=7.1") || return 1
        existing=$(azure_tags_split "$(printf '%s' "$view" | jq -r '.fields["System.Tags"] // ""')")
        removes=$(printf '%s\n' "${remove_labels[@]}" | jq -Rsc 'split("\n") | map(select(length > 0))')
        adds="[]"
        [ "${#add_labels[@]}" -gt 0 ] && adds=$(printf '%s\n' "${add_labels[@]}" | jq -Rsc 'split("\n") | map(select(length > 0))')
        final=$(jq -cn --argjson e "$existing" --argjson r "$removes" --argjson a "$adds" '[($e - $r)[], $a[]] | reduce .[] as $t ([]; if index($t) then . else . + [$t] end)')
        if [ "$final" != "$existing" ]; then
            if [ "$final" = "[]" ]; then
                ops+=('{"op":"remove","path":"/fields/System.Tags"}')
            else
                ops+=("$(jq -cn --arg v "$(azure_tags_join "$final")" '{op:"replace",path:"/fields/System.Tags",value:$v}')")
            fi
        fi
    elif [ "${#add_labels[@]}" -gt 0 ]; then
        # Adding alone sends just the new tags: an add on System.Tags appends to the
        # existing ones (verified live; see test_provider_azure_register.bats).
        requested=true
        local tags
        tags=$(azure_tags_join "$(printf '%s\n' "${add_labels[@]}" | jq -Rsc 'split("\n") | map(select(length > 0))')")
        ops+=("$(jq -cn --arg v "$tags" '{op:"add",path:"/fields/System.Tags",from:null,value:$v}')")
    fi
    [ "$requested" = true ] || { log_error "provider_issues_edit: nothing to edit"; return 1; }
    # Everything asked for may already hold (a removed tag that was never there).
    [ "${#ops[@]}" -gt 0 ] || return 0

    local patch_body
    patch_body=$(printf '%s\n' "${ops[@]}" | jq -s '.')
    azure_http_request PATCH "$base/workitems/$number" "$patch_body" "application/json-patch+json" >/dev/null
}

# Patch only the System.State field.
# Usage: azure_issue_patch_state NUMBER STATE
azure_issue_patch_state() {
    local number="$1" state="$2"
    local base
    base=$(azure_wit_base) || return 1
    local patch_body
    patch_body=$(jq -cn --arg v "$state" '[{op:"add",path:"/fields/System.State",from:null,value:$v}]')
    local response
    if ! response=$(azure_http_request PATCH "$base/workitems/$number" "$patch_body" "application/json-patch+json"); then
        printf '%s' "$response"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Sub-issue graph (work-item relations; consumed via issue-graph.bash)
# ---------------------------------------------------------------------------

# Link a child work item under a parent (Hierarchy-Forward from parent,
# -Reverse from child — one relation on the parent carries both views).
# Idempotent: a duplicate relation is rejected by the store as a conflict,
# which reads as already-linked success here.
# Usage: provider_issue_graph_link REPO PARENT CHILD   (work items belong to the project: REPO is accepted for the seam's shape)
provider_issue_graph_link() {
    local _repo="${1-}" parent="${2:?parent id required}" child="${3:?child id required}"
    local base
    base=$(azure_wit_base) || return 1
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local rel_url patch_body
    rel_url=$(printf 'https://dev.azure.com/%s/%s/_apis/wit/workItems/%s' "$(azure_uri "$org")" "$(azure_uri "$project")" "$child")
    patch_body=$(jq -cn --arg url "$rel_url" '[{op: "add", path: "/relations/-", value: {rel: "System.LinkTypes.Hierarchy-Forward", url: $url}}]')
    local response
    if ! response=$(azure_http_request PATCH "$base/workitems/$parent" "$patch_body" "application/json-patch+json"); then
        # A duplicate link surfaces as a store conflict. Whether it is one is judged by
        # the state, not the error text: the link counts as done only when the parent
        # really lists the child. Any other failure (a cycle, another parent, a revision
        # conflict) stays a failure.
        if provider_issue_graph_children "$_repo" "$parent" 2>/dev/null | grep -qx "$child"; then
            return 0
        fi
        return 1
    fi
    return 0
}

# Remove the child relation from a parent.
# Usage: provider_issue_graph_unlink REPO PARENT CHILD
provider_issue_graph_unlink() {
    local _repo="${1-}" parent="${2:?parent id required}" child="${3:?child id required}"
    local base
    base=$(azure_wit_base) || return 1
    local response
    if ! response=$(azure_http_request GET "$base/workitems/$parent?\$expand=relations&api-version=7.1"); then
        return 1
    fi
    local index
    # The index is the child's position in the FULL relations array: the remove
    # op addresses /relations/<index>, and other relations (commit links,
    # attachments) sit among the hierarchy ones.
    index=$(printf '%s' "$response" | jq -r --arg id "$child" '(.relations // []) | to_entries[] | select(.value.rel == "System.LinkTypes.Hierarchy-Forward" and (.value.url | test("workItems/" + $id + "$"))) | (.key | tostring)' | head -1)
    [ -n "$index" ] || return 0   # not linked — idempotent no-op
    local patch_body
    patch_body=$(printf '[{"op":"remove","path":"/relations/%s"}]' "$index")
    azure_http_request PATCH "$base/workitems/$parent" "$patch_body" "application/json-patch+json" >/dev/null
}

# List a parent's children (work-item ids, one per line).
# Usage: provider_issue_graph_children REPO PARENT
provider_issue_graph_children() {
    local _repo="${1-}" parent="${2:?parent id required}"
    local base
    base=$(azure_wit_base) || return 1
    local response
    if ! response=$(azure_http_request GET "$base/workitems/$parent?\$expand=relations&api-version=7.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.relations // [] | .[] | select(.rel == "System.LinkTypes.Hierarchy-Forward") | .url | capture("workItems/(?<n>[0-9]+)$").n' 2>/dev/null
}

# Resolve an issue's parent (Hierarchy-Reverse relation target id), or empty.
# Usage: provider_issue_graph_parent REPO ISSUE
provider_issue_graph_parent() {
    local _repo="${1-}" issue="${2:?issue id required}"
    local base
    base=$(azure_wit_base) || return 1
    local response
    if ! response=$(azure_http_request GET "$base/workitems/$issue?\$expand=relations&api-version=7.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.relations // [] | .[] | select(.rel == "System.LinkTypes.Hierarchy-Reverse") | .url | capture("workItems/(?<n>[0-9]+)$").n' 2>/dev/null | head -1
}


# Set a work item's type to the Azure type mapped for TYPE_NAME
# (azure_work_item_type_for). An item already of that type is left as is.
# Usage: provider_issues_set_type REPO_OWNER REPO_NAME NUMBER TYPE_NAME
provider_issues_set_type() {
    local _owner="$1" _repo="$2" number="$3" type_name="$4"
    [ -n "$number" ] && [ -n "$type_name" ] || { log_error "provider_issues_set_type: number and type required"; return 1; }
    local normalized="$type_name"
    if declare -F normalize_issue_type >/dev/null; then
        normalized=$(normalize_issue_type "$type_name") || return 1
    fi
    local wit_type current
    wit_type=$(azure_work_item_type_for "$normalized") || return 1
    current=$(azure_work_item_type "$number") || return 1
    [ "$current" = "$wit_type" ] && return 0
    local base
    base=$(azure_wit_base) || return 1
    local patch_body
    patch_body=$(jq -cn --arg t "$wit_type" '[{op: "replace", path: "/fields/System.WorkItemType", value: $t}]')
    azure_http_request PATCH "$base/workitems/$number" "$patch_body" "application/json-patch+json" >/dev/null
}

# List the org's issue types: the config type map (the process types API
# is org-admin scope; the map is the fork's sanctioned vocabulary).
# Usage: provider_org_issue_types ORG
provider_org_issue_types() {
    local types
    types=$(azure_config_get issues types)
    if [ -n "$types" ]; then
        # Emit seam-shaped {id, name} entries from the type map keys (comma-separated).
        printf '%s\n' "$types" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | jq -R 'select(length > 0)' | jq -sc '[.[] | {id: ., name: .}]'
        return 0
    fi
    log_error "provider_org_issue_types: no type map configured ([issues] types in devenv.config)"
    return 1
}

# ---------------------------------------------------------------------------
# Labels (Azure tags)
# ---------------------------------------------------------------------------

# List labels: the project's tags, from the tags endpoint. If that endpoint is
# unavailable, the distinct tags of the project's work items stand in (at most
# 500, fetched 200 ids per request). Emits seam-shaped [{name}] entries.
# --limit caps the list, --json/-q project it as for any list verb (a tag has only
# a name: color and description are accepted fields and come back empty).
# Usage: provider_issues_label_list [repo] [--limit N] [--json FIELDS] [-q JQ]
provider_issues_label_list() {
    if [ $# -gt 0 ] && [[ "$1" != -* ]]; then
        shift   # labels are project-wide: the repo is not a filter here
    fi
    local limit="" json_fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --limit) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; limit="$2"; shift 2 ;;
            --json) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; json_fields="$2"; shift 2 ;;
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    local labels
    labels=$(_azure_label_names) || return 1
    if [ -n "$limit" ]; then
        labels=$(printf '%s' "$labels" | jq -c --argjson n "$limit" '.[0:$n]')
    fi
    labels=$(printf '%s' "$labels" | jq -c 'map(. + {description: "", color: ""})')
    azure_apply_list_flags "$labels" "$json_fields" "$jq_expr"
}

# The project's tag names as [{name}].
_azure_label_names() {
    local base
    base=$(azure_wit_base) || return 1
    local tags_response
    if tags_response=$(azure_http_request GET "$base/tags" 2>/dev/null) \
        && printf '%s' "$tags_response" | jq -e '(.value | type) == "array"' >/dev/null 2>&1; then
        printf '%s' "$tags_response" | jq -c '[.value[].name | gsub("^\\s+|\\s+$"; "") | select(length > 0)] | unique | map({name: .})'
        return 0
    fi
    local wiql
    wiql='{"query":"SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project"}'
    local ids_response
    if ! ids_response=$(azure_http_request POST "$base/wiql" "$wiql" application/json idempotent); then
        return 1
    fi
    local id_list
    id_list=$(printf '%s' "$ids_response" | jq -c '[.workItems[].id] | .[0:500]')
    [ "$id_list" = "[]" ] && { printf '[]'; return 0; }
    local details
    if ! details=$(azure_workitems_batch "$base" "$id_list"); then
        return 1
    fi
    printf '%s' "$details" | jq -c "$AZURE_TAGS_JQ_DEF"'[.value[].fields["System.Tags"] | azure_tags | .[]] | unique | map({name: .})'
}

# Ensure a tag exists on some work item (Azure tags materialize on first use;
# this verb is a no-op that always succeeds for interface parity).
# Usage: provider_issues_label_ensure [repo] NAME [COLOR] [DESCRIPTION]
provider_issues_label_ensure() {
    return 0
}

# Add a tag to the mapped work item. Azure tags are work-item-scoped flat
# strings — color/description are accepted and ignored (MAPPING.md
# constraint). Tag materialization needs an existing work item; with no
# number the verb fails defined (a host with org-level labels can create them; azure cannot).
# Usage: provider_issues_label_create [repo] NAME [COLOR] [DESCRIPTION] [--issue N]
provider_issues_label_create() {
    local repo="${1-}"
    [ $# -gt 0 ] && shift
    local name="${1:?name required}"
    shift
    # color/description consumed positionally, then ignored — azure tags have
    # neither field (mapping constraint); keeping them optional preserves the
    # shared call-site shape.
    [ $# -gt 0 ] && [[ "$1" != -* ]] && shift   # color
    [ $# -gt 0 ] && [[ "$1" != -* ]] && shift   # description
    local number=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --issue) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; number="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    [ -n "$number" ] || { log_error "provider_issues_label_create: azure tags live on work items — pass --issue N"; return 1; }
    provider_issues_add_tag "$number" "$name"
}

# Update an existing label: azure tags have no color/description — the
# update is a no-op success (mapping constraint, MAPPING.md).
# Usage: provider_issues_label_update [repo] NAME [COLOR] [DESCRIPTION]
provider_issues_label_update() {
    return 0
}

# Add a tag to a work item: read the current System.Tags, append when absent
# (idempotent, comparing trimmed tags), write back via JSON-Patch.
# Usage: provider_issues_add_tag NUMBER TAG
provider_issues_add_tag() {
    local number="$1" tag="$2"
    [ -n "$number" ] && [ -n "$tag" ] || { log_error "provider_issues_add_tag: work item id and tag required"; return 1; }
    local base
    base=$(azure_wit_base) || return 1
    local view
    if ! view=$(azure_http_request GET "$base/workitems/$number?\$fields=System.Tags&api-version=7.1"); then
        return 1
    fi
    local existing new_tags
    existing=$(azure_tags_split "$(printf '%s' "$view" | jq -r '.fields["System.Tags"] // ""')")
    if printf '%s' "$existing" | jq -e --arg t "$tag" 'index($t) != null' >/dev/null; then
        return 0  # already tagged — idempotent no-op
    fi
    new_tags=$(azure_tags_join "$(printf '%s' "$existing" | jq -c --arg t "$tag" '. + [$t]')")
    # jq builds the JSON string so tag content can never break the payload.
    local patch_body
    patch_body=$(jq -cn --arg v "$new_tags" '[{op:"add",path:"/fields/System.Tags",from:null,value:$v}]')
    azure_http_request PATCH "$base/workitems/$number" "$patch_body" "application/json-patch+json" >/dev/null
}

# ---------------------------------------------------------------------------
# Milestones (Azure iterations — config-mapped, informational only)
# ---------------------------------------------------------------------------

# List milestones as Azure iteration paths. Milestones have no Azure API
# parity (config-mapped iterations, informational only) — the list is
# intentionally empty.
# Usage: provider_issues_milestones [repo] [-q JQ]
provider_issues_milestones() {
    if [ $# -gt 0 ] && [[ "$1" != -* ]]; then
        shift   # milestones are not repository-scoped here
    fi
    local jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            -q|--jq) provider_need_value "${FUNCNAME[0]}" "$1" "$#" || return 1; jq_expr="$2"; shift 2 ;;
            *) provider_unknown_option "${FUNCNAME[0]}" "$1"; return 1 ;;
        esac
    done
    azure_apply_list_flags '[]' "" "$jq_expr"
}
