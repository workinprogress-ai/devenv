#!/bin/bash

# Editor helpers
# Provides a function to open files in the user's preferred editor,
# preferring VS Code with blocking behavior and falling back gracefully.

# Guard against multiple sourcing
if [ -n "${_EDITOR_LOADED:-}" ]; then return 0; fi
_EDITOR_LOADED=1

open_in_editor() {
  local file="$1"
  # Preferred/fallback editor selection
  local pref
  pref="${PREF_EDITOR:-${FALLBACK_EDITOR:-nano}}"

  # Try VS Code first with --wait to block until closed
  if command -v code >/dev/null 2>&1; then
    if code --wait "$file"; then
      return 0
    else
      echo "⚠️  Could not open with VS Code. Falling back to $pref..." >&2
    fi
  fi

  # Fallback editor
  "$pref" "$file"
}