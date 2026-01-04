# DEVENV (Developer Environment) repo

A comprehensive development environment setup with dev containers, tooling, and scripts. This repository provides a complete developer experience with infrastructure automation, repository management, and quality tools for teams using GitHub.

## Features

- **Dev Container Environment**: Fully configured development container with all necessary tools
- **Repository Management**: Scripts for cloning, updating, and managing multiple repositories
- **Pull Request Workflows**: GitHub CLI-based PR creation and management tools
- **Developer Utilities**: Script templates, linting, versioning, and code quality tools
- **Database Tools**: MongoDB, SQL Server, and SMB server utilities
- **.NET Development**: NuGet package management and local debugging support
- **Comprehensive Testing**: BATS test framework with extensive coverage
- **Documentation**: Detailed guides for coding standards, contributing, and best practices

## Prerequisites

- Git
- Visual Studio Code (with the Remote - Containers extension installed)
- A unix environment (Linux, MacOS, WSL)
- **Docker or Podman** (setup script will help you install either one)

You do not need to have any additional tooling installed on your host machine. Everything you need will be provided in the dev container. Although it is not prohibited to use a different editor or IDE for development, Visual Studio Code and the dev environment provided here are considered the standard. Use of VS Code and this dev environment is _required_. (see the section on [lone wolf options](./docs/Dev-container-environment.md#lone-wolf-options))

## Setup of the dev environment

### Windows

Note:  Windows is the most complex environment to set up.  You should properly hate it, and prefer something else.  A Windows machine will need significantly more resources than a Linux or MacOS machine.  An option to consider is to run Linux in a VM instead.

1. Install the WSL2 on Windows.  This is a feature that allows you to run a Linux environment on Windows.  You can find instructions [here](https://docs.microsoft.com/en-us/windows/wsl/install).    
2. Install a Linux distro from the Microsoft Store.  Ubuntu 22.04 is recommended.  Log in and verify that it runs. 
3. Configure the WSL with sufficient resources.  This is done in the `.wslconfig` file in your user directory (`C:\Users\[user name]`).  The following is a recommended configuration:
   ```
   [wsl2]
   memory=12GB
   processors=4
   ```
   You can adjust this to suit your system, but that is the recommended minimum.  After making the changes, restart the WSL2 environment by exiting the terminal and restarting it.
4. Install Docker Desktop for Windows, using WSL2 as the backend.
5. Make sure that Docker is configured to expose it's command line to WSL2.  This is done in the Docker Desktop settings.
6. Clone this repo into your WSL2 environment.
   `git clone git@github.com:YOUR-ORG/devenv.git`  
7. In the WSL terminal, navigate to the repo directory `devenv`
   `cd devenv`
8. Run the [setup script](#running-the-setup-script).  This will ask you a few questions about your environment and allow you to specify your SSH key to the private repos.
   `./setup`
9. Once the setup script is complete, navigate back to the root of the repo and run Visual Studio Code, pointing it at the repo directory.
   `code .`
10. VS Code should, after a few seconds, offer to reopen the folder in a container.  If not, open the command palette (Ctrl+Shift+P) and run the command `Remote-Containers: Reopen in Container`.
11. The dev container will build and start.  This may take a few minutes the first time.  Subsequent starts will be faster.  Once the bootstrap has run, and the container output log shows that it is opening ports. Close VS Code and re-open it, or select Reload Window from the command palette. 
12. Reopen Visual Studio Code and the folder in the dev container.  Once again you will be asked if you want to open the folder in a dev container.   Choose to do so, or you can manually open it in the container.  
13. The dev container will start.  You can now start working on the code.

### MacOS

1. Install [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/).
2. In a terminal, clone this repo.
   `git clone git@github.com:YOUR-ORG/devenv.git`  
3. In the terminal, navigate to the repo directory `devenv`
   `cd devenv`
4. Run the [setup script](#running-the-setup-script).  This will ask you a few questions about your environment and allow you to specify your SSH key to the private repos.
   `./setup`
5. Once the setup script is complete, navigate back to the root of the repo and run Visual Studio Code, pointing it at the repo directory.
   `code .`
6. VS Code should, after a few seconds, offer to reopen the folder in a container.  If not, open the command palette (Ctrl+Shift+P) and run the command `Remote-Containers: Reopen in Container`.
7. The dev container will build and start.  This may take a few minutes the first time.  Subsequent starts will be faster.  Once the bootstrap has run, and the container output log shows that it is opening ports. Close VS Code and re-open it, or select Reload Window from the command palette.  
8. Reopen Visual Studio Code and the folder in the dev container.  Once again you will be asked if you want to open the folder in a dev container.   Choose to do so, or you can manually open it in the container.  
9. The dev container will start.  You can now start working on the code.

### Linux

1. Install Docker or Podman. The setup script can help you install either container runtime. You can also manually install Docker using the script at [get.docker.com](https://get.docker.com) or install Podman via your package manager (`apt install podman` or `dnf install podman`).
2. Clone this repo.
   ```bash
   git clone git@github.com:YOUR-ORG/devenv.git
   ```
3. In the terminal, navigate to the repo directory `devenv`
   ```bash
   cd devenv
   ```
4. Run the [setup script](#running-the-setup-script). This will ask you a few questions about your environment, help you install a container runtime if needed, and configure your SSH key for repository access.
   ```bash
   ./setup
   ```
5. Once the setup script is complete, open the project in Visual Studio Code.
   ```bash
   code .
   ```
6. VS Code should, after a few seconds, offer to reopen the folder in a container. If not, open the command palette (Ctrl+Shift+P) and run the command `Dev Containers: Reopen in Container`.
7. The dev container will build and start. This may take a few minutes the first time. Subsequent starts will be faster. Once the bootstrap has run, and the container output log shows that it is opening ports, close VS Code and re-open it, or select Reload Window from the command palette.
8. Reopen Visual Studio Code and the folder in the dev container. The dev container will start. You can now start working on the code.

## Running the setup script

The [setup script](./setup) will ask you a few questions about your environment and help you configure everything needed for development. It will also optionally install Docker or Podman if not already present. The script saves your answers to a hidden folder in the local repo `.setup` and will not ask you the same question twice if you have already run it previously and provided answers. If you want to run `setup` from the beginning, simply delete files from the `.setup` folder.

The script will ask you for the following information:

* **Your name**: This is the name by which you will be identified in all commits.
* **Your organization email**: This identifies you by email in all commits.
* **Your timezone**: This is in order to correctly display your local time within the container. By default, the script will attempt to determine your time zone. If it does so correctly, then you can just hit ENTER and accept the default.
* **GitHub username**: Your GitHub account username (not email).
* **GitHub organization**: The GitHub organization that owns your repositories. The setup script will attempt to auto-detect this from the devenv repository's remote URL. This is used by repository management scripts to clone and create repositories.
* **GitHub PAT**: The Personal Access Token allows package access and other functions from the dev environment. You can create one by going to [GitHub Settings → Developer Settings → Personal Access Tokens → Tokens (classic)](https://github.com/settings/tokens/new). The recommended note should be 'GH_TOKEN' and the expiration should be 'No Expiration'. This token should have the following scopes:
  - **repo** (all) - Full control of private repositories
  - **read:packages** - Download packages from GitHub Package Registry
  - **read:org** - Read org and team membership, read org projects
  - **write:discussion** - Write access to discussions
  - **project** - Full control of projects

![PAT permissions](./docs/github_pat_scopes.png)

* **Digital Ocean API Token** (optional): If you plan to use Digital Ocean infrastructure tools, you can provide your API token during setup. This enables scripts like `terraform-plan.sh` and other infrastructure utilities to interact with your Digital Ocean account. You can create an API token at [Digital Ocean Account Settings → API → Tokens/Keys](https://cloud.digitalocean.com/account/api/tokens). The token will be validated during setup.

* **Container Runtime**: If neither Docker nor Podman is installed, the script will offer to install one for you. Choose Docker for traditional setup or Podman for a rootless, daemonless alternative.

## Creating the Dev Container

There is a first time procedure to execute to set up the container the first time. Container configuration and setup is handled in two parts:  There is a configuration that defines the basic container setup (the [devcontainer.json](./../.devcontainer/devcontainer.json) file) and a subsequent script that is run once the container is up.

1) In VS Code, open the repository root folder.  Once VS loads it, you should see a message come up that asks if you want to open it in a dev container.  Click on the button to re-open the folder in a dev container.  Alternatively if you do not get asked to open it in a dev container, you can tell VS explicitly to do so. From the command pallette choose "Dev Containers:  Open Folder in Container..."  Choose the repository root folder.

2) Once VS opens the folder in a container, the container itself will be created.  The first run will take longer as the container is built.  After that, container start-up should be almost instantaneous.

3) After the container finishes building, shut down VS Code and give it a few seconds for the container to fully shut down.  When `docker ps` shows no containers running, reopen VS and you should be good to go.

NOTE:  Be careful that the container has finished building before you shut down VS Code.  This isn't always super clear by looking at the log.  When the log gets to where ports are being forwarded (see example), you are usually good to go.

```
[74284 ms] Port forwarding 43888 > 44963 > 44963 stderr: Connection established
[79289 ms] Port forwarding 43888 > 44963 > 44963 stderr: Remote close
[79295 ms] Port forwarding 43888 > 44963 > 44963 terminated with code 0 and signal null.
```

## More information

For more information see the documentation:

**Getting Started:**

* [The Development Environment](./docs/Dev-container-environment.md) - Comprehensive dev container guide
* [Additional Tooling](./docs/Additional-Tooling.md) - All available scripts and utilities

**GitHub Issues & Projects:**

* [GitHub Issues Management](./docs/GitHub-Issues-Management.md) - Complete workflow guide for GitHub Issues, Projects, and Milestones
* [GitHub Issues Quick Reference](./docs/GitHub-Issues-Quick-Reference.md) - Fast lookup for common commands

**Development Standards:**

* [Coding Standards](./docs/Coding-standards.md) - Code quality and style guidelines
* [Contributing](./docs/Contributing.md) - How to contribute to projects
* [Function Naming Conventions](./docs/Function-Naming-Conventions.md) - Bash function naming standards
* [Logging Framework](./docs/Logging-Framework.md) - Standardized logging guide

**Advanced Topics:**

* [Port Forwarding](./docs/Port-forwarding.md) - Remote service access guide
* [Culture](./docs/Culture.md) - Team culture and practices

**Customizing the devenv:**

The devenv can be forked and customized to use with other organizations. See [CUSTOMIZATION](./docs/CUSTOMIZATION.md)

## Testing

Run the test suite with:

```bash
./tools/run-tools-tests
```

Run linting with:

```bash
./tools/lint-tools-scripts
```

See [tests/README.md](./tests/README.md) for more information about writing and running tests. 

## Reference

* [VS Code Remote Containers](https://code.visualstudio.com/docs/remote/containers)
