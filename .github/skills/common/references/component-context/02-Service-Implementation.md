# Service Implementation Reference

> **Context brief for AI agents.** Use this when writing or reviewing implementation plans for services, or when delegating implementation tasks. Covers every standard wiring task with exact code patterns.
>
> For conceptual architecture (what services are, events, sync), see [01-Service-Architecture.md](./01-Service-Architecture.md).
> For plugin-specific APIs, see [03-Service-Plugins.md](./03-Service-Plugins.md).

---

## File-by-File Reference

### 1. `src/Host/Program.cs` — Composition Root

The single entry point. Creates the host, builds the web app, wires all dependencies, starts the service. This is the only place to register plugin dependencies.

```csharp
using WorkInProgress.Lib.Services.Chassis.Host;
using WorkInProgress.Lib.Services.Chassis.Host.Kestrel;
using WorkInProgress.Services.MyCategory.MyService.Service;
using WorkInProgress.Services.MyCategory.MyService.Common;

var host = new HostEnvironment();
var app = WebApplication
    .CreateBuilder(args)
    .BuildServicesStandardApp(host);

var dependencyProvider = await DependencyBuilder.Create(host, Constants.ServiceIdentifier)
    .AddAllCommon()                                      // always present — daemons, TryChain, shared infra
    .AddOperationFactory(new MyServiceApiOperationFactory())  // always present — creates API operations
    // .AddDocumentData()                               // add plugins here as needed
    // .AddServiceMessaging()
    // .AddSagas()
    // .AddServiceClientFactory(OtherServiceRestClientFactory.Create())  // if calling other services
    .Build();

await app.RunService(dependencyProvider, MyServiceFactory.CreateFactory());
```

**Rules:**

- `AddAllCommon()` is always the first call after `DependencyBuilder.Create`
- `AddOperationFactory(...)` is always present
- All plugins are registered here via `Add*()` extension methods (see [03-Service-Plugins.md](./03-Service-Plugins.md))
- `DependencyBuilder.Build()` automatically creates `IConfigProvider` and `ILoggerFactory` if not explicitly registered

---

### 2. `src/Common/Constants.cs`

```csharp
namespace WorkInProgress.Services.MyCategory.MyService.Common;

public static class Constants {
    public const string ServiceIdentifier = "mycategory.myservice"; // lower-case, dot-separated
    public const int CurrentMajorVersion = 1;                       // increment for breaking API changes

    public static class Endpoints {
        public const string Ping           = "/ping";
        public const string GetWidget      = "/widgets/{id}";
        public const string GetAllWidgets  = "/widgets";
        public const string CreateWidget   = "/widgets";
        public const string UpdateWidget   = "/widgets/{id}";
        public const string DeleteWidget   = "/widgets/{id}";
    }
}
```

---

### 3. `src/Common/Api/IMyServiceApi.cs` — API Contract

Defines every callable operation. Implemented by both the service operation class and the REST client. **Never break this interface** — only add new methods.

```csharp
namespace WorkInProgress.Services.MyCategory.MyService.Common.Api;

public interface IMyServiceApi {
    Task<string?> Ping(string? expectedResponse);
    Task<GetWidgetResponse?> GetWidget(GetWidgetRequest? request);
    Task<Widget?> CreateWidget(Widget? widget);
    Task<Widget?> UpdateWidget(Widget? widget);
    Task DeleteWidget(string? id);
}
```

Rules:

- All return types are `Task<T?>` (operations return `null` when `Begin` fails)
- Request/response model classes live in the same `Api/` folder
- A separate `IMyServiceClient.cs` interface extending the API interface is the marker type used by the REST client factory

---

### 4. `src/Service/MyService.cs` — Service Class

Inherits `ManagedService`. Manages lifecycle, builds the operation dependency provider, publishes endpoints. Contains no business logic.

```csharp
namespace WorkInProgress.Services.MyCategory.MyService.Service;

using WorkInProgress.Lib.Services.Chassis.Service;
using WorkInProgress.Lib.Services.Common.Service;
using WorkInProgress.Lib.Services.Chassis.Common.Service;
using WorkInProgress.Lib.Common.Essentials.Collections;
using WorkInProgress.Lib.Telemetry.Logging.Common;
using ServiceConstants = Common.Constants;

internal class MyService : ManagedService {
    private IDependencyProvider? operationDependencies;
    private IDependencyProvider OperationDependencies =>
        this.operationDependencies ?? throw new InvalidOperationException("Service has not been started.");

    public MyService(IDependencyProvider dependencyProvider)
        : base(ServiceConstants.ServiceIdentifier, dependencyProvider) { }

    protected override Task OnStart(ILoggerSession _) {
        // Simple case — no shared state to inject into operations:
        this.operationDependencies = GetDefaultOperationsDependencyProvider();

        // — OR — if operations need shared state (e.g. a database connection, in-memory store):
        this.operationDependencies = FromDependencyProvider()
            .WithAll()
            .Create();

        return Task.CompletedTask;
    }

    protected override void PublishEndpoints(IEndpointPublisher endpointPublisher) {
        IMyApiOperation createOperation(CallContext callContext) =>
            CreateOperation<IMyApiOperation>(
                new OperationContext(
                    OperationDependencies,
                    CancellationToken,
                    callContext.MetaData
                    // , optionalExtraValuesContainer  ← add if passing shared state
                )
            );

        endpointPublisher.PublishQueryMethod(
            createOperation,
            ServiceConstants.Endpoints.Ping,
            ServiceConstants.CurrentMajorVersion,
            async (context, operation) => await operation.Ping(context.Parameters.GetSafeValue("expectedResponse"))
        );

        endpointPublisher.PublishQueryMethod(
            createOperation,
            ServiceConstants.Endpoints.GetWidget,
            ServiceConstants.CurrentMajorVersion,
            async (context, operation) => await operation.GetWidget(GetWidgetRequest.From(context.Parameters))
        );

        endpointPublisher.PublishCreationMethod<IMyApiOperation, Widget>(
            createOperation,
            ServiceConstants.Endpoints.CreateWidget,
            ServiceConstants.CurrentMajorVersion,
            async (context, operation, body) => await operation.CreateWidget(body)
        );

        endpointPublisher.PublishMutationMethod<IMyApiOperation, Widget>(
            createOperation,
            ServiceConstants.Endpoints.UpdateWidget,
            ServiceConstants.CurrentMajorVersion,
            async (context, operation, body) => await operation.UpdateWidget(body)
        );

        endpointPublisher.PublishDeletionMethod(
            createOperation,
            ServiceConstants.Endpoints.DeleteWidget,
            ServiceConstants.CurrentMajorVersion,
            async (context, operation) => await operation.DeleteWidget(context.Parameters.GetSafeValue("id"))
        );
    }
}
```

#### Lifecycle Hook Methods

Override as needed (all are optional):

| Method | When Called | Typical Use |
|--------|-------------|-------------|
| `OnStart(logger)` | Service starting | Load config, start daemons, build operation deps |
| `OnReady(logger)` | After entering Running state | Post-startup tasks |
| `OnPause(logger)` | Pausing (in-flight still drains) | Signal daemons to stop accepting work |
| `OnStop(logger)` | Stopping | Drain queues, flush state |
| `OnStopped(logger)` | After stop completes | Final cleanup |

#### Endpoint Publisher Methods

| Method | HTTP | Use For |
|--------|------|---------|
| `PublishQueryMethod` | GET | Read-only queries |
| `PublishCreationMethod<TOp, TBody>` | POST | Create resources |
| `PublishMutationMethod<TOp, TBody>` | PUT | Update/replace resources |
| `PublishDeletionMethod` | DELETE | Delete resources |

**Validating path variables vs. body in mutation endpoints:**

```csharp
endpointPublisher.PublishMutationMethod<IMyApiOperation, Widget>(
    createOperation, ServiceConstants.Endpoints.UpdateWidget, ServiceConstants.CurrentMajorVersion,
    async (context, operation, body) => {
        var id = context.Parameters.GetSafeValue("id");
        if (id != body?.Id) {
            (operation as IManagedOperation)?.SetOperationResult(
                OperationResultCode.BadRequest, $"Path id '{id}' does not match body id '{body?.Id}'");
            return;
        }
        await operation.UpdateWidget(body);
    }
);
```

---

### 5. `src/Service/MyServiceFactory.cs`

```csharp
namespace WorkInProgress.Services.MyCategory.MyService.Service;

using WorkInProgress.Lib.Services.Common.Service;

public class MyServiceFactory : IManagedServiceFactory {
    private static readonly IManagedServiceFactory Singleton = new MyServiceFactory();
    public static IManagedServiceFactory CreateFactory() => Singleton;

    IManagedService IManagedServiceFactory.CreateService(IDependencyProvider dependencyProvider)
        => new MyService(dependencyProvider);
}
```

---

### 6. `src/Service/IMyApiOperation.cs` — Operation Interface

Combines `IManagedOperation` with the API contract. Used by both the service and tests.

```csharp
namespace WorkInProgress.Services.MyCategory.MyService.Service;

using WorkInProgress.Lib.Services.Common.Service;
using WorkInProgress.Services.MyCategory.MyService.Common.Api;

public interface IMyApiOperation : IManagedOperation, IMyServiceApi { }
```

---

### 7. `src/Service/OperationFactories.cs` — Operation Factory

```csharp
namespace WorkInProgress.Services.MyCategory.MyService.Service;

using WorkInProgress.Lib.Services.Common.Service;

public class MyApiOperationFactory : IOperationFactory<IMyApiOperation> {
    IMyApiOperation IOperationFactory<IMyApiOperation>.CreateOperation(IOperationContext context)
        => new MyApiOperation(context);
}
```

---

### 8. `src/Service/MyApiOperations.cs` — Operation Class

Inherits `ManagedOperation`. Every public API method follows the `Begin → work → End` pattern.

```csharp
namespace WorkInProgress.Services.MyCategory.MyService.Service;

using WorkInProgress.Lib.Services.Chassis.Service;
using WorkInProgress.Lib.Services.Common;
using WorkInProgress.Lib.Services.Common.Service;
using WorkInProgress.Services.MyCategory.MyService.Common;
using WorkInProgress.Services.MyCategory.MyService.Common.Api;

internal class MyApiOperation : ManagedOperation, IMyApiOperation {

    public MyApiOperation(IOperationContext context)
        : base(Constants.ServiceIdentifier, context, OperationBehaviorFlags.None) { }

    async Task<string?> IMyServiceApi.Ping(string? expectedResponse) {
        if (!await Begin()) return null;
        return await End(expectedResponse ?? "PONG");
    }

    async Task<Widget?> IMyServiceApi.CreateWidget(Widget? widget) {
        if (!await Begin(() => widget != null)) return null;

        var newWidget = new Widget { Id = Identifiers.Create(), Description = widget!.Description };
        // ... persist ...
        return await End(newWidget);
    }

    async Task<GetWidgetResponse?> IMyServiceApi.GetWidget(GetWidgetRequest? request) {
        if (!await Begin()) return null;
        // ... fetch ...
        return await End(new GetWidgetResponse { Widgets = [] });
    }

    async Task<Widget?> IMyServiceApi.UpdateWidget(Widget? widget) {
        if (!await Begin(() => widget?.Id != null)) return null;
        // ... if not found:
        // return await End<Widget>(OperationResultCode.NotFound);
        return await End(widget!);
    }

    async Task IMyServiceApi.DeleteWidget(string? id) {
        if (!await Begin(() => !string.IsNullOrWhiteSpace(id))) return;
        // ... delete ...
        await End();
    }

    protected override Task OnUnsuccessful() {
        if (ResultCode != OperationResultCode.Error)
            Logger.LogError($"{ResultCode}: {ResultMessage ?? string.Empty}");
        return Task.CompletedTask;
    }
}
```

#### Begin Overloads

| Call | Meaning |
|------|---------|
| `await Begin()` | No validation |
| `await Begin(() => condition)` | `true` = valid, `false` = bad request |
| `await Begin(() => condition ? null : "error message")` | null string = valid, non-null = error message |
| `await Begin("OperationName", () => ...)` | Explicit operation name override |
| `await Begin(new MyValidator(param))` | `IParamValidator` for complex validation |

If `Begin` returns `false`, the operation result is already set — return immediately without doing any work.

#### End Overloads

| Call | Meaning |
|------|---------|
| `await End()` | Success, no data |
| `await End(data)` | Success with data |
| `await End(data, OperationResultCode.Success)` | Explicit code + data |
| `await End(OperationResultCode.NotFound)` | Failure, no data |
| `await End(OperationResultCode.Problem, "message")` | Failure with message |
| `await End<T>(OperationResultCode.NotFound)` | Typed failure (when return type is `Task<T?>`) |

#### Result Codes → HTTP Status

| `OperationResultCode` | HTTP Status |
|-----------------------|-------------|
| `Success` | 200 / 201 |
| `BadRequest` | 400 |
| `NotFound` | 404 |
| `Problem` | 500 |
| `Error` | 500 |

Always use `End(resultCode)` for failures — do not throw exceptions. Unhandled exceptions in an operation are caught by the chassis and recorded as `Problem`.

#### Protected Properties Available in Operations

| Property | Type | Description |
|----------|------|-------------|
| `Logger` | `ILoggerSession` | Scoped logger for this operation |
| `DependencyProvider` | `IDependencyProvider` | Service-level dependencies |
| `ConfigProvider` | `IConfigProvider` | Load config files |
| `CancellationToken` | `CancellationToken` | Service cancellation |
| `ResultCode` | `OperationResultCode` | The outcome after `End` is called |
| `ResultMessage` | `string?` | Optional outcome message |
| `MetaData` | `IReadOnlyDictionary<string,string>` | Request metadata (correlation ID, etc.) |
| `MessagePublisher` | `IServiceEventPublisher` | Publish events |

---

### 9. Passing Shared State to Operations (`ValuesContainer`)

Use when all operations in a service need access to shared state (DB connections, in-memory stores, loaded config).

**In the service constructor:**

```csharp
private readonly Lazy<IValuesContainer> operationValuesLazy;

public MyService(IDependencyProvider dependencyProvider) : base(...) {
    this.operationValuesLazy = new Lazy<IValuesContainer>(() => {
        var values = new ValuesContainer();
        values.Set(this.mySharedThing);   // keyed by type
        return values;
    });
}
```

**Pass it in `PublishEndpoints`:**

```csharp
IMyApiOperation createOperation(CallContext callContext) =>
    CreateOperation<IMyApiOperation>(
        new OperationContext(
            OperationDependencies,
            CancellationToken,
            callContext.MetaData,
            this.operationValuesLazy.Value   // ← extra values
        )
    );
```

**Read in the operation constructor:**

```csharp
public MyApiOperation(IOperationContext context) : base(...) {
    this.mySharedThing = context.Extra.Get<MySharedThingType>();
}
```

---

### 10. Loading Config

```csharp
// Config class (in Common or Service)
public class MyServiceConfig {
    public string DatabaseName { get; set; } = "";
    public int MaxPageSize { get; set; } = 100;
}

// In OnStart (reads "service.mycategory.myservice.json")
protected override async Task OnStart(ILoggerSession logger) {
    var config = await GetConfig<MyServiceConfig>(logger);
    // ...
}

// In an operation
var config = await ConfigProvider.GetConfig<MyServiceConfig>(ServiceName, Logger);
```

Config file name is derived from `ServiceName` (`"service." + ServiceIdentifier`).

---

### 11. `src/Service/Plugins.cs` — Plugin Global Usings

Plugin extension methods are made available via global usings in this file. It is managed by the `.repo/add-plugins.sh` script but can be edited manually.

```csharp
// Plugins.cs — add one pair of global usings per plugin in use
global using WorkInProgress.Lib.Services.DocumentData;
global using WorkInProgress.Lib.Services.DocumentData.Common;
global using WorkInProgress.Lib.Services.ServiceMessaging;
global using WorkInProgress.Lib.Services.ServiceMessaging.Common;
```

A corresponding block is added to the test project's global usings for the `.Testing` package.

---

### 12. Background Daemons

Use `CreateBackgroundDaemon<TPayload>` for queue-based background work.

**Create the daemon in `OnStart`:**

```csharp
private IBackgroundOperationDaemon<MyPayload>? myDaemon;

protected override Task OnStart(ILoggerSession logger) {
    this.operationDependencies = FromDependencyProvider().WithAll().Create();

    this.myDaemon = CreateBackgroundDaemon<MyPayload>(
        "my-daemon-name",
        (context, payload) => new MyDaemonOperation(context, payload)
    );

    return Task.CompletedTask;
}
```

The factory lambda `(context, payload) => new MyDaemonOperation(context, payload)` creates a `ManagedOperation` subclass per message. The daemon and the operation follow the same Begin/End lifecycle as API operations.

**Route events to the daemon (most common):**

```csharp
await SubscribeToEvent(
    WidgetEvents.Created,
    this.myDaemon,
    envelope => new MyPayload { EntityId = envelope.Entities[0].Id }
);
```

**Route events directly to an operation (no queue, lightweight):**

```csharp
await SubscribeToEvent<IMyApiOperation>(
    WidgetEvents.Created,
    (envelope, operation) => operation.HandleWidgetCreated(envelope)
);
```

**Manually post to a daemon (e.g. from an API operation):**

```csharp
// In an API operation — the service passes the daemon via ValuesContainer
this.myDaemon.PostMessages(Logger, new[] { new DaemonMessage<MyPayload>(new MyPayload { ... }) });
this.myDaemon.Trigger();
```

For timer-triggered and job-scheduled daemons, see [03-Service-Plugins.md § Timers](./03-Service-Plugins.md) and [§ Job Scheduling](./03-Service-Plugins.md).

---

### 13. `src/Client.Rest/MyServiceRestClient.cs`

Implements the service's Common API interface using HTTP. Inherits `ServiceRestClient`.

```csharp
namespace WorkInProgress.Services.MyCategory.MyService.Client;

using RestSharp;
using WorkInProgress.Lib.Services.Chassis.Client.Rest;
using WorkInProgress.Lib.Services.Chassis.Client.Rest.Util;
using WorkInProgress.Lib.Telemetry.Logging.Common;
using WorkInProgress.Services.MyCategory.MyService.Common;
using WorkInProgress.Services.MyCategory.MyService.Common.Api;

public class MyServiceRestClient : ServiceRestClient, IMyServiceClient {

    public MyServiceRestClient(IRestClient restClient, ILoggerSession? logger = null)
        : base(restClient, Constants.ServiceIdentifier, Constants.CurrentMajorVersion, logger) { }

    public MyServiceRestClient(RestClientConfig config, ILoggerSession? logger = null)
        : base(Constants.ServiceIdentifier, Constants.CurrentMajorVersion, config, logger) { }

    Task<string?> IMyServiceApi.Ping(string? expectedResponse) =>
        ExecuteGet<string?>(new ExecutionRequest {
            ResourceTemplate = Constants.Endpoints.Ping,
            ResourceParameters = new ResourceParametersBuilder().AddParameter("expectedResponse", expectedResponse).Build()
        });

    Task<GetWidgetResponse?> IMyServiceApi.GetWidget(GetWidgetRequest? request) =>
        ExecuteGet<GetWidgetResponse>(new ExecutionRequest {
            ResourceTemplate = request?.Id == null ? Constants.Endpoints.GetAllWidgets : Constants.Endpoints.GetWidget,
            ResourceParameters = new ResourceParametersBuilder().AddParameter("id", request?.Id).Build()
        });

    Task<Widget?> IMyServiceApi.CreateWidget(Widget? widget) =>
        ExecutePost<Widget>(new ExecutionRequest {
            ResourceTemplate = Constants.Endpoints.CreateWidget,
            Body = widget
        });

    Task<Widget?> IMyServiceApi.UpdateWidget(Widget? widget) =>
        ExecutePut<Widget>(new ExecutionRequest {
            ResourceTemplate = Constants.Endpoints.UpdateWidget,
            ResourceParameters = new ResourceParametersBuilder().AddParameter("id", widget?.Id).Build(),
            Body = widget
        });

    Task IMyServiceApi.DeleteWidget(string? id) =>
        ExecuteDelete(new ExecutionRequest {
            ResourceTemplate = Constants.Endpoints.DeleteWidget,
            ResourceParameters = new ResourceParametersBuilder().AddParameter("id", id).Build()
        });
}
```

`ExecutionRequest` fields: `ResourceTemplate` (path), `ResourceParameters` (path vars + query), `Body` (POST/PUT body). `ResourceParametersBuilder.AddParameter(key, value)` omits null values automatically.

---

### 14. `src/Client.Rest/MyServiceRestClientFactory.cs`

```csharp
namespace WorkInProgress.Services.MyCategory.MyService.Client;

using WorkInProgress.Lib.Services.Chassis.Client.Rest;
using WorkInProgress.Lib.Services.Common.Client;
using WorkInProgress.Services.MyCategory.MyService.Common.Api;

public class MyServiceRestClientFactory : ServiceRestClientFactory<IMyServiceClient> {
    public static IServiceClientFactory<IMyServiceClient> Create() => new MyServiceRestClientFactory();

    protected override IMyServiceClient CreateNewClient(RestClientConfig config)
        => new MyServiceRestClient(config);
}
```

Register in the consuming service's `Program.cs`:

```csharp
.AddServiceClientFactory(MyServiceRestClientFactory.Create())
```

Access in an operation:

```csharp
var client = DependencyProvider.Get<IMyServiceClient>();
var widget = await client.GetWidget(new GetWidgetRequest { Id = id });
```

---

### 15. Testing Operations

Operations are plain objects — tested by constructing them directly. No service startup required.

**`test/Operations/ApiOperation/TestBase.cs`:**

```csharp
using System.Collections.Concurrent;
using WorkInProgress.Lib.Common.Essentials.Collections;
using WorkInProgress.Lib.Common.Essentials.Tasks;
using WorkInProgress.Lib.Services.Chassis.Common.Service;
using WorkInProgress.Lib.Services.Chassis.Test;
using WorkInProgress.Lib.Services.Common.Service;
using WorkInProgress.Services.MyCategory.MyService.Common.Api;
using WorkInProgress.Services.MyCategory.MyService.Service;

public class TestBase {
    private IDependencyProvider DependencyProvider { get; }
    protected ConcurrentDictionary<string, Widget> MockWidgets = new();

    public TestBase() {
        MockWidgets.TryAdd("1", new Widget { Id = "1", Description = "Test Widget" });

        DependencyProvider = TaskUtil.RunAsyncAsSync(() =>
            TestDependencyBuilder.Create()
                .AddAllOperationCommon()   // ← lighter than AddAllServiceCommon
                .Build()
        );
    }

    protected IMyApiOperation CreateApiOperation() {
        var values = new ValuesContainer();
        values.Set(this.MockWidgets);
        return new MyApiOperation(
            new OperationContext(DependencyProvider, CancellationToken.None, new Dictionary<string, string>(), values)
        );
    }
}
```

**`test/Operations/ApiOperation/GetWidgetTests.cs`:**

```csharp
[TestClass]
public class GetWidgetTests : TestBase {

    [TestMethod]
    public async Task SucceedsGettingWidget() {
        var operation = CreateApiOperation();

        var response = await operation.GetWidget(new GetWidgetRequest { Id = "1" });

        operation.ResultCode.Should().Be(OperationResultCode.Success);
        response.Should().NotBeNull();
    }

    [TestMethod]
    public async Task FailsWithNotFoundWhenMissing() {
        var operation = CreateApiOperation();

        var response = await operation.GetWidget(new GetWidgetRequest { Id = "999" });

        operation.ResultCode.Should().Be(OperationResultCode.NotFound);
        response.Should().BeNull();
    }
}
```

**Testing patterns:**

- Use `TestDependencyBuilder.Create().AddAllOperationCommon().Build()` for operation tests (lighter weight)
- Inject mock state via `ValuesContainer` — same mechanism as production
- Always assert `operation.ResultCode` as well as the return value — result code determines HTTP status
- Use `TaskUtil.RunAsyncAsSync(...)` in `TestBase` constructor to keep it synchronous
- Target 100% coverage — every `Begin` validation branch, every `NotFound` path, every error path

For plugins that need mocking in operation tests, add the mock to `TestDependencyBuilder` (see [03-Service-Plugins.md](./03-Service-Plugins.md) for per-plugin test setup).

---

### 16. Testing the Service

Service-level tests verify lifecycle and endpoint wiring, not business logic.

**`test/ServiceMain/StartingAndStopping.cs`:**

```csharp
[TestClass]
public class StartingAndStopping {
    private IDependencyProvider? dependencyProvider;

    [TestInitialize]
    public async Task TestInit() {
        this.dependencyProvider = await TestDependencyBuilder.Create()
            .AddAllServiceCommon()             // ← registers mock messaging so service can start
            .AddOperationFactory(new MyApiOperationFactory())
            .Build();
    }

    [TestMethod]
    public async Task Starts_and_stops_without_error() {
        var service = MyServiceFactory.CreateFactory().CreateService(this.dependencyProvider!);

        await service.Start();
        await service.Stop();

        service.State.Should().Be(ServiceState.Stopped);
    }
}
```

`AddAllServiceCommon()` registers mock messaging infrastructure — without it the service cannot start (it requires a message broker connection).

---

## Logging Reference

`ILoggerSession` is available as `this.Logger` in operations and as the parameter in service lifecycle methods.

| Method | When to Use |
|--------|-------------|
| `Logger.LogTrace()` | Happy-path success — normal completion |
| `Logger.LogDebug("msg", data: json)` | Debug-only diagnostic info |
| `Logger.LogInformation("msg")` | Noteworthy operational events |
| `Logger.LogWarning("msg")` | Unexpected but recoverable conditions |
| `Logger.LogError("msg")` | Failures and error conditions |
| `Logger.LogCritical("msg")` | Service-threatening conditions |

The `data` parameter accepts a JSON string for structured context.
