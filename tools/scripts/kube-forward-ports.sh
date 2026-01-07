#!/usr/bin/env bash
#
# kube-forward-ports.sh
#
# Combines functionality from tunnel-ports.sh and kube-pod-port-forward.sh.
# Accepts parameters in the form: POD=PORT or POD=LOCAL_PORT:POD_PORT.
#
# You can optionally pass in a file as the first parameter that contains one mapping per line.
# Lines starting with '#' or blank lines are ignored.
#
# Examples:
#   ./kube-forward-ports.sh mappings.txt
#   ./kube-forward-ports.sh mappings.txt backend=9090:80
#   ./kube-forward-ports.sh myapp=8080 frontend=3000:3000

source "$DEVENV_TOOLS/lib/infrastructure-utilities.bash"

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
  exit 1
fi

# Array to store processed mapping details (format: pod_name:local_port:pod_port)
mapping_details=()

# Process each mapping from the file/command-line.
for mapping in "${mappings[@]}"; do
  # Split on "=" to separate pod identifier and port mapping.
  IFS='=' read -r pod_identifier port_mapping <<< "$mapping"
  if [ -z "$pod_identifier" ] || [ -z "$port_mapping" ]; then
    echo "Invalid mapping format: $mapping" >&2
    exit 1
  fi

  # Check if port_mapping contains a colon.
  if [[ "$port_mapping" == *:* ]]; then
    IFS=':' read -r local_port pod_port <<< "$port_mapping"
  else
    # If only one port provided, use it for both local and pod.
    local_port="$port_mapping"
    pod_port="$port_mapping"
  fi

  # Validate that provided ports are numeric.
  if ! [[ "$local_port" =~ ^[0-9]+$ && "$pod_port" =~ ^[0-9]+$ ]]; then
    echo "Ports must be numeric in mapping: $mapping" >&2
    exit 1
  fi

  pod_name=$(kube-pod-select.sh "$pod_identifier" "Pick a pod for $mapping")
  echo "Mapping: local port $local_port to pod '$pod_name' on port $pod_port."
  mapping_details+=("$pod_name:$local_port:$pod_port")
done

pids=()
should_terminate=false

cleanup() {
  echo -e "\nStopping all port-forwards..."
  should_terminate=true
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null
  done
  wait
  stty sane 2>/dev/null
  exit 0
}

trap cleanup SIGINT SIGTERM

forward_port() {
  local pod_name="$1"
  local local_port="$2"
  local pod_port="$3"
  local label="${pod_name}:${local_port}->${pod_port}"

  while ! $should_terminate; do
    echo "[$label] Starting port-forward..."
    kubectl port-forward "$pod_name" "$local_port:$pod_port" 2>&1 | while read -r line; do
      echo "[$label] $line"
    done

    if $should_terminate; then
      echo "[$label] Terminated."
      break
    fi

    echo "[$label] Port-forward died. Reconnecting..."
    #sleep .1
  done
}

echo "Starting port-forwards..."
for mapping_detail in "${mapping_details[@]}"; do
  IFS=':' read -r pod_name local_port pod_port <<< "$mapping_detail"
  forward_port "$pod_name" "$local_port" "$pod_port" &
  pids+=($!)
done

wait
