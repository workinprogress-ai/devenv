#!/usr/bin/env bash
# install-extra.sh
# Pick an "extra" from $devenv/.devcontainer/install-extras using fzf and run it.
# Usage:
#   install-extra.sh              # single selection
#   install-extra.sh -m           # multi-select (install several)
#   install-extra.sh --dir PATH   # override the extras dir
#   install-extra.sh <filter>     # filter list by name, auto-run if only one match

set -o pipefail
source "$DEVENV_TOOLS/lib/fzf-selection.bash"


# Source fzf-selection library

# --- config / args ---
MULTI=0
FILTER=""
if [[ "$1" == "-m" || "$1" == "--multi" ]]; then MULTI=1; shift; fi

EXTRAS_DIR="${devenv:-.}/.devcontainer/install-extras"
if [[ "$1" == "--dir" && -n "$2" ]]; then EXTRAS_DIR="$2"; shift 2; fi

# Remaining argument is treated as filter
if [[ -n "$1" ]]; then FILTER="$1"; shift; fi

# --- preflight ---
err() { echo "❌ $*" >&2; }
info(){ echo "• $*"; }

# Check fzf availability using library function
check_fzf_installed || exit 2

[[ -d "$EXTRAS_DIR" ]] || { err "Extras directory not found: $EXTRAS_DIR"; exit 1; }

# Find candidate scripts: *.sh OR any executable file
mapfile -t FILES < <(find "$EXTRAS_DIR" -maxdepth 1 -type f \( -name '*.sh' -o -perm -u+x -o -perm -g+x -o -perm -o+x \) | sort)
[[ ${#FILES[@]} -gt 0 ]] || { err "No extras found in $EXTRAS_DIR"; exit 1; }

# Build the menu lines: NAME<TAB>FULLPATH
MENU_ITEMS=""
for f in "${FILES[@]}"; do
  name="$(basename "$f")"
  MENU_ITEMS+=$(printf "%s\t%s\n" "$name" "$f")
done

# Preview command: prefers bat if present
if command -v bat >/dev/null 2>&1; then
  PREVIEW='bat --style=plain --line-range=1:200 --color=always {2}'
else
  PREVIEW='sed -n "1,200p" {2}'
fi

# Use library functions for selection
SELECTION=""
if [[ -n "$FILTER" ]]; then
    # Use filtered selection with smart auto-run
    SELECTION=$(fzf_select_filtered "$MENU_ITEMS" "$FILTER" "Install extra > " "$PREVIEW" "-i") || { 
        echo "No selection."; exit 1; 
    }
else
    # Use multi or single selection
    if [[ $MULTI -eq 1 ]]; then
        SELECTION=$(fzf_select_multi "$MENU_ITEMS" "Install extra > " "$PREVIEW") || { 
            echo "No selection."; exit 1; 
        }
    else
        SELECTION=$(fzf_select_single "$MENU_ITEMS" "Install extra > " "$PREVIEW") || { 
            echo "No selection."; exit 1; 
        }
    fi
fi

# Extract full paths (2nd field) from selection using library function
mapfile -t CHOSEN < <(echo "$SELECTION" | while read -r line; do
    fzf_extract_field "$line" 2 $'\t'
done)

# Execute selections in order
EXIT_CODE=0
for script in "${CHOSEN[@]}"; do
  info "Running: $(basename "$script")"
  if [[ -x "$script" ]]; then
    "$script"
  else
    bash "$script"
  fi
  rc=$?
  if [[ $rc -ne 0 ]]; then
    err "Script exited with code $rc: $script"
    EXIT_CODE=$rc
  fi
done

exit "$EXIT_CODE"
