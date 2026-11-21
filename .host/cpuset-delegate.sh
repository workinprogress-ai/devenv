#!/bin/bash

# cpuset-delegate.sh — make cpuset cgroup delegation durable for the devenv
# dev container's host environment.
#
# Why: k3s (and therefore k3d clusters inside the dev container) hard-requires
# the cpuset cgroup controller at server start. On systemd hosts that delegate
# only cpu/memory/pids to the user session (the default for rootless podman),
# the container can never see cpuset — k3s dies with
# "failed to find cpuset cgroup (v2)" and k3d hangs with no error. The durable
# fix is a systemd Delegate= drop-in adding cpuset to the delegated set; it
# takes effect at the next user-session start (reboot or session restart).
#
# For same-session recovery without a reboot, run cpuset-live-toggle.sh.
#
# Runtime matrix (docs/Dev-container-environment.md has the full table):
#  - rootless podman: container under user@<uid>.service — the default
#    delegated set lacks cpuset; drop-in targets the user unit. Live-verified
#    against k3d v5.9.0 / k3s v1.35.5.
#  - docker as root: container under docker.service — delegated set varies
#    by distro; drop-in targets the docker unit (mode docker).
#  - podman as root: containers land under system.slice like docker's;
#    the docker mode's Delegate= mechanics apply identically (analysis —
#    not live-proven).
#
# Self-elevates: requires root for the /etc writes; re-execs under sudo.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Re-running under sudo (writes to /etc require root)..."
    exec sudo "$0" "$@"
fi

CONTROLLER_SET="cpu cpuset memory pids"

usage() {
    echo "Usage: $0 [--uid <uid>] [--force-docker] [--force-user]"
    echo "          [--container-name <pattern>]"
    echo ""
    echo "Installs a systemd Delegate= drop-in so the user session's cgroup"
    echo "subtree includes cpuset (k3s requirement). Default --uid is the"
    echo "invoking user (or 1000 when run directly as root)."
    echo ""
    echo "Handles two host shapes (detected via podman/docker when possible;"
    echo "--force-docker or --force-user override detection; CONTAINER_NAME"
    echo "env or --container-name tunes the lookup, default 'vsc-'):"
    echo "  - rootless podman / WSL (user@<uid>.service)"
    echo "  - docker-as-root / podman-as-root (docker.service drop-in; check"
    echo "    whether the problem exists first — rootful runtimes usually"
    echo "    have all controllers at the cgroup root)"
    exit "${1:-0}"
}

UID_ARG=""
MODE=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --uid) UID_ARG="${2:?--uid requires a value}"; shift 2 ;;
        --container-name) CONTAINER_NAME="${2:?--container-name requires a value}"; shift 2 ;;
        --force-docker) MODE="docker"; shift ;;
        --force-user) MODE="user"; shift ;;
        -h|--help) usage 0 ;;
        *) echo "Unknown option: $1" >&2; usage 1 ;;
    esac
done

# Invoking uid: SUDO_USER when elevated, else the caller. A direct root run
# (no SUDO_USER, no --uid) would otherwise target user@0.service — not a user
# session, does nothing — so it falls to 1000, the conventional first user.
if [ -n "${SUDO_USER:-}" ]; then
    TARGET_UID="${UID_ARG:-$(id -u "$SUDO_USER" 2>/dev/null || echo 1000)}"
elif [ "$(id -u)" -eq 0 ]; then
    TARGET_UID="${UID_ARG:-1000}"
else
    TARGET_UID="${UID_ARG:-$(id -u)}"
fi

if [ -z "$MODE" ]; then
    # Detection: a cgroup chain under user@.service means the user-session
    # shape; anything else (system.slice/docker-*/libpod/containerd) means
    # a system-slice runtime (docker-as-root or podman-as-root).
    # The script runs on the host; the dev container is not named after the
    # host's hostname. Default the name filter to the dev-container naming
    # pattern (vsc-…); --container-name overrides, and explicit modes skip
    # discovery entirely.
    CHAIN=""
    CID=""
    NAME_FILTER="${CONTAINER_NAME:-vsc-}"
    if command -v podman >/dev/null 2>&1; then
        CID="$(podman ps -q --filter "name=$NAME_FILTER" 2>/dev/null | head -1 || true)"
        if [ -n "$CID" ]; then
            HOST_PID="$(podman inspect "$CID" --format '{{.State.Pid}}' 2>/dev/null)"
            if [ -n "$HOST_PID" ] && [ -r "/proc/$HOST_PID/cgroup" ]; then
                CHAIN="$(awk -F:: '/^0::/{print $2}' "/proc/$HOST_PID/cgroup")"
            fi
        fi
    fi
    if [ -z "$CHAIN" ] && command -v docker >/dev/null 2>&1; then
        # podman cannot see docker-engine containers (separate stores) —
        # probe the docker engine too before falling back to user mode.
        DCID="$(docker ps -q --filter "name=$NAME_FILTER" 2>/dev/null | head -1 || true)"
        if [ -n "$DCID" ]; then
            DPID="$(docker inspect "$DCID" --format '{{.State.Pid}}' 2>/dev/null)"
            if [ -n "$DPID" ] && [ -r "/proc/$DPID/cgroup" ]; then
                CHAIN="$(awk -F:: '/^0::/{print $2}' "/proc/$DPID/cgroup")"
            fi
        fi
    fi
    case "$CHAIN" in
        *user@*.service*) MODE="user" ;;
        *docker*|*system.slice*|*libpod*|*containerd*) MODE="docker" ;;
        "") : ;;  # nothing discovered — default below
        *) MODE="docker" ;;
    esac
    [ -n "$MODE" ] || MODE="user"  # safest default: the documented devenv shape
fi

# Non-systemd hosts get a clear refusal instead of a half-run: the drop-in
# would be written and then daemon-reload would die raw under set -e.
# Delegate= delegation is also a cgroup v2 mechanism — a v1 hierarchy host
# gets the same clear refusal (the docs promise both scripts require v2).
if [ ! -d /run/systemd/system ]; then
    echo "Error: no systemd on this host — a Delegate= drop-in has no effect here." >&2
    echo "cgroup delegation on non-systemd hosts is manual (enable cpuset on the" >&2
    echo "container's cgroup chain; see docs/Dev-container-environment.md)." >&2
    exit 1
fi
if [ ! -f "${DEVENV_CGROUP_SYSFS_OVERRIDE:-/sys/fs/cgroup}/cgroup.controllers" ]; then
    echo "Error: cgroup v2 required (no cgroup.controllers at the cgroup root) —" >&2
    echo "this host runs the legacy cgroup v1 hierarchy; Delegate= is a v2 mechanism." >&2
    exit 1
fi

install_dropin() {
    local unit="$1" conf_dir="$2" desc="$3"
    mkdir -p "$conf_dir"
    local conf="$conf_dir/delegate-cpuset.conf"
    cat > "$conf" <<EOF
# Managed by devenv .host/cpuset-delegate.sh — adds cpuset to the delegated
# cgroup controllers so k3s (k3d clusters in the dev container) can start.
# A drop-in REPLACES the unit's original Delegate= line, so the full set is
# restated here.
[Service]
Delegate=$CONTROLLER_SET
EOF
    systemctl daemon-reload
    echo "Installed $desc drop-in: $conf (Delegate=$CONTROLLER_SET)"
    echo "Effective at the next ${unit%%.*} start — reboot, or restart the session/unit."
}

case "$MODE" in
    user)
        UNIT="user@${TARGET_UID}.service"
        install_dropin "$UNIT" "/etc/systemd/system/${UNIT}.d" "user session ($UNIT)"
        ;;
    docker)
        # A system-slice chain with no docker.service means rootful podman
        # (transient scopes, no persistent unit to delegate) — a drop-in for
        # a nonexistent unit daemon-reloads fine but asserts a fix that can
        # never take effect. Refuse honestly instead.
        if ! systemctl cat docker.service >/dev/null 2>&1; then
            echo "Error: detected a system-slice container chain but docker.service" >&2
            echo "does not exist on this host (rootful podman shape?). Rootful runtimes" >&2
            echo "usually expose all controllers at the cgroup root — verify inside the" >&2
            echo "dev container:  cat /sys/fs/cgroup/cgroup.controllers" >&2
            exit 1
        fi
        install_dropin "docker.service" "/etc/systemd/system/docker.service.d" "docker service"
        echo "Note: docker-as-root hosts usually already have all controllers at the"
        echo "cgroup root; verify the problem exists before keeping this drop-in."
        ;;
esac

echo ""
echo "Verification after next reboot/session start (inside the dev container):"
echo "  cat /sys/fs/cgroup/cgroup.controllers   # must list cpuset"
