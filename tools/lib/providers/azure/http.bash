#!/bin/bash
# providers/azure/http.bash - Thin HTTP transport for the Azure DevOps provider.
#
# Everything HTTP lives here once: Basic-auth header from the PAT,
# api-version injection, ContinuationToken pagination, 429/Retry-After and
# transient-5xx retry with backoff, jq response validation, and token
# redaction on every log/error path. Domain modules (providers/azure/*)
# call azure_http_request / azure_http_paginate; they never touch curl.
#
# Contract:
#   - PAT travels ONLY as an Authorization header. Query-string tokens are
#     forbidden (they leak into logs and process listings).
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

# Build the Authorization header value off-argv. The PAT never appears in a
# curl argument (process listings) — only inside this header string.
_azure_auth_header() {
    printf 'Authorization: Basic %s' "$(printf ':%s' "${AZURE_PAT}" | base64 | tr -d '\r\n')"
}
azure_http_request() {
    local method="$1"
    local url="$2"
    local body="${3:-}"
    local content_type="${4:-application/json}"

    if ! _azure_pat_ensure; then
        return 1
    fi

    # Append the default api-version unless the URL pins its own (preview
    # resources like work-item comments require a -preview version).
    local full_url="$url"
    case "$url" in
        *api-version=*) : ;;
        *\?*) full_url="${url}&api-version=${AZURE_API_VERSION}" ;;
        *) full_url="${url}?api-version=${AZURE_API_VERSION}" ;;
    esac

    local attempt=0
    local http_code retry_after body_file headers_file
    body_file=$(mktemp)
    headers_file=$(mktemp)

    while :; do
        attempt=$((attempt + 1))

        local curl_args=(
            -sS
            -X "$method"
            -H "$(_azure_auth_header)"
            -D "$headers_file"
            --max-time 60
        )
        [ -n "$body" ] && curl_args+=(-H "Content-Type: ${content_type}" -d "$body")

        # Body is captured via stdout redirection rather than curl's -o: the
        # captured file is then guaranteed to hold exactly what this function
        # validates and emits (works with any curl, stubbed or real).
        curl "${curl_args[@]}" "$full_url" > "$body_file"
        local curl_exit=$?

        if [ "$curl_exit" -ne 0 ]; then
            # Transport-level failure (DNS, timeout, connection). Retry only
            # if attempts remain.
            if [ "$attempt" -lt "$AZURE_HTTP_MAX_RETRIES" ]; then
                sleep $((attempt * 2))
                continue
            fi
            printf '{"error":"transport","message":"curl failed after %d attempts (exit %d)"}' "$attempt" "$curl_exit"
            rm -f "$body_file" "$headers_file"
            return 1
        fi

        http_code=$(head -n1 "$headers_file" | tr -d '\r' | awk '{print $2}')

        case "$http_code" in
            2*)
                # Success. Validate JSON when the body is non-empty.
                if [ -s "$body_file" ] && ! jq -e . "$body_file" >/dev/null 2>&1; then
                    printf '{"error":"malformed-json","message":"response was not valid JSON"}'
                    rm -f "$body_file" "$headers_file"
                    return 1
                fi
                cat "$body_file"
                rm -f "$body_file" "$headers_file"
                return 0
                ;;
            429|500|502|503|504)
                # Retryable. Honor Retry-After for 429, exponential otherwise.
                if [ "$attempt" -ge "$AZURE_HTTP_MAX_RETRIES" ]; then
                    printf '{"error":"http","code":%s,"message":"gave up after %d attempts"}' "${http_code:-0}" "$attempt"
                    rm -f "$body_file" "$headers_file"
                    return 1
                fi
                retry_after=$(grep -i '^Retry-After:' "$headers_file" | tr -d '\r' | awk '{print $2}')
                if [ -n "$retry_after" ] && [ "$http_code" = "429" ]; then
                    sleep "$retry_after"
                else
                    sleep $((attempt * 2))
                fi
                continue
                ;;
            *)
                # Non-retryable HTTP error (400/401/403/404...). Surface the
                # Azure error payload when present; redact regardless.
                local err_message
                err_message=$(jq -r '.message // empty' "$body_file" 2>/dev/null || true)
                # Server-controlled text: strip any token material (C2).
                err_message=$(azure_redact "${err_message:-HTTP $http_code}")
                printf '{"error":"http","code":%s,"message":%s}' \
                    "${http_code:-0}" \
                    "$(jq -Rn --arg m "${err_message:-HTTP $http_code}" '$m')"
                rm -f "$body_file" "$headers_file"
                return 1
                ;;
        esac
    done
}

# ============================================================================
# Pagination
# ============================================================================

# Fetch all pages of a list endpoint and print one combined JSON array.
# Usage: azure_http_paginate URL
#   URL   list endpoint without api-version; the ContinuationToken parameter
#         is appended here as pages are consumed.
# Returns: 0 and prints a single JSON array of all items; 1 on any failure.
azure_http_paginate() {
    local url="$1"
    local continuation=""
    local -a items=()

    if ! _azure_pat_ensure; then
        return 1
    fi

    while :; do
        local page_url="$url"
        if [ -n "$continuation" ]; then
            case "$page_url" in
                *\?*) page_url="${page_url}&continuationToken=${continuation}" ;;
                *) page_url="${page_url}?continuationToken=${continuation}" ;;
            esac
        fi

        local headers_file body_file
        headers_file=$(mktemp)
        body_file=$(mktemp)

        local page_separator='?'
        case "$page_url" in
            *\?*) page_separator='&' ;;
        esac

        # stdout capture (see azure_http_request): the validated file is
        # exactly what curl emitted.
        if ! curl -sS -H "$(_azure_auth_header)" -D "$headers_file" --max-time 60 \
            "${page_url}${page_separator}api-version=${AZURE_API_VERSION}" > "$body_file"; then
            printf '{"error":"transport","message":"curl failed during pagination"}'
            rm -f "$body_file" "$headers_file"
            return 1
        fi

        if ! jq -e . "$body_file" >/dev/null 2>&1; then
            printf '{"error":"malformed-json","message":"page response was not valid JSON"}'
            rm -f "$body_file" "$headers_file"
            return 1
        fi

        # Status gate: a non-2xx page (401/404/429/5xx) is an error, not an
        # empty page — without this the loop silently yields "[]".
        local page_code
        page_code=$(head -n1 "$headers_file" | tr -d '\r' | awk '{print $2}')
        case "$page_code" in
            2*) : ;;
            *)
                printf '{"error":"http","code":%s,"message":"list request failed"}' "${page_code:-0}"
                rm -f "$body_file" "$headers_file"
                return 1
                ;;
        esac

        # Collect this page's items (list endpoints return {"value": [...]}).
        while IFS= read -r item; do
            [ -n "$item" ] && items+=("$item")
        done < <(jq -c '.value[]' "$body_file" 2>/dev/null)

        continuation=$(grep -i '^ContinuationToken:' "$headers_file" | tr -d '\r' | awk '{print $2}')
        rm -f "$body_file" "$headers_file"

        [ -z "$continuation" ] && break
    done

    # Emit one combined array.
    if [ "${#items[@]}" -eq 0 ]; then
        printf '[]'
    else
        printf '%s\n' "${items[@]}" | jq -s '.'
    fi
    return 0
}
