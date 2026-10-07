#!/usr/bin/env bash
# smoke-capture.bash (azure provider) - Redaction and capture helpers for the
# live smoke harness (azure-smoke-test.sh).
#
# When AZURE_SMOKE_CAPTURE_DIR is set, the harness records each live response
# there as a fixture the provider bats tests can parse. A recorded response
# must carry no credential, no real identity, and no real GUID, so everything
# is passed through smoke_redact before it touches disk.
#
# Redaction rules:
#   - the PAT and its Basic-auth base64 form              -> REDACTED-PAT
#   - JSON identity fields (displayName, uniqueName,
#     mailAddress, principalName, descriptor, imageUrl,
#     directoryAlias), at any depth                       -> fixed placeholders
#   - GUIDs                                               -> stable placeholders
#     (same GUID, same placeholder, across every call in one run)
#   - the org and project names (also as <org>.visualstudio.com)
#                                                         -> example-org / Example-Project
#   - email addresses, and identity descriptors such as
#     aad.<base64> embedded in URLs                       -> user@example.test / aad.EXAMPLE
#
# The GUID mapping holds the REAL values, so it lives in a private temp file
# (SMOKE_REDACT_MAP) and never in the capture directory. The caller owns removing it
# (the harness registers it with its teardown stack).
#
# Sourced, never executed. No side effects at load.

if [ -n "${_AZURE_SMOKE_CAPTURE_LOADED:-}" ]; then return 0; fi
_AZURE_SMOKE_CAPTURE_LOADED=1

_SMOKE_GUID_RE='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
_SMOKE_GUID_PLACEHOLDER_PREFIX='00000000-0000-4000-8000-'

# Create (once) the private GUID map file and print its path. The path is also
# exported as SMOKE_REDACT_MAP; call this in the parent shell (not inside $( ))
# so later calls in the same run share one mapping.
smoke_redact_map_init() {
    if [ -z "${SMOKE_REDACT_MAP:-}" ] || [ ! -f "$SMOKE_REDACT_MAP" ]; then
        SMOKE_REDACT_MAP="$(mktemp "${TMPDIR:-/tmp}/smoke-redact-map.XXXXXX")"
        chmod 600 "$SMOKE_REDACT_MAP"
        export SMOKE_REDACT_MAP
    fi
    printf '%s\n' "$SMOKE_REDACT_MAP"
}

# Escape a literal for use inside a sed basic-regex pattern.
_smoke_sed_escape() {
    printf '%s' "$1" | sed 's/[][\.*^$/]/\\&/g'
}

# Redact stdin to stdout. Valid JSON stays valid JSON.
smoke_redact() {
    smoke_redact_map_init >/dev/null
    local text
    text="$(cat)"

    # 1. Credentials.
    if [ -n "${AZURE_PAT:-}" ]; then
        local b64
        b64="$(printf ':%s' "$AZURE_PAT" | base64 -w0)"
        text="${text//"$b64"/REDACTED-PAT}"
        text="${text//"$AZURE_PAT"/REDACTED-PAT}"
    fi

    # 2. Identity fields in JSON (any depth).
    if printf '%s' "$text" | jq -e . >/dev/null 2>&1; then
        text="$(printf '%s' "$text" | jq -c '
            {"displayName":"Example User","uniqueName":"user@example.test",
             "mailAddress":"user@example.test","principalName":"user@example.test",
             "descriptor":"aad.EXAMPLE","imageUrl":"https://example.test/avatar",
             "directoryAlias":"example.user"} as $m
            | walk(if type == "object"
                   then with_entries(.key as $k
                                     | if (.value | type) == "string" and ($m | has($k))
                                       then .value = $m[$k] else . end)
                   else . end)')"
    fi

    # 3. Email addresses, and identity descriptors embedded in URLs or strings
    #    (aad.<base64 of the identity>, msa., vssgp. ...): these decode to a real
    #    identity id, so they are replaced wherever they appear.
    text="$(printf '%s' "$text" | sed -E \
        -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/user@example.test/g' \
        -e 's/\b(aad|aadgp|msa|vssgp|svc|s2s|win|bnd)\.[A-Za-z0-9_-]{6,}/\1.EXAMPLE/g')"

    # 4. Org and project names (case-insensitive).
    local script
    script="$(mktemp "${TMPDIR:-/tmp}/smoke-redact-sed.XXXXXX")"
    if [ -n "${AZURE_DEVOPS_ORG:-}" ]; then
        printf 's/%s/example-org/Ig\n' "$(_smoke_sed_escape "$AZURE_DEVOPS_ORG")" >> "$script"
    fi
    if [ -n "${AZURE_SMOKE_TEST_PROJECT:-}" ]; then
        printf 's/%s/Example-Project/Ig\n' "$(_smoke_sed_escape "$AZURE_SMOKE_TEST_PROJECT")" >> "$script"
    fi

    # 5. GUIDs: stable placeholders, already-placeholder GUIDs left alone.
    local guid placeholder n
    while IFS= read -r guid; do
        [ -n "$guid" ] || continue
        placeholder="$(awk -v g="$guid" '$1 == g { print $2; exit }' "$SMOKE_REDACT_MAP")"
        if [ -z "$placeholder" ]; then
            n=$(( $(wc -l < "$SMOKE_REDACT_MAP") + 1 ))
            placeholder="$(printf '%s%012x' "$_SMOKE_GUID_PLACEHOLDER_PREFIX" "$n")"
            printf '%s %s\n' "$guid" "$placeholder" >> "$SMOKE_REDACT_MAP"
        fi
        printf 's/%s/%s/Ig\n' "$guid" "$placeholder" >> "$script"
    done < <(printf '%s' "$text" | grep -oiE "$_SMOKE_GUID_RE" | tr 'A-F' 'a-f' | sort -u \
             | grep -v "^${_SMOKE_GUID_PLACEHOLDER_PREFIX}" || true)

    if [ -s "$script" ]; then
        text="$(printf '%s' "$text" | sed -f "$script")"
    fi
    rm -f "$script"

    printf '%s\n' "$text"
}

# Record stdin as a redacted fixture named NAME in AZURE_SMOKE_CAPTURE_DIR
# (NAME.json when the body is JSON, NAME.txt otherwise). A no-op when no capture
# directory is set. NAME is sanitized: it can never address a path outside the
# capture directory.
smoke_capture() {
    local name="${1:?capture name required}"
    if [ -z "${AZURE_SMOKE_CAPTURE_DIR:-}" ]; then
        cat >/dev/null
        return 0
    fi
    local safe
    safe="$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '_')"
    safe="${safe//../_}"
    safe="${safe#.}"
    [ -n "$safe" ] || safe="capture"
    mkdir -p "$AZURE_SMOKE_CAPTURE_DIR"
    local redacted
    redacted="$(smoke_redact)"
    if printf '%s' "$redacted" | jq -e . >/dev/null 2>&1; then
        printf '%s' "$redacted" | jq . > "$AZURE_SMOKE_CAPTURE_DIR/$safe.json"
    else
        printf '%s\n' "$redacted" > "$AZURE_SMOKE_CAPTURE_DIR/$safe.txt"
    fi
}

# Outcome assertion: succeeds only when FILTER is true for the JSON in $1.
# Invalid JSON or a false filter both return 1.
smoke_jq_ok() {
    local json="${1-}" filter="${2:?jq filter required}"
    printf '%s' "$json" | jq -e "$filter" >/dev/null 2>&1 || return 1
}
