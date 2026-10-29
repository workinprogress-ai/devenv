<!-- DEVENV_ARTIFACT_V1
doc_id: <dv1:<owner>/<repo>:issue-<N>:grooming:<artifact-slug> | dv1:<owner>/<repo>:local:grooming:<artifact-slug>>
artifact_type: grooming
artifact_scope: issue-comment | local-file
issue_number: <N | none>
planning_repo: <owner>/<planning-repo | none>
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

| Issue type       | Proposed title | Repo | Size (S/M/L) | Independent production target | Planned plan issue/artifact |
| ---------------- | -------------- | ---- | ------------ | ----------------------------- | ------------------------------------------ |
| Feature/Fix/Task |                |      |              | yes/no                        | TBD                                        |

If any row cannot state `yes` for independent production target, split that row into smaller issues until each row is independently deliverable.

Type follows placement: a row under a **Feature or Bug** parent is a **Task** (Features and Bugs are user-visible deliverables; Tasks are required work users don't see). Feature/Fix rows are legitimate only as top-level rows or rows under an Epic — name the parent's type when proposing row types.

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

### Assumptions

Facts the design relies on that nobody has verified in this work's context. Recorded the moment an assumption supports a decision — never retroactively. Major `Confirmed` decisions carry a falsifiability line in their rationale: what would prove the choice wrong, and would we find out before implementation?

| #     | Assumption | Used by (decisions) | What if it's wrong | Verified how |
| ----- | ---------- | ------------------- | ------------------ | ------------ |
| A-001 |            |                     |                    | not yet      |

## Outstanding questions

Use Q-NNN format. See status transitions in [_conventions.md Open Questions Log](../../_conventions.md#open-questions-log-q-nnn).

```
Q-001  [open]      ...
                   Raised: <context>. Affects: <decision/component>.
```

## Design notes

Freeform: constraints, key insights, rejected directions, operational concerns.

Write this section as the current target state. Do not include prior-state narrative here; place historical change notes in `## Revision History`.

## Related plans

| Plan file | Repo | Phases | Status |
| --------- | ---- | ------ | ------ |
|           |      |        |        |

## Revision History

| Date       | Change  | Reason |
| ---------- | ------- | ------ |
| YYYY-MM-DD | Created |        |
