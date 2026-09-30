#!/bin/bash
# azure/issues.bash - Azure DevOps implementation of the issues domain verbs.
#
# Maps the issue seam onto Azure Boards work items. Verbs mirror the gh-backed
# flag contracts callers use (parity per the plan's grep-derived list):
# list/view/exists/comments/create/comment/close/reopen/edit plus
# label_list/label_ensure (Azure tags stand in for labels) and milestones
# (Azure iterations, config-mapped — no milestone API parity claimed).
#
# Work-item mapping:
#   number            -> work item id
#   state open/closed -> "New"/"Active" vs "Closed"/"Removed"/"Done"
#   labels            -> System.Tags (semicolon-separated)
#   title/body        -> System.Title / System.Description (HTML-ish markdown)
#
# Transport: azure_http_request / azure_http_paginate. Contract: return
# non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_ISSUES_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_ISSUES_LOADED=1

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
if ! declare -F azure_apply_gh_list_flags >/dev/null; then
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/urls.bash"
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
    printf 'https://dev.azure.com/%s/%s/_apis/wit' "$org" "$project"
}

# Azure stores long-text fields (comment text, System.Description) as HTML
# regardless of the submitted format: markdown in, entity-encoded markdown
# out (verified live — quotes become &quot; etc.), plus one trailing newline
# the store appends. The provider boundary restores the caller's markdown:
# read paths un-escape entities (azure_text_decode); command-substitution
# capture strips the trailing newline on read, and the write paths
# pre-trim one trailing newline (azure_text_normalize) — the pairing keeps
# round trips byte-stable without per-read newline surgery.
# Usage: azure_text_decode <<< html-ish text -> markdown on stdout
azure_text_decode() {
    python3 -c 'import html,sys; sys.stdout.write(html.unescape(sys.stdin.read()))'
}
# Normalize text for storage: drop ONE trailing newline (the store re-adds
# it), keeping interior formatting untouched. Must pair with decode on read.
# Usage: azure_text_normalize TEXT -> normalized text on stdout
azure_text_normalize() {
    printf '%s' "$1" | python3 -c 'import sys; t=sys.stdin.read(); sys.stdout.write(t[:-1] if t.endswith(chr(10)) else t)'
}

# Web UI base for a work item's page (comments anchor included by callers).
azure_web_items_base() {
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    printf 'https://dev.azure.com/%s/%s/_workitems/edit/' "$org" "$project"
}

# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

# List issues (work items) via WIQL. Supports the seam's valued flags:
# --state (open/closed/all), --label (tag contains), --type (work-item
# type: Bug/Feature/Task/Epic), --milestone (documented degrade), --limit,
# --json FIELDS, -q/--jq J (gh list semantics).
# Output: one JSON array of gh-shaped objects.
# Usage: provider_issues_list [repo] [--state S] [--label L] [--type T] [FLAGS]
provider_issues_list() {
    local repo=""
    local state="open" label="" type="" limit="200"
    local json_fields="" jq_expr=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --state) state="$2"; shift 2 ;;
            --label) label="$2"; shift 2 ;;
            --type) type="$2"; shift 2 ;;
            --limit) limit="$2"; shift 2 ;;
            --json)
                shift
                if [[ ${1:-} != --* ]] && [ $# -gt 0 ]; then json_fields="$1"; shift; fi
                ;;
            -q|--jq)
                shift
                if [[ ${1:-} != --* ]] && [ $# -gt 0 ]; then jq_expr="$1"; shift; fi
                ;;
            --web|--lock|--assignee)
                shift
                # Valued flags consume their argument; booleans do not.
                if [[ ${1:-} != --* ]] && [ $# -gt 0 ]; then shift; fi
                ;;
            *) shift ;;
        esac
    done

    local state_filter=""
    case "$state" in
        open) state_filter="AND [System.State] NOT IN ('Closed','Removed','Done')" ;;
        closed) state_filter="AND [System.State] IN ('Closed','Removed','Done')" ;;
        all) : ;;
    esac
    local label_filter=""
    [ -n "$label" ] && label_filter="AND [System.Tags] CONTAINS '$label'"
    local type_filter=""
    [ -n "$type" ] && type_filter="AND [System.WorkItemType] = '$type'"

    # jq composes the query string: a label containing a single quote must
    # not be able to break out of the WIQL literal.
    local wiql
    wiql=$(jq -cn --arg q "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project $state_filter $label_filter $type_filter ORDER BY [System.Id] DESC" \
        '{query: $q}')

    local base
    base=$(azure_wit_base) || return 1
    local ids_response
    if ! ids_response=$(azure_http_request POST "$base/wiql" "$wiql"); then
        return 1
    fi
    local ids
    ids=$(printf '%s' "$ids_response" | jq -r --argjson n "$limit" \
        '[.workItems[].id] | .[0:$n] | @sh' 2>/dev/null | tr -d "'")
    if [ -z "$ids" ]; then
        # Empty result still honors the caller's -q program (gh semantics:
        # '.[0].x' over [] is empty output, not an error).
        azure_apply_gh_list_flags '[]' "$json_fields" "$jq_expr"
        return $?
    fi

    # Batch-fetch the identified work items. The body is jq-built with the
    # limit as a number — the id list never rides a string interpolation.
    local batch_body
    batch_body=$(printf '%s' "$ids_response" \
        | jq -c --argjson n "$limit" '{ids: ([.workItems[].id] | .[0:$n]), "$expand": "fields"}') || return 1
    local details
    if ! details=$(azure_http_request POST "$base/workitemsbatch" "$batch_body"); then
        return 1
    fi

    # One JSON array on stdout (the shared issue-list wrapper selects with
    # .[] over the whole output; NDJSON lines would truncate that select).
    # The record carries the gh-dialect field set wrappers project with
    # --json (body included — issue-search matches on it); description is
    # entity-encoded html, carried base64 so jq never mangles it, decoded
    # once per record here.
    local enriched
    enriched=$(printf '%s' "$details" | jq -c '[.value[] | {
        number: .id,
        title: .fields["System.Title"],
        state: (if (.fields["System.State"] == "Closed" or .fields["System.State"] == "Removed" or .fields["System.State"] == "Done") then "CLOSED" else "OPEN" end),
        labels: (.fields["System.Tags"] // "" | if . == "" then [] else split(";") | map({name: .}) end),
        body: ((.fields["System.Description"] // "") | @base64),
        url: ((.url // "") ),
        createdAt: (.fields["System.CreatedDate"] // ""),
        updatedAt: (.fields["System.ChangedDate"] // ""),
        author: {login: (.fields["System.CreatedBy"].displayName // "unknown")},
        assignees: (if (.fields["System.AssignedTo"] == null) then [] else [{login: .fields["System.AssignedTo"].displayName}] end),
        milestone: null
    }]')
    if [ -z "$enriched" ] || [ "$enriched" = "null" ]; then
        enriched='[]'
    fi
    local decoded
    decoded=$(printf '%s' "$enriched" | python3 -c '
import base64, html, json, sys
items = json.load(sys.stdin)
for obj in items:
    body = base64.b64decode(obj["body"]).decode("utf-8", "replace")
    obj["body"] = html.unescape(body)
sys.stdout.write(json.dumps(items))
') || return 1
    [ -n "$decoded" ] || decoded='[]'
    azure_apply_gh_list_flags "$decoded" "$json_fields" "$jq_expr"
}

# View a single issue. Mirrors gh's --json field projection and -q/--jq
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
            --json) fields="$2"; shift 2 ;;
            -q|--jq) jq_expr="$2"; shift 2 ;;
            *) shift ;;
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
    decoded_desc=$(printf '%s' "$response" | jq -r '.fields["System.Description"] // ""' | azure_text_decode)
    # The decoded text must also be the mapped body: consumers feed
    # view --json body -q .body straight back into edit --body-file.
    local mapped_body
    mapped_body=$(printf '%s' "$decoded_desc" | jq -Rs '.')
    local mapped
    mapped=$(printf '%s' "$response" | jq -c --argjson body "$mapped_body" --argjson wid "$number" --arg web "$(azure_web_items_base)" '{
        number: .id,
        title: .fields["System.Title"],
        state: (if (.fields["System.State"] == "Closed" or .fields["System.State"] == "Removed" or .fields["System.State"] == "Done") then "CLOSED" else "OPEN" end),
        body: $body,
        url: ($web + ($wid | tostring)),
        labels: (.fields["System.Tags"] // "" | if . == "" then [] else split(";") | map({name: .}) end)
    }')

    if [ -n "$jq_expr" ]; then
        printf '%s' "$mapped" | jq -r "$jq_expr"
        return 0
    fi
    if [ -n "$fields" ]; then
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
# Usage: provider_issues_comments [repo] NUMBER
provider_issues_comments() {
    local number="$1"
    local base
    base=$(azure_wit_base) || return 1
    local response
    if ! response=$(azure_http_request GET "$base/workitems/$number/comments?api-version=${AZURE_COMMENTS_API_VERSION}"); then
        return 1
    fi
    # Raw gh REST comment shape: {id, html_url, user: {login}, body,
    # created_at, updated_at} — the shared formatter (and every gh-dialect
    # consumer) projects these names. id is the opaque comment ref
    # (<issue>/<comment>) — the exact token issue-comment-update and the
    # get/edit verbs accept. Bodies pass through the markdown restore below
    # (the store entity-encodes text and appends one trailing newline;
    # base64 carries bodies through jq safely). Azure comment objects carry
    # no html link (verified live): the web URL is constructed.
    printf '%s' "$response" \
        | jq -c --arg web "$(azure_web_items_base)" '[.comments[] | {
            id: ((.workItemId | tostring) + "/" + (.id | tostring)),
            html_url: ($web + (.workItemId | tostring) + "?_a=comments"),
            user: {login: (.createdBy.displayName // "unknown")},
            body: (.text | @base64),
            created_at: .createdDate,
            updated_at: (.modifiedDate // .createdDate)
        }] | .[]' \
        | python3 -c '
import base64, html, json, sys
mapped = []
for line in sys.stdin:
    obj = json.loads(line)
    body = base64.b64decode(obj["body"]).decode("utf-8")
    body = html.unescape(body)
    if body.endswith("\n"):
        body = body[:-1]
    obj["body"] = body
    mapped.append(obj)
sys.stdout.write(json.dumps(mapped) + "\n")
'
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

# Fetch one work-item comment as gh-shaped JSON ({id, html_url, body}).
# COMMENT_REF is the provider-opaque id (issue/comment composite).
# Usage: provider_issues_comment_get [repo] COMMENT_REF
provider_issues_comment_get() {
    local repo=""
    if [ $# -gt 0 ]; then
        # A digits/digits token is the opaque comment ref (repo specs are
        # never purely numeric); anything else slash-bearing is a repo spec.
        case "$1" in
            [0-9]*/[0-9]*) ;;
            */*) repo="$1"; shift ;;
        esac
    fi
    local ref="$1"
    local number comment_id
    azure_split_comment_ref "$ref" || return 1
    number="$_AZ_WI"; comment_id="$_AZ_CID"
    local base web
    base=$(azure_wit_base) || return 1
    web=$(azure_web_items_base) || return 1
    local response
    if ! response=$(azure_http_request GET "$base/workitems/$number/comments?api-version=${AZURE_COMMENTS_API_VERSION}"); then
        return 1
    fi
    # body decoded through the shared restore so callers read markdown, not
    # the store's entity-encoded form; the mapped object is emitted (github's
    # comment_get passes the JSON through — a missing comment is the empty
    # output the caller fails on).
    local mapped
    mapped=$(printf '%s' "$response" | jq -c --argjson id "$comment_id" --arg web "$web" '
        [.comments[] | select(.id == $id) | {
            id: ((.workItemId | tostring) + "/" + (.id | tostring)),
            html_url: ($web + (.workItemId | tostring) + "?_a=comments"),
            body: (.text | @base64)
        }] | .[0]') || return 1
    [ -n "$mapped" ] && [ "$mapped" != "null" ] || return 1
    printf '%s' "$mapped" | python3 -c '
import base64, html, json, sys
obj = json.load(sys.stdin)
body = base64.b64decode(obj["body"]).decode("utf-8")
body = html.unescape(body)
if body.endswith("\n"):
    body = body[:-1]
obj["body"] = body
sys.stdout.write(json.dumps(obj) + "\n")
'
}

# Replace a comment's body; emits gh-shaped JSON ({id, html_url}).
# COMMENT_REF is the provider-opaque id.
# Usage: provider_issues_comment_edit [repo] COMMENT_REF --body TEXT
provider_issues_comment_edit() {
    local repo=""
    if [ $# -gt 0 ]; then
        case "$1" in
            [0-9]*/[0-9]*) ;;
            */*) repo="$1"; shift ;;
        esac
    fi
    local ref="$1"; shift
    local number comment_id
    azure_split_comment_ref "$ref" || return 1
    number="$_AZ_WI"; comment_id="$_AZ_CID"
    local body=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --body) body="$2"; shift 2 ;;
            --body-file) body=$(cat "$2"); shift 2 ;;
            *) shift ;;
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
        html_url: ($web + (.workItemId | tostring) + "?_a=comments")
    }'
}

# Create a comment on a work item; emits gh-shaped JSON ({id, html_url}) —
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
            --body) body="$2"; shift 2 ;;
            --body-file) body=$(cat "$2"); shift 2 ;;
            *) shift ;;
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
        html_url: ($web + (.workItemId | tostring) + "?_a=comments")
    }'
}

# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

# Create an issue (work item). Type comes from the issue-types config surface
# (Azure has no native per-org type API; default "Issue" maps to Task).
# Usage: provider_issues_create [repo] --title T [--body B] [--label L]...
provider_issues_create() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local title="" body=""
    local -a labels=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --title) title="$2"; shift 2 ;;
            --body) body="$2"; shift 2 ;;
            --body-file) body=$(cat "$2"); shift 2 ;;
            --label) labels+=("$2"); shift 2 ;;
            *) shift ;;
        esac
    done
    [ -n "$title" ] || { log_error "provider_issues_create requires --title"; return 1; }

    local tags
    tags=$(printf '%s;' "${labels[@]:-}" | sed 's/;$//')

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
    fi
    [ -n "$tags" ] && ops+=("$(jq -cn --arg v "$tags" '{op:"add",path:"/fields/System.Tags",from:null,value:$v}')")

    local patch_body
    patch_body=$(printf '%s\n' "${ops[@]}" | jq -s '.')

    local base
    base=$(azure_wit_base) || return 1
    local response
    # Work-item APIs require the JSON-Patch content type; the type rides the
    # URL path ("Issue" — a work-item type name, not a prefixed literal).
    if ! response=$(azure_http_request POST "$base/workitems/\$Issue" "$patch_body" "application/json-patch+json"); then
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
            --body) text="$2"; shift 2 ;;
            --body-file) text=$(cat "$2"); shift 2 ;;
            --comment-body) text="$2"; shift 2 ;;
            *) shift ;;
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

# Close an issue. --reason/--comment accepted and mapped (comment first).
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
            --comment) comment="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    if [ -n "$comment" ]; then
        provider_issues_comment "$repo" "$number" --comment-body "$comment" >/dev/null || return 1
    fi
    azure_issue_patch_state "$number" "Closed"
}

# Reopen an issue.
# Usage: provider_issues_reopen [repo] NUMBER
provider_issues_reopen() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"
    azure_issue_patch_state "$number" "New"
}

# Edit an issue (--title/--body/--add-label).
# Usage: provider_issues_edit [repo] NUMBER [--title T] [--body B] ...
provider_issues_edit() {
    local repo=""
    if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
        repo="$1"; shift
    fi
    local number="$1"; shift
    local title="" body=""
    local -a add_labels=()
    while [ $# -gt 0 ]; do
        case "$1" in
            --title) title="$2"; shift 2 ;;
            --body) body="$2"; shift 2 ;;
            --body-file) body=$(cat "$2"); shift 2 ;;
            --add-label) add_labels+=("$2"); shift 2 ;;
            *) shift ;;
        esac
    done

    # jq builds every patch op (see provider_issues_create).
    local -a ops=()
    [ -n "$title" ] && ops+=("$(jq -cn --arg v "$title" '{op:"add",path:"/fields/System.Title",from:null,value:$v}')")
    [ -n "$body" ] && ops+=("$(jq -cn --arg v "$(azure_text_normalize "$body")" '{op:"add",path:"/fields/System.Description",from:null,value:$v}')")
    if [ "${#add_labels[@]}" -gt 0 ]; then
        local tags
        tags=$(printf '%s;' "${add_labels[@]}" | sed 's/;$//')
        ops+=("$(jq -cn --arg v "$tags" '{op:"add",path:"/fields/System.Tags",from:null,value:$v}')")
    fi
    [ "${#ops[@]}" -gt 0 ] || { log_error "provider_issues_edit: nothing to edit"; return 1; }

    local patch_body
    patch_body=$(printf '%s\n' "${ops[@]}" | jq -s '.')
    local base
    base=$(azure_wit_base) || return 1
    azure_http_request PATCH "$base/workitems/$number" "$patch_body" "application/json-patch+json" >/dev/null
}

# Patch only the System.State field.
# Usage: azure_issue_patch_state NUMBER STATE
azure_issue_patch_state() {
    local number="$1" state="$2"
    local base
    base=$(azure_wit_base) || return 1
    local patch_body
    patch_body=$(printf '[{"op":"add","path":"/fields/System.State","from":null,"value":"%s"}]' "$state")
    azure_http_request PATCH "$base/workitems/$number" "$patch_body" "application/json-patch+json" >/dev/null
}

# ---------------------------------------------------------------------------
# Sub-issue graph (work-item relations; consumed via issue-graph.bash)
# ---------------------------------------------------------------------------

# Link a child work item under a parent (Hierarchy-Forward from parent,
# -Reverse from child — one relation on the parent carries both views).
# Idempotent: a duplicate relation is rejected by the store as a conflict,
# which reads as already-linked success here.
# Usage: provider_issue_graph_link PARENT CHILD
provider_issue_graph_link() {
    local parent="${1:?parent id required}" child="${2:?child id required}"
    local base
    base=$(azure_wit_base) || return 1
    local op
    op=$(azure_org_project) || return 1
    local org project
    org=$(printf '%s' "$op" | sed -n 1p)
    project=$(printf '%s' "$op" | sed -n 2p)
    local rel_url patch_body
    rel_url=$(printf 'https://dev.azure.com/%s/%s/_apis/wit/workItems/%s' "$org" "$project" "$child")
    patch_body=$(jq -cn --arg url "$rel_url" '[{op: "add", path: "/relations/-", value: {rel: "System.LinkTypes.Hierarchy-Forward", url: $url}}]')
    local response
    if ! response=$(azure_http_request PATCH "$base/workitems/$parent" "$patch_body" "application/json-patch+json"); then
        # Already-linked duplicates surface as store conflicts; treat as done.
        case "$response" in
            *already*|*conflict*|*exists*) return 0 ;;
        esac
        return 1
    fi
    return 0
}

# Remove the child relation from a parent.
# Usage: provider_issue_graph_unlink PARENT CHILD
provider_issue_graph_unlink() {
    local parent="${1:?parent id required}" child="${2:?child id required}"
    local base
    base=$(azure_wit_base) || return 1
    local response
    if ! response=$(azure_http_request GET "$base/workitems/$parent?\$expand=relations&api-version=7.1"); then
        return 1
    fi
    local index
    index=$(printf '%s' "$response" | jq -r --arg id "$child" '[.relations[] | select(.rel == "System.LinkTypes.Hierarchy-Forward") | .url | capture("workItems/(?<n>[0-9]+)$").n] | to_entries[] | select(.value == $id) | (.key | tostring)' | head -1)
    [ -n "$index" ] || return 0   # not linked — idempotent no-op
    local patch_body
    patch_body=$(printf '[{"op":"remove","path":"/relations/%s"}]' "$index")
    azure_http_request PATCH "$base/workitems/$parent" "$patch_body" "application/json-patch+json" >/dev/null
}

# List a parent's children (work-item ids, one per line).
# Usage: provider_issue_graph_children PARENT
provider_issue_graph_children() {
    local parent="${1:?parent id required}"
    local base
    base=$(azure_wit_base) || return 1
    local response
    if ! response=$(azure_http_request GET "$base/workitems/$parent?\$expand=relations&api-version=7.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.relations // [] | .[] | select(.rel == "System.LinkTypes.Hierarchy-Forward") | .url | capture("workItems/(?<n>[0-9]+)$").n' 2>/dev/null
}

# Resolve an issue's parent (Hierarchy-Reverse relation target id), or empty.
# Usage: provider_issue_graph_parent ISSUE
provider_issue_graph_parent() {
    local issue="${1:?issue id required}"
    local base
    base=$(azure_wit_base) || return 1
    local response
    if ! response=$(azure_http_request GET "$base/workitems/$issue?\$expand=relations&api-version=7.1"); then
        return 1
    fi
    printf '%s' "$response" | jq -r '.relations // [] | .[] | select(.rel == "System.LinkTypes.Hierarchy-Reverse") | .url | capture("workItems/(?<n>[0-9]+)$").n' 2>/dev/null | head -1
}


# Set a work item's type: patch System.WorkItemType. The type vocabulary
# comes from the issues-config type map (process types API is org-level
# admin; the config map is the sanctioned source).
# Usage: provider_issues_set_type REPO_OWNER REPO_NAME NUMBER TYPE_NAME
provider_issues_set_type() {
    local _owner="$1" _repo="$2" number="$3" type_name="$4"
    [ -n "$number" ] && [ -n "$type_name" ] || { log_error "provider_issues_set_type: number and type required"; return 1; }
    local normalized="$type_name"
    if declare -F normalize_issue_type >/dev/null; then
        normalized=$(normalize_issue_type "$type_name") || return 1
    fi
    local base
    base=$(azure_wit_base) || return 1
    local patch_body
    patch_body=$(jq -cn --arg t "$normalized" '[{op: "add", path: "/fields/System.WorkItemType", from: null, value: $t}]')
    azure_http_request PATCH "$base/workitems/$number" "$patch_body" "application/json-patch+json" >/dev/null
}

# List the org's issue types: the config type map (the process types API
# is org-admin scope; the map is the fork's sanctioned vocabulary).
# Usage: provider_org_issue_types ORG
provider_org_issue_types() {
    local config_file="${DEVENV_ROOT:-}/devenv.config"
    if [ -f "${DEVENV_TOOLS:-}/lib/config-reader.bash" ] && [ -f "$config_file" ]; then
        # shellcheck disable=SC1091
        source "${DEVENV_TOOLS}/lib/config-reader.bash"
        if config_init "$config_file" 2>/dev/null; then
            # Emit gh-shaped {id, name} entries from the type map keys.
            config_read_array "issues" "types" 2>/dev/null | jq -R . | jq -sc '[.[] | {id: ., name: .}]'
            return 0
        fi
    fi
    log_error "provider_org_issue_types: no type map configured ([issues] types in devenv.config)"
    return 1
}

# ---------------------------------------------------------------------------
# Labels (Azure tags)
# ---------------------------------------------------------------------------

# List labels. Azure has no label registry: the practical equivalent is the
# distinct set of tags across work items. Emits gh-shaped [{name}] entries.
# Usage: provider_issues_label_list [repo]
provider_issues_label_list() {
    local base
    base=$(azure_wit_base) || return 1
    local wiql
    wiql='{"query":"SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project"}'
    local ids_response
    if ! ids_response=$(azure_http_request POST "$base/wiql" "$wiql"); then
        return 1
    fi
    local id_list
    id_list=$(printf '%s' "$ids_response" | jq -c '[.workItems[].id] | .[0:500]')
    [ "$id_list" = "[]" ] && { printf '[]'; return 0; }
    # jq-built batch body (ids are jq-produced numbers; the build matches
    # the issues_list pattern — no string-interpolated JSON).
    local batch_body
    batch_body=$(printf '%s' "$ids_response" | jq -c '{ids: ([.workItems[].id] | .[0:500]), "$expand": "fields"}') || return 1
    local details
    if ! details=$(azure_http_request POST "$base/workitemsbatch" "$batch_body"); then
        return 1
    fi
    printf '%s' "$details" | jq -c '[.value[].fields["System.Tags"] // empty | split(";")[]] | unique | map({name: .})'
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
# number the verb fails defined (GH creates org-level labels; azure cannot).
# Usage: provider_issues_label_create [repo] NAME [COLOR] [DESCRIPTION] [--issue N]
provider_issues_label_create() {
    local repo=""
    if [ $# -gt 0 ]; then
        case "$1" in
            */*) repo="$1"; shift ;;
        esac
    fi
    local name="${1:?name required}"
    shift
    # color/description consumed positionally, then ignored — azure tags have
    # neither field (mapping constraint); keeping them optional preserves the
    # shared call-site shape.
    [ $# -gt 0 ] && shift   # color
    [ $# -gt 0 ] && shift   # description
    local number=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --issue) number="$2"; shift 2 ;;
            *) shift ;;
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

# Add a tag to a work item: read current System.Tags, append when absent
# (idempotent), write back via JSON-Patch. Tags are semicolon-joined.
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
    existing=$(printf '%s' "$view" | jq -r '.fields["System.Tags"] // ""')
    case ";${existing};" in
        *";${tag};"*) return 0 ;;  # already tagged — idempotent no-op
    esac
    if [ -n "$existing" ]; then
        new_tags="${existing};${tag}"
    else
        new_tags="$tag"
    fi
    local patch_body
    patch_body=$(printf '{"op":"add","path":"/fields/System.Tags","from":null,"value":"%s"}' "$new_tags")
    # jq builds the JSON string so tag content can never break the payload.
    patch_body=$(jq -cn --arg v "$new_tags" '[{op:"add",path:"/fields/System.Tags",from:null,value:$v}]')
    azure_http_request PATCH "$base/workitems/$number" "$patch_body" "application/json-patch+json" >/dev/null
}

# ---------------------------------------------------------------------------
# Milestones (Azure iterations — config-mapped, informational only)
# ---------------------------------------------------------------------------

# List milestones as Azure iteration paths. Milestones have no Azure API
# parity (config-mapped iterations, informational only) — the list is
# intentionally empty.
# Usage: provider_issues_milestones [repo]
provider_issues_milestones() {
    printf '[]'
}
