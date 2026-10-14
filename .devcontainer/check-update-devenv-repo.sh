#!/bin/bash
# check-update-devenv-repo.sh - Checks for updates and, if found, interacts with the user to perform an update.
#
# After pulling, the required post-update action comes from the "Devenv-Action"
# trailers on the new commits; see post-update.bash, shared with devenv-update.

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
    exit 0
fi

# Local is ahead of the remote: nothing to pull, nothing to say.
if [ "$REMOTE_HASH" == "$BASE_HASH" ]; then
    exit 0
fi

# Both sides moved. The remote's history may have been rewritten (a force-pushed
# fork master): an earlier tip of the remote-tracking branch (from its reflog) is
# still reachable from the local branch but no longer from the remote. That case
# now offers the update and delegates to git-update (reset when the clone kept
# nothing unique, replay via rebase when it did); ordinary divergence — local
# commits that were never on the remote — is normal for a fork: silent in
# non-interactive runs, one TTY-only pointer line interactively. Objects missing from a shallow
# clone make the reachability test fail, which reads as "not rewritten".
if [ "$LOCAL_HASH" != "$BASE_HASH" ]; then
    # The shared rewrite classifier: none / clean <past-tip> / diverged <past-tip>.
    # shellcheck source=../tools/lib/rewrite-detect.bash
    source "$devenv/tools/lib/rewrite-detect.bash" 2>/dev/null || {
        echo "Warning: rewrite-detect library missing; cannot classify the divergence." >&2
        exit 0
    }
    STATE="$(rewrite_detect_state "$CURRENT_BRANCH")"
    VERDICT="${STATE%% *}"
    case "$VERDICT" in
        clean|diverged)
            PAST_TIP="${STATE#* }"
            # Uncommitted changes: refuse, same as the fast-forward path below —
            # a reset would destroy them and a rebase refuses them anyway.
            if [ -n "$(git status --porcelain)" ]; then
                echo "The remote history of ${CURRENT_BRANCH} was rewritten, but there are uncommitted or untracked changes in the devenv repo."
                echo "Please commit, stash, or remove them before updating."
                exit 1
            fi
            echo "The remote history of ${CURRENT_BRANCH} was rewritten (a fork sync): origin/${CURRENT_BRANCH} and your branch have diverged."
            if [ "$VERDICT" = "clean" ]; then
                echo "This clone has no unique commits; the update resets to origin/${CURRENT_BRANCH}."
            else
                echo "Your local commits will be replayed on top of origin/${CURRENT_BRANCH}."
            fi
            echo "Changes detected on the remote ${CURRENT_BRANCH} branch for the development environment."
            read -rp "Do you want to update? (y/n): " answer
            case $answer in
                [Yy]* ) ;;
                * )
                    exit 1;;
            esac
            if ! "$devenv/tools/git-update"; then
                echo "Error updating the repository. Please update manually (e.g., run 'git rebase origin/${CURRENT_BRANCH}')."
                exit 1
            fi
            # The scan base for Devenv-Action trailers: the pre-rewrite tip, so
            # the scan covers exactly the new upstream commits — not the whole
            # rewritten span. git-update exports GIT_UPDATE_SCAN_BASE; fall back
            # to the classifier's tip if the tool did not set it.
            SCAN_BASE="${GIT_UPDATE_SCAN_BASE:-$PAST_TIP}"
            # shellcheck source=./post-update.bash
            source "$script_folder/post-update.bash"
            # Ceiling = origin/<branch>: upstream commits only — the consumer's
            # replayed local commits (inside HEAD on the rebase path) must never
            # re-fire a container action via their own trailers.
            devenv_post_update "$LOCAL_HASH" "origin/${CURRENT_BRANCH}" "$SCAN_BASE" || exit 1
            exit 0
            ;;
    esac
    # Diverged without a recognized rewrite. Ordinary fork divergence (local
    # commits never on the remote) is normal for a fork and stays silent; a
    # rewritten remote whose past tip fell out of the reflog also lands here —
    # tell the user an update may exist and how to get it.
    if [ -t 0 ]; then
        echo "Your branch and origin/${CURRENT_BRANCH} have diverged in a way this check cannot classify."
        echo "If the remote history was rewritten a while ago, run 'git-update' to update anyway."
    fi
    exit 0
fi

# ── Non-master branch ──────────────────────────────────────────────────────
if [ "$CURRENT_BRANCH" != "master" ]; then
    echo "WARNING: The current branch ${CURRENT_BRANCH} is different on the remote."
    echo "You must manually update this branch (e.g., by running 'git pull') to get the latest changes."
    exit 0;
fi

# ── Master branch ──────────────────────────────────────────────────────────
# Uncommitted changes: refuse only now that an update is actually on offer, so a
# dirty tree does not nag on every start while the repo is up to date.
if [ -n "$(git status --porcelain)" ]; then
    echo "Changes are available on the remote ${CURRENT_BRANCH} branch, but there are uncommitted or untracked changes in the devenv repo."
    echo "Please commit, stash, or remove them before updating."
    exit 1
fi

echo "Changes detected on the remote master branch for the development environment."
read -rp "Do you want to update? (y/n): " answer
case $answer in
    [Yy]* ) ;;
    * )
        exit 1;;
esac

# Capture HEAD before pulling so we can scan only the new commits.
PRE_UPDATE_HASH=$(git rev-parse HEAD)

if ! "$devenv/tools/git-update"; then
    echo "Error updating the repository. Please update manually (e.g., run 'git pull')."
    echo "You may also need to rebuild the dev container or re-run the bootstrap."
    exit 1
fi

# Carry out the action the new commits call for.
# shellcheck source=./post-update.bash
source "$script_folder/post-update.bash"
devenv_post_update "$PRE_UPDATE_HASH" || exit 1

exit 0
