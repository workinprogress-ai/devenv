#!/bin/bash

__bash_prompt() {
    local userpart='`export XIT=$? \
        && [ ! -z "${GITHUB_USER:-}" ] && echo -n "\[\033[0;32m\]@${GITHUB_USER:-} " || echo -n "\[\033[0;32m\]\u " \
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

    local lightblue='\[\033[1;34m\]'
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
