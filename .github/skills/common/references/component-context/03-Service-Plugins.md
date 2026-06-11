# Service Plugins Reference

> **Context brief for AI agents.** Use this when delegating implementation tasks that involve adding plugins to a service, or when looking up the exact calls needed for a plugin feature.
>
> For how to wire `Program.cs` and the service class, see [02-Service-Implementation.md](./02-Service-Implementation.md).

---

## Plugin System Overview

Plugins extend the chassis with optional functionality. They are:

- **NuGet packages** — three per plugin: `.Common` (interfaces), main package (extensions + impl), `.Testing` (mocks)
- **Extension methods** — plugins expose methods via C# extension methods on `IPluginServiceHost` (implemented by `ManagedService`) and `IPluginOperationHost` (implemented by `ManagedOperation`)
- **Registered in `Program.cs`** via `Add*()` methods on `IPluginDependencyBuilder` (the `DependencyBuilder` from `AddAllCommon` onwards)
- **Made available** via global usings in `src/Service/Plugins.cs` — add one pair of `global using` lines per plugin

### `src/Service/Plugins.cs` Pattern

```csharp
// Plugins.cs — add one pair per plugin in use
global using WorkInProgress.Lib.Services.DocumentData;
global using WorkInProgress.Lib.Services.DocumentData.Common;
```

In the test project, add a matching block for the `.Testing` package:

```csharp
// test/GlobalUsings.cs (or similar)
global using WorkInProgress.Lib.Services.DocumentData;
global using WorkInProgress.Lib.Services.DocumentData.Common;
global using WorkInProgress.Lib.Services.DocumentData.Testing;
```

### Plugin Host Interfaces

| Interface | Implemented By | Exposes Plugin Methods To |
|-----------|----------------|--------------------------|
| `IPluginServiceHost` | `ManagedService` | Service lifecycle methods (`OnStart`, etc.) |
| `IPluginOperationHost` | `ManagedOperation` | Operation methods (`Begin`/`End` scope) |
| `IPluginDependencyBuilder` | `DependencyBuilder` | `Program.cs` registration |

---

## DocumentData (MongoDB)

**What it provides:** MongoDB document database access. The standard persistence mechanism for services.

**Backing library:** `lib.cs.backing.document-data`

**Packages:**

| Package | Reference From |
|---------|----------------|
| `WorkInProgress.Lib.Services.DocumentData` | Service + Host projects |
| `WorkInProgress.Lib.Services.DocumentData.Common` | Transitively included |
| `WorkInProgress.Lib.Services.DocumentData.Testing` | Test project only |

**Environment variable:** `DOCUMENT_SERVER` — MongoDB connection string (e.g. `mongodb://localhost:27017`)

### Registration (`Program.cs`)

```csharp
.AddDocumentData()
```

### Global Usings (`Plugins.cs`)

```csharp
global using WorkInProgress.Lib.Services.DocumentData;
global using WorkInProgress.Lib.Services.DocumentData.Common;
```

### Usage in Service (`OnStart` or lifecycle)

```csharp
var connection = this.GetDocumentConnection("my-database");
var collection = await connection.GetCollection<MyEntity>("my-collection");
```

### Usage in Operations

```csharp
var connection = this.GetDocumentConnection("my-database");
var collection = await connection.GetCollection<MyEntity>("my-collection");

// Insert
await collection.InsertDocument(new MyEntity { ... });

// Query with filter
var cursor = await collection.FindDocuments()
    .Filter(e => e.Status == "Active")
    .AddSort(e => e.CreatedAt, ascending: false)
    .Skip(0).Limit(20)
    .Create();
var results = await cursor.DiscardToList();

// Update
await collection.UpdateDocument(
    e => e.Id == id,
    update => update.Set(e => e.Status, "Inactive")
);

// Delete
await collection.DeleteDocument(e => e.Id == id);
```

### Transactions

```csharp
using var tx = await connection.BeginTransaction();
try {
    var orders = await connection.GetCollection<Order>("orders", tx.RollbackId);
    await orders.InsertDocument(newOrder);
    await tx.Commit();
} catch {
    await tx.Rollback();
    throw;
}
```

### Testing Mock

```csharp
// In TestBase or TestInitialize:
var mockFactory = new MockDocumentDbConnectionFactory();
// Use in-memory test database via the testing package helpers
builder.AddDocumentData(mockFactory);
```

---

## DictionaryData (Redis)

**What it provides:** Redis-backed key-value storage and persistent daemon message queues.

**Backing library:** `lib.cs.backing.dictionary-data`

**Packages:**

| Package | Reference From |
|---------|----------------|
| `WorkInProgress.Lib.Services.DictionaryData` | Host project |
| `WorkInProgress.Lib.Services.DictionaryData.Common` | Transitively included |
| `WorkInProgress.Lib.Services.DictionaryData.Testing` | Test project only |

**Environment variable:** `DICTIONARY_SERVER` — Redis endpoint (`host:port`, e.g. `redis:6379`)

### Registration (`Program.cs`)

```csharp
.AddDictionaryData()
```

### What Gets Registered

| Type | Purpose |
|------|---------|
| `IDictionaryConnectionFactory` | Create Redis connections for key-value ops |
| `IDaemonMessageStore` | Persistent daemon queues — all daemons automatically use this |

Once `IDaemonMessageStore` is registered, every daemon created via `CreateBackgroundDaemon` persists its messages in Redis across restarts.

### Usage

```csharp
var factory = DependencyProvider.Get<IDictionaryConnectionFactory>();
using var conn = factory.CreateConnection(databaseNum: 0);

await conn.ValueSet("key", "value");
var val = await conn.ValueGet("key");
await conn.HashSet("hash", "field", "value");
```

### Testing Mock

```csharp
var mockFactory = new Mock<IDictionaryConnectionFactory>();
var mockStore = new Mock<IDaemonMessageStore>();
builder.AddDictionaryData(mockFactory.Object, mockStore.Object);
```

Integration tests can use `RedisContainerManager` (from the Testing package) to spin up a real Redis container via Docker Testcontainers.

---

## ServiceMessaging (NATS Events)

**What it provides:** NATS-backed publish/subscribe for service events. Enables event-driven communication between services.

**Backing library:** `lib.cs.backing.process-messaging` (NATS)

**Packages:**

| Package | Reference From |
|---------|----------------|
| `WorkInProgress.Lib.Services.ServiceMessaging` | Service + Host projects |
| `WorkInProgress.Lib.Services.ServiceMessaging.Common` | Transitively included |
| `WorkInProgress.Lib.Services.ServiceMessaging.Testing` | Test project only |

**Environment variable:** `MESSAGE_BROKER_SERVER` — NATS server URL. **Required** — service fails to start if absent.

### Registration (`Program.cs`)

```csharp
.AddServiceMessaging()
```

### Global Usings (`Plugins.cs`)

```csharp
global using WorkInProgress.Lib.Services.ServiceMessaging;
global using WorkInProgress.Lib.Services.ServiceMessaging.Common;
```

### Publishing Events

Register a publisher topic in `OnStart`, then publish from operations or service methods:

```csharp
// In OnStart:
await MessagePublisher.Register("widget-events", new ServicePublisherOptions {
    DeduplicationWindow = TimeSpan.FromMinutes(2),
    MaxAge = TimeSpan.FromHours(24),
    DiscardMessagesWhenNoInterest = true
});

// In an operation (via RaiseEvent convenience wrapper):
await RaiseEvent(
    EventEnvelope.CreateEventCreated("Widget", new[] { widgetRef }),
    metaData: MetaData,
    logger: Logger
);

// Or directly:
await MessagePublisher.Publish("widget-events", envelope, headers);
```

### Subscribing to Events

```csharp
// In OnStart — route to daemon (most common for non-trivial work):
await SubscribeToEvent(
    WidgetEvents.Created,
    this.syncDaemon,
    envelope => new MyPayload { EntityId = envelope.Entities[0].Id }
);

// Route directly to an operation (lightweight, no queue):
await SubscribeToEvent<IWidgetOperation>(
    WidgetEvents.Created,
    (envelope, operation) => operation.HandleWidgetCreated(envelope)
);

// Subscribe + auto-pull sync data:
await SubscribeToEventWithSync("widgets.widget-data", WidgetEvents.Updated);
```

### Testing

Two mock levels are available:

**Chassis mocks** (verify publishing was called — lighter):

```csharp
// Included automatically via TestDependencyBuilder.AddAllServiceCommon()
// The mock publisher/subscriber are registered; no extra setup needed
```

**Plugin mocks** (full message flow with realistic serialization):

```csharp
var mockFactory = new MockServiceMessagingFactory();
builder.AddServiceMessaging(mockFactory);

// Inject test messages
mockFactory.AddMessage("widget-events", envelope);
await mockFactory.TriggerMessage("widget-events", envelope);

// Assert publication
mockFactory.AssertMessagePublishedOnce("widget-events");
mockFactory.AssertMessageCount(2, topic: "widget-events");

// Intercept published messages
mockFactory.OnMessagePublish = (topic, envelope, meta) => {
    Assert.AreEqual("widget-events", topic);
};
```

Use chassis mocks for unit tests ("did my service publish?"). Use plugin mocks for integration-style tests ("does my handler correctly process a message end-to-end?").

---

## Sagas

**What it provides:** Multi-step operations with automatic rollback (Saga pattern). Use when an operation spans multiple external calls or document writes that must roll back atomically on failure.

**Packages:**

| Package | Reference From |
|---------|----------------|
| `WorkInProgress.Lib.Services.Sagas` | Service project |
| `WorkInProgress.Lib.Services.Sagas.Common` | Transitively included |
| `WorkInProgress.Lib.Services.Sagas.Testing` | Test project only |

### Registration (`Program.cs`)

```csharp
.AddSagas()
```

### Global Usings (`Plugins.cs`)

```csharp
global using WorkInProgress.Lib.Services.Sagas;
global using WorkInProgress.Lib.Services.Sagas.Common;
```

### Basic Usage (in an operation)

```csharp
await this.BeginSaga("CreateOrder", () => ValidateRequest())
    .Action(ctx => CreateOrder(), identifier: "create_order")
    .Action(ctx => ReserveInventory(), identifier: "reserve")
    .Action(ctx => ProcessPayment(), identifier: "payment")
    .End();
```

Nothing executes until `.End()` is called. The validation lambda (second arg to `BeginSaga`) follows the same rules as `Begin` — return `null` for valid, or an error string for invalid.

### With Rollback

```csharp
await this.BeginSaga("OrderFlow")
    .Action(
        async ctx => await ReserveInventoryAsync(),
        rollback: async ctx => await ReleaseInventoryAsync(),
        identifier: "reserve"
    )
    .Action(
        async ctx => await ChargeCardAsync(),
        rollback: async ctx => await RefundCardAsync(),
        identifier: "charge"
    )
    .End();
```

Rollbacks execute in **reverse order** — only for steps that had already completed successfully.

### Returning a Result

```csharp
// Return an explicit value:
var order = await this.BeginSaga("CreateOrder")
    .Action(ctx => { ctx.SetValue(new Order { Id = "123" }); }, identifier: "create")
    .End<Order>();  // returns ctx.GetValue<Order>()

// Return directly:
var order = await this.BeginSaga("CreateOrder")
    .Action(ctx => { }, identifier: "create")
    .End(new Order { Id = "123" });
```

### Value Store (pass data between steps)

```csharp
await this.BeginSaga("MultiStep")
    .Action(ctx => {
        ctx.SetValue(new Order { Id = "1" });          // by type
        ctx.SetValue<string>("note", "urgent");        // by key
    }, identifier: "step1")
    .Action(ctx => {
        var order = ctx.GetValue<Order>();              // by type
        var note = ctx.GetValue<string>("note");       // by key
    }, identifier: "step2")
    .End();
```

### Calling External Services

```csharp
await this.BeginSaga("ExternalFlow")
    .CallService<IPaymentClient>(
        async (ctx, client) => await client.Charge(amount),
        rollback: async (ctx, client) => await client.Refund(amount),
        identifier: "charge"
    )
    .End();
```

Clients are auto-created, injected, and disposed. Default retry: 5 attempts with delays `[100ms, 300ms, 1s, 5s, 10s]`.

### Document Transactions

```csharp
await this.BeginSaga("SaveData", documentDbConnectionFactory: () => dbConnection)
    .AccessDocuments(
        TransactionSafetyMode.Transactional,
        action: async (ctx, src) => {
            var orders = await src.GetCollection<Order>("orders");
            await orders.InsertDocument(newOrder);
        },
        identifier: "insert"
    )
    .End();
// Transaction commits automatically on success; rolls back on failure
```

### Raising Events in Sagas

```csharp
await this.BeginSaga("CreateOrder")
    .Action(ctx => CreateOrder(), identifier: "create")
    .RaiseEvent(
        ctx => EventEnvelope.CreateEventCreated("Order", new[] { orderRef }),
        rollback: async (ctx, raised) => await PublishCompensationEvent(raised),
        identifier: "notify"
    )
    .End();
```

### Early Exit

```csharp
.Action(ctx => {
    if (AlreadyDone()) {
        ctx.End(OperationResultCode.Success, "Already processed");
        ctx.Abort();  // stops saga without rollback
        return;
    }
    DoWork();
}, identifier: "check")
```

### Testing

```csharp
// In TestDependencyBuilder setup:
builder.AddSagas();

// Or use TestSagaBuilderFactory for isolated unit tests:
var sagaFactory = new TestSagaBuilderFactory();
builder.AddSagas(sagaFactory);
```

---

## Timers

**What it provides:** Background timer functionality — fire operations at regular intervals without cron scheduling.

**Backing library:** `lib.cs.engine.daemon` (auto-daemon infrastructure)

**Packages:**

| Package | Reference From |
|---------|----------------|
| `WorkInProgress.Lib.Services.Timers` | Service + Host projects |
| `WorkInProgress.Lib.Services.Timers.Common` | Reference explicitly |
| `WorkInProgress.Lib.Services.Timers.Testing` | Test project only |

### Registration (`Program.cs`)

```csharp
.AddTimers()
```

### Global Usings (`Plugins.cs`)

```csharp
global using WorkInProgress.Lib.Services.Timers;
global using WorkInProgress.Lib.Services.Timers.Common;
```

### Timer-Triggered Auto Daemon (most common)

Creates a daemon that fires at a fixed interval. Each firing creates a payload, posts it to the daemon's queue, and processes it via a `ManagedOperation`.

```csharp
// In OnStart — using a registered operation factory:
var daemon = this.CreateTimerAutoDaemon<CleanupPayload>(
    name: "CleanupDaemon",
    createPayload: () => new CleanupPayload { Timestamp = DateTime.UtcNow },
    getInterval: () => 60_000  // milliseconds
);
// Automatically registered with service lifecycle

// Or using an inline factory method:
var daemon = this.CreateTimerAutoDaemon<PingPayload>(
    name: "PingDaemon",
    createPayload: () => new PingPayload(),
    getInterval: () => 30_000,
    operationFactoryMethod: (envelope, ct) => new PingOperation(envelope.Message.Payload)
);
```

The `IBackgroundOperationFactory<TPayload>` must be registered in `Program.cs` (via `builder.Add<IBackgroundOperationFactory<TPayload>>(new MyFactory())`) if not using the inline method.

**Key parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `name` | required | Name for daemon and timer |
| `createPayload` | required | Factory called each time the timer fires |
| `getInterval` | required | Returns interval in milliseconds |
| `fireOnce` | `false` | Fire only once then stop |
| `canFireEvent` | `null` | Predicate — return `false` to skip a firing |
| `manageObjectWithServiceLifecycle` | `true` | Auto-register with service lifecycle |

### Raw Timer (lower-level)

```csharp
// In OnStart:
var timer = this.CreateTimer("MyTimer");
timer.SetParameters(delayMilliseconds: 5000, fireOnce: false);
timer.OnTimerEvent = (t) => { /* do work */ };
timer.Start();

// Stop in OnStop:
timer.Stop(blockUntilStopped: true);
```

### Testing

```csharp
var timerFactory = new MockBackgroundTimerFactory();
builder.AddTestTimers(timerFactory);

// After service start, get the mock timer by name:
var mockTimer = timerFactory.GetTimer("CleanupDaemon");
mockTimer.FireTimerEvent(force: true);  // Manually trigger
```

---

## JobScheduling

**What it provides:** Cron-like scheduled background processing — fire operations at specific times or intervals.

**Backing library:** `lib.cs.engine.job-scheduler`

**Packages:**

| Package | Reference From |
|---------|----------------|
| `WorkInProgress.Lib.Services.JobScheduling` | Service + Host projects |
| `WorkInProgress.Lib.Services.JobScheduling.Common` | Reference explicitly |
| `WorkInProgress.Lib.Services.JobScheduling.Testing` | Test project only |

### Registration (`Program.cs`)

```csharp
.AddJobScheduling()
// Optionally add job persistence (requires DictionaryData):
// .AddJobSchedulingStore()
```

### Global Usings (`Plugins.cs`)

```csharp
global using WorkInProgress.Lib.Services.JobScheduling;
global using WorkInProgress.Lib.Services.JobScheduling.Common;
```

### Job-Scheduled Auto Daemon (most common)

Creates a daemon that fires according to a job schedule. Each firing creates a payload and processes it via a `ManagedOperation`.

```csharp
// In OnStart:
var daemon = this.CreateJobEngineAutoDaemon<ReportPayload>(
    name: "DailyReportDaemon",
    jobEngineStore: null,   // pass IJobEngineStore for persistence across restarts
    createPayload: () => new ReportPayload { Date = DateTime.UtcNow.Date },
    getRecurrences: () => [JobRecurrence.Daily(hour: 2, minute: 0)]
);

// Using inline factory method:
var daemon = this.CreateJobEngineAutoDaemon<BackupPayload>(
    name: "WeeklyBackup",
    jobEngineStore: null,
    createPayload: () => new BackupPayload(),
    getRecurrences: () => [JobRecurrence.Weekly(DayOfWeek.Sunday, hour: 3, minute: 0)],
    operationFactoryMethod: (payload, dp) => new BackupOperation(payload)
);
```

### `JobRecurrence` Patterns

```csharp
JobRecurrence.Daily(hour: 2, minute: 0)             // Every day at 02:00
JobRecurrence.Hourly(minute: 15)                     // Every hour at :15
JobRecurrence.Weekly(DayOfWeek.Monday, hour: 9, minute: 0)  // Mondays at 09:00
JobRecurrence.Interval(TimeSpan.FromMinutes(30))     // Every 30 minutes
JobRecurrence.Cron("0 */6 * * *")                   // Cron expression (every 6 hours)
```

Multiple recurrences on one daemon:

```csharp
getRecurrences: () => [
    JobRecurrence.Daily(hour: 6, minute: 0),
    JobRecurrence.Daily(hour: 18, minute: 0)
]
```

**Key parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `name` | required | Name for daemon and job engine |
| `jobEngineStore` | `null` | `IJobEngineStore` for persistence (requires `AddJobSchedulingStore()`) |
| `createPayload` | required | Factory called each time a job fires |
| `getRecurrences` | required | Returns array of `IJobRecurrence` |
| `allowOverlapping` | `false` | Skip if previous execution still running |
| `canFireEvent` | `null` | Predicate — return `false` to skip a firing |
| `manageObjectWithServiceLifecycle` | `true` | Auto-register with service lifecycle |

### Job Persistence

When `IJobEngineStore` is provided, job state persists across restarts. Requires `AddJobSchedulingStore()` in `Program.cs` (which itself requires `AddDictionaryData()`).

```csharp
// In OnStart — get the store factory and create a store:
var storeFactory = this.TryGetJobEngineStoreFactory();
var store = storeFactory?.Create("DailyReportDaemon");

var daemon = this.CreateJobEngineAutoDaemon<ReportPayload>(
    name: "DailyReportDaemon",
    jobEngineStore: store,
    ...
);
```

### Testing

The Testing package re-exports `WorkInProgress.Lib.Engine.JobScheduler.Testing`:

```csharp
// Use mock job engine factory in tests:
builder.AddJobScheduling(new MockJobEngineFactory());
```

---

## FeatureFlags

**What it provides:** Runtime feature toggling — enable/disable code paths without redeployment.

**Packages:**

| Package | Reference From |
|---------|----------------|
| `WorkInProgress.Lib.Services.FeatureFlags` | Service project |
| `WorkInProgress.Lib.Services.FeatureFlags.Common` | Transitively included |
| `WorkInProgress.Lib.Services.FeatureFlags.Testing` | Test project only |

### Registration (`Program.cs`)

```csharp
// From config (reads endpoint from service config):
.AddFeatureFlagsFromConfig(configProvider)

// Explicit endpoint:
.AddFeatureFlags("https://config.example.com/feature-flags.json", cacheExpirationInSeconds: 300)
```

### Global Usings (`Plugins.cs`)

```csharp
global using WorkInProgress.Lib.Services.FeatureFlags;
global using WorkInProgress.Lib.Services.FeatureFlags.Common;
```

### Usage in Operations or Service

```csharp
// Simple check:
if (await this.IsFeatureFlagEnabled("new-checkout-flow")) {
    // New path
}

// Branch on flag:
var result = await this.GetFeatureFlagHandler().HandleFlag(
    "premium-pricing",
    enabledAction: () => CalculatePremiumPrice(),
    disabledAction: () => CalculateStandardPrice()
);
```

### Feature Flag JSON Format

The endpoint returns a JSON object with boolean flag values:

```json
{
    "new-checkout-flow": true,
    "premium-pricing": false,
    "beta-feature": true
}
```

### Testing

```csharp
// Register specific flags with known values:
builder.AddTestFeatureFlags(
    ("new-checkout-flow", true),
    ("premium-pricing", false)
);
```

---

## Plugin Quick Reference

| Plugin | `Add*()` call | Env Var | Key Method |
|--------|--------------|---------|------------|
| DocumentData | `.AddDocumentData()` | `DOCUMENT_SERVER` | `this.GetDocumentConnection("db")` |
| DictionaryData | `.AddDictionaryData()` | `DICTIONARY_SERVER` | `DependencyProvider.Get<IDictionaryConnectionFactory>()` |
| ServiceMessaging | `.AddServiceMessaging()` | `MESSAGE_BROKER_SERVER` | `RaiseEvent(...)`, `SubscribeToEvent(...)` |
| Sagas | `.AddSagas()` | — | `this.BeginSaga("name").Action(...).End()` |
| Timers | `.AddTimers()` | — | `this.CreateTimerAutoDaemon<T>(...)` |
| JobScheduling | `.AddJobScheduling()` | — | `this.CreateJobEngineAutoDaemon<T>(...)` |
| FeatureFlags | `.AddFeatureFlags(url)` | — | `await this.IsFeatureFlagEnabled("flag")` |
