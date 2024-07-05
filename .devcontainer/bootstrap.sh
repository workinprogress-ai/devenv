#!/bin/bash

# Ensure that the script is not run with CRLF line endings
scriptdir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"; scriptfile="$0"; if [[ "$(file ${scriptdir}/${scriptfile})" =~ "CRLF" && -f "${scriptdir}/${scriptfile}" && "$(head -n 100 ${scriptdir}/${scriptfile} | grep "^scriptdir.\+dg4MbsIfhbv4-Bash-CRLF-selfheal_Written_By_Kenneth_Lutzke-8Nds9NclkU4sgE" > /dev/null 2>&1 ; echo "$?" )" == "0" ]]; then echo "$(cat ${scriptdir}/${scriptfile} | sed 's/\r$//')" > ${scriptdir}/${scriptfile} ; bash ${scriptdir}/${scriptfile} $@ ; exit ; fi ; echo "" > /dev/null 2>&1

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

touch $HOME/.ran_bootstrap

# Make a backup of the .bashrc file so if we run this script multiple times, we don't 
# end up adding the same stuff over and over.  We will always use the original.

if [ ! -f ~/.bashrc.original ]; then
    cp ~/.bashrc ~/.bashrc.original
fi;
cp ~/.bashrc.original ~/.bashrc

cp repo_list.workinprogress repo_list
if [ -f repo_list.extra ]; then
    cat repo_list.extra >> repo_list
fi

sudo apt install curl wget gnupg bash-completion -y
#wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
#echo "deb http://repo.mongodb.org/apt/debian bullseye/mongodb-org/6.0 main" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list

if [[ -z "$HOME" ]]; then
    export HOME=/home/vscode
fi

echo "# Get container scripts"
echo "#############################################"
wget -O $HOME/.git-completion.bash https://raw.githubusercontent.com/git/git/master/contrib/completion/git-completion.bash
chmod +x $HOME/.git-completion.bash
chmod +x $toolbox_root/devenv-utils/*

echo "Set up SSH to work as it should"
echo "#############################################"

mkdir -p $HOME/.ssh
touch $HOME/.ssh/github

if [ -f $setup_dir/github_key ]; then
    cp $setup_dir/github_key $HOME/.ssh/github
else 
    echo "WARNING!!!  No github key found in $setup_dir/github_key"
fi
if [ -f $setup_dir/github_token.txt ]; then
    PACKAGE_ACCESS=$(cat $setup_dir/github_token.txt)
else 
    echo "WARNING!!!  No PAT found in $setup_dir/github_token.txt"
fi
if [ -f $setup_dir/github_user.txt ]; then
    GITHUB_USER=$(cat $setup_dir/github_user.txt)
else 
    echo "WARNING!!!  No github user found in $setup_dir/github_user.txt"
fi

cat <<EOF >>$HOME/.ssh/config
AddKeysToAgent yes
IdentityFile $HOME/.ssh/github
EOF
touch $HOME/.ssh/github
chmod 600 $HOME/.ssh/github

cat <<EOF >>$HOME/.bashrc
if [ ! -S ~/.ssh/ssh_auth_sock ]; then
  eval \`ssh-agent\` &>/dev/null
  ln -sf "\$SSH_AUTH_SOCK" ~/.ssh/ssh_auth_sock
fi
export SSH_AUTH_SOCK=~/.ssh/ssh_auth_sock
ssh-add -l > /dev/null || ssh-add &>/dev/null
EOF

echo "# Add additional stuff in .bashrc"
echo "#############################################"

cat <<EOF >>$HOME/.bashrc

export DEVENV_ROOT=$toolbox_root
export PATH="\$PATH:\${DEVENV_ROOT}/.debug/scripts"
source \$HOME/.git-completion.bash
alias ll='ls -lah'
export TZ='$(cat $timezone_file)'

# Check if the repos directory exists
if [ -d "$repos_dir" ]; then
  # Loop through each sub-directory in repos
  for dir in "$repos_dir"/*/; do
    # Check if _utils directory exists within the sub-directory
    if [ -d "\${dir}_utils" ]; then
      # Add _utils to the PATH
      PATH="\$PATH:\${dir}_utils"
    fi
  done
fi

export PATH=\$PATH:\${DEVENV_ROOT}/devenv-utils

# Variables to run services locallys
export DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE=false
export DOTNET_USE_POLLING_FILE_WATCHER=true
export CONFIG_FOLDER=\$DEVENV_ROOT/.debug/config
export DATA_FOLDER=\$DEVENV_ROOT/.debug/data
export ENV_NAME=local
export DICTIONARY_SERVER=localhost:6379
export DOCUMENT_SERVER=localhost
export GIT_TERMINAL_PROMPT=1
export PACKAGE_ACCESS=$PACKAGE_ACCESS
export GITHUB_USER=$GITHUB_USER

cd ~/repos
if [ -z "$(find . -mindepth 1 -maxdepth 1 -type d)" ]; then
  echo "No repos have been cloned yet.  If you want to clone the standard repos, run the following command:"
  echo "update-repos.sh"
  echo
fi

EOF

echo "# Package install"
echo "#############################################"

if [[ -z "$(which nvm)" ]]; then
    curl -sL https://dl.yarnpkg.com/debian/pubkey.gpg | gpg --dearmor | sudo tee /usr/share/keyrings/yarnkey.gpg >/dev/null
    echo "deb [signed-by=/usr/share/keyrings/yarnkey.gpg] https://dl.yarnpkg.com/debian stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
    nvm install --lts
fi
sudo apt update
sudo apt upgrade -y
sudo apt install gcc g++ make yarn xmlstarlet redis-tools chromium cifs-utils xmlstarlet -y
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

# echo "# Install .NET"
# echo "#############################################"

# wget https://dot.net/v1/dotnet-install.sh
# chmod +x dotnet-install.sh
# ./dotnet-install.sh -c 6.0
# ./dotnet-install.sh -c 7.0
# ./dotnet-install.sh -c 8.0

# #sudo mv /usr/bin/dotnet /usr/bin/dotnet.old &>/dev/null

# sudo rm -rf /usr/share/dotnet &>/dev/null
# sudo mv $HOME/.dotnet /usr/share/dotnet
# sudo rm -rf /usr/bin/dotnet &>/dev/null
# sudo ln -s  /usr/share/dotnet/dotnet /usr/bin/dotnet

# rm dotnet-install.sh

echo "# Configure .net"
echo "#############################################"

/usr/bin/dotnet tool install --global altcover.global
/usr/bin/dotnet dev-certs https
sudo -E /usr/bin/dotnet dev-certs https -ep /usr/local/share/ca-certificates/aspnet/https.crt --format PEM
sudo update-ca-certificates

echo "# Node packages"
echo "#############################################"
if [[ -z "$(which npx)" ]]; then
    npm install -g npx
fi;
if [[ -z "$(which zx)" ]]; then
    npm install -g zx
fi;

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
cd $toolbox_root
git config --global --add safe.directory $toolbox_root

if [ -f $name_file ]; then
    git config --global user.name "$(cat $name_file)"
else
    echo "WARNING!!!  No name found in $name_file"
fi
if [ -f $email_file ]; then
    git config --global user.email "$(cat $email_file)"
else
    echo "WARNING!!!  No email found in $email_file"
fi

#echo "# VS Code extentsions"
#echo "#############################################"
#code --install-extension ms-dotnettools.csdevkit

echo "# Other configuration"
echo "#############################################"
mkdir -p $toolbox_root/.debug/data
mkdir -p $toolbox_root/.debug/config
bash $script_folder/download-csharp-debugger.sh
echo fs.inotify.max_user_instances=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p
mkdir -p $toolbox_root/repos
ln -s $toolbox_root/repos $HOME/repos

echo "Bootstrap complete"
echo "--------------------------------------------------------------"

echo "Please exit out of VS Code and let the container restart."
echo "Please restart the container to complete the setup."

cd $HOME/repos
