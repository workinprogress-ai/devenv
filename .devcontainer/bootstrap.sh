#!/bin/bash

# Ensure that the script is not run with CRLF line endings
scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"; scriptfile="$0"; if [[ "$(file ${scriptdir}/${scriptfile})" =~ "CRLF" && -f "${scriptdir}/${scriptfile}" && "$(head -n 100 ${scriptdir}/${scriptfile} | grep "^scriptdir.\+dg4MbsIfhbv4-Bash-CRLF-selfheal_Written_By_Kenneth_Lutzke-8Nds9NclkU4sgE" > /dev/null 2>&1 ; echo "$?" )" == "0" ]]; then echo "$(cat ${scriptdir}/${scriptfile} | sed 's/\r$//')" > ${scriptdir}/${scriptfile} ; bash ${scriptdir}/${scriptfile} $@ ; exit ; fi ; echo "" > /dev/null 2>&1

on_error() {
  echo "An error occurred. Running cleanup."
  exit 1;
}

call_npm() {
    # Use this to get rid of the annoying warning
    npm "$@" 2>&1 | grep -v 'NODE_TLS_REJECT_UNAUTHORIZED is set to 0'
}

add_nuget_source_if_not_exists() {
    local sourceName="$1"
    local sourceUrl="$2"
    local username="$3"
    local password="$4"

    # Check if the source already exists
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

# Trap ERR signal which is triggered by any command that exits with a non-zero status
#trap on_error ERR

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")
setup_dir=$toolbox_root/.setup
repos_dir=$toolbox_root/repos
timezone_file=$toolbox_root/.setup/timezone.txt
name_file=$toolbox_root/.setup/name.txt
email_file=$toolbox_root/.setup/email.txt

arch=$(uname -m)
is_arm=$([ "$arch" == "aarch64" ] && echo 1)

if [ "$is_arm" == "1" ]; then
    echo "ARM architecture detected"
else
    echo "x86 architecture assumed"
fi

if [[ -z "$HOME" ]]; then
    export HOME=/home/vscode
fi

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

# Make a backup of the .bashrc file so if we run this script multiple times, we don't 
# end up adding the same stuff over and over.  We will always use the original.

if [ ! -f ~/.bashrc.original ]; then
    cp ~/.bashrc ~/.bashrc.original
fi;
cp ~/.bashrc.original ~/.bashrc

cd $toolbox_root

echo "# OS packages update and install - First round"
echo "#############################################"
sudo apt update
sudo apt upgrade -y
sudo apt install -y \
    curl wget gnupg bash-completion iputils-ping uuid fzf gcc g++ make \
    xmlstarlet redis-tools cifs-utils xmlstarlet software-properties-common \
    sshfs apt-transport-https ca-certificates

echo "# Add specialized OS package repositories and keys"
echo "#############################################"

sudo mkdir -p /etc/apt/keyrings

# Add repository for Terrform
wget -O- https://apt.releases.hashicorp.com/gpg | \
gpg --dearmor | \
sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg > /dev/null
    echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] \
    https://apt.releases.hashicorp.com $(lsb_release -cs) main" | \
    sudo tee /etc/apt/sources.list.d/hashicorp.list

# Add repository for kubctl
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.31/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
sudo chmod 644 /etc/apt/keyrings/kubernetes-apt-keyring.gpg # allow unprivileged APT programs to read this keyring
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.31/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
sudo chmod 644 /etc/apt/sources.list.d/kubernetes.list   

curl https://baltocdn.com/helm/signing.asc | gpg --dearmor | sudo tee /usr/share/keyrings/helm.gpg > /dev/null
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/helm.gpg] https://baltocdn.com/helm/stable/debian/ all main" | sudo tee /etc/apt/sources.list.d/helm-stable-debian.list

echo "# OS packages update and install - Second round"
echo "#############################################"
sudo apt update
sudo apt install -y \
    terraform kubectl helm

echo "# Install externally downloaded packages"
echo "#############################################"

if [ "$is_arm" == "1" ]; then
    wget -O mongo-shell.deb https://downloads.mongodb.com/compass/mongodb-mongosh_2.1.5_arm64.deb
    wget -O mongo-tools.deb https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-arm64-100.9.4.deb
    curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube_latest_arm64.deb
    mv minikube_latest_arm64.deb minikube.deb
else
    wget -O mongo-tools.deb https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.9.4.deb
    wget -O mongo-shell.deb https://downloads.mongodb.com/compass/mongodb-mongosh_2.1.5_amd64.deb
    curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube_latest_amd64.deb
    mv minikube_latest_amd64.deb minikube.deb
fi
sudo apt install -y ./mongo-tools.deb
sudo apt install -y ./mongo-shell.deb
sudo apt install -y ./minikube.deb
rm mongo-tools.deb
rm mongo-shell.deb
rm minikube.deb

echo "# Install .NET"
echo "#############################################"

wget https://dot.net/v1/dotnet-install.sh
chmod +x ./dotnet-install.sh
sudo ./dotnet-install.sh -c 8.0 -i /usr/share/dotnet
sudo ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet
rm dotnet-install.sh
dotnet_cmd=/usr/bin/dotnet

# #sudo mv /usr/bin/dotnet /usr/bin/dotnet.old &>/dev/null
# sudo rm -rf /usr/share/dotnet &>/dev/null
# sudo mv $HOME/.dotnet /usr/share/dotnet
# sudo rm -rf /usr/bin/dotnet &>/dev/null
# sudo ln -s  /usr/share/dotnet/dotnet /usr/bin/dotnet

# wget -O get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
# chmod +x get_helm.sh
# ./get_helm.sh

echo "# Get container scripts"
echo "#############################################"
wget -O $HOME/.git-completion.bash https://raw.githubusercontent.com/git/git/master/contrib/completion/git-completion.bash
chmod +x $HOME/.git-completion.bash
chmod +x $toolbox_root/scripts/*

mkdir -p $HOME/.ssh
touch $HOME/.ssh/github

if [ -f $setup_dir/github_key ]; then
    cp $setup_dir/github_key $HOME/.ssh/github
else 
    echo "WARNING!!!  No github key found in $setup_dir/github_key"
fi
if [ -f $setup_dir/github_token.txt ]; then
    DEVENV_GH_TOKEN=$(cat $setup_dir/github_token.txt)
else 
    echo "WARNING!!!  No PAT found in $setup_dir/github_token.txt"
fi
if [ -f $setup_dir/github_user.txt ]; then
    GITHUB_USER=$(cat $setup_dir/github_user.txt)
else 
    echo "WARNING!!!  No github user found in $setup_dir/github_user.txt"
fi
if [ -f $email_file ]; then
    USER_EMAIL=$(cat $email_file)
else
    echo "WARNING!!!  No email found in $email_file"
fi
if [ -f $name_file ]; then
    HUMAN_NAME="$(cat $name_file)"
else
    echo "WARNING!!!  No human name found in $name_file"
fi

git remote set-url origin git@github.com:workinprogress-ai/devenv.git

cat <<EOF >>$HOME/.ssh/config
AddKeysToAgent yes
IdentityFile $HOME/.ssh/github
EOF
touch $HOME/.ssh/github
chmod 600 $HOME/.ssh/github

echo "# Create aliases and bash functions script"
echo "#############################################"
rm -f $toolbox_root/.devcontainer/bash-functions.sh
cat <<EOF >$toolbox_root/.devcontainer/bash-functions.sh

alias ll='ls -lah'

get-repo() {
    bash $toolbox_root/scripts/get-repo.sh "\$@"
    source \$HOME/.bashrc
    cd "$@" &>/dev/null
}

devenv() {
    cd \$DEVENV_ROOT
}

repos() {
    cd \$DEVENV_ROOT/repos
} 

load-ssh-agent() {
    source $toolbox_root/.devcontainer/load-ssh.sh
}

update-dev-env() {
    git pull && git fetch --tags -f && $toolbox_root/.devcontainer/check-update-devenv-repo.sh
}

update-github-token() {
    source $toolbox_root/.devcontainer/update-github-token.sh
}

EOF
chmod +x $toolbox_root/.devcontainer/bash-functions.sh

echo "# Create env-vars.sh"
echo "#############################################"
rm -f $toolbox_root/.devcontainer/env-vars.sh
cat <<EOF >>$toolbox_root/.devcontainer/env-vars.sh
export TZ='$(cat $timezone_file)'
export DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE=false
export DOTNET_USE_POLLING_FILE_WATCHER=true
export CONFIG_FOLDER=\$DEVENV_ROOT/.debug/config
export DATA_FOLDER=\$DEVENV_ROOT/.debug/data
export ENV_NAME=local
export DICTIONARY_SERVER=localhost:6379
export DOCUMENT_SERVER=localhost
export GIT_TERMINAL_PROMPT=1
export DEVENV_GH_TOKEN=$DEVENV_GH_TOKEN
export GITHUB_USER=$GITHUB_USER
export USER_EMAIL=$USER_EMAIL
export HUMAN_NAME=$HUMAN_NAME
export DEVENV_UPDATE_INTERVAL=$((4 * 3600)) # 4 hours.  This can be changed as needed.
export INSTALL_VERSION=$VERSION
export MAJOR_VERSION=$MAJOR_VERSION
export MINOR_VERSION=$MINOR_VERSION
export PATCH_VERSION=$PATCH_VERSION
export repos=\$DEVENV_ROOT/repos
export devenv=\$DEVENV_ROOT
export debug=\$DEVENV_ROOT/.debug
EOF
chmod +x $toolbox_root/.devcontainer/env-vars.sh

echo "# Add additional stuff in .bashrc"
echo "#############################################"
cat <<EOF >>$HOME/.bashrc
export DEVENV_ROOT=$toolbox_root
export PATH="\$PATH:\${DEVENV_ROOT}/.debug/scripts:/home/vscode/.dotnet/tools"
source \$HOME/.git-completion.bash

# Check if the repos directory exists
if [ -d "$repos_dir" ]; then
  # Loop through each sub-directory in repos
  for dir in "$repos_dir"/*/; do
    # Check if scripts directory exists within the sub-directory
    if [ -d "\${dir}scripts" ]; then
      # Add scripts to the PATH
      PATH="\$PATH:\${dir}scripts"
    fi
  done
fi

export PATH=\$PATH:\${DEVENV_ROOT}/scripts

$toolbox_root/.devcontainer/sanity-check.sh
source $toolbox_root/.devcontainer/env-vars.sh
source $toolbox_root/.devcontainer/bash-functions.sh
source $toolbox_root/.devcontainer/bash-prompt.sh
source $toolbox_root/.devcontainer/bash_completion_custom

load-ssh-agent

if [[ \$(pwd) == \${DEVENV_ROOT} ]]; then
  cd \$DEVENV_ROOT/repos
fi

EOF

if command -v nvm > /dev/null 2>&1; then    
    echo "# Install nvm"
    echo "#############################################"

    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
    export NVM_DIR="/usr/local/share/nvm"
    source ~/.bashrc
    source "$NVM_DIR/nvm.sh" # This loads nvm
    nvm install --lts
    nvm use --lts
fi

echo "# Configure .net"
echo "#############################################"

$dotnet_cmd tool install --global altcover.global
$dotnet_cmd tool install --global dotnet-outdated-tool
sudo $dotnet_cmd dev-certs https
sudo -E $dotnet_cmd dev-certs https -ep /usr/local/share/ca-certificates/aspnet/https.crt --format PEM
sudo update-ca-certificates

echo "# Node packages"
echo "#############################################"
#npm install -g npx
call_npm install -g zx
call_npm install -g pnpm@8.7.1
call_npm install -g turbo@2.0.6

echo "# Configure git"
echo "#############################################"
git config --global core.autocrlf false
git config --global core.eol lf
git config --global merge.tool vscode
git config --global mergetool.vscode.cmd "code --wait \$MERGED"
git config --global diff.tool vscode
git config --global difftool.vscode.cmd "code --wait --diff \$LOCAL \$REMOTE"
git config --global core.editor "code --wait"
git config --global pull.ff only
git config --global credential.helper store
git config --global credential.helper 'cache --timeout=999999999'
git config --global --bool push.autoSetupRemote true
git config --global --add safe.directory $toolbox_root
git config --global user.name "$HUMAN_NAME"
git config --global user.email "$USER_EMAIL"

cd $toolbox_root

echo "# Other configuration"
echo "#############################################"
mkdir -p $toolbox_root/.debug/data
mkdir -p $toolbox_root/.debug/config
mkdir -p $toolbox_root/repos
mkdir -p $toolbox_root/tmp
if [[ ! -d "$toolbox_root/.debug/remote_debugger" ]]; then
    $toolbox_root/download-csharp-debugger.sh
fi
echo fs.inotify.max_user_instances=524288 | sudo tee -a /etc/sysctl.conf &>/dev/null
sudo sysctl -p

# if [ ! -L "$HOME/repos" ]; then
#     ln -s "$toolbox_root/repos" "$HOME/repos"
# else
#     echo "Symbolic link $HOME/repos already exists."
# fi
# if [ ! -L "$HOME/devenv" ]; then
#     ln -s "$toolbox_root" "$HOME/devenv"
# else
#     echo "Symbolic link $HOME/devenv already exists."
# fi
# if [ ! -L "$HOME/debug" ]; then
#     ln -s "$toolbox_root/.debug" "$HOME/debug"
# else
#     echo "Symbolic link $HOME/debug already exists."
# fi

echo "# Configure local devenv repo hooks"
echo "#############################################"
pnpm install

echo "# Configure nuget"
echo "#############################################"

local_nuget_dev=$toolbox_root/.debug/local-nuget-dev
mkdir -p $local_nuget_dev
 
add_nuget_source_if_not_exists "dev" $local_nuget_dev
add_nuget_source_if_not_exists "github" https://nuget.pkg.github.com/workinprogress-ai/index.json $GITHUB_USER $DEVENV_GH_TOKEN

echo "# Configure user npmrc file" 
echo "#############################################"

echo "//npm.pkg.github.com/:_authToken=$DEVENV_GH_TOKEN" > ~/.npmrc

# If there is a custom bootstrap, run it
if [ -f $toolbox_root/.devcontainer/custom-bootstrap.sh ]; then
    /bin/bash $toolbox_root/.devcontainer/custom-bootstrap.sh
fi

echo "# Cleanup"
echo "#############################################"
pkill ssh-agent &>/dev/null
sudo apt autoremove -y

echo "Bootstrap complete"
echo "--------------------------------------------------------------"

echo "Please exit out of VS Code and let the container restart."
echo "Please restart the container to complete the setup."

container_bootstrap_run_file="$HOME/.bootstrap_run_time"
repo_bootstrap_run_file="$toolbox_root/.devcontainer/.bootstrap_run_time"

date +%s > $container_bootstrap_run_file
cp $container_bootstrap_run_file $repo_bootstrap_run_file

cd $toolbox_root/repos
