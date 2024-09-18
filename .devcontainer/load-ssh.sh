#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

if [ "$1" == "-f" ]; then
    force=true
else
    force=false
fi

# if [ ! -S ~/.ssh/ssh_auth_sock ]; then
#   eval `ssh-agent` &>/dev/null
#   ln -sf "$SSH_AUTH_SOCK" ~/.ssh/ssh_auth_sock
# fi
# export SSH_AUTH_SOCK=~/.ssh/ssh_auth_sock
# ssh-add -l > /dev/null || ssh-add &>/dev/null

is_ssh_agent_running() {
    if [ ! -f ~/.ssh-agent-info ]; then
        echo "false"
        exit;
    fi
    if ! pgrep -u "$USER" ssh-agent > /dev/null 2>&1; then
        echo "false"
        exit;
    fi
    echo "true"
}

agent_running=$(is_ssh_agent_running)

# Check if ssh-agent is running
if [[ "$force" == "true" || "$agent_running" == "false" ]]; then
    echo "Starting ssh agent ..."
    # Start ssh-agent and disown it to make it independent of the terminal
    (ssh-agent > ~/.ssh-agent-info) & disown
    sleep 2         # Give ssh-agent some time to write the environment variables
    # Source the generated ssh-agent environment variables
    echo "ssh-agent started with PID: $(pgrep -u "$USER" ssh-agent)"
    #rm ~/.ssh-agent-info
fi
source ~/.ssh-agent-info &>/dev/null
