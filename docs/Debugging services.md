# Debugging

Debugging is such an important topic, it gets multiple applicable quotes:

> If debugging is the process of removing software bugs, then programming must be the process of putting them in.
― E. W. DIJKSTRA

> Anything that can possibly go wrong, will go wrong.
― Murphy

> At the source of every error which is blamed on the computer you will find at least two human errors, including the error of blaming it on the computer.
― Anonymous

The architecture of services gives you multiple options when it comes to debugging.

## Debugging on the local machine

Most debugging will happen on your local machine, which is obviously the easiest case.  It is not hard to run an entire SOA locally.  This means that in the vast majority of cases, you should be able to replicate any issues on your local machine.

### Using tests to debug

The easiest way to debug an issue is to create a test that demonstrates it.  If you can do that. then it's simply a matter of debugging the test.

### Local configuration and data

When debugging locally, services will generally need access to configuration files and a place to put their data.  By default, there are a set of git-ignored folders called `.debug/data` and `.debug/config` in the repository root that can be used.  The environment variables `DATA_FOLDER` and `CONFIG_FOLDER` are used to indicate where the service should look for its data and config.  In the default dev environment, these variables are set up for you automatically.

In order to obtain the latest config information, run the script `devenv-utils/get-services-config.sh`.  You will need to provide your azure user name, a password, and an environment "branch".  This will save the latest config info to

### Running a service in the debugger

If the issue cannot be isolated down to a test, then the next best thing is to run the service on the local machine in the debugger directly.  Simply start the debugger and it should (if everything is configured correctly) start the host running the service.

Some service will require additional processes in order to run (for example, the Log Aggregator requires a dictionary server like Redis).  In that case, you can use the service's [`docker-compose.yml`](../log-aggregator-service/_devops/docker-compose.yml) to bring up the dependencies.  Simply comment out the part of the `docker-compose.yml` that relates to the service itself, and make sure that the dependencies have the appropriate ports exposed etc.  You may have to fiddle with the configuration of the service so that it can find its dependencies.

Even though services with external dependencies can in fact be debugged directly in your dev environment, it is quite often easier to just [debug them in a container](#debugging-a-service-running-in-a-container).

### Debugging a service running in a container

Sometimes it is beneficial to run a service in a container and debug it there.  For example, if the service has dependencies that it needs in order to run, of ir you need the entire system to run in order to debug a specific problem.  Although each service could be brought up manually, it's usually easier to use Docker to do this for you.

Each service has within its folder a [`docker-compose.yml`](../sample-service/_devops/docker-compose.yml).  It is configured to point at and build the local service code.  It will also bring up all the dependencies.  Note that the [`docker-compose.yml`](../sample-service/_devops/docker-compose.yml) for each individual service will create a Debug build of the service and configure for local debugging.  It will bring up the service by itself, along with direct dependencies.  For more on how to do this, see the section below [Building and running the service using it's own `docker-compose.yml`](#building-and-running-the-service-using-its-own-docker-composeyml).

You can also [bring up the entire set of services](#building-and-running-the-entire-system) and debug specific ones.  In this case, you will have an entire environment just like Dev, QA, etc.

If you are using the dev container, then the `default.env` file points to the correct information in order to bring up containers for services.  If you are not using the provided dev container, then you will probably need to create a `local.env` file first.  The `local.env` file defines certain environment variables that Docker will need in order to build and run the service.

See the information about [using the Docker daemon withing the dev container](./Dev-environment.md#using-docker-in-the-container) for more information about how docker works in the provided environment.

#### Building and running the service using its own `docker-compose.yml`

To build and run the service with its immediate dependencies, execute the following commands in the terminal within the dev container (from the service root folder):

```
$ docker-up.sh
```

If you are running it on the host, you may need to use a full path

```
$ ../devenv-utils/docker-up.sh
```

Note that this is just a quick shortcut to running `docker-compose up`.  It is not intended that this shortcut obviate the need to understand Docker and how it works.

Because the service's `docker-compose.yml` instructs Docker to build the service image using a `debug` profile, your local code will be used to build the service and run it.

#### Building and running the entire system

A service's local `docker-compose.yml` should have the minimum dependencies necessary in order for the service to run.  These dependencies may be resources such as databases, or they may be other services that this service needs in order to work.  Thus, you should always be able to bring up a service using its own local `docker-compose.yml`.

Sometimes, however, you may need to run a service in the context of the entire system in order to properly debug certain issues.  In the repo root, there is also a `docker-compose.yml` that brings up the entire system.   This `docker-compose.yml` will by default pull from the OMSNIC image registry the images for the different services.  However, if you already have an image that it needs in your local Docker cache, that particular image will not be pulled by default.  You can use this behavior to help you debug.   By building from your local code first, you can let your code run in the context of the entire system (all services running together).

In order to make this work:

1. Build a debug version of your service first
2. Tell Docker to bring up the system

For example, let's say you wanted to debug the `log-aggregator` service on your local machine, but you want to do it with other services running and sending their log data.  How would you do this?

1. `cd` to the `log-aggregator-service` folder.
2. Build the service using `docker-build.sh`.  This will put the image in your local image cache.
3. `cd` back to the repo root and execute `docker-up.sh`.  When you do this, Docker will pull all images it needs, but your service that you just built will not be pulled.  Since you built it as `debug`, you can proceed to attach a debugger to it [as indicated](#how-to-actually-attach-the-debugger-and-step-through-code-in-the-container).  Remember that the requirements must be met as indicated in [the following section](#requirements-for-attaching-the-debugger-and-stepping-through-code-in-the-container)

#### Requirements for attaching the debugger and stepping through service code in the container

In order to debug in containers, there are three things that basically need to happen (this is all done for you when you use the [`docker-compose.yml`] in a service folder).  This is informational only:

1. You must have a debug build running in the container.  This is automatically the case if you use the `docker-compose.yml` provided with the service.
2. Your source where you are putting breakpoints needs to match the filepaths with which the code was built.  So your code must be mapped into the container.  Remember, this path to your code is the path on the _host machine_ because [the container is using the Docker on your host](./Dev-environment.md#using-docker-in-the-container).
3. The c# debugger must be available _within_ the container.  There is a script called [`enable-container-debugger.sh`](../devenv-utils/enable-container-debugger.sh) in the `devenv-utils` folder that you can run which will copy the debugger into the container.  However most of the time this will not be necessary, as this copying is done during a debug build.

##### How to actually attach the debugger and step through service code in the container

Assuming that you have [created the image using a debug build](#building-and-running-the-service-using-its-own-docker-composeyml) (which will set up all of the [requirements](#requirements-for-attaching-the-debugger-and-stepping-through-code-in-the-container)), you should be able to debug code in a container like a boss.  With the service running in a container, using VS Code click on the Debugger tab.  Pick "Docker .NET Attach" in the profile list and click the "Start Debugging" button.  VS Code will ask you what container to attach to.  Pick the one with your service.  Once you do, magic will happen and it should attach.  At that point, you can do whatever you normally would in the debugger.  Open a code file for example, set a breakpoint, and watch in wonder as execution stops at that point.

## Debugging a service running in one of the environments

If there is a problem that cannot be reproduced in your local development environment, then you may have to debug a service while running in one of the environments.  This can be tricky.  The same rules apply as outlined in [the section about debugging requirements](#requirements-for-attaching-the-debugger-and-stepping-through-code-in-the-container).

Your best bet is probably to create a special build image (by fiddling with the Docker file) which does a Debug build and packages all the code together, then manually pull that image on to the target environment.  Assuming that the necessary ports are open, it should in theory be possible then to debug code remotely and step through it.
