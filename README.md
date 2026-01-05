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

Note:  Windows is the most complex environment to set up.  You should properly hate it, and prefer something else.  However, it's a reality in most cases.  A Windows machine will need significantly more resources than a Linux or MacOS machine.  An option to consider is to run Linux in a VM instead.

Note:  The instructions below are for WSL2 using Docker installed in the WSL2 environment.  Docker Desktop for Windows is not recommend. It is problematic and causes problems with case sensitivity in file paths and other Windows related idiosyncrasies. 

1. Install the WSL2 on Windows.  This is a feature that allows you to run a Linux environment on Windows.  You can find instructions [here](https://docs.microsoft.com/en-us/windows/wsl/install).    
2. Install a Linux distro from the Microsoft Store.  Ubuntu 22.04 is recommended.  Log in and verify that it runs. 
3. Configure the WSL with sufficient resources.  This is done in the `.wslconfig` file in your user directory (`C:\Users\[user name]`).  The following is a recommended configuration:
   ```
   [wsl2]
   memory=12GB
   processors=4
   ```
   You can adjust this to suit your system, but that is the recommended minimum.  After making the changes, restart the WSL2 environment by exiting the terminal and restarting it.
4. Inside the WSL, run the steps for [Linux setup](#linux-setup) to set up your development environment.

### MacOS setup with OrbStack

This tutorial will guide you through setting up OrbStack and creating your first VM.

#### Prerequisites

- macOS system
- Terminal access
- Homebrew installed

#### Installation Steps

1. First, install OrbStack using Homebrew:
```bash
brew install orbstack
```
2. Create a Debian-based VM named "coding-vm":
```bash
orb create debian coding-vm
```
> Note: When prompted, allow OrbStack to install the helper. You can dismiss any additional dialogs that appear.
3. Connect to your new VM via SSH:
```bash
ssh orb
```
> Note: If asked to verify the fingerprint, type 'yes' and press Enter.
4. Inside the Orb VM, run the steps for [Linux setup](#linux-setup) to set up your development environment.

#### Notes and follow-up

* To get back to the Orb VM, simply run `ssh orb` in your terminal.
* To run VS Code and have it work with the Orb VM

   1. Start VS Code.
   2. Open the Command Palette (⌘+⇧+P) and type `Remote-SSH: Add Host...`.
   3. Enter `orb` as the host.
   4. Open the Command Palette again and type `Remote-SSH: Connect to Host...`, then select `orb`.
   5. Pick the devenv folder.  It will ask you to trust the authors, say yes for the whole path.
   6. For the toast that appears, select "Reopen in Container".
   7. Let the container build completely.  Afterward you can come back by using the Recent list.

### Linux setup

#### Prerequisites

* A Debian based Linux distribution (Ubuntu, Debian, etc.)

#### Installation Steps

1. At a terminal, update the package list and install Git:
```bash
sudo apt update && sudo apt upgrade -y && sudo apt install apt-utils git -y
```
2. Clone devenv repository:
```bash
git clone git@github.com:YOUR-ORG/devenv.git
```
3. Navigate to the project directory:
```bash
cd devenv
```
4. Execute the [setup script](#running-the-setup-script):
```bash
./setup
```
> Note: The setup script will prompt you for environment details and SSH key configuration for private repositories.
5. At the repo root and launch Visual Studio Code pointing at the repo root.  If it asks you to trust the authors, say yes for the whole path.  Note that if `code` is not found, you may need to add it to the path.  See the next step.:
```bash
code .
```
6. If `code` command is not found from the terminal, open Visual Studio Code normally and add it to your PATH:
   - Open the Command Palette (⌘+⇧+P)
   - Type `Shell Command: Install 'code' command in PATH` and select it
   - Close VS Code
   - Restart your terminal and try `code .` again from the project directory
7. VS Code Container Configuration:
- Wait for VS Code to detect the dev container configuration
- If not prompted automatically, open the Command Palette (⌘+⇧+P)
- Select `Remote-Containers: Reopen in Container`
8. Initial Container Build:
- The first build may take several minutes
- Wait for the bootstrap process to complete
- When port opening messages appear in the container output log:
  1. Close VS Code
  2. Or use Command Palette to select "Reload Window"
9. Relaunch VS Code:
- Open VS Code again
- When prompted, select "Reopen in Container"
- Alternatively, use the Command Palette to manually reopen in container

Now your development environment is fully configured and ready for coding!

#### Notes
- Initial container builds take longer; subsequent starts will be faster
- Ensure all ports are properly opened before starting development
- Keep VS Code updated for optimal container development experience

## Running the setup script

The [setup script](./setup) will ask you a few questions about your environment and allow you to specify your SSH key to the private repos.  It will also install the necessary tools on your host machine to work with the dev container.  The script saves your answers to a hidden folder in the local repo `.setup` and will not ask you the same question twice if you have already run it previously and provided answers.  If you want to run `setup` from the beginning, simply delete any files from the `.setup` folder.  

The script will ask you for the following information:

* Your human name:  This is the name by which you will be identified in all commits.  This is YOUR NAME AS A HUMAN BEING, not your username.  The name your mother calls you when she's angry.
* Your omsnic.com email:  This identifies you by email in all commits. 
* Your timezone:  This is in order to correctly display your local time within the container.  By default, the script will attempt to determine your time zone.  If it does so correctly, then you can just hit ENTER and accept the default. 
* A PAT:  The Personal Access Token is what allows package access and other functions from the dev environment.  The recommended note should be 'AZURE_TOKEN' and the expiration should be one year.  This token should have the following permissions:
   - Work Items: Read & write
   - Code: Read & write, Status
   - Build: Read & Execute
   - Packaging: Read
* You may also be asked other questions that have to do with installing or minimally configuring your host environment.

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
