#!/usr/bin/env bash
# artifact-header.bash - DEVENV_ARTIFACT_V1 header parsing for tools
# Version: 1.0.0
# Description: Shared parser for the DEVENV_ARTIFACT_V1 metadata block.
#              Single implementation of the header contract used by
#              artifact-header.sh and the issue-artifact-* family.
# Requirements: Bash 4.0+, awk

# Guard against multiple sourcing
if [ -n "${_ARTIFACT_HEADER_LIB_LOADED:-}" ]; then
    return 0
fi
readonly _ARTIFACT_HEADER_LIB_LOADED=1

# parse_header_json BODY
#   Parses the DEVENV_ARTIFACT_V1 block from BODY (a string; the caller
#   decides the prefix window, e.g. first 256/1024 chars) and emits it as a
#   flat JSON object: {"key":"value",...}. Returns 1 when the body has no
#   artifact header marker.
#   Same awk engine as artifact-header.sh's original implementation — the
#   canonical header contract lives here now.
parse_header_json() {
    local body="$1"
    local prefix
    prefix="${body:0:1024}"
    if ! printf '%s\n' "$prefix" | grep -q 'DEVENV_ARTIFACT_V1'; then
        return 1
    fi
    printf '%s\n' "$prefix" \
        | awk '/DEVENV_ARTIFACT_V1/{inblock=1;next} inblock&&/^-->/{exit} inblock&&/^[[:space:]]*[A-Za-z_]+[[:space:]]*:/{
            line=$0
            sub(/^[[:space:]]+/,"",line)
            key=line; sub(/:.*/,"",key)
            val=line; sub(/^[^:]*:[[:space:]]*/,"",val)
            gsub(/"/,"\\\"",val)
            print "\"" key "\":\"" val "\""
        }' \
        | paste -sd, - \
        | sed 's/^/{/; s/$/}/'
}

# artifact_header_field BODY KEY
#   Prints the value of KEY from the DEVENV_ARTIFACT_V1 block in BODY
#   (leading/trailing whitespace of the value stripped). Empty output when
#   the key is absent. The caller scopes BODY (e.g. first 256 chars when
#   enforcing the first-256 placement rule).
artifact_header_field() {
    local body="$1"
    local key="$2"
    printf '%s\n' "$body" | sed -n "s/^[[:space:]]*${key}:[[:space:]]*//p" | head -1
}
