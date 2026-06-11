# Service Architecture

> **Context brief for AI agents.** Use this when designing service domains, planning events, operations, and data flows — i.e. during blueprint creation or architecture-level design discussions.
>
> For implementation-level detail (how to wire code), see [02-Service-Implementation.md](./02-Service-Implementation.md).
> For plugin-specific usage, see [03-Service-Plugins.md](./03-Service-Plugins.md).

---

## What a Service Is

A service is a self-contained process that owns a domain of work. Every service is structured identically — same project layout, same base classes, same lifecycle — so contributors and AI agents do not need to re-learn the paradigm for each service. Services are stateless in their service class; all per-request state is confined to operations. Services communicate externally via a REST API (typed interface in Common), and with each other via events (NATS-backed pub/sub) and sync (pull-based data transfer).

---

## Project Layout

Every service repo contains exactly these four source projects plus tests:

```text
src/
  Common/        Interfaces, POCOs, constants, API contract — no implementation code
  Client.Rest/   REST client that implements the Common API interface
  Host/          Entry point (Program.cs): composition root, startup, DI wiring
  Service/       All business logic: ManagedService subclass, operations, daemons
test/
  ...            Unit tests; target 100% operation coverage
```

**Namespace convention:** `WorkInProgress.Services.<Category>.<ServiceName>.<Project>`
Example: `WorkInProgress.Services.Examples.HelloWorld.Service`

**Assembly name convention:** `WorkInProgress.Services.<Category>.<ServiceName>.<Project>.csproj`

**ServiceIdentifier** (in `Common/Constants.cs`) is a dot-separated lower-case string, e.g. `"Examples.helloworld"`. It is used in configuration file names and client discovery.

---

## Common Project

Contains no implementation. Defines the public contract of the service:

| File/Folder | Contents |
|-------------|----------|
| `Api/IMyServiceApi.cs` | Interface declaring all callable operations (the API contract) |
| `Api/IMyServiceClient.cs` | Extends the API interface — marks what the REST client implements |
| `Api/*.cs` | Request and response model classes (POCOs) |
| `Constants.cs` | `ServiceIdentifier`, `CurrentMajorVersion`, `Endpoints` (path strings) |
| `Enumerations.cs` | Service-specific enumerations |

The API interface uses `Task<T?>` return types. It must never have breaking changes — add new methods, never change existing signatures. Increment `CurrentMajorVersion` for breaking changes.

---

## API Categories

All API operations fall into one of five categories. Category determines the HTTP verb and endpoint publishing method:

| Category | HTTP Verb | Publisher Method | Use For |
|----------|-----------|-----------------|---------|
| Query | GET | `PublishQueryMethod` | Read data; no side effects |
| Creation | POST | `PublishCreationMethod<TOp, TBody>` | Create a new resource |
| Mutation | PUT | `PublishMutationMethod<TOp, TBody>` | Replace/update a resource |
| Deletion | DELETE | `PublishDeletionMethod` | Remove a resource |
| Command | POST | `PublishCommandMethod<TOp, TBody>` | Execute an action (non-CRUD) |

API responses must be fast — under 1–2 seconds as a norm, never over 10 seconds. Work that takes longer belongs in a [daemon](#daemons).

---

## Events

Events are lightweight pub/sub notifications published via NATS (through the `ServiceMessaging` plugin). They carry:

- Entity references (`Id`, `ChangeVersion`) — **not** full entity content
- An event type discriminator
- Optional small data values

**Key rule:** Events are notifications only. If a consumer needs the actual entity data, it fetches it via Sync. This keeps events small and decouples consumers from the producer's data schema.

### Event Consistency Model

NATS JetStream provides strong delivery guarantees but does not guarantee perfect delivery in all failure scenarios — an event may be lost in rare edge cases (e.g. a crash at the exact moment of publishing). Services therefore do not rely on events alone for consistency.

The standard event-handling pattern is to use the event as a *trigger for a Sync pull*, not to process the event payload directly. When a service receives an event from another service, it calls `SubscribeToEventWithSync` — this triggers a bulk sync of the relevant entity type, which fetches all changes since the last sync:

- If the event arrives → sync runs → state is current
- If an event is lost → the next event of that type triggers sync → no event is permanently missed, only delayed
- On startup, every consuming service performs a full bulk sync to establish a consistent baseline before processing begins

This provides eventual consistency without the complexity of a full event-sourcing architecture.

**When direct event processing is appropriate:**

- The consumer must react immediately (sub-second) and cannot absorb a sync round-trip
- The event data alone is sufficient — no entity lookup needed
- The occasional missed event is an acceptable tradeoff for the scenario

In these cases, the daemon or direct-operation routing patterns apply. Using sync as an additional backstop is still recommended where feasible.

### Event Descriptors

Events are defined as static descriptors (implementing `IEventDescriptor`) in the Common project of the publishing service:

```csharp
// src/Common/Events/WidgetEvents.cs
public static class WidgetEvents {
    public static readonly IEventDescriptor Created = new EventDescriptor("widgets.created");
    public static readonly IEventDescriptor Updated = new EventDescriptor("widgets.updated");
    public static readonly IEventDescriptor Deleted = new EventDescriptor("widgets.deleted");
}
```

### Event Envelope

An event envelope is created via `EventEnvelope.Create*()` helpers:

```csharp
// Created event — entity array
var envelope = EventEnvelope.CreateEventCreated("Widget", new[] { widgetRef });

// Updated event
var envelope = EventEnvelope.CreateEventUpdated("Widget", new[] { widgetRef });

// Deleted event
var envelope = EventEnvelope.CreateEventDeleted("Widget", new[] { entityId });
```

`widgetRef` is an object with `Id` (string) and optionally `ChangeVersion` (int). Full entity data does not go in the envelope.

### Publishing Events

Called from inside an operation or service method via the inherited `RaiseEvent`:

```csharp
await RaiseEvent(envelope, metaData: MetaData, logger: Logger);
```

Or via `MessagePublisher` directly:

```csharp
await MessagePublisher.Publish("widget-events", envelope, headers);
```

### Subscribing to Events

Registered in `OnStart` on the service:

```csharp
// Default pattern — trigger a Sync pull on each event (see Event Consistency Model above)
await SubscribeToEventWithSync("widgets.widget-data", WidgetEvents.Updated);

// Route to a background daemon — when direct event processing is needed and work is non-trivial
await SubscribeToEvent(
    WidgetEvents.Created,
    this.myDaemon,
    envelope => new WidgetSyncPayload { WidgetId = envelope.Entities[0].Id }
);

// Route directly to an operation — when direct processing is needed and work is lightweight
await SubscribeToEvent<IWidgetOperation>(
    WidgetEvents.Created,
    (envelope, operation) => operation.HandleWidgetCreated(envelope)
);
```

### Commands

Commands are the inverse of events — an actor publishes a command and any number of services respond. Use the same `MessagePublisher`/`MessageSubscriber` infrastructure with a command topic name. Commands are less common than events.

---

## Daemons

A daemon processes a queue of work messages in a background thread pool. Use daemons for:

- Work that takes more than a few seconds
- Work triggered by events that must not block the event subscriber
- Periodic/scheduled background tasks

Daemons have:

- A configurable thread count for parallel processing
- Optional persistence via Redis (`DictionaryData` plugin) so messages survive restarts
- A timer that can kick off processing on an interval (or it can be triggered manually)

Each message processed by a daemon is handled by a `ManagedOperation` subclass — so all the standard Begin/End lifecycle and logging applies.

**Creating a daemon** (in `OnStart`):

```csharp
// Standard daemon — triggered by event subscription or manually
this.syncDaemon = CreateBackgroundDaemon<MyPayload>(
    "widget-sync",
    (context, payload) => new MyDaemonOperation(context, payload)
);

// Timer-triggered auto daemon (via Timers plugin)
var daemon = this.CreateTimerAutoDaemon<MyPayload>(
    name: "PeriodicCleanup",
    createPayload: () => new MyPayload(),
    getInterval: () => 60_000  // ms
);

// Job-scheduled auto daemon (via JobScheduling plugin)
var daemon = this.CreateJobEngineAutoDaemon<MyPayload>(
    name: "DailyReport",
    jobEngineStore: null,
    createPayload: () => new MyPayload(),
    getRecurrences: () => [JobRecurrence.Daily(hour: 2, minute: 0)]
);
```

Daemons created via `CreateBackgroundDaemon` or the auto-daemon helpers are automatically registered with the service lifecycle (started/stopped with the service).

---

## Data Synchronization (Sync)

Sync is a pull-based data transfer mechanism. A service *publishes sync endpoints* to expose its entities; consumers *pull* from those endpoints when they need fresh data.

**How it works:**

1. The publishing service registers sync endpoints (e.g. `/_sync/1/widgets.widget-data`) in `OnStart` via `AddSync(new WidgetSyncHandler())`
2. Consumers subscribe to events from that service with `SubscribeToEventWithSync(syncId, eventDescriptor)` — on each event, they automatically pull fresh data from the sync endpoint
3. Data versioning: a service can publish multiple schema versions simultaneously (`SyncDataVersion` for what it publishes, `SourceDataVersion` for what a consumer requests) — allows gradual consumer migration

---

## Persistence

### Document Data (MongoDB) — standard persistence

Primary persistence mechanism. Provided by the `DocumentData` plugin wrapping `lib.cs.backing.document-data`.

- Connection configured via `DOCUMENT_SERVER` environment variable
- Accessed via `this.GetDocumentConnection("databaseName")` from service or operation
- Supports CRUD, filtering, sorting, pagination, transactions, projections

### Dictionary Data (Redis) — distributed key-value

Provided by the `DictionaryData` plugin wrapping `lib.cs.backing.dictionary-data`.

- Connection configured via `DICTIONARY_SERVER` environment variable
- Primarily used for: daemon message persistence (`IDaemonMessageStore`), distributed caches, shared counters
- Accessed via `IDictionaryConnectionFactory` from the dependency provider

---

## Environment Variables

Services are configured via environment variables and JSON config files. Standard variables:

| Variable | Required By | Value |
|----------|------------|-------|
| `DOCUMENT_SERVER` | DocumentData plugin | MongoDB connection string |
| `DICTIONARY_SERVER` | DictionaryData plugin | Redis endpoint (`host:port`) |
| `MESSAGE_BROKER_SERVER` | ServiceMessaging plugin | NATS server URL |

Config files are named `service.<ServiceIdentifier>.json` and loaded via `GetConfig<T>()` in `OnStart`.

---

## Logging

Logging uses session-based structured logging (`lib.cs.telemetry.logging`). Every operation and service method receives an `ILoggerSession` for the scope of that call. Do not share logger sessions across operations.

Available in a `ManagedOperation` as `this.Logger`. Available in `ManagedService` lifecycle methods as the `logger` parameter.

Log levels: `LogTrace` (happy path), `LogDebug`, `LogInformation`, `LogWarning`, `LogError`, `LogCritical`, `LogErratum`.

---

## Key Architectural Constraints

- **Services are stateless.** The service class holds no business state between requests. State lives in the database or in daemons' message queues.
- **Operations are stateful but ephemeral.** Each operation is created per-request and disposed after. Shared state (DB connections, config, in-memory stores) is passed in via `OperationContext.Extra`.
- **All significant work goes in operations.** Service lifecycle methods (`OnStart`, etc.) do wiring; operations do work.
- **Events carry refs, not data.** Consumers pull data via Sync if they need it.
- **100% unit test coverage** is the target for operations. Tests use `TestDependencyBuilder` and construct operations directly — no service startup required.
