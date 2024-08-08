#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

is_ssh_agent_running() {
    pgrep -u "$USER" ssh-agent > /dev/null 2>&1
}

# Check if ssh-agent is running
if ! is_ssh_agent_running; then
    echo "ssh-agent is not running. Starting it now..."
    # Start ssh-agent and disown it to make it independent of the terminal
    (ssh-agent > ~/.ssh-agent-info) & disown
    # Source the generated ssh-agent environment variables
    source ~/.ssh-agent-info
    echo "ssh-agent started with PID: $(pgrep -u "$USER" ssh-agent)"
    rm ~/.ssh-agent-info
fi