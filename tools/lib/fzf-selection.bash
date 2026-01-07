#!/bin/bash
# fzf-selection.bash - Interactive menu selection helpers using fzf
# Version: 1.0.0
# Description: Common functions for building interactive selection menus with fzf
# Requirements: Bash 4.0+, fzf
# Author: WorkInProgress.ai
# Last Modified: 2026-01-04

# Prevent multiple sourcing
if [ -n "${_FZF_SELECTION_LOADED:-}" ]; then
    return 0
fi
readonly _FZF_SELECTION_LOADED=1

# ============================================================================
# Dependency Checks
# ============================================================================

# Check if fzf is installed and available
#
# Validates that the fzf fuzzy finder is installed and executable.
# This should be called before any fzf selection functions.
#
# Usage:
#   if ! check_fzf_installed; then
#       echo "Cannot use interactive selection"
#       exit 1
#   fi
#
# Returns:
#   0 if fzf is installed and available, 1 if not
#   Outputs error message to stderr if fzf is not available
#
# Examples:
#   check_fzf_installed || exit 1
#   if check_fzf_installed; then echo "Ready for interactive mode"; fi
#
check_fzf_installed() {
    if ! command -v fzf &> /dev/null; then
        echo "ERROR: fzf is not installed" >&2
        echo "Install fzf to enable interactive selection" >&2
        return 1
    fi
    return 0
}

# ============================================================================
# Single Selection (fzf)
# ============================================================================

# Present a list of items for single selection using fzf
#
# Displays a fuzzy-findable list of items and returns the user's selection.
# Uses default fzf options optimized for single selection.
#
# Usage:
#   selected=$(fzf_select_single "item1\nitem2\nitem3" "Select an item: ")
#   selected=$(fzf_select_single "$item_list" "Prompt: " "preview_command")
#
# Arguments:
#   $1 - List of items (newline-separated, required)
#   $2 - Prompt text shown to user (optional, default: "Select: ")
#   $3 - Preview command to run for each item (optional)
#
# Returns:
#   0 if user selected an item, 1 if user cancelled or no items available
#   Outputs the selected item to stdout
#
# Examples:
#   item_list="apple\nbanana\ncherry"
#   selected=$(fzf_select_single "$item_list" "Pick a fruit: ")
#   
#   # With preview
#   selected=$(fzf_select_single "$item_list" "Pick: " "cat {}")
#
# Notes:
#   - Returns empty string and exit code 1 if user presses Escape
#   - Items can contain spaces and special characters
#   - List should be newline-separated
#
fzf_select_single() {
    local items="${1:-}"
    local prompt="${2:-Select: }"
    local preview_cmd="${3:-}"
    
    if [ -z "$items" ]; then
        echo "ERROR: Items list is required" >&2
        return 1
    fi
    
    if ! check_fzf_installed; then
        return 1
    fi
    
    local fzf_args=(
        "--prompt=$prompt"
        "--height=40%"
        "--border"
    )
    
    if [ -n "$preview_cmd" ]; then
        fzf_args+=("--preview=$preview_cmd")
        fzf_args+=("--preview-window=right:50%")
    fi
    
    local selected
    selected=$(echo -e "$items" | fzf "${fzf_args[@]}") || return 1
    
    echo "$selected"
    return 0
}

# ============================================================================
# Multi-Selection (fzf)
# ============================================================================

# Present a list of items for multi-selection using fzf
#
# Displays a fuzzy-findable list of items where users can select multiple items
# using TAB key. Returns all selected items, one per line.
#
# Usage:
#   selections=$(fzf_select_multi "item1\nitem2\nitem3" "Select items: ")
#   selections=$(fzf_select_multi "$items" "Prompt" "preview_cmd")
#
# Arguments:
#   $1 - List of items (newline-separated, required)
#   $2 - Prompt text shown to user (optional, default: "Select items: ")
#   $3 - Preview command to run for each item (optional)
#
# Returns:
#   0 if user selected at least one item, 1 if cancelled or no items available
#   Outputs selected items to stdout (one per line)
#
# Examples:
#   item_list="apple\nbanana\ncherry\ndate"
#   selected=$(fzf_select_multi "$item_list" "Pick fruits: ")
#   while IFS= read -r item; do
#       echo "Selected: $item"
#   done <<< "$selected"
#
#   # With preview
#   selected=$(fzf_select_multi "$list" "Pick: " "cat {}")
#
# Notes:
#   - Use TAB to select/deselect items
#   - Use Shift-Tab to toggle selection of all items
#   - Returns empty string if user presses Escape
#   - One selected item per line in output
#
fzf_select_multi() {
    local items="${1:-}"
    local prompt="${2:-Select items: }"
    local preview_cmd="${3:-}"
    
    if [ -z "$items" ]; then
        echo "ERROR: Items list is required" >&2
        return 1
    fi
    
    if ! check_fzf_installed; then
        return 1
    fi
    
    local fzf_args=(
        "--prompt=$prompt"
        "--height=40%"
        "--border"
        "--multi"
        "--bind=tab:toggle+down"
        "--header=TAB to select | Shift-Tab to toggle all | Enter to confirm"
    )
    
    if [ -n "$preview_cmd" ]; then
        fzf_args+=("--preview=$preview_cmd")
        fzf_args+=("--preview-window=right:50%")
    fi
    
    local selected
    selected=$(echo -e "$items" | fzf "${fzf_args[@]}") || return 1
    
    echo "$selected"
    return 0
}

# ============================================================================
# Smart Selection (auto-run single, fzf multi)
# ============================================================================

# Smart selection: auto-runs if single item, shows menu for multiple
#
# Intelligently handles lists of any size:
# - If list is empty: returns error
# - If list has one item: automatically selects it (returns immediately)
# - If list has multiple items: shows fzf menu for selection
#
# Usage:
#   selected=$(fzf_select_smart "item1\nitem2" "Pick: ")
#   selected=$(fzf_select_smart "$list" "Choose: " "cat {}")
#
# Arguments:
#   $1 - List of items (newline-separated, required)
#   $2 - Prompt text shown to user (optional, default: "Select: ")
#   $3 - Preview command (optional)
#
# Returns:
#   0 if item was selected or auto-selected, 1 if cancelled or empty list
#   Outputs the selected item to stdout
#
# Examples:
#   # Auto-selects if only one match
#   result=$(fzf_select_smart "$(grep pattern file.txt)" "Select: ")
#   
#   # Shows menu for multiple results
#   selected=$(fzf_select_smart "$list" "Pick one: " "cat {}")
#
fzf_select_smart() {
    local items="${1:-}"
    local prompt="${2:-Select: }"
    local preview_cmd="${3:-}"
    
    if [ -z "$items" ]; then
        echo "ERROR: Items list is required" >&2
        return 1
    fi
    
    # Count items
    local item_count
    item_count=$(echo -e "$items" | grep -c ".")
    
    if [ "$item_count" -eq 0 ]; then
        echo "ERROR: No items to select from" >&2
        return 1
    fi
    
    if [ "$item_count" -eq 1 ]; then
        # Auto-select single item
        echo "$items"
        return 0
    fi
    
    # Multiple items: show menu
    fzf_select_single "$items" "$prompt" "$preview_cmd"
}

# ============================================================================
# List Filtering and Display
# ============================================================================

# Filter a list based on pattern and apply smart selection
#
# Applies grep filtering to a list, then uses fzf_select_smart to handle
# the filtered results intelligently:
# - No matches: returns error
# - One match: auto-selects it
# - Multiple matches: shows fzf menu
#
# Usage:
#   result=$(fzf_select_filtered "$list" "search_pattern" "Select: ")
#   result=$(fzf_select_filtered "$files" "\.sh$" "Pick script: " "cat {}")
#
# Arguments:
#   $1 - List of items (newline-separated, required)
#   $2 - Grep pattern for filtering (required)
#   $3 - Prompt text (optional, default: "Select: ")
#   $4 - Preview command (optional)
#   $5 - Grep options (optional, e.g., "-i" for case-insensitive)
#
# Returns:
#   0 if item selected/auto-selected, 1 if no matches or cancelled
#   Outputs selected item to stdout
#
# Examples:
#   # Find and select shell scripts
#   script=$(fzf_select_filtered "$files" "\.sh$" "Pick script: " "cat {}")
#   
#   # Case-insensitive filter
#   item=$(fzf_select_filtered "$list" "keyword" "Select: " "" "-i")
#
fzf_select_filtered() {
    local items="${1:-}"
    local pattern="${2:-}"
    local prompt="${3:-Select: }"
    local preview_cmd="${4:-}"
    local grep_opts="${5:-}"
    
    if [ -z "$items" ] || [ -z "$pattern" ]; then
        echo "ERROR: Items list and pattern are required" >&2
        return 1
    fi
    
    # Filter items by pattern
    local filtered
    # shellcheck disable=SC2086  # grep_opts intentionally unquoted for option expansion
    filtered=$(echo -e "$items" | grep $grep_opts "$pattern")
    
    if [ -z "$filtered" ]; then
        echo "ERROR: No items matching pattern: $pattern" >&2
        return 1
    fi
    
    # Use smart selection on filtered list
    fzf_select_smart "$filtered" "$prompt" "$preview_cmd"
}

# ============================================================================
# List Building Helpers
# ============================================================================

# Build a formatted menu list for fzf
#
# Creates a tab-separated menu where each line has:
# - Display name (column 1)
# - Full path/value (column 2, hidden by default)
#
# Useful for menus where display names differ from actual values.
#
# Usage:
#   menu=$(fzf_build_menu "name1\tpath1\nname2\tpath2")
#   echo "$menu" > /tmp/menu_file
#   selected=$(fzf --with-nth=1 < /tmp/menu_file | awk -F '\t' '{print $2}')
#
# Arguments:
#   $1 - Menu items (tab-separated name\tvalue, newline-separated rows)
#
# Returns:
#   0 always
#   Outputs formatted menu
#
fzf_build_menu() {
    local items="${1:-}"
    
    if [ -z "$items" ]; then
        return 0
    fi
    
    echo -e "$items"
}

# Extract a field from fzf selection (for tab-separated fields)
#
# Extracts a specific field from a tab-separated selection result.
# Useful when fzf selected from a menu with multiple columns.
#
# Usage:
#   selected_path=$(fzf_extract_field "$fzf_result" 2)
#
# Arguments:
#   $1 - Selected line (newline-separated if multiple)
#   $2 - Field number to extract (1-based, required)
#   $3 - Delimiter (optional, default: tab)
#
# Returns:
#   0 always
#   Outputs extracted field(s)
#
# Examples:
#   # From tab-separated menu
#   path=$(fzf_extract_field "$selection" 2 $'\t')
#   
#   # Multiple selections
#   while IFS= read -r line; do
#       path=$(fzf_extract_field "$line" 2)
#   done <<< "$selections"
#
fzf_extract_field() {
    local line="${1:-}"
    local field="${2:-1}"
    local delimiter="${3:-$'\t'}"
    
    if [ -z "$line" ]; then
        return 0
    fi
    
    awk -v "field=$field" -v "delim=$delimiter" \
        'BEGIN {FS=delim} NF >= field {print $field}' <<< "$line"
}

# ============================================================================
# Error Handling
# ============================================================================

# Handle cancelled fzf selection uniformly
#
# Provides consistent error handling when user presses Escape or
# closes fzf without making a selection.
#
# Usage:
#   selected=$(fzf_select ...) || fzf_handle_cancellation "action failed"
#   fzf_handle_cancellation "No item selected"
#
# Arguments:
#   $1 - Error message (optional)
#
# Returns:
#   1 (error exit code)
#   Outputs error message to stderr
#
fzf_handle_cancellation() {
    local message="${1:-Selection cancelled}"
    echo "ERROR: $message" >&2
    return 1
}

# Validate fzf selection is not empty
#
# Checks that a selection result is not empty, useful for post-processing
# fzf results where empty might indicate an error.
#
# Usage:
#   selected=$(fzf_select_single ...)
#   fzf_validate_selection "$selected" || exit 1
#
# Arguments:
#   $1 - Selection result to validate
#   $2 - Context message (optional)
#
# Returns:
#   0 if selection is not empty, 1 if empty
#
fzf_validate_selection() {
    local selection="${1:-}"
    local context="${2:-Selection}"
    
    if [ -z "$selection" ]; then
        echo "ERROR: $context is empty" >&2
        return 1
    fi
    
    return 0
}
