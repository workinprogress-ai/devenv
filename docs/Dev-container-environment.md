# The Development Environment

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

### Using Docker in the container

The configuration for the dev container includes an instance of Docker running within the container itself.  This configuration is referred to as "docker-in-docker".  Remember that anything you do in the container with Docker is isolated from the host.  So for example, if you map folders in `docker-compose.yml`, the paths are actually paths _in the container_, not on the host.

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

## Lone Wolf Options

The provided development and VS Code are the officially supported setup.  Other tools are not supported.  If you want to use a different tool or choose not to use the development environment...

* You're own your own to make it work.
* If you can't make it work in reasonable way, in a reasonable time, and with a reasonable lack of distraction, then you will need to just use the setup provided.
* Do not leave any artifacts in the repo that belong to non-supported environments
* Any non-supported setup must be made to work seamlessly with the official protocols.  Otherwise, you must use the setup provided. 
