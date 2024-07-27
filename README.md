# DEVENV (Developer Environment) repo

This repository is the starting point for setting up a working dev environment for working at WorkInProgress.ai.  It provides the tooling necessary to do development on all other repos.  

See the sections below for instructions on how to set up your dev environment.

## Prerequisites

- Git
- Visual Studio Code (with the Remote - Containers extension installed)
- A unix environment (Linux, MacOS, WSL)
- Docker (instructions for installing docker are given below under the sections for each environment)

You do not need to have any additional tooling installed on your host machine.  Everything you need will be provided in the dev container.  Although it is not prohibited to use a different editor or IDE for development, Visual Studio Code and the dev environment provided here are considered the standard.  Use of VS Code and this dev environment is _strongly encouraged_.  If you want to be a lone wolf and use a different editor, you will need to figure out how to do certain things on your own.  The team will not be able to provide support for other editors.  If you can't get your bespoke solution working on your own, you will be asked to use VS Code and the dev environment provided here.

## Setup of the dev environment

### Windows

1. Install the WSL2 kernel update package for Window.  
2. Install a Linux distro from the Microsoft Store.  Ubuntu 22.04 is recommended.
3. Install Docker Desktop for Windows, using WSL2 as the backend.
4. Make sure that Docker is configured to expose it's command line to WSL2.  This is done in the Docker Desktop settings.
5. In the WSL terminal, clone this repo.
   `git clone git@github.com:workinprogress-ai/devenv.git`  
6. In the WSL terminal, navigate to the repo directory, and the sub directory under it called `host-utils`.
   `cd devenv/host-utils`
7. Run the [setup script](#running-the-setup-script).  This will ask you a few questions about your environment and allow you to specify your SSH key to the private repos.
   `./setup`
8. Once the setup script is complete, navigate back to the root of the repo and run Visual Studio Code, pointing it at the repo directory.
   `code .`
9. VS Code should, after a few seconds, offer to reopen the folder in a container.  If not, open the command palette (Ctrl+Shift+P) and run the command `Remote-Containers: Reopen in Container`.
10. The dev container will build and start.  This may take a few minutes the first time.  Subsequent starts will be faster.  Once the bootstrap has run, and the container output log shows that it is opening ports, close Visual Studio. 
11. Reopen Visual Studio Code and the folder in the dev container.  Once again you will be asked if you want to open the folder in a dev container.   Choose to do so, or you can manually open it in the container.  
12. The dev container will start.  You can now start working on the code.

### MacOS

1. Install [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/).
2. In a terminal, clone this repo.
   `git clone git@github.com:workinprogress-ai/devenv.git`  
3. In the terminal, navigate to the repo directory, and the sub directory under it called `host-utils`.
   `cd devenv/host-utils`
4. Run the [setup script](#running-the-setup-script).  This will ask you a few questions about your environment and allow you to specify your SSH key to the private repos.
   `./setup`
5. Once the setup script is complete, navigate back to the root of the repo and run Visual Studio Code, pointing it at the repo directory.
   `code .`
6. VS Code should, after a few seconds, offer to reopen the folder in a container.  If not, open the command palette (Ctrl+Shift+P) and run the command `Remote-Containers: Reopen in Container`.
7. The dev container will build and start.  This may take a few minutes the first time.  Subsequent starts will be faster.  Once the bootstrap has run, and the container output log shows that it is opening ports, close Visual Studio. 
8. Reopen Visual Studio Code and the folder in the dev container.  Once again you will be asked if you want to open the folder in a dev container.   Choose to do so, or you can manually open it in the container.  
9. The dev container will start.  You can now start working on the code.

### Linux

1. Install Docker.  You may use the script [here](https://get.docker.com) to install Docker on your system.
2. In a terminal, clone this repo.
   `git clone git@github.com:workinprogress-ai/devenv.git`  
3. In the terminal, navigate to the repo directory, and the sub directory under it called `host-utils`.
   `cd devenv/host-utils`
4. Run the [setup script](#running-the-setup-script).  This will ask you a few questions about your environment and allow you to specify your SSH key to the private repos.
   `./setup`
5. Once the setup script is complete, navigate back to the root of the repo and run Visual Studio Code, pointing it at the repo directory.
   `code .`
6. VS Code should, after a few seconds, offer to reopen the folder in a container.  If not, open the command palette (Ctrl+Shift+P) and run the command `Remote-Containers: Reopen in Container`.
7. The dev container will build and start.  This may take a few minutes the first time.  Subsequent starts will be faster.  Once the bootstrap has run, and the container output log shows that it is opening ports, close Visual Studio. 
8. Reopen Visual Studio Code and the folder in the dev container.  Once again you will be asked if you want to open the folder in a dev container.   Choose to do so, or you can manually open it in the container.  
9. The dev container will start.  You can now start working on the code.

## Running the setup script

The [setup script](./host-utils/setup) will ask you a few questions about your environment and allow you to specify your SSH key to the private repos.  It will also install the necessary tools on your host machine to work with the dev container.  The script saves your answers to a hidden folder in the local repo `.setup` and will not ask you the same question twice if you have already run it previously and provided answers.  If you want to run `setup` from the beginning, simply delete any files from the `.setup` folder.  

The script will ask you for the following information:

* Your name:  This is the name by which you will be identified in all commits.  
* Your workinprogress.ai email:  This identifies you by email in all commits. 
* Your timezone:  This is in order to correctly display your local time within the container.  By default, the script will attempt to determine your time zone.  If it does so correctly, then you can just hit ENTER and accept the default. 
* A github SSH key:  This is for use when dealing with repository remotes.  The script will help you to create one if you do not already have one.  You will need to add the public part of the key to your [github settings](https://github.com/settings/keys). 
* A github PAT:  The Personal Access Token is what allows package access and other functions from the dev environment. You can create one by going in github to Settings -> Developer Settings -> Personal Access Tokens -> Classic and click on [the link to create a new token](https://github.com/settings/tokens/new).  This token should have READ access for PACKAGES (look for `read:packages`).  The recommended note should be 'PACKAGE_ACCESS' and the expiration should be 'No Expiration'.  (Note:  An argument could be made that storing the PAT in plain text is a security risk.  This PAT should only have package read access.  If you follow the directions, the overall risk is minimal.  At most, a bad actor could gain access to our packages.  Not the end of the world.  If you are concerned about this, feel free to delete the `github_token.txt` file once the container comes on line.)

## Coding in the dev container

The dev container is a fully functional development environment.  It has all the tools you need to work on the code.  The code is mounted into the container, so any changes you make in the container will be reflected on the host machine.  

When you first bring up the dev environment, it only contains the code that is in the `devenv` repo.  You will need to clone the other repos that you want to work on.  You can do this in the terminal in the dev container.  

When you first open a terminal in the dev container, the current folder will be `~/repos` (the ~ indicates that it is located in the home folder).  The prompt will look something like this: 

```
@toochevere ➜ ~/repos (<>) $
```

Any repos cloned should be put under the `repos/` folder.  A command line alias (actually it's a bash function but let's not be picky) exists in order to make this easy:  `get-repo`.  Simply use `get-repo` command with the name of the repo you wish to clone:

```
@toochevere ➜ ~/repos (<>) $ get-repo devops
```

If the repos is not yet present under the `~/repos` folder then it will be cloned.  If it is present, it will be updated.   If the newly cloned repos has a `scripts` folder, then it will be automatically added to the `PATH` variable and any scripts will be available.  

**Note** that part of the setup script asked for a GitHub SSH key.  This key is used to clone the private repos.  If you did not provide a key, you will not be able to clone the private repos. 

Once you have the repos cloned, you can then open any of them in the dev environment.  This can be done by (in VS Code) opening the command palette and choosing "Open Workspace from file" and selecting the workspace you wish to open.  You can also open the terminal in VS Code, navigate to the folder you want to open, and use the command `code <workspace file or folder>`.  Once you open a project, it will be add to the "Recent" list in VS Code and you can quickly open it in the future. 

## Updating the dev environment

The dev environment will check for updates to it's code.  This happens periodically.  If it finds an update has happened (a new commit has been pushed to `master` in the `devenv` repo) then it will warn the user when a command line is opened.  The user is given the option to pull the latest changes in `master`.  If the change was a major version change, then the user will also be warned they should rebuild the container. 

## Utilities

### Scripts 

A few utility scripts have been provided to make life happy.

* `get-services-config.sh` This script pulls the service config from it's repository into the local dev environment.  It is placed in `~/debug/config`
* `0x0.st` A script to push a file to the 0x0 file sharing site
* `count-code-lines.sh` A utility to count code lines in a file or folder
* `docker-build.sh` A utility to build a project using Docker.
* `docker-down.sh` A utility to bring down a local docker configuration
* `docker-up.sh` A utility to bring up a local docker configuration
* `enable-container-dotnet-debugger.sh` A utility to inject and run the dotnet debugger into a locally running container.
* `file.io` A utility to push a file to the file.io file sharing site.
* `update-repos.sh` A utility to update all repos in the `~/repos` folder.

### Git extensions 

The following are additional `git` commands that extend it's basic capabilities. 

* `git graph` Provides a graphical display of the commit history
* `git graph-all` Provides a graphical display of the commit history for all branches
* `git prune-branches` Prunes local branches that are no longer needed

## Coding documentation

* [Coding Standards](docs/coding-standards.md)
* [Coding workflow, getting code into production](docs/coding-workflow.md)
* [Culture](docs/culture.md)

## Reference

* [VS Code Remote Containers](https://code.visualstudio.com/docs/remote/containers)
