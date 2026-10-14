#!/usr/bin/env bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"
# Automatic markdown linting fixer
# This script automatically fixes common markdown linting issues

set -euo pipefail

# Derive the checkout root from this script's own location; an exported
# DEVENV_ROOT pointing elsewhere is ignored (self-root contract).
DEVENV_ROOT="$(devenv_self_root "${BASH_SOURCE[0]}")"
export DEVENV_ROOT

FIX_MODE=false
FILES=()

while [ "$#" -gt 0 ]; do
    case "$1" in
        --fix)
            FIX_MODE=true
            ;;
        --help|-h)
            echo "Usage: $(basename "$0") [--fix] [file ...]"
            echo ""
            echo "Without file arguments, lints README.md and docs/**/*.md"
            echo "Also checks relative .md links and their in-page anchors"
            echo "(GitHub-style fragments) in the linted files."
            echo "--fix    Apply markdown autofixes where possible"
            exit 0
            ;;
        *)
            FILES+=("$1")
            ;;
    esac
    shift
done

if [ ${#FILES[@]} -eq 0 ]; then
    # Determine target root: if inside a git repo under repos/, lint that repo; otherwise lint devenv docs only
    if GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
        if [[ "$GIT_ROOT" == *"/repos/"* && "$GIT_ROOT" != "$DEVENV_ROOT" ]]; then
            TARGET_ROOT="$GIT_ROOT"
            mapfile -t FILES < <(git -C "$TARGET_ROOT" ls-files '*.md')
        else
            TARGET_ROOT="$DEVENV_ROOT"
            mapfile -t FILES < <(git -C "$TARGET_ROOT" ls-files 'README.md' 'docs/*.md' 'docs/**/*.md')
        fi
    else
        TARGET_ROOT="$DEVENV_ROOT"
        mapfile -t FILES < <(git -C "$TARGET_ROOT" ls-files 'README.md' 'docs/*.md' 'docs/**/*.md')
    fi
else
    # If explicit files were provided, set TARGET_ROOT context: prefer git root when available, else devenv
    if GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
        TARGET_ROOT="$GIT_ROOT"
    else
        TARGET_ROOT="$DEVENV_ROOT"
    fi
    
    # Filter files based on context: for devenv root, only include README.md and docs/**
    if [[ "$TARGET_ROOT" == "$DEVENV_ROOT" ]]; then
        FILTERED=()
        for f in "${FILES[@]}"; do
            if [[ "$f" == "README.md" || "$f" == docs/* ]]; then
                FILTERED+=("$f")
            fi
        done
        FILES=("${FILTERED[@]}")
    fi
fi

# Filter out session memory files (e.g. session_memory-*.md, session_*memory*.md)
# and plan files (Plan-*.md or Implementation_plan-*.md) which contain
# free-form AI-generated content that does not conform to doc lint rules.
FILTERED_FILES=()
for f in "${FILES[@]}"; do
    basename="${f##*/}"
    if [[ "$basename" == session_* && "$basename" == *memory* ]]; then
        continue
    fi
    if [[ "$basename" == Plan-*.md || "$basename" == Implementation_plan-*.md ]]; then
        continue
    fi
    FILTERED_FILES+=("$f")
done
FILES=("${FILTERED_FILES[@]}")

if [ ${#FILES[@]} -eq 0 ]; then
    echo "No markdown files to lint."
    exit 0
fi

echo "Running markdown linting on:" 
printf ' - %s\n' "${FILES[@]}"
echo ""

# Always use markdownlint-cli2 installed in the devenv repository
# markdownlint-cli2 resolves config per-directory (walks up from each file),
# so per-folder .markdownlint.json overrides are honoured automatically.
MARKDOWNLINT_BIN="$DEVENV_ROOT/node_modules/.bin/markdownlint-cli2"
if [ ! -x "$MARKDOWNLINT_BIN" ]; then
    echo "Error: markdownlint-cli2 is not installed in devenv at $MARKDOWNLINT_BIN"
    echo "Install it with: pnpm install (in $DEVENV_ROOT)"
    exit 1
fi

CMD=("$MARKDOWNLINT_BIN")
if [ "$FIX_MODE" = true ]; then
    CMD+=(--fix)
fi
CMD+=("${FILES[@]}")

# Track file hashes before fix to detect actual modifications
FIXED_ANY=false
if [ "$FIX_MODE" = true ]; then
    declare -A BEFORE_HASH
    # compute hashes relative to TARGET_ROOT
    ( cd "$TARGET_ROOT" && for f in "${FILES[@]}"; do [ -f "$f" ] && BEFORE_HASH["$f"]=$(md5sum "$f" | awk '{print $1}'); done )
fi

( cd "$TARGET_ROOT" && "${CMD[@]}" )
LINT_STATUS=$?
if [ "$FIX_MODE" = true ]; then
    # compare hashes after
    ( cd "$TARGET_ROOT" && for f in "${FILES[@]}"; do 
        if [ -f "$f" ]; then 
            AFTER=$(md5sum "$f" | awk '{print $1}') 
            if [ "${BEFORE_HASH[$f]:-}x" != "${AFTER}x" ]; then FIXED_ANY=true; fi 
        fi 
    done )
fi

if [ "$LINT_STATUS" -ne 0 ]; then
    echo ""
    echo "⚠ Some linting issues could not be auto-fixed."
    echo "Please review the errors above and fix them manually."
    exit 1
fi

echo ""
echo "✓ Markdown linting completed successfully!"
if [ "$FIX_MODE" = true ] && [ "$FIXED_ANY" = true ]; then
    echo ""
    echo "Review the changes with: git -C '$TARGET_ROOT' diff"
    echo "Stage the changes with: git -C '$TARGET_ROOT' add -A"
fi

# ---------------------------------------------------------------------------
# Relative .md link + anchor check
#
# A stale editor write once removed sections from docs/Forking.md while links
# to their headings survived elsewhere: the file resolved, the anchors dangled.
# For every relative .md link in the linted files, verify the target file
# exists and — when the link carries a #fragment — that a heading matching the
# anchor (GitHub-style: lowercased, spaces as dashes, punctuation stripped)
# exists in the target. External URLs are markdown-link-check's job (CI), not
# ours.
# ---------------------------------------------------------------------------

# GitHub-style anchor for a heading line.
anchor_of_heading() {
    local heading="$1"
    heading="${heading%%|*}"                 # strip table-row remainder
    heading="${heading#*# }"                 # strip leading hashes+space
    heading="${heading##* ]}"                # strip leading list markers
    heading="${heading##*> }"                # strip blockquote markers
    heading="${heading,,}"
    heading="${heading// /-}"
    # shellcheck disable=SC1112  # unicode dashes/quotes are the point here
    heading="$(printf '%s' "$heading" | tr -d '`*_.,:;!?()[]&/—–“”‘’#')"
    printf '%s' "$heading"
}

link_failures=0
links_checked=0
for md_file in "${FILES[@]}"; do
    [ -f "$TARGET_ROOT/$md_file" ] || continue
    file_rel="${md_file#./}"
    rel_dir="$(dirname "$file_rel")"
    while IFS= read -r -d '' link; do
        target="${link%%#*}"
        anchor=""
        case "$link" in
            *"#"*) anchor="${link#*#}" ;;
        esac
        [ -n "$target" ] || continue
        resolved="$(cd "$TARGET_ROOT/$rel_dir" 2>/dev/null && realpath -m --relative-to="$TARGET_ROOT" "$target" 2>/dev/null)" || continue
        links_checked=$((links_checked + 1))
        if [ ! -f "$TARGET_ROOT/$resolved" ]; then
            printf 'BROKEN LINK: %s -> %s (file not found)\n' "$file_rel" "$link" >&2
            link_failures=$((link_failures + 1))
            continue
        fi
        [ -n "$anchor" ] || continue
        found=0
        while IFS= read -r heading_line; do
            [ "$anchor" = "$(anchor_of_heading "$heading_line")" ] && found=1 && break
        done < <(grep -E "^#{1,6} " "$TARGET_ROOT/$resolved" 2>/dev/null)
        if [ "$found" -ne 1 ]; then
            printf 'DANGLING ANCHOR: %s -> %s#%s\n' "$file_rel" "$resolved" "$anchor" >&2
            link_failures=$((link_failures + 1))
        fi
    done < <(grep -oE '\]\([^)]+\.md[^)]*\)' "$TARGET_ROOT/$md_file" 2>/dev/null | sed 's/^](//; s/)$//' | sort -u | tr '\n' '\0')
done

echo "Checked $links_checked relative .md link(s); $link_failures failure(s)."
[ "$link_failures" -eq 0 ] || exit 1
