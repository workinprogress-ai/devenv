#!/usr/bin/env bash
#
# kube-intercept.sh
#
# Uses telepresence to intercept traffic to a deployment.
# Accepts parameters in the form: POD=PORT or POD=LOCAL_PORT:POD_PORT.
#
# You can optionally pass in a file as the first parameter that contains one mapping per line.
# Lines starting with '#' or blank lines are ignored.
#
# Examples:
#   ./kube-intercept.sh mappings.txt
#   ./kube-intercept.sh mappings.txt backend=9090:80
#   ./kube-intercept.sh myapp=8080 frontend=3000:3000

# Array to store mapping strings
mappings=()

# If the first argument is a file, read mappings from it.
if [ -f "$1" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Skip empty lines or lines starting with #
    if [[ -z "$line" || "$line" =~ ^# ]]; then
      continue
    fi
    mappings+=("$line")
  done < "$1"
  shift 1
fi

# Append any additional command-line arguments as mappings.
for arg in "$@"; do
  mappings+=("$arg")
done

# Ensure at least one mapping is provided.
if [ ${#mappings[@]} -eq 0 ]; then
  echo "Usage: $0 [mapping_file] POD=PORT or POD=LOCAL_PORT:POD_PORT [POD=PORT ...]"
fi

mapping_lines=()

for mapping in "${mappings[@]}"; do
  IFS='=' read -r deployment_identifier port_mapping <<< "$mapping"
  if [ -z "$deployment_identifier" ] || [ -z "$port_mapping" ]; then
    echo "Invalid mapping format: $mapping" >&2
    exit 1
  fi

  # Allow for multiple ports separated by commas
  IFS=',' read -ra port_pairs <<< "$port_mapping"

  pod_name=$(kube-deployment-select.sh "$deployment_identifier" "Pick a pod for $mapping")

  # Build the port part: --port local:remote ...
  port_args=""
  for port_pair in "${port_pairs[@]}"; do
    if [[ "$port_pair" == *:* ]]; then
      IFS=':' read -r local_port pod_port <<< "$port_pair"
    else
      local_port="$port_pair"
      pod_port="$port_pair"
    fi

    if ! [[ "$local_port" =~ ^[0-9]+$ && "$pod_port" =~ ^[0-9]+$ ]]; then
      echo "Ports must be numeric in mapping: $mapping" >&2
      exit 1
    fi

    port_args+=" --port ${local_port}:${pod_port}"
  done

  line="$pod_name$port_args"
  mapping_lines+=("$line")
done

WATCHDOG_INTERVAL=5
PREFIX="[telepresence-watchdog]"

is_telepresence_connected() {
  telepresence status --output json 2>/dev/null | jq -e '.user_daemon.status == "Connected"'
}

telepresence_connect() {
  if ! telepresence connect; then
    return 1
  fi
  return 0
}

telepresence_watchdog_loop() {
  while true; do
    if [ "$(is_telepresence_connected)" != "true" ] ; then
      echo -e "$PREFIX [$(date)] Telepresence is not connected. Attempting to reconnect..."
      if telepresence_connect; then
        sleep "$WATCHDOG_INTERVAL"
      else
        telepresence_socket=/var/run/telepresence-daemon.socket
        echo -e "$PREFIX [$(date)] Failed to connect to telepresence. Attempting to remove hung socket..."
        sudo rm -f $telepresence_socket &>/dev/null
        sleep 1
        if telepresence_connect; then
          sleep "$WATCHDOG_INTERVAL"
        else
          echo -e "$PREFIX [$(date)] Failed to connect to telepresence. Exiting..."
          exit 1
        fi
      fi
    fi
  done
}

cleanup() {
  echo -e "\nStopping all intercepts..."
  if [ -n "$TELEPRESENCE_WATCHDOG_PID" ]; then
    kill "$TELEPRESENCE_WATCHDOG_PID" 2>/dev/null
  fi
  telepresence quit --stop-daemons
  exit 0
}

trap cleanup SIGINT SIGTERM

if ! kubectl get deployment traffic-manager -n ambassador --no-headers &>/dev/null; then
  echo "Installing traffic-manager on cluster..."
  telepresence helm install
fi

if [ "$(is_telepresence_connected)" != 'true' ]; then
  echo "Starting telepresence..."
  telepresence_watchdog_loop &
  TELEPRESENCE_WATCHDOG_PID=$!
  sleep 3
fi

echo "Starting intercepts..."
for line in "${mapping_lines[@]}"; do
  telepresence replace $line
done

if [ -z "$TELEPRESENCE_WATCHDOG_PID" ]; then
  echo "Watchdog is running in the background.  No need to stay running."
  echo "Mission accomplished.  To exit the intercept, kill the process where the connection watchdog is running."
  exit 0;
fi

sleep infinity 
rm /home/vscode/.cache/telepresence/logs/*.log &>/dev/null
