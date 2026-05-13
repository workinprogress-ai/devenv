# Blueprint Template

Copy this skeleton verbatim and fill it in. All top-level headings are required, even if a section is intentionally short ("None" / "N/A" is acceptable).

```markdown
# Blueprint: <System Name>

<One paragraph: what this blueprint addresses and why. Reference the source
Requirements document, GitHub issue, or brief if applicable. State whether
this is greenfield or brownfield.>

**Status**: Draft | Approved | Superseded
**Source requirements**: <link to Requirements-*.md or issue, if any>
**Type**: Greenfield | Brownfield

## Revision History

### YYYY-MM-DD — Initial blueprint

---

## 1. Context

### 1.1 Problem Statement

<What problem the system solves, in business / user terms. Not technical.>

### 1.2 QoS Targets

| Concern | Target |
|---|---|
| Availability | <e.g. 99.9%> |
| p99 latency | <e.g. < 200ms> |
| Throughput | <e.g. 1000 rps sustained> |
| Scale | <expected load profile> |

### 1.3 Constraints

- <Regulatory, organisational, deadline, technology, etc.>

### 1.4 Out of Scope

- <Explicitly excluded; with rationale where useful>

---

## 2. Existing System Survey

> Brownfield only. For greenfield blueprints, replace this section with "N/A — greenfield".

For each surveyed component:

### 2.1 service.commerce.order-management

- **Purpose**: <one sentence>
- **Owns**: <data / aggregates>
- **Public API**: <endpoints, in brief>
- **Events emitted**: <list>
- **Events consumed**: <list>
- **Dependencies**: <other services / libraries>

### 2.2 ...

---

## 3. Architecture

### 3.1 Domains

#### Domain: <Domain Name>

- **Purpose**: <what this domain is responsible for>
- **In scope**: <what belongs here>
- **Out of scope**: <what does NOT belong here, despite seeming related>
- **Why a natural boundary**: <one or two sentences>

**Vocabulary**:

| Term | Definition |
|---|---|
| <Term> | <Definition> |

**Relationships**: <how this domain relates to others>

### 3.2 Services

For each service:

#### service.<category>.<name>  *(existing | new | extended)*

- **Purpose**: <one sentence, business-focused>
- **Owns**: <data / aggregates>
- **Operations**: <key actions>
- **Dependencies**: <other services it calls>

### 3.3 Operations

For each significant business operation:

#### Operation: `CreateOrder`

- **Trigger**: <user action / scheduled / event>
- **Participants**: OrderService, InventoryService, PaymentService
- **Flow**:
  1. OrderService validates the request (sync)
  2. OrderService calls InventoryService to reserve stock (sync)
  3. OrderService calls PaymentService to charge (sync)
  4. OrderService emits `OrderConfirmed` (async)
- **Failure handling**: <compensation / retry / saga reference>
- **Sync/async rationale**: <why this mix>

### 3.4 Events

| Event | Emitted By | Consumed By | Purpose |
|---|---|---|---|
| `OrderConfirmed` | OrderService | FulfillmentService, NotificationService | Triggers fulfillment and customer notification |

### 3.5 Communication Patterns

| Interaction | Sync / Async | Rationale |
|---|---|---|
| Order → Inventory (reserve) | Sync | Must confirm stock before charging |
| Order → Fulfillment | Async | Decoupling; eventual consistency acceptable |

### 3.6 Patterns Applied

> Reference patterns from the Pattern Library only when they clearly apply.
> Use full GitHub URLs for portability.

- **Saga** ([link]): manages the order → payment → fulfillment flow with compensations.
- **Circuit Breaker** ([link]): protects calls into PaymentService.

---

## 4. Per-Component Changes

> For brownfield blueprints. For greenfield, replace with "N/A — greenfield".

### 4.1 service.commerce.inventory  *(extended)*

- **Current state**: Owns inventory levels per SKU. Synchronous read API. No events emitted.
- **Target state**: Same ownership; emits `InventoryReserved` and `InventoryReleased`; new async reservation endpoint.
- **Changes**:
  - Add event publishing for reservations
  - Add `POST /reservations` endpoint
  - Add `Reservation` aggregate to data model

### 4.2 service.commerce.fulfillment-orchestrator  *(new)*

- **Purpose**: Coordinates the fulfillment saga across inventory, payment, and shipping.
- **Owns**: Saga state.
- **Triggered by**: `OrderConfirmed` event.

---

## 5. Consequences

### 5.1 Positive

1. <Improvement / force resolved>
2. ...

### 5.2 Negative

1. <Complexity / risk introduced>
2. ...

### 5.3 Mitigations

| Negative consequence | Mitigation |
|---|---|
| <Negative #1> | <Pattern, monitoring, operational practice> |

---

## 6. Assumptions and Gaps

### 6.1 Assumptions

- <Things treated as true that may not be>

### 6.2 Known Gaps

- <Areas not yet designed in detail>

### 6.3 Future Work

- <Out of scope for this blueprint; deferred>

---

## 7. References

- Requirements: <link>
- Related blueprints: <links>
- Pattern Library entries: <full URLs>
- External specs / RFCs: <links>
```
