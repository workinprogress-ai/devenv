# DEVENV repo

This repository is the starting point for setting up a working dev environment.  I provides the tooling necessary to development on all other repos.  

See the sections below for instructions on how to set up your dev environment.

## Prerequisites

- Git
- Visual Studio Code (with the Remote - Containers extension installed)
- A unix environment (Linux, MacOS, WSL)

You do not need to have any additional tooling installed on your host machine.  Everything you need will be provided in the dev container.  Although it is not prohibited to use a different editor or IDE for development, the dev environment is considered the standard and certain functions will only be available using it.  If you want to be a lone wolf and use a different editor, you will need to figure out how to do certain things on your own.

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
7. Run the setup script.  This will ask you a few questions about your environment and allow you to specify your SSH key to the private repos.
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
4. Run the setup script.  This will ask you a few questions about your environment and allow you to specify your SSH key to the private repos.
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
4. Run the setup script.  This will ask you a few questions about your environment and allow you to specify your SSH key to the private repos.
   `./setup`
5. Once the setup script is complete, navigate back to the root of the repo and run Visual Studio Code, pointing it at the repo directory.
   `code .`
6. VS Code should, after a few seconds, offer to reopen the folder in a container.  If not, open the command palette (Ctrl+Shift+P) and run the command `Remote-Containers: Reopen in Container`.
7. The dev container will build and start.  This may take a few minutes the first time.  Subsequent starts will be faster.  Once the bootstrap has run, and the container output log shows that it is opening ports, close Visual Studio. 
8. Reopen Visual Studio Code and the folder in the dev container.  Once again you will be asked if you want to open the folder in a dev container.   Choose to do so, or you can manually open it in the container.  
9. The dev container will start.  You can now start working on the code.

## Coding in the dev container

The dev container is a fully functional development environment.  It has all the tools you need to work on the code.  The code is mounted into the container, so any changes you make in the container will be reflected on the host machine.  

When you first bring up the dev environment, it only contains the code that is in the `devenv` repo.  You will need to clone the other repos that you want to work on.  You can do this in the terminal in the dev container if you wish.  Any repos cloned should be put under the `repos/` folder.  For your convenience, there is also a script in the `devenv-utils` folder called `update-repos.sh` that will clone all the repos that you need.  You can run this script in the terminal in the dev container to clone all the repos.  It will also update the repos using `fetch` and `pull`.

If you wish to add additional repos to the list that is cloned and updated, you can add a file in the root folder called `repo_list.extra` with a list of the additional repo links that you wish to include. 

**Note** that part of the setup script asked for a GitHub SSH key.  This key is used to clone the private repos.  If you did not provide a key, you will not be able to clone the private repos. 

After cloning the repos, it is a good idea to restart Visual Studio to allow the dev container to add any `_utils` folders to your PATH.

## Coding documentation

* [Coding Standards](docs/coding-standards.md)
* [Coding workflow, getting code into production](docs/coding-workflow.md)
* [Culture](docs/culture.md)

## Reference

* [VS Code Remote Containers](https://code.visualstudio.com/docs/remote/containers)
