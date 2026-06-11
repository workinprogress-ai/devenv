# Component context index

Shared component-context references for skills. Load these only when the current task needs them.

## Component types

- Service
- API gateway
- Frontend application

## Available context

### Service (available now)

- `01-Service-Architecture.md`
- `02-Service-Implementation.md`
- `03-Service-Plugins.md`

When the target component is a service and the task needs implementation or architecture detail, load only the relevant file(s), not all three by default.

### API gateway (planned)

Context will be added in this folder later.

### Frontend application (planned)

Context will be added in this folder later.

## Load policy

1. Classify component type first.
2. Load the minimum context needed for the current decision.
3. Prefer targeted reads over full-file ingestion when possible.
4. If context for a component type is not yet available, continue with general skill rules and explicitly note that specialized context is pending.
