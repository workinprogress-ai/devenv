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

sudo apt install curl wget gnupg bash-completion iputils-ping uuid fzf -y
#wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
#echo "deb http://repo.mongodb.org/apt/debian bullseye/mongodb-org/6.0 main" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list

if [[ -z "$HOME" ]]; then
    export HOME=/home/vscode
fi

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

check-update-env() {
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

if \$DEVENV_ROOT/.devcontainer/check-update-devenv-repo.sh ; then 
    #source \$HOME/.bashrc
    echo "Devenv repo updated!"
fi

if [[ \$(pwd) == \${DEVENV_ROOT} ]]; then
  cd \$DEVENV_ROOT/repos
fi

EOF

echo "# Package install"
echo "#############################################"

if command -v nvm > /dev/null 2>&1; then    
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
    export NVM_DIR="/usr/local/share/nvm"
    source ~/.bashrc
    source "$NVM_DIR/nvm.sh" # This loads nvm
    nvm install --lts
    nvm use --lts
fi

sudo apt update
sudo apt upgrade -y
sudo apt install gcc g++ make xmlstarlet redis-tools cifs-utils xmlstarlet flatpak software-properties-common sshfs -y
#sudo apt install mongocli -y

if [ "$is_arm" == "1" ]; then
    wget -O mongo-shell.deb https://downloads.mongodb.com/compass/mongodb-mongosh_2.1.5_arm64.deb
    wget -O mongo-tools.deb https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-arm64-100.9.4.deb
else
    wget -O mongo-tools.deb https://fastdl.mongodb.org/tools/db/mongodb-database-tools-ubuntu2204-x86_64-100.9.4.deb
    wget -O mongo-shell.deb https://downloads.mongodb.com/compass/mongodb-mongosh_2.1.5_amd64.deb
fi
sudo apt install -y ./mongo-tools.deb
sudo apt install -y ./mongo-shell.deb
rm mongo-tools.deb
rm mongo-shell.deb

# # # NOTE:  We do not need to install previous SDK's at the moment.

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
call_npm install -g pnpm

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

# echo "# Disable snaps"
# echo "#############################################"
# sudo apt-get purge snapd -y
# sudo rm -rf /var/cache/snapd/
# sudo rm -rf /snap
# echo -e "Package: snapd\nPin: release a=*\nPin-Priority: -10" | sudo tee /etc/apt/preferences.d/nosnap.pref
# echo '
# Package: *
# Pin: release o=LP-PPA-mozillateam
# Pin-Priority: 1001

# Package: firefox
# Pin: version 1:1snap*
# Pin-Priority: -1
# ' | sudo tee /etc/apt/preferences.d/mozilla-firefox

echo "# More installs"
echo "#############################################"
#sudo add-apt-repository ppa:mozillateam/ppa -y
#sudo apt update
#sudo apt install firefox -y
sudo apt install chromium -y

#echo "# VS Code extentsions"
#echo "#############################################"
#code --install-extension ms-dotnettools.csdevkit

echo "# Other configuration"
echo "#############################################"
mkdir -p $toolbox_root/.debug/data
mkdir -p $toolbox_root/.debug/config
mkdir -p $toolbox_root/repos
bash $script_folder/download-csharp-debugger.sh
echo fs.inotify.max_user_instances=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p
sudo flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

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

if [ "$is_arm" == "1" ]; then
    echo "ARM:  Cannot install MongoDbCompass"
    # echo "# Install binfmt support for ARM"
    # echo "#############################################"
    # sudo apt install -y qemu-user-static binfmt-support
    # sudo update-binfmts --enable qemu-x86_64
    # #sudo dpkg --add-architecture i386
    # sudo dpkg --add-architecture amd64
    # sudo apt update
    # sudo apt install -y libc6:amd64
else
    echo "# Installing mongo db compass"
    echo "#############################################"

    wget -O /tmp/mongodb-compass.deb https://downloads.mongodb.com/compass/mongodb-compass_1.43.5_amd64.deb
    sudo apt install -y /tmp/mongodb-compass.deb
    rm /tmp/mongodb-compass.deb
fi

# If there is a custom startup, run it
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
