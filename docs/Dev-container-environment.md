# The Development Environment

The dev container is a fully functional development environment.  It has all the tools you need to work on the code.  The code is mounted into the container, so any changes you make in the container will be reflected on the host machine.  

When you first bring up the dev environment, it only contains the code that is in the `devenv` repo.  You will need to clone the other repos that you want to work on.  You can do this in the terminal in the dev container.  

When you first open a terminal in the dev container, the current folder will be `~/repos` (the ~ indicates that it is located in the home folder).  The prompt will look something like this: 

```
@toochevere ➜ ~/repos (<>) $
```

Any repos cloned should be put under the `repos/` folder.  A command line alias (actually it's a bash function but let's not be picky) exists in order to make this easy:  `repo-get`.  Simply use `repo-get` command with the name of the repo you wish to clone:

```
@toochevere ➜ ~/repos (<>) $ repo-get devops
```

If the repos is not yet present under the `~/repos` folder then it will be cloned.  If it is present, it will be updated.   If the newly cloned repos has a `scripts` folder, then it will be automatically added to the `PATH` variable and any scripts will be available.  

**Note** that part of the setup script asked for an SSH key.  This key is used to clone the private repos.  If you did not provide a key, you will not be able to clone the private repos. 

Once you have the repos cloned, you can then open any of them in the dev environment.  This can be done by (in VS Code) opening the command palette and choosing "Open Workspace from file" and selecting the workspace you wish to open.  You can also open the terminal in VS Code, navigate to the folder you want to open, and use the command `code <workspace file or folder>`.  Once you open a project, it will be add to the "Recent" list in VS Code and you can quickly open it in the future. 

## Container isolation

The dev container completely isolates the development environment from the host machine.  This means that any changes you make in the container are isolated from the host machine.  You can work on other projects with different dependencies without worrying about conflicts.  It also means that you can work on a project that has dependencies that are not installed on your host machine.  If you break something within the container, it's simply a matter of rebuilding it.  

The only folder that is mapped from the container to the host is the repository folder itself.  See the section below on [the folder structure](#folder-structure-in-the-dev-environment) for more information.

## Using Docker in the container

The configuration for the dev container includes an instance of Docker running within the container itself.  This configuration is referred to as "docker-in-docker".  Remember that anything you do in the container with Docker is isolated from the host.  So for example, if you map folders in `docker-compose.yml`, the paths are actually paths _in the container_, not on the host.

## Updating the dev environment

The dev environment will check for updates to it's code.  This happens periodically.  If it finds an update has happened (a new commit has been pushed to `master` in the `devenv` repo) then it will warn the user when a command line is opened.  The user is given the option to pull the latest changes in `master`.  If the change was a major version change, then the user will also be warned they should rebuild the container. 

## Folder structure in the dev environment

The dev containers extension that is used to run the dev environment has a specific folder structure.  It places the current git repository (the repository of the dev env itself) under `/workspaces`.  So it ends up being something like `/workspaces/<REPO>` (where `<REPO>` is the name of the dev env repository when you first cloned it).  Everything in this folder and under it is mapped to the host machine's repository folder.  So anything you place here will live between instances of the dev container in case for example it gets rebuilt.  

Within this repository, there are a few folders of note:

### `/workspace` repository folders

* `.devcontainer` This folder contains the configuration for the dev container itself.  It is where the `bootstrap.sh` and `devcontainer.json` files are located.  It also contains a few temporary files that are used by the dev environment to manage the container. 
* `scripts` This folder contains a few utility scripts that are intended to be used by the user.
* `docs` This folder contains documentation for the dev environment.  It is where you are reading this file right now.
* `repos` This folder is where the user should clone any repositories they wish to work on.  It is the default folder that the terminal opens to.  When calling the `get-repo` utility, the repo will be cloned here.  This folder is excluded from the repository of the dev environment itself.  
* `.debug` This folder is where the utility scripts will place any files needed for debugging or other development purposes.  It is excluded from the repository of the dev environment itself.  The services configuration is placed in a subfolder of this folder, as well as the services data folder. 

**Remember** that any files or folders created outside of the mapped repo folder will not be saved if the container is deleted or rebuilt.  So if you want to keep something, make sure it is in the repo folder, perhaps in a place like the `.debug` folder. 

### Home folder

Because the dev environment is a Linux os in a container, it has a folder structure that reflects this as well.  The dev environment is based on Debian, so it has a Debian-like folder structure.  The home folder is `/home/vscode`.  Any processes that run in the container will run as the `vscode` user. 

**NOTE:**  On rare occasions, some apps get confused about the symlinking.  You can also just open repos or other folders directly from `/workspace/<REPO>` folder.  

### `.bashrc` file

The `.bashrc` file is a file that is run every time a new terminal is opened and when vscode is first started.  It is used to set up the environment for the user.  It sets up the prompt, the aliases, environment variables, and the path.  If you want something to be run every time you open a terminal, you can add it to this file.  

## `custom_bootstrap.sh` and `custom_startup.sh`

The `custom_bootstrap.sh` and `custom_startup.sh` are optional scripts that you can provide in order to customize the dev environment.  They need to be put in the `.devcontainer` folder and should be made executable.  These files are not included in the repository.  

* The `custom_bootstrap.sh` file is run when the container is first created.  It can be used to install packages or make other changes that should be done once upon creation.  If you want to make permanent modifications for example, to [your `.bashrc` file](#bashrc-file), you should do it in the `custom_bootstrap.sh` file.
* The `custom_startup.sh` file is run each time vscode starts.

**Managing custom bootstrap commands:**

You can use the `devenv-add-custom-bootstrap` script to add commands to `custom-bootstrap.sh` that run whenever the container is created or the bootstrap sequence executes:

```bash
devenv-add-custom-bootstrap "command1" "command2"
```

The script will:
- Create `custom-bootstrap.sh` if it doesn't exist
- Validate bash syntax before adding commands
- Set executable permissions automatically
- Append commands with documentation comments

**Managing custom startup commands:**

You can use the `devenv-add-custom-startup` script to easily add commands to `custom_startup.sh`:

```bash
devenv-add-custom-startup "command1" "command2"
```

The script will:
- Create `custom_startup.sh` if it doesn't exist
- Validate bash syntax before adding commands
- Set proper permissions automatically
- Append commands with documentation comments

**Managing environment variables:**

You can use the `devenv-add-env-vars` script to add or update environment variables in `env-vars.sh`:

```bash
devenv-add-env-vars "MY_VAR=value" "ANOTHER_VAR=value2"
```

The script will automatically update existing variables to prevent duplicates.

## Optional Install Scripts

The `.devcontainer/install-extras/` folder contains optional installation scripts for additional tools not included in the base container. These scripts can be run manually when needed:

### Available Optional Installs

* **`helm.sh`** - Installs Helm package manager for Kubernetes
* **`minikube.sh`** - Installs Minikube for local Kubernetes clusters
* **`mongo-tools.sh`** - Installs MongoDB command-line tools (mongosh, mongodump, mongorestore, etc.)
* **`mongo-compass.sh`** - Installs MongoDB Compass GUI
* **`chromium.sh`** - Installs Chromium web browser
* **`firefox.sh`** - Installs Firefox web browser
* **`flatpak.sh`** - Installs Flatpak package manager
* **`zsh.sh`** - Installs zsh and reuses the dev env bash configuration
* **`tailscale.sh`** - Installs and configures Tailscale VPN with SOCKS5 proxy support

### Running Optional Installs

The recommended way to install extras is using the `install-extras` script:

```bash
# Install a specific tool (auto-runs if only one match)
install-extras helm

# Interactive menu to select one tool
install-extras

# Multi-select mode (install several at once)
install-extras -m

# Filter the list
install-extras mongo
```

You can also run the scripts directly if needed:

```bash
bash .devcontainer/install-extras/helm.sh
bash .devcontainer/install-extras/tailscale.sh
```

**Note:** The Tailscale installer is interactive and will:
- Prompt for your Tailscale auth key
- Ask for a hostname for this container
- Configure SOCKS5 proxy for routing traffic through Tailscale
- Set up automatic reconnection on container restart

## Container desktop environment

The dev container includes a "light" and simple graphical desktop environment that can be used as an alternative to the terminal.  This is useful for running graphical applications or for those who prefer a graphical interface.  The desktop environment is based on the `xfce` desktop environment.  It is not intended to be a full desktop environment, but rather a simple one that can be used for basic tasks.  It includes a terminal, file manager, and web browser.  It also includes a few other utilities such as a text editor and a calculator. 

To access the desktop environment, you need to [open a browser to port 6080 on the localhost](http://localhost:6080).  The easiest way do this is to open the Ports tab in Vs Code (ctrl+shift+p and type "Ports" and click on the option `View: Toggle Ports`).  Of course, you can also bookmark it in the browser.  The web page will take you to a web-hosted instances of VNC that you can use to access the desktop.  The password is `vscode`.  (It's a super simple interface.  Don't gripe, remember it's running in a container so just use it and be amazed that it works at all.)

## Utilities

### Scripts 

A few utility scripts have been provided to make life happy.

* `get-services-config` This script pulls the service config from it's repository into the local dev environment.  It is placed in `~/debug/config`
* `metrics-count-code-lines` A utility to count code lines in a file or folder
* `docker-build` A utility to build a project using Docker.
* `docker-down` A utility to bring down a local docker configuration
* `docker-up` A utility to bring up a local docker configuration
* `container-enable-dotnet-debugger` A utility to inject and run the dotnet debugger into a locally running container.
* `file.io` A utility to push a file to the file.io file sharing site.
* `repo-get` A utility to clone or update a repo in the `~/repos` folder.
* `repo-update-all` A utility to update all repos in the `~/repos` folder.
* `pr-create-for-review` A utility to create a "progressive" or "final" PR for reviewing all changes.
* `pr-create-for-merge` A utility to create a PR for merging code to the default branch.
* `repo-version-list` A utility to list all versions in a repo.

### Git extensions 

The following are additional `git` commands that extend it's basic capabilities. 

* `git graph` Provides a graphical display of the commit history
* `git graph-all` Provides a graphical display of the commit history for all branches
* `git prune-branches` Prunes local branches that are no longer needed

## Credentials and Authentication

Your credentials are stored securely in the `.setup` folder on your host machine:

* **GitHub Token** (`.setup/github_token.txt`): Used for GitHub API access, package registry, and SSH-based repository cloning. Automatically loaded as `GH_TOKEN` environment variable.
* **GitHub Username** (`.setup/github_username.txt`): Your GitHub username. Automatically loaded as `GH_USER` environment variable.
* **GitHub Organization** (`.setup/github_org.txt`): The GitHub organization that owns your repositories. Automatically loaded as `GH_ORG` environment variable.
* **Digital Ocean API Token** (`.setup/digitalocean_token.txt`): Used for infrastructure operations via Digital Ocean. Automatically loaded as `DO_API_TOKEN` environment variable.
* **SSH Key** (`.setup/ssh_key_path.txt`): Path to your SSH private key for secure repository access.

These credentials are automatically loaded into the container environment on startup (via `bootstrap.sh`) and are accessible to all scripts that need them. Credentials are **never** stored in the container image itself — they're only loaded at runtime from your host machine.

**To update credentials:**
- GitHub Token: Run `./setup` and update when prompted, or manually edit `.setup/github_token.txt`
- Digital Ocean Token: Run `./setup` and choose the Digital Ocean setup option
- SSH Key: Configure via the initial setup or re-run the setup script

## Lone Wolf Options

The provided development and VS Code are the officially supported setup.  Other tools are not supported.  If you want to use a different tool or choose not to use the development environment...

* You're own your own to make it work.
* If you can't make it work in reasonable way, in a reasonable time, and with a reasonable lack of distraction, then you will need to just use the setup provided.
* Do not leave any artifacts in the repo that belong to non-supported environments
* Any non-supported setup must be made to work seamlessly with the official protocols.  Otherwise, you must use the setup provided. 
* You **must** strictly adhere to the coding standards and protocols.  Without the official setup, you will not have the benefit of certain tools and/or automated checks.  You must do these manually, such as setting up `husky` for the git hooks. 