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

When you first bring up the dev environment, it only contains the code that is in the `devenv` repo.  You will need to clone the other repos that you want to work on.  You can do this in the terminal in the dev container if you wish.  Any repos cloned should be put under the `repos/` folder.  For your convenience, there is also a script in the `devenv-utils` folder called `update-repos.sh` that will clone all the repos that you need.  You can run this script in the terminal in the dev container to clone all the repos.  It will also update the repos using `fetch` and `pull`.

If you wish to add additional repos to the list that is cloned and updated, you can add a file in the root folder called `repo_list.extra` with a list of the additional repo links that you wish to include. 

**Note** that part of the setup script asked for a GitHub SSH key.  This key is used to clone the private repos.  If you did not provide a key, you will not be able to clone the private repos. 

After cloning the repos, it is a good idea to restart Visual Studio to allow the dev container to add any `_utils` folders to your PATH.

Once you have the repos cloned, you can then open any of them in the dev environment.  This can be done by (in VS Code) opening the command palette and choosing "Open Workspace from file" and selecting the workspace you wish to open.  You can also open the terminal in VS Code, navigate to the folder you want to open, and use the command `code <workspace file or folder>`.  Once you open a project, it will be add to the "Recent" list in VS Code and you can quickly open it in the future. 

## Coding documentation

* [Coding Standards](docs/coding-standards.md)
* [Coding workflow, getting code into production](docs/coding-workflow.md)
* [Culture](docs/culture.md)

## Reference

* [VS Code Remote Containers](https://code.visualstudio.com/docs/remote/containers)
