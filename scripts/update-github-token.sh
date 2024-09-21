#!/bin/bash

TOKEN_FILE="$DEVENV_ROOT/.setup/github_token.txt"

# Function to save a response to a file
save_response() {
    local question="$1"
    echo "$question"
    read -r response
    if [ -n "$response" ]; then
        echo "$response" > "$TOKEN_FILE"
    fi
}


if [ -n "$1" ]; then
    export GITHUB_TOKEN="$1"
    echo "$GITHUB_TOKEN" > "$TOKEN_FILE"
else 
    echo "You will need to paste a PAT (personal access token) from Azure.  It should have READ/WRITE access to code and READ access to Packages." 
    echo "You can create one with this link: https://oms-fort.visualstudio.com/_usersSettings/tokens"
    save_response "Paste the token:" "GITHUB_TOKEN.txt"

    export GITHUB_TOKEN=$(cat "$TOKEN_FILE")
fi

sed -i "s/^GITHUB_TOKEN=.*/GITHUB_TOKEN=${GITHUB_TOKEN}/" "$DEVENV_ROOT/.devcontainer/env-vars.sh"

update-repos.sh
