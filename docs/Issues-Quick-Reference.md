# Issues Quick Reference

Fast lookup for common issue commands and workflows.

## Issue Commands

### Create Issue

```bash
# Default: no template (plain issue; --body TEXT to skip the editor)
issue-create --title "Title"

# Opt in to interactive template selection (fzf over .github/ISSUE_TEMPLATE/)
issue-create --title "Title" --select-template

# With specific template
issue-create --title "Title" --template .github/ISSUE_TEMPLATE/feature_request.md

# Explicit no-template (accepted no-op for backward compatibility)
issue-create --title "Title" --no-template

# Template without editor (automation)
issue-create --title "Title" --template FILE --no-interactive

# With type and parent
issue-create --title "Task" --type Task --parent 123

# Override repo safety check (for devenv repo)
issue-create --devenv --title "Internal issue" --type Bug   # canonical devenv root only — nested repos/devenv clones need no flag
```

### Create Issues in Batch

```bash
# Fast mode (preview by default)
issue-create-batch \
    --issue "Immutable commit graph and refs|type=Feature|size=L" \
    --issue "Drift checks and rebuild tooling|type=Task|labels=ops" \
    --parent 1

# Execute creation (otherwise preview only)
issue-create-batch \
    --issue "Immutable commit graph and refs|type=Feature" \
    --issue "Drift checks and rebuild tooling|type=Task" \
    --parent 1 \
    --create

# Manifest mode (advanced)
issue-create-batch --file child-issues.yaml --create

# Apply a default parent to manifest rows missing parent
issue-create-batch --file child-issues.yaml --parent 1

# Preview commands only (explicit alias)
issue-create-batch --file child-issues.yaml --dry-run
```

Fast mode entry format:

- `"Title|type=Feature|parent=123|labels=a,b|assignees=@me|blocked_by=42,55|milestone=Sprint 5|project=Q3 2026|size=M|target=scope text|body=...|body_file=..."`

Manifest rows support:

- required: `title`, `type`
- optional: `body` or `body_file`, `labels[]`, `assignees[]`, `milestone`, `project`, `parent`, `blocked_by[]`

### List Issues

```bash
issue-list                              # All open
issue-list --type Bug                   # Bugs only
issue-list --milestone "Sprint 5"       # In sprint
issue-list --assignee "@me"             # Assigned to me
issue-list --state closed               # Closed issues
issue-search login failed               # Keyword search titles+bodies
issue-search --state all --type Bug "session timeout"  # Duplicate check
```

### Update Issue

```bash
issue-update 123 --title "New title"
issue-update 123 --add-label "priority/P1"
issue-update 123 --add-assignee "john"
issue-update 123 --milestone "Sprint 6"
issue-update 123 --state closed
```

### Get Issue Details

```bash
issue-get 123                           # Structured JSON
issue-get 123 --pretty                  # Pretty-printed
issue-get 123 | jq -r '.title'          # Extract field
issue-get 123 | jq -r '.labels[].name' # Extract labels
```

### Add a Comment

```bash
issue-comment 123 --body "Fixed in PR #456"
issue-comment 123 --body-file notes.md  # From file
issue-comment 123 --edit                # Open $EDITOR
```

### Upsert Artifact Comment (Stable `doc_id`)

```bash
issue-artifact-upsert \
    --body-file spike-001-topic.md

issue-artifact-upsert --issue 123 \
    --body-file spike-001-topic.md --dry-run

cat spike-001-topic.md | issue-artifact-upsert --issue 123   # piped stdin
issue-artifact-upsert                                        # interactive picker over .local-artifacts/
```

**Rules:**

- Body must contain exact line: `doc_id: <doc_id>`
- `--issue` is optional when body metadata includes `issue_number: <N>`
- If both are provided, `--issue` and body `issue_number` must match
- Matching is exact and limited to first 256 characters
- Exit `3` means duplicate `doc_id` conflict on the issue

### Generate Artifact `doc_id`

```bash
issue-artifact-doc-id --issue 123 --artifact-type spike --slug "Retry Strategy"
issue-artifact-doc-id --issue 123 --artifact-type redesign --source-file Redesign--003-Auth-Flow.md
issue-artifact-doc-id --issue 123 --artifact-type plan --source-file Plan-issue-123-001.md
```

### Get One Artifact Comment

```bash
issue-artifact-get --issue 123 \
    --doc-id "dv1:example-org/devenv:issue-123:plan:plan-issue-123-001" \
    --full --pretty
```

### List Artifact Comments

```bash
issue-artifact-list --issue 123 --artifact-type plan --pretty
```

### Select One Artifact

```bash
issue-artifact-select --issue 123 --artifact-type plan --latest --format doc-id
issue-artifact-select --issue 123 --doc-id "$DOC_ID" --format url
```

### Close/Reopen Issue

```bash
issue-close 123                         # Close
issue-close reopen 123                  # Reopen
issue-close 123 --comment "Fixed"       # With comment
```

### Interactive Selection

```bash
issue-select                            # Pick one
issue-select --multi                    # Pick many
issue-select --type Task               # Filter by type
```

## Issue Hierarchy

| Type | Usage | Parent | Tasks |
|------|-------|--------|-------|
| Epic | Long-lived orchestration across repos/efforts | None | No (use features) |
| Feature | Deliverable | Epic | Yes (checkboxes) |
| Task | Work toward someone else's change | Feature or Epic | Yes (checkboxes) |
| Bug | Defect | Epic or None | Yes (checkboxes) |

### Create with Parent

```bash
issue-create --title "Task" --type Task --parent 123
```

## Project Commands

### Add Issue to Project

```bash
project-add-issue "Q1 2026" 123
```

### Update Issue Status in Project

Workflow states advance by their own signals (see [Issue Workflow](./Issue-Workflow.md)); manual writes are the escape hatch:

```bash
project-update-issue "Q1 2026" 123 --status "Ready"   # escape hatch
```

## Status Workflow

Status is a single ordered column with two halves: workflow states (TBD → Review) advanced by work signals, and deployment states (Merged → Production) advanced by deploys. Most transitions fire automatically from skills and PR tooling; parents of decomposed work derive their status from children. See [Issue Workflow](./Issue-Workflow.md) for the full model.

```text
TBD → To-Groom → Ready → Implementing → Review → Merged → Staging → Production
     (workflow signals)                        (deploys / workflow-signal)
```

### Signal an event (preferred way to move a card)

```bash
workflow-signal begin-implementation 123
workflow-signal production-deploy 101 102   # batch
workflow-signal                             # interactive: pick "what happened"
```

### Set Status directly (forced writes; delivery states only)

```bash
project-update-issue 123 --status "Implementing" --all-projects
```

Workflow states cannot be forced — they advance only by their own signals.

## Sprint Management

### Assign to Sprint

```bash
issue-update 123 --milestone "Sprint 6"
```

### List Issues in Sprint

```bash
issue-list --milestone "Sprint 5"
```

## Grooming

### Interactive Grooming Session

```bash
issue-triage
```

**Grooming sets:**

- Type (Bug/Feature/Task/Epic — native field)
- Acceptance criteria
- Tasks/checkboxes
- Labels (priority, etc.)
- Milestone (sprint)
- Assignee

## Workflow Examples

### Sprint Planning

```bash
issue-triage
issue-update 123 --milestone "Sprint 6"
project-add-issue "Q1 2026" 123
issue-triage --triage-complete 123   # fires the TBD→To-Groom signal
```

### Start Development

```bash
issue-update 123 --add-assignee "@me"   # assignment signals Implementing
git checkout -b feature/my-feature
```

### Submit PR

```bash
pr-create-for-merge   # signals Review on open
```

### Merge & Deploy

```bash
# After PR approval/merge — merge wrappers signal Merged
pr-complete-merge

# After staging validation — deploy process signals Staging

# Deploy to production — deploy process signals Production

# Closing stays explicit:
issue-close 123 --reason completed

## Filtering Cheatsheet

| Command | Filters By |
|---------|-----------|
| `--state open\|closed\|all` | Issue state |
| `--type Bug\|Task\|Feature\|Epic` | Native issue type |
| `--milestone NAME` | Sprint/milestone |
| `--assignee USER\|none\|@me` | Assignee |
| `--label LABEL` | Label(s) |
| `--author USER` | Issue creator |

### Combine Filters

```bash
issue-list --type Task --milestone "Sprint 5" --assignee none
```

## Label Conventions

### Type Labels

Types are a native field (not labels), configured in `tools/config/issues-config.yml`:

- `Epic` — Long-lived orchestration issue across repos/efforts (native type)
- `Feature` — Deliverable (native type)
- `Task` — Work toward someone else's change (native type)
- `Bug` — Defect (native type)

### Priority Labels

- `priority/P0` - Critical — production broken, data loss, security, blocking
- `priority/P1` - High — major user impact, no workaround, strategic
- `priority/P2` - Normal priority
- `priority/P3` - Low — nice to have

### Status Labels (optional, use project Status field)

- `needs-triage` - Newly filed, not yet routed
- `needs-grooming` - Routed to grooming before planning
- `status:ready` - Groomed and ready for implementation

## Common Issues

### Issue Won't Close When Set to Production

✅ Solution: closing remains an explicit act (issue-close or the closing PR); status reaching Production does not auto-close

- Must be in project first: `project-add-issue "Project" 123`
- Then set status: `project-update-issue "Project" 123 --status "Production"`

### Can't Find Issue in Interactive Selection

✅ Solution: Increase limit or adjust filters

```bash
issue-list --state all --limit 100
```

### Task Checkboxes Not Updating

✅ Solution: Edit full issue body with checkboxes, not just title

```bash
issue-update 123 --body-file full-issue.md
```

### Want to Track Custom Fields

✅ Solution: Use project custom fields or labels

```bash
project-update-issue "Project" 123 --field "CustomField=Value"
# Or use labels: --add-label "estimate:8" --add-label "component:auth"
```

## Bash Aliases

All commands are available as bash functions in the dev container:

```bash
issue-create    # Create issue (batch: issue-create-batch)
issue-list      # List issues
issue-search    # Search issues
issue-get       # Fetch issue as JSON
issue-get       # Fetch issue as JSON
issue-update    # Update issue
issue-close     # Close issue
issue-select    # Interactive picker
issue-triage    # Backlog metadata wizard
issue-comment   # Comment on an issue
issue-label-create  # Create a label
issue-label-list    # List labels
project-add-issue     # Add to project
project-update-issue  # Update project fields
project-list-for-issue # List projects containing an issue
workflow-signal  # Fire skill event signals manually
```

Use `alias` in shell to see all available aliases.

## Environment Variables

- `GH_TOKEN` - Not used day-to-day: tokens live in the keychain (via `key-update-git`), and an exported `GH_TOKEN` is honored only when the provider allowlist opts in. Never required.
- `DEVENV_REPO` - Target repo override (`owner/repo`); auto-detected from the cwd when unset

## Get Help

```bash
issue-create --help
issue-list --help
issue-search --help
issue-get --help
issue-update --help
issue-close --help
issue-select --help
issue-triage --help
issue-comment --help
issue-comment-list --help
issue-label-list --help
issue-artifact-upsert --help
project-add-issue --help
project-update-issue --help
```

## See Full Documentation

- Complete guide: [Issues Management](./Issues-Management.md) — owns the workflow and concepts (types, status model, hierarchy); this quick reference owns command syntax
- All tools: [Additional Tooling](./Additional-Tooling.md)
