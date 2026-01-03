#!/usr/bin/env bash
# install-extra.sh
# Pick an "extra" from $devenv/.devcontainer/install-extras using fzf and run it.
# Usage:
#   install-extra.sh              # single selection
#   install-extra.sh -m           # multi-select (install several)
#   install-extra.sh --dir PATH   # override the extras dir
#   install-extra.sh <filter>     # filter list by name, auto-run if only one match

set -o pipefail

# Cleanup function
cleanup() {
  if [ -n "${MENU_TMP:-}" ] && [ -f "$MENU_TMP" ]; then
    rm -f "$MENU_TMP"
  fi
}

# Register cleanup on EXIT
trap cleanup EXIT

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

command -v fzf >/dev/null 2>&1 || { err "fzf is required (apt install fzf)."; exit 2; }

[[ -d "$EXTRAS_DIR" ]] || { err "Extras directory not found: $EXTRAS_DIR"; exit 1; }

# Find candidate scripts: *.sh OR any executable file
mapfile -t FILES < <(find "$EXTRAS_DIR" -maxdepth 1 -type f \( -name '*.sh' -o -perm -u+x -o -perm -g+x -o -perm -o+x \) | sort)
[[ ${#FILES[@]} -gt 0 ]] || { err "No extras found in $EXTRAS_DIR"; exit 1; }

# Apply filter if specified
if [[ -n "$FILTER" ]]; then
  mapfile -t FILTERED < <(printf "%s\n" "${FILES[@]}" | grep -i "$FILTER")
  FILES=("${FILTERED[@]}")
  [[ ${#FILES[@]} -gt 0 ]] || { err "No extras match filter: $FILTER"; exit 1; }
  
  # If exactly one match, run it directly without fzf
  if [[ ${#FILES[@]} -eq 1 ]]; then
    script="${FILES[0]}"
    info "Found single match: $(basename "$script")"
    info "Running: $(basename "$script")"
    if [[ -x "$script" ]]; then
      "$script"
    else
      bash "$script"
    fi
    exit $?
  fi
fi

# Build the menu lines: NAME<TAB>FULLPATH
MENU_TMP="$(mktemp)"
for f in "${FILES[@]}"; do
  name="$(basename "$f")"
  printf "%s\t%s\n" "$name" "$f"
done > "$MENU_TMP"

# Preview command: prefers bat if present
if command -v bat >/dev/null 2>&1; then
  PREVIEW='bat --style=plain --line-range=1:200 --color=always {2}'
else
  PREVIEW='sed -n "1,200p" {2}'
fi

# fzf options
FZF_OPTS=(
  --prompt="Install extra > "
  --border
  --height=80%
  --ansi
  --with-nth=1
  --delimiter='\t'
  --preview="$PREVIEW"
)

[[ $MULTI -eq 1 ]] && FZF_OPTS+=(--multi)

# Run fzf
SELECTION="$(fzf "${FZF_OPTS[@]}" < "$MENU_TMP")" || { echo "No selection."; exit 1; }

# Extract full paths (2nd field) from selection
mapfile -t CHOSEN < <(printf "%s\n" "$SELECTION" | awk -F '\t' '{print $2}')

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
