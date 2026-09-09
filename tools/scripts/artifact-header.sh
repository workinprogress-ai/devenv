#!/bin/bash
# artifact-header.sh - Parse, verify, and stamp DEVENV_ARTIFACT_V1 headers in local files
# Version: 1.0.0
# Description: Deterministic replacement for hand-parsing artifact metadata blocks:
#              read the header as JSON, extract single fields, bump updated_at_utc,
#              and set individual keys without touching the rest of the document.
# Requirements: Bash 4.0+, jq

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Parse and stamp DEVENV_ARTIFACT_V1 headers in local files"

FILE=""
FIELD=""
STAMP=0
SETS=()

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME FILE [OPTIONS]

Read, verify, or update the DEVENV_ARTIFACT_V1 metadata block at the top of
a local artifact file. Without options, prints the parsed header as JSON.

Arguments:
    FILE                         Artifact file to inspect/update

Options:
    --field NAME                 Print the raw value of one header key (exit 1 if absent)
    --stamp                      Rewrite updated_at_utc to the current UTC time
                                 (inserts the line if the block lacks it)
    --set KEY=VALUE              Set/replace one header key (repeatable)
    -V, --verbose                Enable verbose logs
    -h, --help                   Show help and exit
    -v, --version                Show version and exit

Output:
    JSON object: {"found": true, "header": {<parsed key/value pairs>}}
    or {"found": false} (exit 1) when no DEVENV_ARTIFACT_V1 block is present.

Exit Codes:
    0 success
    1 no artifact header found / requested field absent
    2 invalid arguments
    4 I/O failure
EOF
    exit 0
}

invalid_args() {
    log_error "$1"
    echo "Use --help for usage information"
    exit 2
}

# Parse the header block from stdin-ish text; echoes JSON {key:value,...} or empty
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

main() {
    if [ $# -eq 0 ]; then
        invalid_args "Required arguments are missing"
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_usage ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose) shift ;;  # verbosity handled via log level env; flag accepted for CLI consistency
            --field)
                [ -z "${2:-}" ] && invalid_args "Missing value for --field"
                FIELD="$2"; shift 2 ;;
            --stamp) STAMP=1; shift ;;
            --set)
                [ -z "${2:-}" ] && invalid_args "Missing value for --set (KEY=VALUE)"
                SETS+=("$2"); shift 2 ;;
            *) FILE="$1"; shift ;;
        esac
    done

    if [ -z "$FILE" ]; then
        invalid_args "FILE is required"
    fi
    if [ ! -f "$FILE" ]; then
        invalid_args "File not found: $FILE"
    fi

    local body
    if ! body=$(cat "$FILE"); then
        log_error "Failed to read $FILE"
        exit 4
    fi

    local header_json
    if ! header_json=$(parse_header_json "$body") || [ -z "$header_json" ]; then
        echo '{"found": false}'
        exit 1
    fi

    # Read-only single-field mode
    if [ -n "$FIELD" ] && [ "$STAMP" -eq 0 ] && [ "${#SETS[@]}" -eq 0 ]; then
        local value
        if ! value=$(echo "$header_json" | jq -r --arg f "$FIELD" '.[$f] // empty' 2>/dev/null) || [ -z "$value" ]; then
            log_error "Field not found in artifact header: $FIELD"
            exit 1
        fi
        echo "$value"
        exit 0
    fi

    if [ "$STAMP" -eq 1 ] || [ "${#SETS[@]}" -gt 0 ]; then
        local now
        now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

        # Build an awk program that rewrites matching keys inside the block,
        # or inserts missing keys just before the closing -->.
        local awk_sets=""
        local kv key val
        for kv in "${SETS[@]}"; do
            key="${kv%%=*}"
            val="${kv#*=}"
            awk_sets="$awk_sets\nrewrite[\"$key\"]=\"$val\""
        done
        if [ "$STAMP" -eq 1 ]; then
            awk_sets="$awk_sets\nrewrite[\"updated_at_utc\"]=\"$now\""
        fi

        awk -v prog="$awk_sets" '
            BEGIN {
                n = split(prog, lines, "\n")
                for (i = 1; i <= n; i++) if (lines[i] != "") {
                    # each line looks like: rewrite["key"]="value"
                    k = lines[i]
                    sub(/^rewrite\["/, "", k); sub(/"\].*/, "", k)
                    v = lines[i]
                    sub(/^rewrite\["[^"]*"\]="/, "", v); sub(/"$/, "", v)
                    rewrite[k] = v
                }
                inblock = 0; seen[""] = 0; delete seen[""]
            }
            /DEVENV_ARTIFACT_V1/ { inblock = 1; print; next }
            inblock && /^-->/ {
                for (k in rewrite) if (!seen[k]) print k ": " rewrite[k]
                print; inblock = 0; next
            }
            inblock && /^[[:space:]]*[A-Za-z_]+[[:space:]]*:/ {
                line = $0
                key = line
                sub(/^[[:space:]]+/, "", key); sub(/:.*/, "", key)
                if (key in rewrite) {
                    seen[key] = 1
                    indent = line
                    sub(/[^[:space:]].*$/, "", indent)
                    print indent key ": " rewrite[key]
                    next
                }
            }
            { print }
        ' "$FILE" > "$FILE.tmp" || { rm -f "$FILE.tmp"; log_error "Header rewrite failed"; exit 4; }
        mv "$FILE.tmp" "$FILE"
    fi

    # Report the (possibly updated) header
    if ! header_json=$(parse_header_json "$(cat "$FILE")") || [ -z "$header_json" ]; then
        log_error "Header lost after rewrite — this is a bug"
        exit 4
    fi
    echo "$header_json" | jq --argjson h "$header_json" '{found: true, header: $h}'
}

main "$@"
