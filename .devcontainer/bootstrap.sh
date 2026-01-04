#!/bin/bash

# Ensure that the script is not run with CRLF line endings
scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"; scriptfile="$0"; if [[ "$(file ${scriptdir}/${scriptfile})" =~ "CRLF" && -f "${scriptdir}/${scriptfile}" && "$(head -n 100 ${scriptdir}/${scriptfile} | grep "^scriptdir.\+dg4MbsIfhbv4-Bash-CRLF-selfheal_Written_By_Kenneth_Lutzke-8Nds9NclkU4sgE" > /dev/null 2>&1 ; echo "$?" )" == "0" ]]; then echo "$(cat ${scriptdir}/${scriptfile} | sed 's/\r$//')" > ${scriptdir}/${scriptfile} ; bash ${scriptdir}/${scriptfile} "$@" ; exit ; fi ; echo "" > /dev/null 2>&1
container_bootstrap_run_file="$HOME/.bootstrap_container_time"
repo_bootstrap_run_file="$toolbox_root/.runtime/.bootstrap_run_time"

on_error() {
  echo "An error occurred. Running cleanup."
  exit 1;
}

# Trap ERR signal which is triggered by any command that exits with a non-zero status
#trap on_error ERR

call_npm() {
    npm "$@" 2>&1 | grep -v 'NODE_TLS_REJECT_UNAUTHORIZED is set to 0'
}

add_nuget_source_if_not_exists() {
    local sourceName="$1"
    local sourceUrl="$2"
    local username="$3"
    local password="$4"

    if ! $dotnet_cmd nuget list source | grep -q "$sourceUrl"; then
        if [ -n "$username" ] && [ -n "$password" ]; then
            $dotnet_cmd nuget add source "$sourceUrl" -n "$sourceName" -u "$username" -p "$password" --store-password-in-clear-text
            echo "NuGet source $sourceName with credentials added."
        else
            $dotnet_cmd nuget add source "$sourceUrl" -n "$sourceName"
            echo "NuGet source $sourceName added."
        fi
    else
        echo "NuGet source $sourceName already exists."
    fi
}

initialize_paths() {
    script_path=$(readlink -f "$0")
    script_folder=$(dirname "$script_path")
    toolbox_root=$(dirname "$script_folder")
    devenv=$toolbox_root
    setup_dir=$toolbox_root/.setup
    name_file=$toolbox_root/.setup/name.txt
    email_file=$toolbox_root/.setup/email.txt
}

detect_architecture() {
    arch=$(uname -m)
    is_arm=$([ "$arch" == "aarch64" ] && echo 1)

    if [ "$is_arm" == "1" ]; then
        echo "ARM architecture detected"
    else
        echo "x86 architecture assumed"
    fi
}

ensure_home_is_set() {
    if [[ -z "$HOME" ]]; then
        export HOME=/home/vscode
    fi
}

load_version_info() {
    VERSION=$(git tag -l 'v*' | sort -V | tail -n 1)
    if [[ $VERSION =~ ([0-9]+)\.([0-9]+)\.([0-9]+)(-([a-zA-Z0-9]+)\.([0-9]+))? ]]; then
        MAJOR_VERSION=${BASH_REMATCH[1]}
        MINOR_VERSION=${BASH_REMATCH[2]}
        PATCH_VERSION=${BASH_REMATCH[3]}
    else
        echo "Warning: VERSION format is not recognized"
        MAJOR_VERSION=0
        MINOR_VERSION=0
        PATCH_VERSION=0
    fi
}

prepare_install_directories() {
    mkdir -p "$devenv/.installs"
}

reset_bashrc_to_original() {
    if [ ! -f ~/.bashrc.original ]; then
        cp ~/.bashrc ~/.bashrc.original
    fi
    cp ~/.bashrc.original ~/.bashrc
}

install_os_packages_round1() {
    echo "# OS packages update and install - First round"
    echo "#############################################"
    sudo apt update
    sudo apt upgrade -y
    sudo apt install -y \
        curl wget gnupg bash-completion iputils-ping uuid fzf gcc g++ make gh \
        xmlstarlet redis-tools cifs-utils xmlstarlet software-properties-common \
        sshfs apt-transport-https ca-certificates bats shellcheck 
}

add_specialized_repositories() {
    echo "# Add specialized OS package repositories and keys"
    echo "#############################################"

    sudo mkdir -p /etc/apt/keyrings

    wget -O- https://apt.releases.hashicorp.com/gpg | \
    gpg --dearmor | \
    sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg > /dev/null
    echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] \
    https://apt.releases.hashicorp.com $(lsb_release -cs) main" | \
    sudo tee /etc/apt/sources.list.d/hashicorp.list

    curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.31/deb/Release.key | sudo gpg --dearmor --yes -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
    sudo chmod 644 /etc/apt/keyrings/kubernetes-apt-keyring.gpg
    echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.31/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
    sudo chmod 644 /etc/apt/sources.list.d/kubernetes.list
}

install_os_packages_round2() {
    echo "# OS packages update and install - Second round"
    echo "#############################################"
    sudo apt update
    sudo apt install -y \
        terraform kubectl
}

install_dotnet() {
    echo "# Install .NET"
    echo "#############################################"

    wget https://dot.net/v1/dotnet-install.sh
    chmod +x ./dotnet-install.sh
    sudo ./dotnet-install.sh -c 8.0 -i /usr/share/dotnet
    sudo ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet
    rm dotnet-install.sh
    dotnet_cmd=/usr/bin/dotnet
}

download_container_scripts() {
    echo "# Get container scripts"
    echo "#############################################"
    wget -O "$HOME/.git-completion.bash" https://raw.githubusercontent.com/git/git/master/contrib/completion/git-completion.bash
    chmod +x "$HOME/.git-completion.bash"
    chmod +x "$toolbox_root"/scripts/*
}

load_setup_credentials() {
    if [ -f "$email_file" ]; then
        USER_EMAIL=$(cat "$email_file")
    else
        echo "WARNING!!!  No email found in $email_file"
    fi

    if [ -f "$name_file" ]; then
        HUMAN_NAME="$(cat "$name_file")"
    else
        echo "WARNING!!!  No human name found in $name_file"
    fi

    if [ -f "$setup_dir/github_token.txt" ]; then
        GH_TOKEN=$(cat "$setup_dir/github_token.txt")
        export GH_TOKEN
    else
        echo "ERROR: No GitHub token found in $setup_dir/github_token.txt"
        echo "Run 'setup' to configure your GitHub token"
        exit 1
    fi

    if [ -f "$setup_dir/github_user.txt" ]; then
        GH_USER=$(cat "$setup_dir/github_user.txt")
        export GH_USER
    else
        echo "ERROR: No GitHub user found in $setup_dir/github_user.txt"
        echo "Run 'setup' to configure your GitHub username"
        exit 1
    fi

    if [ -f "$setup_dir/github_org.txt" ]; then
        GH_ORG=$(cat "$setup_dir/github_org.txt")
        export GH_ORG
    else
        echo "ERROR: No GitHub organization found in $setup_dir/github_org.txt"
        echo "Run 'setup' to configure your GitHub organization"
        exit 1
    fi

    if [ -f "$setup_dir/digitalocean_token.txt" ]; then
        DO_API_TOKEN=$(cat "$setup_dir/digitalocean_token.txt")
        export DO_API_TOKEN
    else
        echo "WARNING: No Digital Ocean API token found in $setup_dir/digitalocean_token.txt (optional)"
    fi
}

write_bash_functions_file() {
    echo "# Create aliases and bash functions script"
    echo "#############################################"
    mkdir -p "$toolbox_root/.runtime"
    rm -f "$toolbox_root/.runtime/bash-functions.sh"
    cat <<'EOF' >"$toolbox_root/.runtime/bash-functions.sh"
#!/bin/bash
# bash-functions.sh - Special functions that need to modify shell environment
# All other scripts are accessible via symlinks in $DEVENV_TOOLS (without .sh extension)

alias ll='ls -lah'

repo-get() {
    bash "$DEVENV_ROOT/tools/scripts/repo-get.sh" "$@"
    if [ -d "$DEVENV_ROOT/repos/$1" ]; then
        cd "$DEVENV_ROOT/repos/$1" || return
    fi
}

devenv() {
    cd "$DEVENV_ROOT" || return
}

playground() {
    cd "$DEVENV_ROOT/playground" || return
}

repos() {
    cd "$DEVENV_ROOT/repos" || return
}

update-dev-env() {
    local current_dir
    current_dir=$(pwd)
    cd "$DEVENV_ROOT" || return
    git-update
    cd "$current_dir" || return
    "$DEVENV_ROOT/.devcontainer/check-update-devenv-repo.sh"
}

update-tailscale-key() {
    "$DEVENV_ROOT/tools/scripts/update-tailscale-key.sh" "$@"
    if [ -f "$DEVENV_ROOT/.runtime/env-vars.sh" ]; then
        source "$DEVENV_ROOT/.runtime/env-vars.sh"
    fi
}

update-github-key() {
    "$DEVENV_ROOT/tools/scripts/update-github-key.sh" "$@"
    if [ -f "$DEVENV_ROOT/.runtime/env-vars.sh" ]; then
        source "$DEVENV_ROOT/.runtime/env-vars.sh"
    fi
}
EOF
    chmod +x "$toolbox_root/.runtime/bash-functions.sh"
}

generate_env_vars_file() {
    echo "# Generate env-vars.sh from .setup configuration"
    echo "#############################################"

    if [ -f "$setup_dir/timezone.txt" ]; then
        SETUP_TZ=$(cat "$setup_dir/timezone.txt")
    else
        SETUP_TZ="${TZ:-UTC}"
    fi

    mkdir -p "$toolbox_root/.runtime"
    cat <<EOF >"$toolbox_root/.runtime/env-vars.sh"
#!/bin/bash
# This file is auto-generated by bootstrap.sh from .setup/*.txt files
# Do not edit manually - changes will be overwritten on next bootstrap

# Timezone
export TZ="$SETUP_TZ"

# .NET settings
export DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE=false
export DOTNET_USE_POLLING_FILE_WATCHER=true

# Core paths
export DEVENV_ROOT="$toolbox_root"
export devenv="$toolbox_root"
export DEVENV_TOOLS="$toolbox_root/tools"
export CONFIG_FOLDER="$toolbox_root/.debug/config"
export DATA_FOLDER="$toolbox_root/.debug/data"

# Environment
export ENV_NAME="${ENV_NAME:-local}"
export DICTIONARY_SERVER="${DICTIONARY_SERVER:-localhost:6379}"
export DOCUMENT_SERVER="${DOCUMENT_SERVER:-mongodb://localhost}"
export MESSAGE_BROKER_SERVER="${MESSAGE_BROKER_SERVER:-nats://localhost:4222}"
export GIT_TERMINAL_PROMPT=1

# Cloud / registry
export DIGITALOCEAN_API_TOKEN="${DO_API_TOKEN:-}"
export DIGITALOCEAN_REGISTRY="${DIGITALOCEAN_REGISTRY:-}"
export DO_APP_NAME="${DO_APP_NAME:-}"
export DO_REGION="${DO_REGION:-}"

# GitHub auth (loaded from .setup during bootstrap)
export GH_USER="${GH_USER:-}"
export GH_ORG="${GH_ORG:-}"
export GH_TOKEN="${GH_TOKEN:-}"

# User identity
export USER_EMAIL="${USER_EMAIL:-}"

# Version placeholders
export DEVENV_UPDATE_INTERVAL="${DEVENV_UPDATE_INTERVAL:-7200}"
export INSTALL_VERSION="${INSTALL_VERSION:-v0.0.0}"
export MAJOR_VERSION="${MAJOR_VERSION:-0}"
export MINOR_VERSION="${MINOR_VERSION:-0}"
export PATCH_VERSION="${PATCH_VERSION:-0}"

# Convenience paths 
export repos="$toolbox_root/repos"
export playground="$toolbox_root/playground"
export debug="$toolbox_root/.debug"
export EDITOR="${EDITOR:-nano}"
EOF
    chmod +x "$toolbox_root/.runtime/env-vars.sh"
}

create_tool_symlinks() {
    echo "# Creating symlinks in tools/ for executable scripts"
    echo "#############################################"
    mkdir -p "$toolbox_root/tools"
    find "$toolbox_root/tools" -maxdepth 1 -type l -delete

    BASH_FUNCTION_SCRIPTS=(
        "repo-get.sh"
        "update-tailscale-key.sh"
        "update-github-key.sh"
        "lint-scripts.sh"
        "script-template.sh"
        "create-script.sh"
    )

    for script in "$toolbox_root/tools/scripts"/*.sh; do
        if [ -f "$script" ]; then
            script_name=$(basename "$script" .sh)
            script_basename=$(basename "$script")

            skip=false
            for bash_func_script in "${BASH_FUNCTION_SCRIPTS[@]}"; do
                if [ "$script_basename" = "$bash_func_script" ]; then
                    skip=true
                    break
                fi
            done

            if [ "$skip" = false ]; then
                ln -sf "$script" "$toolbox_root/tools/$script_name"
            fi
        fi
    done

    for script in "$toolbox_root/tools/scripts"/git-*; do
        if [ -f "$script" ] && [[ ! "$script" =~ \.sh$ ]]; then
            script_name=$(basename "$script")
            ln -sf "$script" "$toolbox_root/tools/$script_name"
        fi
    done

    ln -sf "$toolbox_root/tools/tests/run-tests-local.sh" "$toolbox_root/tools/run-tools-tests"
    ln -sf "$toolbox_root/tools/scripts/lint-scripts.sh" "$toolbox_root/tools/lint-tools-scripts"
}

write_devenvrc() {
    echo "# Write shared shell config to ~/.devenvrc"
    echo "#############################################"

    cat > "$HOME/.devenvrc" <<'DEVENVRC_EOF'
# Auto-generated by devenv bootstrap. Do not edit manually.

export DEVENV_ROOT="${DEVENV_ROOT:-/workspaces/devenv}"
export DEVENV_TOOLS="${DEVENV_ROOT}/tools"
export devenv="${DEVENV_ROOT}"

# Core PATH entries
export PATH="${PATH}:${DEVENV_ROOT}/.debug/scripts:/home/vscode/.dotnet/tools"

# Add repo scripts to PATH (best-effort for both bash and zsh)
if [ -d "${DEVENV_ROOT}/repos" ]; then
    for dir in "${DEVENV_ROOT}/repos"/*/; do
        [ -d "$dir" ] || continue
        if [ -d "${dir}scripts" ]; then
            PATH="${PATH}:${dir}scripts"
        fi
    done
fi

# Add devenv tools
export PATH="${PATH}:${DEVENV_ROOT}/tools"

# Shell-specific helpers
if [ -n "${BASH_VERSION:-}" ] && [ -f "$HOME/.git-completion.bash" ]; then
    source "$HOME/.git-completion.bash"
fi

# Core devenv environment
[ -f "${DEVENV_ROOT}/.runtime/env-vars.sh" ] && source "${DEVENV_ROOT}/.runtime/env-vars.sh"
[ -f "${DEVENV_ROOT}/.runtime/bash-functions.sh" ] && source "${DEVENV_ROOT}/.runtime/bash-functions.sh"

# Optional bash-only helpers
if [ -n "${BASH_VERSION:-}" ]; then
    [ -f "${DEVENV_ROOT}/.devcontainer/sanity-check.sh" ] && source "${DEVENV_ROOT}/.devcontainer/sanity-check.sh"
    [ -f "${DEVENV_ROOT}/.devcontainer/tool-versions.sh" ] && source "${DEVENV_ROOT}/.devcontainer/tool-versions.sh"
    [ -f "${DEVENV_ROOT}/.devcontainer/bash-prompt.sh" ] && source "${DEVENV_ROOT}/.devcontainer/bash-prompt.sh"
    [ -f "${DEVENV_ROOT}/.devcontainer/bash_completion_custom" ] && source "${DEVENV_ROOT}/.devcontainer/bash_completion_custom"
fi

# SSH setup (works in both shells)
[ -f "${DEVENV_ROOT}/.devcontainer/load-ssh.sh" ] && source "${DEVENV_ROOT}/.devcontainer/load-ssh.sh"

# Convenience: move to repos if starting in repo root (bash-only behavior preserved)
if [ -n "${BASH_VERSION:-}" ] && [ "$(pwd)" = "${DEVENV_ROOT}" ]; then
    cd "${DEVENV_ROOT}/repos"
fi
DEVENVRC_EOF
}

append_bashrc() {
    echo "# Add additional stuff in .bashrc"
    echo "#############################################"
    local marker_start="### devenv rc start"
    local marker_end="### devenv rc end"

    if ! grep -Fq "$marker_start" "$HOME/.bashrc"; then
        cat <<EOF >> "$HOME/.bashrc"
$marker_start
if [ -f "$HOME/.devenvrc" ]; then
    source "$HOME/.devenvrc"
fi
$marker_end
EOF
    fi
}

install_or_configure_nvm() {
    if ! command -v nvm > /dev/null 2>&1; then
        echo "# Install nvm"
        echo "#############################################"

        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
        export NVM_DIR="/usr/local/share/nvm"

        sudo mkdir -p $NVM_DIR
        sudo chown -R "$(whoami)":"$(whoami)" "$NVM_DIR"

        # shellcheck disable=SC1090 # User's bashrc is dynamic
        source ~/.bashrc
        source "$NVM_DIR/nvm.sh"
        nvm install "$NODE_VERSION"
        nvm use "$NODE_VERSION"
        sudo chown -R "$(whoami)":"$(whoami)" "$NVM_DIR/versions"
    else
        echo "# NVM already installed, ensuring proper permissions"
        echo "#############################################"
        export NVM_DIR="/usr/local/share/nvm"

        if [ -d "$NVM_DIR" ]; then
            sudo chown -R "$(whoami)":"$(whoami)" "$NVM_DIR"
        fi

        # shellcheck disable=SC1090 # User's bashrc is dynamic
        source ~/.bashrc
        source "$NVM_DIR/nvm.sh" 2>/dev/null || true
    fi
}

configure_dotnet_tools() {
    echo "# Configure .net"
    echo "#############################################"

    $dotnet_cmd tool install --global altcover.global
    $dotnet_cmd tool install --global dotnet-outdated-tool
    sudo $dotnet_cmd dev-certs https
    sudo mkdir -p /usr/local/share/ca-certificates/aspnet
    sudo chmod 755 /usr/local/share/ca-certificates/aspnet
    sudo -E $dotnet_cmd dev-certs https -ep /usr/local/share/ca-certificates/aspnet/https.crt --format PEM || echo "WARNING: Failed to export HTTPS certificate"
    sudo update-ca-certificates
}

install_node_packages() {
    echo "# Node packages"
    echo "#############################################"
    call_npm install -g zx
    call_npm install -g "pnpm@$PNPM_VERSION"
    call_npm install -g turbo@2.0.6
}

configure_git() {
    echo "# Configure git"
    echo "#############################################"
    git config --global core.autocrlf false
    git config --global core.eol lf
    git config --global merge.tool vscode
    git config --global mergetool.vscode.cmd "code --wait $MERGED"
    git config --global diff.tool vscode
    git config --global difftool.vscode.cmd "code --wait --diff $LOCAL $REMOTE"
    git config --global core.editor "code --wait"
    git config --global pull.ff only
    git config --global --bool push.autoSetupRemote true
    git config --global --add safe.directory $toolbox_root
    git config --global user.name "$HUMAN_NAME"
    git config --global user.email "$USER_EMAIL"
}

ensure_directories_and_settings() {
    echo "# Other configuration"
    echo "#############################################"
    mkdir -p $toolbox_root/.debug/data
    mkdir -p $toolbox_root/.debug/config
    mkdir -p $toolbox_root/repos
    mkdir -p $toolbox_root/tmp
    mkdir -p $toolbox_root/playground
    mkdir -p $toolbox_root/tools/custom
    mkdir -p "$toolbox_root/.runtime"
    if [[ ! -d "$toolbox_root/.debug/remote_debugger" ]]; then
        debugger_script="$DEVENV_ROOT/.devcontainer/download-csharp-debugger.sh"
        if [ -f "$debugger_script" ]; then
            $debugger_script
        else
            echo "INFO: download-csharp-debugger.sh not found (optional)"
        fi
    fi
    echo fs.inotify.max_user_instances=524288 | sudo tee -a /etc/sysctl.conf &>/dev/null
    sudo sysctl -p 2>/dev/null || echo "INFO: Some sysctl settings may not be applicable in container environment"
    sudo usermod -aG docker vscode
}

install_repo_dependencies() {
    echo "# Configure local devenv repo hooks"
    echo "#############################################"
    CI=1 pnpm install
}

configure_nuget_sources() {
    echo "# Configure nuget"
    echo "#############################################"

    local_nuget_dev=$toolbox_root/.debug/local-nuget-dev
    mkdir -p $local_nuget_dev

    add_nuget_source_if_not_exists "dev" $local_nuget_dev
    if [ -n "${GH_TOKEN:-}" ] && [ -n "${GH_USER:-}" ] && [ -n "${GH_ORG:-}" ]; then
        add_nuget_source_if_not_exists "github" https://nuget.pkg.github.com/${GH_ORG}/index.json $GH_USER $GH_TOKEN
    else
        echo "Skipping GitHub NuGet feed: GH_ORG/GH_USER/GH_TOKEN not fully configured"
    fi
}

configure_user_npmrc() {
    echo "# Configure user npmrc file"
    echo "#############################################"
    if [ -n "${GH_TOKEN:-}" ]; then
        echo "//npm.pkg.github.com/:_authToken=$GH_TOKEN" > ~/.npmrc
    else
        echo "Skipping npmrc auth token (GH_TOKEN not set)" > ~/.npmrc
    fi
}

run_custom_bootstrap_if_present() {
    if [ -f "$toolbox_root/.devcontainer/custom-bootstrap.sh" ]; then
        /bin/bash "$toolbox_root/.devcontainer/custom-bootstrap.sh"
    fi
}

cleanup_packages() {
    echo "# Cleanup"
    echo "#############################################"
    pkill ssh-agent &>/dev/null
    sudo apt autoremove -y
}

init_bootstrap_run_time() {
    date +%s > $container_bootstrap_run_file
    rm $repo_bootstrap_run_file
}

record_bootstrap_run_time() {
    date +%s > $container_bootstrap_run_file
    cp $container_bootstrap_run_file $repo_bootstrap_run_file
}

finish_message() {
    echo "Bootstrap complete"
    echo "--------------------------------------------------------------"
    echo "Please exit out of VS Code and let the container restart."
    echo "Please restart the container to complete the setup."
}

run_tasks() {
    local tasks=("$@")
    local default_tasks=(
        init_bootstrap_run_time
        initialize_paths
        detect_architecture
        ensure_home_is_set
        load_version_info
        prepare_install_directories
        reset_bashrc_to_original
        install_os_packages_round1
        add_specialized_repositories
        install_os_packages_round2
        install_dotnet
        download_container_scripts
        load_setup_credentials
        write_bash_functions_file
        generate_env_vars_file
        create_tool_symlinks
        write_devenvrc
        append_bashrc
        install_or_configure_nvm
        configure_dotnet_tools
        install_node_packages
        configure_git
        ensure_directories_and_settings
        install_repo_dependencies
        configure_nuget_sources
        configure_user_npmrc
        run_custom_bootstrap_if_present
        cleanup_packages
        record_bootstrap_run_time
        finish_message
    )

    if [ ${#tasks[@]} -eq 0 ]; then
        tasks=("${default_tasks[@]}")
    fi

    for task in "${tasks[@]}"; do
        if ! declare -f "$task" >/dev/null; then
            echo "Unknown task: $task"
            exit 1
        fi
        echo "Running task: $task"
        "$task"
    done
}

# Defaults for common tool versions (override via env as needed)
PNPM_VERSION=${PNPM_VERSION:-8.7.1}
NODE_VERSION=${NODE_VERSION:-20}

run_tasks "$@"
