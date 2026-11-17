#!/usr/bin/env bash
# config-reader.bash
# The one INI reader for devenv.config: every reader in the tooling (provider
# detection and identity, bootstrap, setup) goes through it.
#
# Rules, the same on every path:
#   - a section header and a key are matched exactly, never as a prefix or a pattern
#   - spaces and tabs around headers, keys and values are ignored, as are a trailing CR
#     (CRLF files), blank lines and full-line comments (# or ;)
#   - a value is everything after the first "=", so it may contain "="
#   - a key that is present twice reads as its last occurrence
#   - a key that is present but empty reads the same as an absent key: the caller's
#     default is returned
#
# Two ways to read:
#   config_get_raw FILE SECTION KEY [DEFAULT]   the literal value from FILE
#   config_get     FILE SECTION KEY [DEFAULT]   the same, with ${PROVIDER_ORG} and
#                                               ${PROVIDER_USER} expanded
# Both take the file explicitly and touch no global, so reading one file never
# changes what another reader sees. config_init / config_read_value remain for
# callers that read one file repeatedly: config_init sets CONFIG_FILE and
# config_read_value reads it.
# Token variables are never interpolated: a config file is a persistent surface and
# must not carry or expand secrets.

# Guard against multiple sourcing
if [ -n "${_CONFIG_READER_LOADED:-}" ]; then return 0; fi
_CONFIG_READER_LOADED=1

# The scanner every reader shares: prints the value of SECTION/KEY in FILE, or nothing.
# Usage: _config_scan FILE SECTION KEY [WARN_DUPLICATES: 1|0]
_config_scan() {
    awk -v section="$2" -v key="$3" -v warn="${4:-0}" -v conffile="$1" '
        { line = $0; sub(/\r$/, "", line); gsub(/^[ \t]+|[ \t]+$/, "", line) }
        match(line, /^\[[^]]*\]/) {
            # anything after the closing bracket (a trailing comment) is ignored
            name = substr(line, 2, RLENGTH - 2)
            gsub(/^[ \t]+|[ \t]+$/, "", name)
            in_section = (name == section)
            next
        }
        !in_section || line == "" || line ~ /^[#;]/ { next }
        {
            idx = index(line, "=")
            if (idx == 0) next
            k = substr(line, 1, idx - 1); gsub(/[ \t]+$/, "", k)
            if (k != key) next
            v = substr(line, idx + 1); gsub(/^[ \t]+/, "", v)
            if (seen++ && warn) {
                printf "WARNING: duplicate key %s.%s in %s (line %d) — using last value\n", section, key, conffile, NR > "/dev/stderr"
            }
            val = v
        }
        END { if (seen) print val }
    ' "$1"
}

# Expand the template variables in a value: ${PROVIDER_ORG} and ${PROVIDER_USER},
# through the provider identity accessors when the provider layer is loaded. The
# accessors read RAW values, so this cannot re-enter the reader. Pure parameter
# expansion (not sed), so secret values never transit a process argument. The
# token replacement is a prefix/suffix split rather than ${v//pat/repl}: on bash
# 5.2 an unquoted "&" in the replacement of that form expands to the matched
# pattern (patsub_replacement), and quoting inside a quoted expansion behaves
# differently across bash 3.2, 4.x and 5.x. Split-and-append treats "&", "/"
# and backslash in values literally on every version.
_config_replace_token() {
    local rest="$1" token="$2" repl="$3" out=""
    while [[ "$rest" == *"$token"* ]]; do
        out+="${rest%%"$token"*}${repl}"
        rest="${rest#*"$token"}"
    done
    printf '%s' "${out}${rest}"
}

_config_expand() {
    local value="$1"
    if declare -F provider_org_get >/dev/null; then
        local org_res user_res
        org_res=$(provider_org_get 2>/dev/null || true)
        user_res=$(provider_user_get 2>/dev/null || true)
        # Single-pass expansion: each token is replaced over the ORIGINAL value only.
        # A token spelling arriving inside an accessor-resolved value is neutralized
        # with a sentinel that no later pass matches, so sequential replaces cannot
        # re-expand substituted content.
        local sentinel=$'\x01'
        org_res="${org_res//\$\{/$sentinel\{}"
        user_res="${user_res//\$\{/$sentinel\{}"
        value=$(_config_replace_token "$value" '${PROVIDER_ORG}' "${org_res:-}")
        value=$(_config_replace_token "$value" '${PROVIDER_USER}' "${user_res:-}")
        value="${value//$sentinel/\$}"
    fi
    printf '%s' "$value"
}

# Read a literal value from FILE (no expansion). Returns 1, printing nothing, when
# the file does not exist.
# Usage: config_get_raw FILE SECTION KEY [DEFAULT]
config_get_raw() {
    local file="$1" section="$2" key="$3" default="${4:-}"
    [ -f "$file" ] || return 1
    local value
    value=$(_config_scan "$file" "$section" "$key" 0)
    printf '%s\n' "${value:-$default}"
}

# Read a value from FILE with ${PROVIDER_ORG}/${PROVIDER_USER} expanded. Returns 1,
# printing nothing, when the file does not exist. A repeated key warns on stderr.
# Usage: config_get FILE SECTION KEY [DEFAULT]
config_get() {
    local file="$1" section="$2" key="$3" default="${4:-}"
    [ -f "$file" ] || return 1
    local value
    value=$(_config_scan "$file" "$section" "$key" 1)
    [ -n "$value" ] || value="$default"
    printf '%s\n' "$(_config_expand "$value")"
}

# Initialize config reader
# Usage: config_init <config_file_path>
config_init() {
    local config_file="$1"
    
    if [[ ! -f "$config_file" ]]; then
        echo "ERROR: Configuration file not found: $config_file" >&2
        return 1
    fi
    
    CONFIG_FILE="$config_file"
    return 0
}

# Read a single value from the file config_init selected.
# Usage: config_read_value <section> <key> [default_value]
# Returns: The value with template variables expanded, or default_value if not found
config_read_value() {
    local section="$1"
    local key="$2"
    local default="${3:-}"

    if [[ -z "$CONFIG_FILE" ]]; then
        echo "ERROR: config_init not called" >&2
        return 1
    fi
    config_get "$CONFIG_FILE" "$section" "$key" "$default"
}
