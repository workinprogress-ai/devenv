#!/usr/bin/env bash
# Automatic markdown linting fixer
# This script automatically fixes common markdown linting issues

set -euo pipefail

if [[ -z "${DEVENV_ROOT:-}" ]]; then
    echo "Error: DEVENV_ROOT is not set. Please run this script from within a Devenv environment." >&2
    exit 1
fi

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
            echo "--fix    Apply autofixes where possible"
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

if [ ${#FILES[@]} -eq 0 ]; then
    echo "No markdown files to lint."
    exit 0
fi

echo "Running markdown linting on:" 
printf ' - %s\n' "${FILES[@]}"
echo ""

# Always use markdownlint installed in the devenv repository
MARKDOWNLINT_BIN="$DEVENV_ROOT/node_modules/.bin/markdownlint"
if [ ! -x "$MARKDOWNLINT_BIN" ]; then
    echo "Error: markdownlint is not installed in devenv at $MARKDOWNLINT_BIN"
    echo "Install it with: pnpm install (in $DEVENV_ROOT)"
    exit 1
fi

CMD=("$MARKDOWNLINT_BIN")
if [ "$FIX_MODE" = true ]; then
    CMD+=(--fix)
fi
# Always ignore MD013 (line length)
CMD+=(--disable MD013 --)
CMD+=("${FILES[@]}")

# Track file hashes before fix to detect actual modifications
FIXED_ANY=false
if [ "$FIX_MODE" = true ]; then
    declare -A BEFORE_HASH
    # compute hashes relative to TARGET_ROOT
    ( cd "$TARGET_ROOT" && for f in "${FILES[@]}"; do [ -f "$f" ] && BEFORE_HASH["$f"]=$(md5sum "$f" | awk '{print $1}'); done )
fi

( cd "$TARGET_ROOT" && "${CMD[@]}" )
if [ "$?" -eq 0 ]; then
    if [ "$FIX_MODE" = true ]; then
        # compare hashes after
        ( cd "$TARGET_ROOT" && for f in "${FILES[@]}"; do 
            if [ -f "$f" ]; then 
                AFTER=$(md5sum "$f" | awk '{print $1}') 
                if [ "${BEFORE_HASH[$f]:-}x" != "${AFTER}x" ]; then FIXED_ANY=true; fi 
            fi 
        done )
    fi

    echo ""
    echo "✓ Markdown linting completed successfully!"
    if [ "$FIX_MODE" = true ] && [ "$FIXED_ANY" = true ]; then
        echo ""
        echo "Review the changes with: git -C '$TARGET_ROOT' diff"
        echo "Stage the changes with: git -C '$TARGET_ROOT' add -A"
    fi
else
    echo ""
    echo "⚠ Some linting issues could not be auto-fixed."
    echo "Please review the errors above and fix them manually."
    exit 1
fi
