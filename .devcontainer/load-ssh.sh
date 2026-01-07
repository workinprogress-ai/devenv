#!/bin/bash

#!/bin/bash

# load-ssh.sh - wire container to host-provided SSH agent

SOCK_PATH="${SSH_AUTH_SOCK:-/ssh-agent}"

if [ ! -S "$SOCK_PATH" ]; then
    echo "SSH agent socket not found at $SOCK_PATH. Ensure your host ssh-agent is running and forwarded." >&2
    exit 0
fi

export SSH_AUTH_SOCK="$SOCK_PATH"

# List identities if available (best-effort)
ssh-add -l >/dev/null 2>&1 || true
