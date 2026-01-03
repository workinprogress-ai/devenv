#!/bin/bash

# Get all available contexts
contexts=$(kubectl config get-contexts -o name)
if [ -z "$contexts" ]; then
    echo "No clusters found."
    exit 1
fi

# Function to use fzf for selection
select_context() {
    local list="$1"
    selected=$(echo "$list" | fzf --prompt="Select a cluster: ")
    if [[ -n "$selected" ]]; then
        kubectl config use-context "$selected" >/dev/null
        echo "Switched to context: $(kubectl config current-context)" >&2
    else
        echo "No cluster selected."
        exit 1
    fi
}

# No parameter provided: display all contexts
if [[ -z "$1" ]]; then
    echo "No partial cluster name provided. Please select a cluster from the list below:"
    select_context "$contexts"
else
    # Filter contexts that match the provided partial name
    matches=$(echo "$contexts" | grep -iF "$1")
    
    # No matches found
    if [ -z "$matches" ]; then
        echo "Error: No clusters match '$1'." >&2
        exit 1
    fi

    # Count the number of matches
    count=$(echo "$matches" | wc -l)
    
    if [[ "$count" -eq 1 ]]; then
        # Exactly one match found: use it directly
        kubectl config use-context "$(echo "$matches" | head -n 1)" >/dev/null
        echo "Switched to context: $(kubectl config current-context)" >&2
    else
        # Multiple matches found: prompt user to select one
        echo "Multiple clusters match '$1'. Please select one from the list below:" >&2
        select_context "$matches"
    fi
fi
