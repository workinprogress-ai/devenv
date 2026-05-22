#!/bin/bash

################################################################################
# desktop-menu.bash
#
# Library for managing the Fluxbox desktop application menu.
# Provides idempotent functions to add shortcuts (exec entries) and folders
# (submenu blocks) to the Fluxbox menu file.
#
# Menu format reference:
#   [begin] (Menu Title)
#       [exec]    (Label) { command } <>
#       [submenu] (Folder Name) {}
#           [exec] (Label) { command } <>
#       [end]
#       [config]     (Configuration)
#       [workspaces] (Workspaces)
#   [end]
#
# Dependencies:
#   - error-handling.bash (logging and error utilities)
#
# Functions exported:
#   - desktop_menu_get_file()
#   - desktop_menu_shortcut_exists()
#   - desktop_menu_folder_exists()
#   - desktop_menu_add_shortcut()
#   - desktop_menu_add_folder()
#
################################################################################

# Prevent double-sourcing
if [[ "${_DESKTOP_MENU_LOADED:-}" == "true" ]]; then
  return
fi
_DESKTOP_MENU_LOADED="true"

# shellcheck source=/dev/null
source "${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/tools/lib/error-handling.bash"

################################################################################
# Return the path to the Fluxbox menu file.
# Respects the FLUXBOX_MENU environment variable override.
# Usage: desktop_menu_get_file
# Returns: Absolute path to the menu file
################################################################################
desktop_menu_get_file() {
  echo "${FLUXBOX_MENU:-${HOME}/.fluxbox/menu}"
}

################################################################################
# Check whether a shortcut with the given label exists in the menu.
# Usage: desktop_menu_shortcut_exists MENU_FILE LABEL
# Arguments:
#   MENU_FILE  Path to the Fluxbox menu file
#   LABEL      Display label to search for
# Returns: 0 if an [exec] entry with that label exists, 1 otherwise
################################################################################
desktop_menu_shortcut_exists() {
  local menu_file="$1"
  local label="$2"

  grep -qF "[exec] (${label})" "$menu_file"
}

################################################################################
# Check whether a folder with the given name exists in the menu.
# Usage: desktop_menu_folder_exists MENU_FILE FOLDER_NAME
# Arguments:
#   MENU_FILE    Path to the Fluxbox menu file
#   FOLDER_NAME  Folder (submenu) name to search for
# Returns: 0 if a [submenu] entry with that name exists, 1 otherwise
################################################################################
desktop_menu_folder_exists() {
  local menu_file="$1"
  local folder_name="$2"

  grep -qF "[submenu] (${folder_name})" "$menu_file"
}

################################################################################
# Add a shortcut (exec entry) to the menu file.
# If a shortcut with the same label already exists the function exits silently.
#
# Usage: desktop_menu_add_shortcut MENU_FILE LABEL COMMAND [FOLDER]
# Arguments:
#   MENU_FILE  Path to the Fluxbox menu file
#   LABEL      Display label shown in the menu
#   COMMAND    Shell command to execute when the item is selected
#   FOLDER     Optional — name of an existing folder to place the shortcut in.
#              The folder must already exist; create it with desktop_menu_add_folder
#              first if needed.
################################################################################
desktop_menu_add_shortcut() {
  local menu_file="$1"
  local label="$2"
  local command="$3"
  local folder="${4:-}"

  if [[ ! -f "$menu_file" ]]; then
    die "Menu file not found: ${menu_file}" "$EXIT_NOT_FOUND"
  fi

  if desktop_menu_shortcut_exists "$menu_file" "$label"; then
    log_debug "Shortcut '${label}' already exists in ${menu_file}; skipping"
    return 0
  fi

  if [[ -n "$folder" ]]; then
    if ! desktop_menu_folder_exists "$menu_file" "$folder"; then
      die "Folder '${folder}' does not exist in '${menu_file}'" "$EXIT_NOT_FOUND"
    fi
    _desktop_menu_insert_into_folder \
      "$menu_file" "$folder" "        [exec] (${label}) { ${command} } <>"
  else
    _desktop_menu_insert_before_root_end \
      "$menu_file" "    [exec] (${label}) { ${command} } <>"
  fi

  log_info "Added shortcut '${label}' to desktop menu"
}

################################################################################
# Add a folder (submenu block) to the menu file.
# If a folder with the same name already exists the function exits silently.
#
# Usage: desktop_menu_add_folder MENU_FILE FOLDER_NAME [PARENT_FOLDER]
# Arguments:
#   MENU_FILE      Path to the Fluxbox menu file
#   FOLDER_NAME    Display name for the new folder
#   PARENT_FOLDER  Optional — name of an existing folder to nest this one inside.
################################################################################
desktop_menu_add_folder() {
  local menu_file="$1"
  local folder_name="$2"
  local parent="${3:-}"

  if [[ ! -f "$menu_file" ]]; then
    die "Menu file not found: ${menu_file}" "$EXIT_NOT_FOUND"
  fi

  if desktop_menu_folder_exists "$menu_file" "$folder_name"; then
    log_debug "Folder '${folder_name}' already exists in ${menu_file}; skipping"
    return 0
  fi

  if [[ -n "$parent" ]]; then
    if ! desktop_menu_folder_exists "$menu_file" "$parent"; then
      die "Parent folder '${parent}' does not exist in '${menu_file}'" "$EXIT_NOT_FOUND"
    fi
    _desktop_menu_insert_into_folder \
      "$menu_file" "$parent" "        [submenu] (${folder_name}) {}\\n        [end]"
  else
    _desktop_menu_insert_before_root_end \
      "$menu_file" "    [submenu] (${folder_name}) {}\\n    [end]"
  fi

  log_info "Added folder '${folder_name}' to desktop menu"
}

################################################################################
# Internal: insert content before the first root-level anchor in the menu.
# The anchor is the first occurrence of [config], [workspaces], or the root
# closing [end] (a bare "[end]" with no leading whitespace).
# Content may contain "\n" escape sequences; awk interprets them as newlines.
################################################################################
_desktop_menu_insert_before_root_end() {
  local menu_file="$1"
  local content="$2"

  awk -v content="$content" '
    BEGIN { inserted = 0 }
    !inserted && (/^[[:space:]]*\[config\]/ || /^[[:space:]]*\[workspaces\]/ || /^\[end\]$/) {
      print content
      inserted = 1
    }
    { print }
  ' "$menu_file" > "${menu_file}.tmp" && mv "${menu_file}.tmp" "$menu_file"
}

################################################################################
# Internal: insert content before the closing [end] of a named submenu folder.
# Correctly handles nested submenus inside the target folder by tracking depth.
# Content may contain "\n" escape sequences; awk interprets them as newlines.
################################################################################
_desktop_menu_insert_into_folder() {
  local menu_file="$1"
  local folder_name="$2"
  local content="$3"

  awk -v folder="$folder_name" -v content="$content" '
    BEGIN { in_folder = 0; depth = 0; inserted = 0 }
    {
      if (!in_folder && index($0, "[submenu] (" folder ")") > 0) {
        in_folder = 1
        depth = 1
        print
        next
      }
      if (in_folder) {
        if (/\[submenu\]/) depth++
        if (/\[end\]/) {
          depth--
          if (depth == 0 && !inserted) {
            print content
            inserted = 1
            in_folder = 0
          }
        }
      }
      print
    }
  ' "$menu_file" > "${menu_file}.tmp" && mv "${menu_file}.tmp" "$menu_file"
}

export -f desktop_menu_get_file
export -f desktop_menu_shortcut_exists
export -f desktop_menu_folder_exists
export -f desktop_menu_add_shortcut
export -f desktop_menu_add_folder
