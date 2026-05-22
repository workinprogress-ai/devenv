#!/bin/zsh

# Capture the VS Code workspace start directory once per shell session.
# The first shell sources this with $PWD = the workspace folder; subshells
# inherit the already-exported value and the :- guard leaves it unchanged.

# Clear a previously-captured bad value (e.g. set during shell startup when PWD was under /vscode).
if [[ "${DEVENV_START_DIR:-}" =~ '^/vscode(/|$)' ]]; then
    unset DEVENV_START_DIR
fi

# Set the start directory to the first non-/vscode PWD value seen, which should be the workspace folder
# for the first shell and any non-/vscode folder for subsequent shells. This allows the prompt to react
# to the user leaving the workspace folder, which is a common source of confusion.
if [[ ! "$PWD" =~ '^/vscode(/|$)' ]]; then
    export DEVENV_START_DIR="${DEVENV_START_DIR:-$PWD}"
fi

# vcs_info provides git branch display; add-zsh-hook lets multiple precmd
# handlers coexist without clobbering each other.
autoload -Uz vcs_info add-zsh-hook

zstyle ':vcs_info:*' enable git
zstyle ':vcs_info:*' check-for-changes true
zstyle ':vcs_info:*' unstagedstr ' %F{yellow}✗%f'
zstyle ':vcs_info:git:*' formats      '%F{cyan}(%F{red}%b%f%u%F{cyan})%f '
zstyle ':vcs_info:git:*' actionformats '%F{cyan}(%F{red}%b%f%F{cyan}|%F{yellow}%a%f%u%F{cyan})%f '

setopt PROMPT_SUBST

# Store the exit code of the last user command before vcs_info overwrites $?.
_DEVENV_LAST_EXIT=0

__devenv_precmd() {
    _DEVENV_LAST_EXIT=$?
    # Mirror bash-prompt.sh: show "<>" as the branch name when sitting directly
    # in the repos/ directory (no git context there).
    if [[ "$(basename "$PWD")" == "repos" ]]; then
        vcs_info_msg_0_='%F{cyan}(<>)%f '
    else
        vcs_info
    fi
}
add-zsh-hook precmd __devenv_precmd

# Username: green when inside the VS Code start directory, dark yellow when
# outside. Followed by the arrow: red on a non-zero exit, normal otherwise.
_devenv_userpart() {
    local colour=green
    if [[ -n "${DEVENV_START_DIR:-}" && \
          "$PWD" != "${DEVENV_START_DIR}" && \
          "$PWD" != "${DEVENV_START_DIR}/"* ]]; then
        colour=yellow
    fi
    if [[ -n "${GH_USER:-}" ]]; then
        echo -n "%F{$colour}@${GH_USER}%f"
    else
        echo -n "%F{$colour}%n%f"
    fi
    if [[ $_DEVENV_LAST_EXIT -ne 0 ]]; then
        echo -n " %F{red}➜%f"
    else
        echo -n " %f➜"
    fi
}

# Path: abbreviated to .../relative when under DEVENV_ROOT/repos/, otherwise
# the full absolute path — matching bash-prompt.sh behaviour exactly.
_devenv_pathpart() {
    local current_path="$PWD"
    local devenv_root="${DEVENV_ROOT:-}"
    if [[ -n "$devenv_root" && "$current_path" == "$devenv_root/repos/"* ]]; then
        echo -n "%B%F{blue}...${current_path#$devenv_root/repos}%f%b"
    else
        echo -n "%B%F{blue}${current_path}%f%b"
    fi
}

PROMPT='$(_devenv_userpart) $(_devenv_pathpart) ${vcs_info_msg_0_}%f%# '
