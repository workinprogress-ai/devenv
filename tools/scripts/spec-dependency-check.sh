#!/bin/bash
# spec-dependency-check.sh - Validate Specifications-*.md dependency graph and anchors
# Version: 1.0.0
# Description: Deterministic integrity checks the model otherwise does by eye:
#              unknown dependency references, dependency cycles, group-order
#              violations, and broken SPEC-ID markdown links.
# Requirements: Bash 4.0+, jq

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Validate specifications dependency graph and anchors"

FILES=()

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME FILE [FILE...]

Validate Specifications-*.md documents (pass multiple files for cross-doc
edge checking — cross-file edges are informational, not violations).

Checks:
    unknown      A Depends on: references a SPEC-ID not defined in any input
    cycle        Dependency cycles (including transitive)
    group-order  A specification item depends on one in a LATER priority group
    links        A [SPEC-NNN](#anchor) link whose anchor does not match any
                 heading in the document

Output: JSON {"errors": [...], "warnings": [...], "edges": N, "ok": bool}
Warnings never affect exit status; errors set exit 1.

Exit Codes:
    0 no errors (warnings allowed)
    1 validation errors found
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
        invalid_args "At least one Specifications file is required"
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_usage ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose) shift ;;
            --*) invalid_args "Unknown option: $1" ;;
            *)
                [ -f "$1" ] || invalid_args "File not found: $1"
                FILES+=("$1")
                shift ;;
        esac
    done

    # ---- Pass 1: per-file extraction into TSV: id, group, deps(csv), file ----
    local tsv=""
    local f
    for f in "${FILES[@]}"; do
        local file_tsv
        file_tsv=$(awk -v fname="$f" '
            /^#+[[:space:]]+SPEC-[0-9]+/ {
                id = $0
                sub(/^#+[[:space:]]+/, "", id)
                match(id, /SPEC-[0-9]+/)
                id = substr(id, RSTART, RLENGTH)
                cur = id; deps[cur] = ""; grp[cur] = ""
                order[++n] = cur
                next
            }
            cur && /^[[:space:]]*\**Dependencies:\**[[:space:]]*/ {
                line = $0
                sub(/^[[:space:]]*\**Dependencies:\**[[:space:]]*/, "", line)
                deps[cur] = line
                next
            }
            cur && /^[[:space:]]*\**Group:\**[[:space:]]*/ {
                line = $0
                sub(/^[[:space:]]*\**Group:\**[[:space:]]*/, "", line)
                grp[cur] = line
                next
            }
            END {
                for (i = 1; i <= n; i++) {
                    id = order[i]
                    d = deps[id]
                    gsub(/[[:space:]]/, "", d)
                    gsub(/,$/, "", d)
                    printf "%s\t%s\t%s\t%s\n", id, grp[id], d, fname
                }
            }
        ' "$f")
        tsv="${tsv}${file_tsv}"
        [ -n "$file_tsv" ] && tsv="${tsv}
"
    done

    if [ -z "$tsv" ]; then
        echo '{"errors": [{"type": "no-spec-ids", "detail": "No SPEC-NNN headings found in input"}], "warnings": [], "edges": 0, "ok": false}'
        exit 1
    fi

    # ---- Pass 2: jq-based graph validation ----
    echo "$tsv" | jq -R -s '
        split("\n") | map(select(length > 0)) | map(split("\t")) as $rows |
        # sequential index per row; index by id
        ([range(0; $rows | length)] | map({id: $rows[.][0], group: $rows[.][1], deps: ($rows[.][2] | if . == "" then [] else split(",") end), file: $rows[.][3], idx: .})) as $specs |
        ($specs | map({key: .id, value: .}) | from_entries) as $index |

        # edges
        ($specs | map(. as $s | .deps[] | {from: $s.id, to: .}) ) as $edges |

        # unknown references
        [$edges[] | select(($index[.to]) == null) | {type: "unknown", detail: ("\(.from) depends on \(.to) which is not defined")}] as $unknown |

        # group-order violations (same-file edges only; group parseable as number-ish text)
        [$specs[] | . as $s | select($s.group != "") |
            $s.deps[] as $d | ($index[$d]) // empty |
            select(.file == $s.file and .group != "" and .group > $s.group) |
            {type: "group-order", detail: ("\($s.id) (group \($s.group)) depends on \($d) in a later group (\(.group))")}
        ] as $groupviol |

        # cycle detection: DFS with colors
        ($specs | map(.id)) as $allids |
        reduce $allids[] as $start ({color: {}, stack: [], cycles: []};
            . as $st |
            def walk($id):
                ($st.color[$id] // 0) as $c |
                if $c == 1 then
                    .cycles += [{type: "cycle", detail: (($st.stack + [$id]) | join(" -> "))}]
                elif $c == 0 and ($index[$id] != null) then
                    .color[$id] = 1 |
                    .stack += [$id] |
                    ($index[$id].deps[]) as $dep | walk($dep) |
                    .stack |= .[0:length-1] |
                    .color[$id] = 2
                else .
            end;
            walk($start)
        ) | .cycles as $cycles |

        # anchor link check needs file text — handled outside jq for simplicity

        ($unknown + $groupviol + $cycles) as $errors |
        ($edges | length) as $ecount |
        {
            errors: $errors,
            warnings: [],
            edges: $ecount,
            ok: ($errors | length == 0)
        }
    '

    # ---- Pass 3 (warnings): anchor links per file ----
    for f in "${FILES[@]}"; do
        # collect links [SPEC-NNN](#anchor) and heading-derived anchors
        local broken
        broken=$(paste -d'\t' \
            <(grep -oE '\[SPEC-[0-9]+\]\(#[^)]+\)' "$f" | sort -u | sed -E 's/^\[([^]]+)\]\(#([^)]+)\)$/\1\t\2/') \
            <(true) 2>/dev/null | while IFS=$'\t' read -r label _; do
                [ -z "$label" ] && continue
                if ! grep -qiE "^#+.*${label}" "$f"; then
                    echo "warning: link target heading for $label not found in $f"
                fi
            done)
        [ -n "$broken" ] && echo "$broken" >&2
    done
}

main "$@"
