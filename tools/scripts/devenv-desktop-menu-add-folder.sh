#!/usr/bin/env bash

################################################################################
# devenv-desktop-menu-add-folder.sh
#
# Add a folder (submenu) to the Fluxbox desktop application menu.
# If a folder with the same name already exists the script exits silently.
#
# Usage:
#   devenv-desktop-menu-add-folder.sh <folder-name> [parent-folder]
#
# Arguments:
#   folder-name    Display name for the new folder
#   parent-folder  Optional — name of an existing folder to nest this one inside.
#
# Examples:
#   devenv-desktop-menu-add-folder.sh "Databases"
#   devenv-desktop-menu-add-folder.sh "MongoDB" "Databases"
#
# Dependencies:
#   - error-handling.bash
#   - desktop-menu.bash
#
################################################################################

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/desktop-menu.bash"

show_usage() {
  cat << EOF
Usage: devenv-desktop-menu-add-folder <folder-name> [parent-folder]

Add a folder (submenu) to the Fluxbox desktop application menu.
If a folder with the same name already exists the command exits silently.

Arguments:
    folder-name    Display name for the new folder
    parent-folder  Optional -- name of an existing folder to nest this one inside.

Options:
    -h, --help   Show this help message and exit

Examples:
    devenv-desktop-menu-add-folder "Databases"
    devenv-desktop-menu-add-folder "MongoDB" "Databases"

Environment:
    FLUXBOX_MENU   Override the default menu file path (~/.fluxbox/menu)
EOF
  exit 0
}

if [[ $# -gt 0 && ( "$1" == "-h" || "$1" == "--help" ) ]]; then
  show_usage
fi

if [[ $# -lt 1 ]]; then
  die "Usage: devenv-desktop-menu-add-folder <folder-name> [parent-folder]  (use --help for details)" "$EXIT_INVALID_ARGUMENT"
fi

folder_name="$1"
parent_folder="${2:-}"

menu_file="$(desktop_menu_get_file)"

if [[ ! -f "$menu_file" ]]; then
  die "Fluxbox menu file not found: ${menu_file}" "$EXIT_NOT_FOUND"
fi

desktop_menu_add_folder "$menu_file" "$folder_name" "$parent_folder"
