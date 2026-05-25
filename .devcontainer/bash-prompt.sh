#!/bin/bash

# Capture the VS Code workspace start directory once per shell session.
# The first shell sources this with $PWD = the workspace folder; subshells
# inherit the already-exported value and the :- guard leaves it unchanged.

__bash_prompt() {
    
    # Clear a previously-captured bad value (e.g. set during shell startup when PWD was under /vscode).
    if [[ "${DEVENV_START_DIR:-}" =~ ^/vscode(/|$) ]]; then
        unset DEVENV_START_DIR
    fi

    # Set the start directory to the git root of the starting folder (or the folder itself if
    # not inside a git repo). Only anchors to the starting location when it is within the
    # workspace tree. If the terminal restored outside the workspace (e.g. /etc, /tmp), fall
    # back to DEVENV_ROOT so colour logic stays meaningful for the whole session rather than
    # being locked to a wrong root or going completely unanchored.
    if [[ ! "$PWD" =~ ^/vscode(/|$) && -z "${DEVENV_START_DIR:-}" ]]; then
        _gsd=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)
        _gsdc="${_gsd:-$PWD}"
        _gsdr="${DEVENV_ROOT:-/workspaces/devenv}"
        if [[ "$_gsdc" == "$_gsdr" || "$_gsdc" == "$_gsdr/"* ]]; then
            export DEVENV_START_DIR="$_gsdc"
        else
            export DEVENV_START_DIR="$_gsdr"
        fi
        unset _gsd _gsdc _gsdr
    fi

    local userpart='`export XIT=$? \
        && if [[ "$PWD" =~ ^/home/vscode(/|$) ]]; then \
             _UC="\[\033[0;38;5;153m\]"; \
           elif [[ -n "${DEVENV_START_DIR:-}" && ( "$PWD" == "${DEVENV_START_DIR}" || "$PWD" == "${DEVENV_START_DIR}/"* ) && ( "${DEVENV_START_DIR}" != "/workspaces/devenv" || "$PWD" != "${DEVENV_START_DIR}/repos/"* ) ]]; then \
             _UC="\[\033[0;32m\]"; \
           elif [[ "$PWD" =~ ^/workspaces/devenv(/|$) ]]; then \
             _UC="\[\033[1;33m\]"; \
           else \
             _UC="\[\033[1;31m\]"; \
           fi \
        && [ ! -z "${GH_USER:-}" ] && echo -n "${_UC}@${GH_USER:-} " || echo -n "${_UC}\u " \
        && [ "$XIT" -ne "0" ] && echo -n "\[\033[1;31m\]➜" || echo -n "\[\033[0m\]➜"`'

    local gitbranch='`\
        if [ "$(git config --get devcontainers-theme.hide-status 2>/dev/null)" != 1 ] && [ "$(git config --get codespaces-theme.hide-status 2>/dev/null)" != 1 ]; then \
            if [ "$(basename $(pwd))" = "repos" ]; then \
                export BRANCH="<>"; \
            else \
                export BRANCH="$(git --no-optional-locks symbolic-ref --short HEAD 2>/dev/null || git --no-optional-locks rev-parse --short HEAD 2>/dev/null)"; \
            fi; \
            if [ "${BRANCH:-}" != "" ]; then \
                echo -n "\[\033[0;36m\](\[\033[1;31m\]${BRANCH:-}" \
                && if git --no-optional-locks ls-files --error-unmatch -m --directory --no-empty-directory -o --exclude-standard ":/*" > /dev/null 2>&1; then \
                        echo -n " \[\033[1;33m\]✗"; \
                fi \
                && echo -n "\[\033[0;36m\]) "; \
            fi; \
        fi`'

    local removecolor='\[\033[0m\]'

    local pathpart='`\
        current_path="$(pwd)"; \
        devenv_root="${DEVENV_ROOT:-}";  \
        if [[ -n "$devenv_root" && "$current_path" == "$devenv_root/repos/"* ]]; then \
            echo -n "\[\033[1;34m\]...${current_path#$devenv_root/repos}"; \
        else \
            echo -n "\[\033[1;34m\]$current_path"; \
        fi`'

    PS1="${userpart} ${pathpart} ${gitbranch}${removecolor}\$ "
    unset -f __bash_prompt
}
__bash_prompt
