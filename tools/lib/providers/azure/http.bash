#!/bin/bash
# providers/azure/http.bash - Thin HTTP transport for the Azure DevOps provider.
#
# Everything HTTP lives here once: Basic-auth header from the PAT,
# api-version injection, continuation-token pagination, 429/Retry-After and
# transient-5xx retry (idempotent requests only) with backoff, typed auth errors,
# jq response validation, and token redaction on every log/error path. Domain modules (providers/azure/*)
# call azure_http_request / azure_http_paginate; they never touch curl.
#
# Contract:
#   - PAT travels ONLY as an Authorization header, passed to curl on stdin
#     (-H @-) so it is never in argv. Query-string tokens are forbidden (they
#     leak into logs and process listings).
#   - All log/error output passes through azure_redact, so the token can
#     never reach a terminal or a file.
#   - Errors are typed: azure_http_request returns non-zero and emits a JSON
#     error object on stdout failure paths (caller decides exit — the
#     provider error contract lives in provider-core).
#
# Requirements: Bash 4.0+, curl, jq
# Sourcing contract: caller sets DEVENV_TOOLS and has error-handling.bash
# loaded; the PAT comes from provider_auth_token (providers/azure/auth.bash).

# Prevent multiple sourcing
if [ -n "${_AZURE_HTTP_LOADED:-}" ]; then
    return 0
fi
readonly _AZURE_HTTP_LOADED=1

readonly AZURE_API_VERSION="7.1"
readonly AZURE_HTTP_MAX_RETRIES=3

# ============================================================================
# Redaction
# ============================================================================

# Strip anything that looks like a PAT from arbitrary text before it reaches
# a terminal or a log. Called on every log/error path in this module.
# Usage: azure_redact "text with maybe a token"
azure_redact() {
    local text="$1"
    local token="${AZURE_PAT:-}"
    if [ -n "$token" ]; then
        # Replace the literal token wherever it appears (URLs, headers, errors).
        text="${text//"$token"/***REDACTED***}"
    fi
    # Defensive: also redact base64 Basic credentials if one leaks in.
    printf '%s' "$text" | sed -E 's#Authorization: Basic [A-Za-z0-9+/=]+#Authorization: Basic ***REDACTED***#g'
}

# ============================================================================
# Core request
# ============================================================================

# Perform one Azure DevOps REST call and print the response body.
# Usage: azure_http_request METHOD URL [JSON_BODY] [CONTENT_TYPE]
#   METHOD   GET | POST | PATCH | PUT | DELETE
#   URL      full URL; api-version is appended here UNLESS the URL already
#            carries one (preview resources pin their own, e.g.
#            work-item comments require 7.1-preview.3 and reject plain 7.1)
#   BODY     optional JSON request body (implies Content-Type)
#   CONTENT_TYPE  optional; application/json (default) or
#             application/json-patch+json (work-item create/edit APIs reject
#             plain application/json with a 400)
# Returns: 0 and prints the body on 2xx; 1 and prints an error object on
#          failure (network, non-2xx after retries, malformed JSON).
# Environment: AZURE_PAT is optional at entry — when unset, the transport
#          self-heals through provider_secret_get (the neutral auth seam:
#          allowlisted env → provider credential store). Callers that need
#          pagination should use azure_http_paginate instead.
# Auth-seam bridge (shared by request + paginate): populate AZURE_PAT via the
# provider-neutral credential seam when not already set, so shared wrappers
# work in azure mode without provider-specific env setup. Returns 1 (and
# emits a typed JSON error) when no credential resolves.
_azure_pat_ensure() {
    [ -n "${AZURE_PAT:-}" ] && return 0
    # Self-heal the seam itself: standalone sourcing (tests, direct use)
    # skips the canonical loader, so the seam's building blocks may not be
    # loaded yet — provider-core owns provider_secret_get, and the azure
    # auth module owns provider_auth_token_impl (PAT file read).
    if ! declare -F provider_secret_get >/dev/null; then
        local core="${DEVENV_TOOLS:-}/lib/providers/provider-core.bash"
        # shellcheck disable=SC1090
        if [ -f "$core" ]; then
            source "$core"
        fi
    fi
    if ! declare -F provider_auth_token_impl >/dev/null; then
        local auth_mod
        auth_mod="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/auth.bash"
        # shellcheck disable=SC1090
        [ -f "$auth_mod" ] && source "$auth_mod"
    fi
    local resolved=""
    if declare -F provider_secret_get >/dev/null; then
        resolved=$(provider_secret_get token 2>/dev/null) || resolved=""
    fi
    if [ -n "$resolved" ]; then
        AZURE_PAT="$resolved"
        export AZURE_PAT
        return 0
    fi
    printf '%s' '{"error":"no-credentials","message":"no stored azure credential — run key-update-azure"}'
    return 1
}

# The Authorization header value. It reaches curl through stdin (-H @-), never
# argv, so the PAT is not visible in process listings.
_azure_auth_header() {
    printf 'Authorization: Basic %s' "$(printf ':%s' "${AZURE_PAT}" | base64 | tr -d '\r\n')"
}

# Typed auth error: the credential was not accepted (401, or the 203/redirect
# sign-in page Azure answers an unauthenticated call with).
# Usage: _azure_auth_error HTTP_CODE
_azure_auth_error() {
    printf '{"error":"auth","code":%s,"message":"Azure DevOps did not accept the stored credential (HTTP %s) — run key-update-azure to store a valid token"}' "${1:-0}" "${1:-0}"
}

# Resolve the response status of the last curl run: curl's own -w line when it
# printed one (the final hop, after redirects), else the last status line of the
# header dump. Strips the -w line from the body file.
# Usage: _azure_response_code BODY_FILE HEADERS_FILE -> prints the code
_azure_response_code() {
    local body_file="$1" headers_file="$2" last code=""
    last=$(tail -n 1 "$body_file" 2>/dev/null || true)
    if [[ "$last" == __azure_http_code=* ]]; then
        code="${last#__azure_http_code=}"
        # drop the marker line and the newline -w put before it
        head -c "-$(( ${#last} + 1 ))" "$body_file" > "$body_file.trim" 2>/dev/null && mv "$body_file.trim" "$body_file"
    else
        code=$(grep -E '^HTTP/' "$headers_file" | tail -n 1 | tr -d '\r' | awk '{print $2}')
    fi
    printf '%s' "$code"
}

# One request attempt loop shared by azure_http_request and azure_http_paginate.
# On success (2xx, JSON body) returns 0 with the body in $_AZ_BODY and the
# response headers in $_AZ_HEADERS; the caller removes both. On failure prints a
# typed JSON error object, removes its files and returns 1.
#
# Retries: a 429 is retried for every verb (Azure rejected the request before
# acting on it, and Retry-After says when); a 5xx or a connection failure only
# for an idempotent request — a GET, PUT or DELETE, or any request the caller
# marks idempotent (a read-only POST such as a WIQL query). A POST or PATCH that
# may already have taken effect is never re-sent.
# Usage: _azure_http_exec METHOD URL [BODY] [CONTENT_TYPE] [idempotent]
_azure_http_exec() {
    local method="$1" url="$2" body="${3:-}" content_type="${4:-application/json}" idem="${5:-}"
    local retry_ok=false
    case "$method" in GET|HEAD|PUT|DELETE) retry_ok=true ;; esac
    [ "$idem" = "idempotent" ] && retry_ok=true

    # Append the default api-version unless the URL pins its own (preview
    # resources like work-item comments require a -preview version).
    local full_url="$url"
    case "$url" in
        *api-version=*) : ;;
        *\?*) full_url="${url}&api-version=${AZURE_API_VERSION}" ;;
        *) full_url="${url}?api-version=${AZURE_API_VERSION}" ;;
    esac

    local attempt=0 http_code retry_after curl_exit
    _AZ_BODY=$(mktemp)
    _AZ_HEADERS=$(mktemp)

    while :; do
        attempt=$((attempt + 1))
        : > "$_AZ_BODY"

        local curl_args=(
            -sS
            -L
            -X "$method"
            -H @-
            -D "$_AZ_HEADERS"
            -w '\n__azure_http_code=%{http_code}'
            --max-time 60
        )
        [ -n "$body" ] && curl_args+=(-H "Content-Type: ${content_type}" -d "$body")

        # Body goes to stdout (-> file) and the credential header in through a
        # here-string, so it never rides argv or a pipe that could SIGPIPE.
        curl "${curl_args[@]}" "$full_url" > "$_AZ_BODY" <<< "$(_azure_auth_header)"
        curl_exit=$?

        if [ "$curl_exit" -ne 0 ]; then
            if [ "$retry_ok" = true ] && [ "$attempt" -lt "$AZURE_HTTP_MAX_RETRIES" ]; then
                sleep $((attempt * 2))
                continue
            fi
            printf '{"error":"transport","message":"curl failed after %d attempts (exit %d)"}' "$attempt" "$curl_exit"
            rm -f "$_AZ_BODY" "$_AZ_HEADERS"
            return 1
        fi

        http_code=$(_azure_response_code "$_AZ_BODY" "$_AZ_HEADERS")

        case "$http_code" in
            203|401)
                _azure_auth_error "$http_code"
                rm -f "$_AZ_BODY" "$_AZ_HEADERS"
                return 1
                ;;
            2*)
                if [ -s "$_AZ_BODY" ] && ! jq -e . "$_AZ_BODY" >/dev/null 2>&1; then
                    # A sign-in page served as a 200 (an unauthenticated call
                    # that was redirected to the login form) is an auth failure,
                    # not a malformed response.
                    if grep -qiE 'sign in|_signin|login\.microsoftonline' "$_AZ_BODY"; then
                        _azure_auth_error "$http_code"
                    else
                        printf '{"error":"malformed-json","message":"response was not valid JSON"}'
                    fi
                    rm -f "$_AZ_BODY" "$_AZ_HEADERS"
                    return 1
                fi
                return 0
                ;;
            429|500|502|503|504)
                if [ "$http_code" != "429" ] && [ "$retry_ok" != true ]; then
                    : # a 5xx on a request that may have taken effect is surfaced, not re-sent
                elif [ "$attempt" -lt "$AZURE_HTTP_MAX_RETRIES" ]; then
                    retry_after=$(grep -i '^Retry-After:' "$_AZ_HEADERS" | tr -d '\r' | awk '{print $2}')
                    if [ -n "$retry_after" ] && [ "$http_code" = "429" ]; then
                        sleep "$retry_after"
                    else
                        sleep $((attempt * 2))
                    fi
                    continue
                fi
                printf '{"error":"http","code":%s,"message":"gave up after %d attempt(s)"}' "${http_code:-0}" "$attempt"
                rm -f "$_AZ_BODY" "$_AZ_HEADERS"
                return 1
                ;;
            *)
                # Non-retryable HTTP error (400/403/404...). Surface the Azure
                # error payload when present; redact regardless.
                local err_message
                err_message=$(jq -r '.message // empty' "$_AZ_BODY" 2>/dev/null || true)
                # Server-controlled text: strip any token material (C2).
                err_message=$(azure_redact "${err_message:-HTTP $http_code}")
                printf '{"error":"http","code":%s,"message":%s}' \
                    "${http_code:-0}" \
                    "$(jq -Rn --arg m "${err_message:-HTTP $http_code}" '$m')"
                rm -f "$_AZ_BODY" "$_AZ_HEADERS"
                return 1
                ;;
        esac
    done
}

azure_http_request() {
    local method="$1"
    local url="$2"
    local body="${3:-}"
    local content_type="${4:-application/json}"
    local idem="${5:-}"

    if ! _azure_pat_ensure; then
        return 1
    fi
    _azure_http_exec "$method" "$url" "$body" "$content_type" "$idem" || return 1
    cat "$_AZ_BODY"
    rm -f "$_AZ_BODY" "$_AZ_HEADERS"
    return 0
}

# ============================================================================
# Pagination
# ============================================================================

# Fetch the pages of a list endpoint and print one combined JSON array.
# Usage: azure_http_paginate URL [MAX_ITEMS]
#   URL        list endpoint without api-version; the continuation token is
#              appended (URL-encoded) as pages are consumed.
#   MAX_ITEMS  optional: stop paging once this many items are in hand and
#              return exactly that many (without it every page is read).
# The token comes from the x-ms-continuationtoken response header, else the
# body's continuationToken field. Pages are fetched with the same retry rules as
# a GET (including 429 backoff).
# Returns: 0 and prints a single JSON array of items; 1 on any failure.
azure_http_paginate() {
    local url="$1" max_items="${2:-}"
    local continuation="" count=0
    local -a items=()

    if ! _azure_pat_ensure; then
        return 1
    fi

    while :; do
        local page_url="$url"
        if [ -n "$continuation" ]; then
            local enc
            enc=$(jq -rn --arg t "$continuation" '$t|@uri')
            case "$page_url" in
                *\?*) page_url="${page_url}&continuationToken=${enc}" ;;
                *) page_url="${page_url}?continuationToken=${enc}" ;;
            esac
        fi

        _azure_http_exec GET "$page_url" || return 1

        # Collect this page's items (list endpoints return {"value": [...]}).
        local item
        while IFS= read -r item; do
            [ -n "$item" ] || continue
            items+=("$item")
            count=$((count + 1))
        done < <(jq -c '.value[]' "$_AZ_BODY" 2>/dev/null)

        continuation=$(grep -iE '^(x-ms-)?continuationtoken:' "$_AZ_HEADERS" | tr -d '\r' | awk '{print $2}' | head -n 1)
        if [ -z "$continuation" ]; then
            continuation=$(jq -r '.continuationToken // empty' "$_AZ_BODY" 2>/dev/null)
        fi
        rm -f "$_AZ_BODY" "$_AZ_HEADERS"

        [ -z "$continuation" ] && break
        if [ -n "$max_items" ] && [ "$count" -ge "$max_items" ]; then
            break
        fi
    done

    if [ "${#items[@]}" -eq 0 ]; then
        printf '[]'
    elif [ -n "$max_items" ]; then
        printf '%s\n' "${items[@]}" | jq -s --argjson n "$max_items" '.[0:$n]'
    else
        printf '%s\n' "${items[@]}" | jq -s '.'
    fi
    return 0
}

# ============================================================================
# Binary download
# ============================================================================

# Download a binary resource (a build artifact zip) to a file, with the same
# authentication and api-version rules as every other call. The JSON transport
# cannot carry a zip, so this bypasses its body validation; the status is still
# checked, and a failed download leaves no partial file.
# Usage: azure_http_download URL DEST_FILE
# Whether a URL is one the PAT may be sent to: https on Azure DevOps' own hosts
# (dev.azure.com, *.dev.azure.com, *.visualstudio.com). A download URL comes from
# a server response, so the host is checked before the credential is attached.
# Usage: azure_url_is_provider_host URL
azure_url_is_provider_host() {
    local host="${1#https://}"
    [ "$host" != "$1" ] || return 1
    host="${host%%/*}"
    host="${host##*@}"
    host="${host%%:*}"
    host="${host,,}"
    case "$host" in
        dev.azure.com|*.dev.azure.com|*.visualstudio.com) return 0 ;;
    esac
    return 1
}

azure_http_download() {
    local url="$1" dest="$2" code
    [ -n "$url" ] && [ -n "$dest" ] || { printf '{"error":"usage","message":"azure_http_download needs a URL and a destination"}'; return 1; }
    if ! azure_url_is_provider_host "$url"; then
        printf '{"error":"host","message":"refusing to send the PAT to a host outside Azure DevOps"}'
        return 1
    fi
    if ! _azure_pat_ensure; then
        return 1
    fi
    case "$url" in
        *api-version=*) : ;;
        *\?*) url="${url}&api-version=${AZURE_API_VERSION}" ;;
        *) url="${url}?api-version=${AZURE_API_VERSION}" ;;
    esac
    local headers_file
    headers_file=$(mktemp)
    code=$(curl -sS -L -H @- -D "$headers_file" -o "$dest" -w '%{http_code}' --max-time 600 "$url" <<< "$(_azure_auth_header)") || {
        rm -f "$dest" "$headers_file"
        printf '{"error":"transport","message":"curl failed downloading the artifact"}'
        return 1
    }
    [ -n "$code" ] || code=$(grep -E '^HTTP/' "$headers_file" | tail -n 1 | tr -d '\r' | awk '{print $2}')
    rm -f "$headers_file"
    case "$code" in
        203|401) rm -f "$dest"; _azure_auth_error "$code"; return 1 ;;
        2*) return 0 ;;
        *) rm -f "$dest"; printf '{"error":"http","code":%s,"message":"artifact download failed"}' "${code:-0}"; return 1 ;;
    esac
}
