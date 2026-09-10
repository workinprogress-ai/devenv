#!/bin/bash
# plan-parse.sh - Deterministic plan structure parsing
# Version: 1.0.0
# Description: Extracts phases, tasks, completion state, and file-path anchors
#              from Plan-*.md (or legacy Implementation_plan-*.md) as JSON — replaces model-side
#              heading/checkbox/Files-bullet harvesting and staleness scans.
# Requirements: Bash 4.0+, jq, grep

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Parse plan structure into JSON"

FILE=""
MODE="structure"   # structure | anchors | census

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME FILE [OPTIONS]

Parse a Plan-*.md (or legacy Implementation_plan-*.md) deterministically.

Modes:
    --structure  (default) Phases with tasks and completion state:
                 {phases:[{number,title,start_line,tasks:[{id,text,done,
                 decision,files:[]}]}], acs:[{id,text,done}]}
    --anchors    File paths mentioned in the plan (Files: bullets and inline
                 path-like tokens) with existence check relative to the
                 plan's directory: {anchors:[{path,exists}]}
    --census     One-line completion summary per phase:
                 {census:[{phase,total,done,open}], totals:{tasks,done,open}}

Options:
    -V, --verbose   Enable verbose logs
    -h, --help      Show help and exit
    -v, --version   Show version and exit

Exit Codes:
    0 success
    2 invalid arguments
EOF
    exit 0
}

invalid_args() {
    log_error "$1"
    echo "Use --help for usage information"
    exit 2
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
            -V|--verbose) shift ;;
            --structure|--anchors|--census)
                MODE="${1#--}"; shift ;;
            *) FILE="$1"; shift ;;
        esac
    done

    if [ -z "$FILE" ]; then
        invalid_args "FILE is required"
    fi
    if [ ! -f "$FILE" ]; then
        invalid_args "File not found: $FILE"
    fi

    local plan_dir
    plan_dir=$(dirname "$FILE")

    if [ "$MODE" = "anchors" ]; then
        # Path-like tokens: Files: bullets plus inline paths ending in source extensions
        local paths_json
        paths_json=$(grep -oE '[A-Za-z0-9_./-]+\.(cs|ts|tsx|js|json|csproj|sh|md|sql|yaml|yml|py)' "$FILE" \
            | grep -v '://' | sort -u \
            | while IFS= read -r p; do
                if [ -e "$plan_dir/$p" ] || [[ "$p" == /* && -e "$p" ]]; then
                    echo "{\"path\": \"$p\", \"exists\": true},"
                else
                    echo "{\"path\": \"$p\", \"exists\": false},"
                fi
              done | sed '$ s/,$//' | sed 's/^/ /' )
        echo "{"
        echo "  \"anchors\": [${paths_json//[[:space:]]+$//}]"
        echo "}"
        exit 0
    fi

    # structure + census share the same extraction pipeline
    local parsed
    parsed=$(awk '
        BEGIN { inphase = 0; phasenum = ""; inac = 0 }
        /^#+[[:space:]]*Phase[[:space:]]+[0-9]+/ {
            heading = $0
            sub(/^#+[[:space:]]*/, "", heading)
            phasenum = heading
            match(phasenum, /[0-9]+/)
            phasenum = substr(phasenum, RSTART, RLENGTH)
            title = heading
            sub(/^Phase[[:space:]]+[0-9]+[[:space:]]*[—–-]?[[:space:]]*/, "", title)
            # strip any leading non-alphanumeric residue (em-dash encodings)
            sub(/^[^A-Za-z0-9]+/, "", title)
            printf "PHASE\t%s\t%s\t%d\n", phasenum, title, NR
            inphase = 1
            next
        }
        # AC checklist: "- [ ] <a id="ac-1"></a>**AC-1** ..." or "- [x] **AC-1** ..."
        /^-[[:space:]]*\[[ xX]\].*AC-[0-9]+/ {
            line = $0
            id = line
            match(id, /AC-[0-9]+/)
            id = substr(id, RSTART, RLENGTH)
            # AC list bullet "- [AC-8](#ac-8)" has no checkbox — excluded by the regex above
            done = (line ~ /^-[[:space:]]*\[[xX]\]/) ? "1" : "0"
            printf "AC\t%s\t%s\n", id, done
            next
        }
        # Task line: "- [x] **1.1 [S] title**" or "- [ ] 1.2 title" (bold optional)
        inphase && /^-[[:space:]]*\[[ xX]\][[:space:]]*(\*\*)?[0-9]+\.[0-9]+/ {
            line = $0
            id = line
            sub(/^[^(0-9)]*[0-9]+\.[0-9]+.*$/, "") # placeholder, replaced below
            rest = line
            sub(/^-[[:space:]]*\[[ xX]\][[:space:]]*/, "", rest)
            sub(/^\*\*/, "", rest)
            id = rest
            match(id, /^[0-9]+\.[0-9]+/)
            id = substr(id, RSTART, RLENGTH)
            done = (line ~ /^-[[:space:]]*\[[xX]\]/) ? "1" : "0"
            text = rest
            sub(/^[0-9]+\.[0-9]+[[:space:]]*/, "", text)
            sub(/^\*\*/, "", text)
            sub(/\*\*[[:space:]]*$/, "", text)
            printf "TASK\t%s\t%s\t%s\t%s\t%d\n", id, done, text, phasenum, NR
            next
        }
    ' "$FILE")

    if [ "$MODE" = "structure" ]; then
        local js='[]'
        local acs='[]'
        while IFS=$'\t' read -r kind a b c d; do
            case "$kind" in
                PHASE)
                    js=$(echo "$js" | jq --arg n "$a" --arg t "$b" --argjson l "$c" \
                        '. + [{number: $n, title: $t, start_line: $l, tasks: []}]')
                    ;;
                TASK)
                    js=$(echo "$js" | jq --arg id "$a" --arg dn "$b" --arg text "$c" --arg ph "$d" \
                        '.[-1].tasks += [{id: $id, done: ($dn == "1"), text: $text}]')
                    ;;
                AC)
                    acs=$(echo "$acs" | jq --arg id "$a" --arg dn "$b" \
                        '. + [{id: $id, done: ($dn == "1")}]')
                    ;;
            esac
        done <<< "$parsed"
        echo "$js" | jq --slurpfile acs <(echo "$acs") '{phases: ., acs: $acs[0]}'
        exit 0
    fi

    # census mode
    echo "$parsed" | awk -F'\t' '
        $1 == "PHASE" { phase[$2] = 0; total[$2] = 0 }
        $1 == "TASK" { total[$5]++; if ($2 == "1") phase[$5]++ }
        END {
            print "{"
            printf "  \"census\": ["
            first = 1
            gt = 0; gd = 0
            for (p in total) {
                if (!first) printf ", "
                first = 0
                printf "{\"phase\": \"%s\", \"total\": %d, \"done\": %d, \"open\": %d}", p, total[p], phase[p], total[p] - phase[p]
                gt += total[p]; gd += phase[p]
            }
            printf "],\n"
            printf "  \"totals\": {\"tasks\": %d, \"done\": %d, \"open\": %d}\n", gt, gd, gt - gd
            print "}"
        }
    '
}

main "$@"
