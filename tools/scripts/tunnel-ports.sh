#!/bin/bash
source "$DEVENV_TOOLS/lib/infrastructure-utilities.bash"

cleanup() {
    # Kill all SSH processes to close the tunnels
    for PID in "${SSH_PIDS[@]}"; do
        echo "Closing tunnel: SSH Process ID $PID"
        kill "$PID" &> /dev/null
    done
}

handle_control_c() {
    echo
    echo
    echo "Jeeesh... all you had to do was hit any key, not hit me with a control-C.  ¯\_(ツ)_/¯   Whatever... cleaning up anyway..."
    echo
    cleanup
    exit 130
}

trap handle_control_c SIGINT

if [ -z "$1" ]; then
    echo "Usage: $0 [-p <ssh port>] [-i <path to ssh key>] <user@target> <port1:destination1> [<port2:destination2> ...]"
    exit 1
fi

if [ "$1" == "-p" ]; then
    shift
    SSH_PORT=$1
    shift
else
    SSH_PORT=22
fi

if [ "$1" == "-i" ]; then
    shift
    SSH_CERT="$1"
    shift
fi

SSH_TARGET=$1
shift  # Shift the arguments so we can loop through the port:destination pairs

# Array to keep track of SSH PIDs
declare -a SSH_PIDS=()

# Loop through the remaining arguments assuming they are in the form port:destination
for TUNNEL in "$@"
do
    # Split the port and destination
    IFS=':' read -r PORT DESTINATION <<< "$TUNNEL"

    # Construct and run the SSH command in the background
    echo "Opening tunnel: Local port $PORT to $DESTINATION through $SSH_TARGET"
    if [ -n "$SSH_CERT" ]; then
        ssh -i $SSH_CERT -NTC -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -L "${PORT}:${DESTINATION}:${PORT}" -p "$SSH_PORT" "$SSH_TARGET" &
    else 
        ssh -NTC -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -L "${PORT}:${DESTINATION}:${PORT}" -p "$SSH_PORT" "$SSH_TARGET" &
    fi
    
    # Save the PID of the SSH process
    SSH_PIDS+=($!)
done

# Inform the user
echo "Tunnels open..."
for PID in "${SSH_PIDS[@]}"; do
    echo " - SSH Process ID: $PID"
done

# Wait for any key press
echo "Press any key to close the tunnels..."
echo
read -n 1 -s -r -p ""

cleanup

echo "Tunnels closed."
