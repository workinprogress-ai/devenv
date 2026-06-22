# Blueprint Template

Copy this skeleton verbatim and fill it in. All top-level headings are required, even if a section is intentionally short ("None" / "N/A" is acceptable).

```markdown
<!-- DEVENV_ARTIFACT_V1
doc_id: dv1:<owner-repo>:local:blueprint:<artifact-slug>
artifact_type: blueprint
artifact_scope: local-file
issue_number: <N | none>
source_file: <workspace-relative file path>
updated_at_utc: <ISO-8601>
-->

# Blueprint: <System Name>

<One paragraph: what this blueprint addresses and why. Reference the source
Requirements document, GitHub issue, or brief if applicable. State whether
this is greenfield or brownfield. Keep it short and avoid repeating details
that will already appear in later sections.>

**Status**: Draft | Approved | Superseded
**Source requirements**: <link to Requirements-*.md or issue, if any>
**Type**: Greenfield | Brownfield

## Revision History

### YYYY-MM-DD — Initial blueprint

Keep revision entries material and concise. If several small edits come from the same review pass, record them as one short entry instead of one line per tweak.

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
> Keep each survey concise and link to deeper source material rather than restating it.

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

## 3. Shared Vocabulary

Terms that apply across the whole system, regardless of domain. Established before domain boundaries are drawn.

| Term | Definition |
|---|---|
| <Term> | <Definition> |

---

## 4. Architecture

### 4.1 Domains

#### Domain: <Domain Name>

- **Purpose**: <what this domain is responsible for>
- **In scope**: <what belongs here>
- **Out of scope**: <what does NOT belong here, despite seeming related>
- **Why a natural boundary**: <one or two sentences>
- **Relationships to other domains**: <upstream/downstream, integrations>

##### Bounded Context: <BC Name>

- **Purpose**: <one sentence — what model this BC owns>
- **Team / ownership**: <who is responsible for this BC>

**Ubiquitous language** (terms specific to this BC; may refine or specialise global terms from §3):

| Term | Definition |
|---|---|
| <Term> | <BC-specific definition> |

**Aggregates**:

| Aggregate Root | Consistency Boundary | Key Invariants |
|---|---|---|
| `<Name>` | <what stays consistent together> | <rules that must always hold> |

###### Component: <component-name>  *(new | existing | extended)*

> A component is a deployable unit (service, API gateway, worker, batch processor, etc.).
> Most commonly a Bounded Context maps 1:1 to a component.
> One BC may contain multiple components (e.g. an API component + a background worker).

- **Purpose**: <one sentence, business-focused>
- **Public API**: <endpoints, in brief — note: any public-facing exposure requires an API Gateway for auth and permission enforcement>
- **Dependencies**: <other components it calls>

**Operations (commands handled)**:

| Operation | Trigger | Flow Summary | Failure Handling |
|---|---|---|---|
| `CreateOrder` | User submits order | Validate → reserve stock → charge payment → emit `OrderConfirmed` | Compensate via saga if payment fails |

**Domain Events** (internal to this BC — not a published contract, consumers are within this BC):

| Event | Trigger | Consumers within this BC |
|---|---|---|
| `OrderValidated` | Order passes validation | Payment handler |

**Integration Events** (cross-BC — these are a published contract; consumer BCs depend on their schema):

| Event | Consumed By | Stability Expectation |
|---|---|---|
| `OrderConfirmed` | FulfillmentBC, NotificationBC | Stable — breaking changes require versioning |

**Brownfield delta** (omit for new components):

- **Current state**: <brief description of what exists today; reference §2 survey for detail>
- **Target state**: <what it looks like after this blueprint is implemented>
- **Changes**:
  - <change 1>

---

### 4.2 Context Map

Relationships between Bounded Contexts.

| From | To | Relationship Type | Notes |
|---|---|---|---|
| `<BCName>` | `<BCName>` | Customer/Supplier | <brief rationale> |

**Relationship type reference**:

| Type | Meaning |
|---|---|
| Customer/Supplier | Downstream (Customer) depends on upstream (Supplier); Supplier considers Customer needs |
| Conformist | Downstream blindly adopts upstream's model; no negotiation |
| Anti-Corruption Layer (ACL) | Downstream wraps upstream's model via an explicit adapter; insulates from upstream changes |
| Shared Kernel | Two BCs share a subset of the domain model; changes require mutual coordination |
| Partnership | Two BCs coordinate tightly; must plan changes together |

### 4.3 Communication Patterns

For each significant cross-component interaction where the sync/async choice needs recording:

| From | To | Sync / Async | Rationale |
|---|---|---|---|
| OrderService | InventoryService | Sync | Must confirm stock before charging |
| OrderService | FulfillmentService | Async | Eventual consistency acceptable; decouples fulfillment latency |

### 4.4 Patterns Applied

> Reference patterns from the Pattern Library only when they clearly apply.
> Use full GitHub URLs for portability.

- **Saga** ([link]): <why/where applied>
- **Anti-Corruption Layer** ([link]): <why/where applied>

---

## 4. Consequences

### 4.1 Positive

1. <Improvement / force resolved>
2. ...

### 4.2 Negative

1. <Complexity / risk introduced>
2. ...

### 4.3 Mitigations

| Negative consequence | Mitigation |
|---|---|
| <Negative #1> | <Pattern, monitoring, operational practice> |

---

## 5. Assumptions and Gaps

### 5.1 Assumptions

- <Things treated as true that may not be>

### 5.2 Known Gaps

- <Areas not yet designed in detail>

### 5.3 Future Work

- <Out of scope for this blueprint; deferred>

---

## 6. References

- Requirements: <link>
- Related blueprints: <links>
- Pattern Library entries: <full URLs>
- External specs / RFCs: <links>
```
