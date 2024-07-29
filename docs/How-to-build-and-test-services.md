# How to build and test

The development environment should have everything you need configured out the box to start building services.

## Building

### Building from the command line

For any particular service, you should be able to go to any of it's main project folders (Client.Rest, Service, Common, Tests, Host) and simply execute `dotnet build` to build it.

### Build from the build task

In the configuration for VS Code for each service, there is a build task that basically executes `dotnet build` for the Tests project.  Because the Tests project references all the others, this should cause the entire service to get built.

### Building with Docker

Each service has a [Dockerfile](../sample-service/Dockerfile) that describes the steps for building an image for that service as well as a [docker-compose.yml](../sample-service/_devops/docker-compose.yml) that specifies things like the image name and describes how the container should be created.

It would be a good idea to learn about how docker works if you don't already know.  There are a few different ways to build an image and then create a container.  We use docker-compose in order to keep image and container names consistent.

You can build an image quickly by executing `docker-service-build` located in the `devenv-utils` folder.  In order to execute it, change to the service's root folder where the `Dockerfile` and `docker-compose.yml` files are located.  Then execute `docker-service-build`.   This will build the image and store it in your local Docker cache.

For information about how to use this image, see the section about [debugging services](./Debugging%20services.md).

## Unit Testing

For the purpose of this information, when we talk about testing we are always talking about unit testing.

### 100% Code coverage!

We can proudly say that for much of the system, the standard is to have code 100% covered by unit tests.  What does this mean?  It means that every line of code is executed at least once when the suite of tests is executed. (Note that branch coverage is not necessarily at 100%).

Having 100% coverage is by no means a guarantee that there are no bugs, but it's a good place to start.  But rather than looking at that number as some kind of a trophy, it is better to remember that code that is testable naturally tends to be better code because good practices are required to be able to achieve a high level of testability.

The [coverage report](#coverage-report) will serve as a guide to be able to understand what part of the code still needs testing.

Even though we are shooting for 100% line coverage, there may at times be services that are exceptions to this rule.  If so, there should be a strong and specific justification.  When an exception is made to shoot for a lower percentage, then the target number can be adjusted in the [`run-tests-local.sh`](../sample-service/Tests/run-tests-local.sh) and in the Azure pipeline config.

Another possibility is that there is at times code that we explicitly decide we will not test.  This might be POCOs for example or other code that simply does not have significant logic.  Such cases must have justification.  When the agreement is made to accept that certain methods or classes will not be included in code coverage, they can be excluded by using the attribute `[ExcludeFromCodeCoverage]`.

### Writing tests

#### File organization

Tests should be organized in a way that keeps related tests together.  For example, the API operation for a service may have multiple methods that need to be tested, and each of these will have multiple cases. 

#### AAA Pattern for tests

Tests should generally follow the "Triple A" pattern in which the test is divided into three sections:  Arrange, Act, Assert.

The Arrange section is where the setup of the test is done.  Steps that are needed to create the conditions of the test are executed here.

The Act section is where the code targeted by the test is executed.

The Assert section is where declarative statements are made about the expectations from the test.  If the expectations are not met, the test fails.

In some cases, a fourth section Cleanup may be added.

#### Thinking of test cases

The coverage report is a good guide to see where we need to add tests, but it should never replace common sense and critical thinking.  When writing tests, reason on the code and [what could go wrong with it](../sample-service/Tests/Operation/UpdateWidget.cs).  What should it do in such cases?  Include tests that are both "happy path" and also error cases.  Good error handling is extremely important and must be verified by good testing.

Tests should be named in a way that clearly indicate what they are trying to prove.  You can use underscores `_` in the name to make it more readable as the need may be.

### Running tests

Tests can be run in several ways.

#### Running individual tests using the quick link

VS Code will put two small links "run test" a "debug test" above the test implementation.  To run a specific test, you can simply click the "run test" link.  Of course, you can also put in breakpoints and run it in the debugger with "debug test".

#### Using the test explorer

A "Test Explorer" extension is installed by default in the dev environment.  It will show a tree of all of the tests in the service (or other project).  Tests can be run either all together or individually from the explorer.  Likewise, individual tests can also be debugged from the explorer.

#### Using the command line

In the `tests` folder is a script called [`run-tests-local.sh`](../sample-service/Tests/run-tests-local.sh).  This script will run a special build of the project and produce a coverage report which is viewable using a browser.  `run-tests-local.sh` takes into account the coverage target, and will fail if coverage is not met (the coverage report will still be produced).

*Note:* Testing standardization is still a work in progress. 

### Coverage report

The coverage report is an html report that is generated from running [`run-tests-local.sh`](../sample-service/Tests/run-tests-local.sh) in the `tests` folder.  It will show coverage percentages organized by code file.  You can drill down and see if specific lines are being covered.  This is a great way to understand what cases you may need to include in your tests.

Another useful piece of information in the coverage report is the section called "Risk hotspots".  This shows areas of complexity from an analysis of NPath and Cyclomatic complexity.  Even though these hotspots will not break the build, if you see them you should give serious consideration to refactoring before finishing your PR.
