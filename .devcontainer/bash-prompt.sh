#!/bin/bash

# Capture the VS Code workspace start directory once per shell session.
# The first shell sources this with $PWD = the workspace folder; subshells
# inherit the already-exported value and the :- guard leaves it unchanged.

__bash_prompt() {
    
    # Clear a previously-captured bad value (e.g. set during shell startup when PWD was under /vscode).
    if [[ "${DEVENV_START_DIR:-}" =~ ^/vscode(/|$) ]]; then
        unset DEVENV_START_DIR
    fi

    # Set the start directory to the first non-/vscode PWD value seen, which should be the workspace folder 
    # for the first shell and any non-/vscode folder for subsequent shells. This allows the prompt to react
    # to the user leaving the workspace folder, which is a common source of confusion.
    if [[ ! "$PWD" =~ ^/vscode(/|$) ]]; then
        export DEVENV_START_DIR="${DEVENV_START_DIR:-$PWD}"
    fi

    local userpart='`export XIT=$? \
        && if [[ -n "${DEVENV_START_DIR:-}" && "$PWD" != "${DEVENV_START_DIR}" && "$PWD" != "${DEVENV_START_DIR}/"* ]]; then \
             _UC="\[\033[0;33m\]"; \
           else \
             _UC="\[\033[0;32m\]"; \
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
