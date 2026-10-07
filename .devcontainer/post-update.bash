#!/bin/bash
# post-update.bash - What to do after the devenv repo has been updated.
#
# Sourced by check-update-devenv-repo.sh (the start-of-shell update check) and by
# the devenv-update shell function, so both follow one routine.
#
# The required action comes from the highest-priority "Devenv-Action" trailer
# across the pulled commits:
#
#   nothing    no further action (the default when no trailer is present)
#   restart    the dev container needs a restart
#   bootstrap  re-run bootstrap (implies a restart)
#   recreate   rebuild the dev container (implies bootstrap and restart)

# Guard against multiple sourcing
if [ -n "${_DEVENV_POST_UPDATE_LOADED:-}" ]; then
    return 0
fi
_DEVENV_POST_UPDATE_LOADED=1

# The repo this file belongs to: located from the file itself, so a stale or
# foreign DEVENV_ROOT in the environment cannot point bootstrap elsewhere.
_DEVENV_POST_UPDATE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Integer priority of an action label (higher = more severe; -1 = unrecognised).
devenv_action_priority() {
    case "$1" in
        recreate)  echo 3 ;;
        bootstrap) echo 2 ;;
        restart)   echo 1 ;;
        nothing)   echo 0 ;;
        *)         echo -1 ;;
    esac
}

# Print the highest-priority action named by a Devenv-Action trailer in OLD_REF..NEW_REF
# (NEW_REF defaults to HEAD), or "nothing" when there is none.
#
# Usage: devenv_highest_action OLD_REF [NEW_REF]
devenv_highest_action() {
    local old_ref="$1" new_ref="${2:-HEAD}" best="nothing" best_pri=0 action pri
    while IFS= read -r action; do
        [ -z "$action" ] && continue
        pri=$(devenv_action_priority "$action")
        if [ "$pri" -gt "$best_pri" ]; then
            best="$action"
            best_pri="$pri"
        fi
    done < <(git log "${old_ref}..${new_ref}" --format='%(trailers:key=Devenv-Action,valueonly)' 2>/dev/null \
             | tr '[:upper:]' '[:lower:]' \
             | grep -v '^$')
    echo "$best"
}

# Offer to restart the dev container.
_devenv_offer_restart() {
    local restart_now
    read -rp "Do you want to restart the dev container now? (y/n): " restart_now
    case "$restart_now" in
        [Yy]*)
            if command -v docker >/dev/null 2>&1; then
                echo "Restarting dev container now..."
                nohup bash -c 'sleep 1; docker restart "$(hostname)"' >/dev/null 2>&1 &
            else
                echo "Docker CLI not found. Run: docker restart \"\$(hostname)\""
            fi
            ;;
        *)
            echo "Skipping restart. Run: docker restart \"\$(hostname)\""
            ;;
    esac
}

# Carry out the post-update action for the commits pulled since OLD_REF.
#
# Usage: devenv_post_update OLD_REF [NEW_REF]
#
# Returns 1 when a bootstrap the user asked for failed, 0 otherwise.
devenv_post_update() {
    local action bootstrap_script recreate_choice run_bootstrap_now
    bootstrap_script="$_DEVENV_POST_UPDATE_ROOT/.devcontainer/bootstrap.sh"
    action=$(devenv_highest_action "$@")

    case "$action" in
        recreate)
            echo "Post-update action: recreate container"
            echo "Choose an option:"
            echo "  1) Recreate container now (recommended)"
            echo "  2) Restart container now"
            echo "  3) Skip"
            read -rp "Enter choice (1/2/3): " recreate_choice
            case "$recreate_choice" in
                1) echo "Run 'Dev Containers: Rebuild Container' in VS Code to recreate the container." ;;
                2) _devenv_offer_restart ;;
                *) echo "Skipping recreate/restart." ;;
            esac
            ;;
        bootstrap)
            echo "Post-update action: run bootstrap and restart container"
            read -rp "Do you want to run bootstrap now? (y/n): " run_bootstrap_now
            case "$run_bootstrap_now" in
                [Yy]*)
                    if "$bootstrap_script"; then
                        echo "Bootstrap completed successfully."
                        echo "Recommendation: restart the dev container to apply bootstrap changes."
                        _devenv_offer_restart
                    else
                        echo "Bootstrap failed. Please run $bootstrap_script manually."
                        return 1
                    fi
                    ;;
                *)
                    echo "Skipping bootstrap. Run $bootstrap_script when ready."
                    ;;
            esac
            ;;
        restart)
            echo "Post-update action: restart container"
            _devenv_offer_restart
            ;;
        *)
            echo "Update complete."
            ;;
    esac
}
