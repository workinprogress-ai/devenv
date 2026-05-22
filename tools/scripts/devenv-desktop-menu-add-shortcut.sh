#!/usr/bin/env bash

################################################################################
# devenv-desktop-menu-add-shortcut.sh
#
# Add a shortcut (exec entry) to the Fluxbox desktop application menu.
# If a shortcut with the same label already exists the script exits silently.
#
# Usage:
#   devenv-desktop-menu-add-shortcut.sh <label> <command> [folder]
#
# Arguments:
#   label    Display label shown in the menu
#   command  Shell command to execute when the item is selected
#   folder   Optional — name of an existing folder to add the shortcut into.
#            Use devenv-desktop-menu-add-folder.sh to create the folder first.
#
# Examples:
#   devenv-desktop-menu-add-shortcut.sh "MongoDB Compass" "mongodb-compass"
#   devenv-desktop-menu-add-shortcut.sh "Compass" "mongodb-compass" "Databases"
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
Usage: devenv-desktop-menu-add-shortcut <label> <command> [folder]

Add a shortcut (exec entry) to the Fluxbox desktop application menu.
If a shortcut with the same label already exists the command exits silently.

Arguments:
    label    Display label shown in the menu
    command  Shell command to execute when the item is selected
    folder   Optional -- name of an existing folder to add the shortcut into.
             Create the folder first with devenv-desktop-menu-add-folder.

Options:
    -h, --help   Show this help message and exit

Examples:
    devenv-desktop-menu-add-shortcut "MongoDB Compass" "mongodb-compass"
    devenv-desktop-menu-add-shortcut "Compass" "mongodb-compass" "Databases"

Environment:
    FLUXBOX_MENU   Override the default menu file path (~/.fluxbox/menu)
EOF
  exit 0
}

if [[ $# -gt 0 && ( "$1" == "-h" || "$1" == "--help" ) ]]; then
  show_usage
fi

if [[ $# -lt 2 ]]; then
  die "Usage: devenv-desktop-menu-add-shortcut <label> <command> [folder]  (use --help for details)" "$EXIT_INVALID_ARGUMENT"
fi

label="$1"
cmd="$2"
folder="${3:-}"

menu_file="$(desktop_menu_get_file)"

if [[ ! -f "$menu_file" ]]; then
  die "Fluxbox menu file not found: ${menu_file}" "$EXIT_NOT_FOUND"
fi

desktop_menu_add_shortcut "$menu_file" "$label" "$cmd" "$folder"
