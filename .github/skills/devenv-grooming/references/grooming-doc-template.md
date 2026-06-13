<!-- DEVENV_ARTIFACT_V1
doc_id: <dv1:<owner-repo>:issue-<N>:grooming:<artifact-slug> | dv1:<owner-repo>:local:grooming:<artifact-slug>>
artifact_type: grooming
artifact_scope: issue-comment | local-file
issue_number: <N | none>
source_file: <workspace-relative file path>
updated_at_utc: <ISO-8601>
-->

# Grooming: <Feature / Epic Name>

> **Status:** In Progress | Blocked | Complete
> **Created:** YYYY-MM-DD
> **Scope:** <one-line summary of the larger piece of work being groomed>

## Affected components

| Component          | Repo     | Role in this work |
| ------------------ | -------- | ----------------- |
| `<component-name>` | `<repo>` | <purpose here>    |

## Suggested issue attack plan

Each row should be independently deliverable to production.

| Issue type       | Proposed title | Repo | Size (S/M/L) | Independent production target | Planned implementation plan issue/artifact |
| ---------------- | -------------- | ---- | ------------ | ----------------------------- | ------------------------------------------ |
| Feature/Fix/Task |                |      |              | yes/no                        |                                            |

If any row cannot state `yes` for independent production target, split that row into smaller issues until each row is independently deliverable.

## Design decisions

### Confirmed

| #     | Decision | Choice | Rationale | Date |
| ----- | -------- | ------ | --------- | ---- |
| D-001 |          |        |           |      |

### Pending

| #     | Decision | Options   | Blocking         | Plan ref |
| ----- | -------- | --------- | ---------------- | -------- |
| D-NNN |          | A / B / C | <what it blocks> |          |

### Deferred

| #     | Decision | Reason | Revisit trigger |
| ----- | -------- | ------ | --------------- |
| D-NNN |          |        |                 |

## Outstanding questions

Use Q-NNN format. See status transitions in [_conventions.md Open Questions Log](../../_conventions.md#open-questions-log-q-nnn).

```
Q-001  [open]      ...
                   Raised: <context>. Affects: <decision/component>.
```

## Design notes

Freeform: constraints, key insights, rejected directions, operational concerns.

## Related implementation plans

| Plan file | Repo | Phases | Status |
| --------- | ---- | ------ | ------ |
|           |      |        |        |

## Change log

| Date       | Change  | Reason |
| ---------- | ------- | ------ |
| YYYY-MM-DD | Created |        |
