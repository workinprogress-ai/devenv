#!/bin/bash

# cpuset-live-toggle.sh — same-session cpuset recovery, no reboot.
#
# Complements cpuset-delegate.sh (the durable fix): until the Delegate=
# drop-in takes effect at the next user-session start, this script re-enables
# cpuset on the running cgroup chain so k3d clusters work immediately.
# Non-persistent: the toggle evaporates on host reboot or session restart —
# run it again, or rely on the drop-in after the next reboot.
#
# Mechanism (cgroup v2): a child's cgroup.controllers only lists controllers
# its parent's subtree_control enables, so the enabling write must happen at
# every level of the chain, top-down, from outside the container. The script
# discovers the dev container's host-side cgroup chain and walks it.
#
# Self-elevates: the /sys/fs/cgroup writes require root; re-execs under sudo.
# DEVENV_TOGGLE_SKIP_ELEVATE=1 is a test seam (hermetic suites run as the
# container user against a writable fake tree).
set -euo pipefail

if [ "$(id -u)" -ne 0 ] && [ "${DEVENV_TOGGLE_SKIP_ELEVATE:-0}" != "1" ]; then
    echo "Re-running under sudo (cgroup writes require root)..."
    exec sudo "$0" "$@"
fi

usage() {
    echo "Usage: $0 [--chain <cgroup-path>] [--container-name <name>]"
    echo ""
    echo "Enables +cpuset on every level of the dev container's host cgroup"
    echo "chain (top-down). Chain auto-discovered via podman when possible:"
    echo "  podman inspect <container> -> host PID -> /proc/<pid>/cgroup"
    echo "Pass --chain explicitly (the 0::<path> value from /proc/<pid>/cgroup)"
    echo "when auto-discovery cannot see the container."
    exit "${1:-0}"
}

CHAIN=""
CONTAINER_NAME=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --chain) CHAIN="${2:?--chain requires a value}"; shift 2 ;;
        --container-name) CONTAINER_NAME="${2:?--container-name requires a value}"; shift 2 ;;
        -h|--help) usage 0 ;;
        *) echo "Unknown option: $1" >&2; usage 1 ;;
    esac
done

if [ -z "$CHAIN" ]; then
    # The script runs on the host; the dev container is not named after the
    # host's hostname. Default to the dev-container naming pattern (vsc-…).
    NAME="${CONTAINER_NAME:-vsc-}"
    if ! command -v podman >/dev/null 2>&1; then
        echo "Error: podman not found and no --chain given; cannot discover the cgroup chain." >&2
        exit 1
    fi
    CID="$(podman ps -q --filter "name=$NAME" 2>/dev/null | head -1 || true)"
    if [ -z "$CID" ]; then
        echo "Error: no podman container matches name '$NAME'; pass --container-name or --chain." >&2
        exit 1
    fi
    HOST_PID="$(podman inspect "$CID" --format '{{.State.Pid}}' 2>/dev/null)"
    if [ -z "$HOST_PID" ] || [ ! -r "/proc/$HOST_PID/cgroup" ]; then
        echo "Error: cannot read /proc/$HOST_PID/cgroup for container '$NAME'." >&2
        exit 1
    fi
    # The v2 line: "0::<path>".
    CHAIN="$(awk -F:: '/^0::/{print $2}' "/proc/$HOST_PID/cgroup")"
fi

if [ -z "$CHAIN" ]; then
    echo "Error: discovered cgroup chain is empty." >&2
    exit 1
fi

# cgroup v2 only: the walk writes cgroup.subtree_control files that do not
# exist on v1 hosts (and not at all on macOS). Refuse instead of fabricating
# a zero-write "success".
enable_cpuset_chain() {
    if [ ! -f "${DEVENV_CGROUP_SYSFS_OVERRIDE:-/sys/fs/cgroup}/cgroup.controllers" ]; then
        echo "Error: cgroup v2 required (no cgroup.controllers at the cgroup root)" >&2
        echo "This host runs cgroup v1 or is not Linux; cpuset delegation needs v2." >&2
        return 1
    fi

    echo "Enabling +cpuset down the chain: $CHAIN"

    # Walk every prefix of the chain shallowest→deepest, writing +cpuset to
    # each level's subtree_control. Top-down order is required: a level's
    # available controller set only gains cpuset after its parent's
    # subtree_control enables it, so a bottom-up walk would fail at the
    # deepest level first and never reach the ancestors where the write is
    # both possible and necessary.
    # Failures are collected but non-fatal per level (a level may
    # legitimately refuse when cpuset is not in its available set — that
    # means the delegation drop-in is required, reported at the end).
    local CGROUP_ROOT="${DEVENV_CGROUP_SYSFS_OVERRIDE:-/sys/fs/cgroup}"
    local LEVELS=("/") ACC="" seg LEVEL CTRL_FILE SEGMENTS
    local IFS="/"
    read -r -a SEGMENTS <<< "$CHAIN"
    for seg in ${SEGMENTS[@]+"${SEGMENTS[@]}"}; do
        [ -n "$seg" ] || continue
        ACC="$ACC/$seg"
        LEVELS=("${LEVELS[@]}" "$ACC")
    done

    FAILED=0
    local PREFIX
    for LEVEL in "${LEVELS[@]}"; do
        # Path join: LEVEL carries the leading slash except at the root,
        # where the prefix must be empty — a naive ${LEVEL#/} strip drops
        # the separator for every other level.
        if [ "$LEVEL" = "/" ]; then PREFIX=""; else PREFIX="$LEVEL"; fi
        CTRL_FILE="$CGROUP_ROOT${PREFIX}/cgroup.subtree_control"
        if [ -w "$CTRL_FILE" ]; then
            if echo "+cpuset" > "$CTRL_FILE" 2>/dev/null; then
                echo "  +cpuset -> $CTRL_FILE"
            else
                if grep -qw cpuset "$CGROUP_ROOT${PREFIX}/cgroup.controllers" 2>/dev/null; then
                    echo "  FAILED (cpuset available but write refused): $CTRL_FILE" >&2
                    FAILED=1
                else
                    echo "  stop: cpuset not in available set at ${LEVEL:-/} — the Delegate= drop-in is required (run cpuset-delegate.sh and reboot)." >&2
                    FAILED=1
                    break
                fi
            fi
        fi
    done
    [ "$FAILED" -eq 0 ]
}
if ! enable_cpuset_chain; then
    echo "" >&2
    echo "Result: incomplete — see messages above. The durable fix is cpuset-delegate.sh." >&2
    exit 1
fi

echo ""
echo "Result: cpuset enabled down the chain. Scope: this specific container"
echo "(the walk targets its cgroup chain; a container recreated later needs"
echo "the walk re-run, or the reboot-effective drop-in). Verify inside the dev container:"
echo "  cat /sys/fs/cgroup/cgroup.controllers   # must list cpuset"
