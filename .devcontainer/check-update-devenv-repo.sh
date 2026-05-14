#!/bin/bash
# check-update-devenv-repo.sh - Checks for updates and, if found, interacts with the user to perform an update.
#
# After pulling, the required post-update action is determined from the highest-priority
# "Devenv-Action" trailer found across all new commits:
#
#   Devenv-Action: nothing    — no further action needed (default when trailer is absent)
#   Devenv-Action: restart    — dev container needs to be restarted
#   Devenv-Action: bootstrap  — re-run bootstrap (implies restart)
#   Devenv-Action: recreate   — rebuild/recreate the dev container (implies bootstrap + restart)
#
# These are progressive: the highest-ranked action across all pulled commits wins.

# ── Action priority ────────────────────────────────────────────────────────
# Returns an integer priority for a given action label (higher = more severe).
action_priority() {
    case "$1" in
        recreate)  echo 3 ;;
        bootstrap) echo 2 ;;
        restart)   echo 1 ;;
        nothing)   echo 0 ;;
        *)         echo -1 ;;   # unrecognised — ignored
    esac
}

# Scan git log from OLD_REF..HEAD for Devenv-Action trailers and return the
# highest-priority action found. Prints "nothing" if no trailers are present.
highest_devenv_action() {
    local old_ref="$1"
    local best="nothing"
    local best_pri=0

    while IFS= read -r action; do
        [ -z "$action" ] && continue
        local pri
        pri=$(action_priority "$action")
        if [ "$pri" -gt "$best_pri" ] 2>/dev/null; then
            best="$action"
            best_pri="$pri"
        fi
    done < <(git log "${old_ref}..HEAD" --format='%(trailers:key=Devenv-Action,valueonly)' 2>/dev/null \
             | tr '[:upper:]' '[:lower:]' \
             | grep -v '^$')

    echo "$best"
}

# ── Setup ──────────────────────────────────────────────────────────────────
script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
cd "$script_folder" || exit 1
devenv=$(dirname "$script_folder")

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
LOCAL_HASH=$(git rev-parse "$CURRENT_BRANCH")
REMOTE_HASH=$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null)
BASE_HASH=$(git merge-base "$CURRENT_BRANCH" "origin/$CURRENT_BRANCH" 2>/dev/null)

# Up to date — nothing to do.
if [ "$LOCAL_HASH" == "$REMOTE_HASH" ]; then
    cd - > /dev/null || return
    exit 0
fi

# Local is ahead of or has diverged from remote — don't offer to update.
if [ "$LOCAL_HASH" != "$BASE_HASH" ]; then
    cd - > /dev/null || return
    exit 0
fi

# ── Non-master branch ──────────────────────────────────────────────────────
if [ "$CURRENT_BRANCH" != "master" ]; then
    echo "WARNING: The current branch ${CURRENT_BRANCH} is different on the remote."
    echo "You must manually update this branch (e.g., by running 'git pull') to get the latest changes."
    exit 0;
fi

# ── Master branch ──────────────────────────────────────────────────────────
echo "Changes detected on the remote master branch for the development environment."
read -rp "Do you want to update? (y/n): " answer
case $answer in
    [Yy]* ) ;;
    * )
        cd - > /dev/null || return
        exit 1;;
esac

# Capture HEAD before pulling so we can scan only the new commits.
PRE_UPDATE_HASH=$(git rev-parse HEAD)

$devenv/tools/git-update
if [ $? -ne 0 ]; then
    cd - > /dev/null || return
    echo "Error updating the repository. Please update manually (e.g., run 'git pull')."
    echo "You may also need to rebuild the dev container or re-run the bootstrap."
    exit 1
fi

# Determine required action from the new commits.
ACTION=$(highest_devenv_action "$PRE_UPDATE_HASH")

case "$ACTION" in
    recreate)
        echo
        echo "********************************************************"
        echo "  Dev container must be RECREATED."
        echo "  Please rebuild / recreate your dev container."
        echo "********************************************************"
        echo
        ;;
    bootstrap)
        "$script_folder/bootstrap.sh"
        echo
        echo "********************************************************"
        echo "  Bootstrap complete.  Please RESTART the dev container."
        echo "********************************************************"
        echo
        ;;
    restart)
        echo
        echo "********************************************************"
        echo "  Please RESTART the dev container."
        echo "********************************************************"
        echo
        ;;
    nothing | *)
        echo
        echo "Update complete."
        echo
        ;;
esac

cd - > /dev/null || return
exit 0
