# Understanding Services

A service can be defined as a "something that does something" in our system.  That's a fairly loose definition to be sure.  Basically a service is a process that does some useful work.  

There is great value to standardization, so all of the "new services" in the SOA are structured in exactly the same way.  A contributor does not need to try to understand the structure each time.  

Services all have some [common features](#common-features) as well.  These common features (discussed below) again mean that a contributor does not need to understand a different paradigm each time he contributes to a different service.  

Services do different things, but how they work is basically always the same.

In the following sections, some points are linked to a concrete example in the [sample service](../sample-service).

## Folder structure 

A service will typically will have the following folders:

|  Folder       | Description |
|---------------|-------------|
| Client.Rest   | A library to consume the service's api
| Common        | Common code, config info, interfaces, etc
| Host          | A project that brings up the service in the context of server (web server)
| Service       | The main service code itself
| Tests         | Tests for all other parts of the service

In addition, there is a workspace file in the top folder of each service project.  And each service project uses the same common core libraries. 

## Common features

### Service API

Services do things, but they usually need a way for external actors to communicate with them.  This mechanism is the service API.  The API defines what "actions" a service can take in response to an external request.  Requests can logically fall into one of the following categories.  Each category is roughly equivalent to a REST verb:

|  Category | REST Equivalent | Description
|-----------|-----------------|----------------|
| Query     | GET             | Requests information, makes no state changes 
| Creation  | POST            | Creates a resource
| Mutation  | PUT             | Mutates (changes) a resource
| Deletion  | DELETE          | Removes (deletes) a resource
| Command   | POST            | Executes an action

The API must respond very quickly to requests.  A general guideline is that the work done by an API call should take no longer than one or two seconds.  This might be longer in some cases, but in no case should it take longer than ten seconds as a rare exception (such a case would need strong justification).  The faster the better.

Obviously, there is some work that will take longer than a few seconds.  This is where [daemons](#daemons) come in.

### Daemons

A daemon is a process that runs invisibly in the background.  In the OMSNIC SOA, daemons run by doing work on a queue of "messages" (in the context of daemons, messages represent discreet chunks of work).  A daemon can be configured to process these messages in parallel with a number of threads.  Message processing can take as long as it needs to.  

Daemons also have a timer that can be configured to fire at regular intervals and kick of message processing.  Message processing can also be kicked off manually, or at the time that messages are posted.  

### Messages (Events and Commands)

A "message" in the context of the service itself is piece of information that is "broadcast" in relation to a specific action, and any interested actor can listen for them and take action accordingly.  

Events are the more common form of messages, and they are emitted (published) when a service does something that might be of interest to another actor.  For example, a user being created might need additional work to be done in other services, so the User service could publish a "UserCreated" event with the new user's information.  Then correspondingly a Profile service could listen for the creation of the user and create a corresponding Profile data object.  

Commands are not as common, but do the same thing in reverse.  A command is issued to the system to do something, without the issuer needing to know what services are responding.  Using the same analogy, the User service in this case would respond to the command by creating a user, the Profile would respond by creating a profile, and any other service would likewise do any necessary work in relation to creating the user.  The work is complete when all subscribers have finished. 

Messages allow services to work together without being tightly coupled to each other.  In both examples the User service and the Profile service do not need to know anything about each other.  They can work without any hard dependencies. 

### Tying it together

These three previously mentioned common features of services can be orchestrated to work together.  

For example, lets say that the Image service is responsible for processing images, which takes a while to do.  The services's API might have a CreateImage call that simply takes the request information and posts the message to it's daemon.  Then it tells the daemon to start processing messages. 

The daemon in our example can process up to two images in parallel, so it gets to work on the message.  Meanwhile more requests to create images come in, and they get assigned to threads. When more than two messages come in while the worker threads are busy, they wait in the queue for their turn.  

Meanwhile, the first image completes, and the daemon publishes an event as the last part of it's work.  The original requester listens for the event and then takes action based on the result. 

## Service code

A key point to understand about services is that they are composed of various interfaces (backed by the corresponding implementations) that do very specific things.  Each piece is very loosely coupled to the others (by interfaces only).   This approach means that 1) each piece can be unit tested apart from the others (allowing us to achieve [100% code coverage in most cases](./How-to-build-and-test.md#100-code-coverage)) and 2) dependencies can be swapped easily by way of composing the services differently, and they can be easily stubbed. 

### Common

Each service has a [Common](../sample-service/Common/) project that has mostly interfaces, POCOs for configuration and moving data, and things like constants and enumerations.  The Common project can be referenced by any consuming code, without the hard coupling to the service implementation. 

One of the most important interfaces that the Common library will have is the [Service Api interface](../sample-service/Common/Api/ISampleServiceApi.cs).  This defines what calls can be made to the service's API.  These calls are just plain old C# method calls.

### Client.Rest

This is a [client](../sample-service/Client.Rest/) that can be used by an external actor (a [consumer](../sample-consumer/Program.cs) of the service) to call the service api.  It abstracts away any concerns about protocols or transmission, and provides the consumer with an easy to use interface. 

This project is usually very simple, typically consisting of [just one .cs file](../sample-service/Client.Rest/SampleServiceRestClient.cs).

### Host

The Host project is what will actually run the service in a process, and does the work of _composing_ the service (providing implementations for it's dependencies) and doing that startup and shutdown.  

It also does the very important work of hooking up a service to a protocol (such as HTTP) so that stuff can actually call it's API.

This project is usually very simple, typically consisting of just a few .cs files or [just one](../sample-service/Host/Program.cs).

### Service

[This project](../sample-service/Service/) is where the bulk of the fun is.  It contains logic where the work of the service is actually implemented.    

There are a few common concepts in a service. 

#### Service main code

The [service main code](../sample-service/Service/SampleService.cs) is where the service defines things that have to do with it's overall life cycle.  Things like starting and stopping for example, and how [operations](#operations) are created. The service main code _should be stateless_ as a general rule, except for the lifecycle state which is handled by the base class.  The service main code should avoid doing any significant work in relation the purpose of the service.   

One of the very important pieces of work that the service main code will do is to publish it's endpoints.  This is basically defining how certain endpoints relate to calls to it's API.  The publication process is not directly coupled to REST, but it it is closely aligned since most of the time HTTP is the mechanism of communication to the API.  (Note:  This is one of the reasons why the calls to the API have categories; so that we can standardize how we publish and do most of the work behind the scenes.)

#### Operations

All significant work should be done in the context of an _operation_.  An operation is an object that handles work and it has it's own lifecycle.  An operation is also stateful (it ends with a result for example) but the state disappears when the operation finishes and the object is disposed.  This allows the overall service to remain _stateless_.

For example, when a request comes in to the API of a service, it will create an API operation and delegate execution to it.  The operation will begin, validate, execute, and end.  The end will be associated with a status and possibly a result object. This information is then relayed back to the caller. 

The main place where operations are seen is obviously the API, but there are others.  For example, when a daemon is processing messages, it should use an operation.  If a service subscribes to an event, the work of responding is delegated to an operation.  Therefore a service may have many different types of operations. 

## Tests

The most important part of a service is [the tests](../sample-service/Tests/).  A service is useless if it cannot be trusted to function.  Most services should have [100% code coverage](./How-to-build-and-test.md#100-code-coverage) by unit tests.  

See the section about [building and testing](./How-to-build-and-test.md) for more information about testing. 