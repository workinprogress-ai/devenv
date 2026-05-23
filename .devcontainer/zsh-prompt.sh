#!/bin/zsh

# Capture the VS Code workspace start directory once per shell session.
# The first shell sources this with $PWD = the workspace folder; subshells
# inherit the already-exported value and the :- guard leaves it unchanged.

# Clear a previously-captured bad value (e.g. set during shell startup when PWD was under /vscode).
if [[ "${DEVENV_START_DIR:-}" =~ '^/vscode(/|$)' ]]; then
    unset DEVENV_START_DIR
fi

# Set the start directory to the git root of the starting folder (or the folder itself if
# not inside a git repo). Using the git root ensures the variable always sits at a repo
# boundary even when the terminal opens deep inside a subtree.
if [[ ! "$PWD" =~ '^/vscode(/|$)' && -z "${DEVENV_START_DIR:-}" ]]; then
    _gsd=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)
    export DEVENV_START_DIR="${_gsd:-$PWD}"
    unset _gsd
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
    local bold=''
    if [[ "$PWD" =~ '^/home/vscode(/|$)' ]]; then
        colour=153
        bold=''
    elif [[ -n "${DEVENV_START_DIR:-}" && \
            ( "$PWD" == "${DEVENV_START_DIR}" || "$PWD" == "${DEVENV_START_DIR}/"* ) && \
            ( "${DEVENV_START_DIR}" != "/workspaces/devenv" || "$PWD" != "${DEVENV_START_DIR}/repos/"* ) ]]; then
        colour=green
        bold=''
    elif [[ "$PWD" =~ '^/workspaces/devenv(/|$)' ]]; then
        colour=yellow
        bold='%B'
    else
        colour=red
        bold='%B'
    fi
    if [[ -n "${GH_USER:-}" ]]; then
        echo -n "${bold}%F{$colour}@${GH_USER}%f%b"
    else
        echo -n "${bold}%F{$colour}%n%f%b"
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
