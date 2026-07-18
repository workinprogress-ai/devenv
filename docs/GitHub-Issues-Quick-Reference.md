# GitHub Issues Quick Reference

Fast lookup for common GitHub Issues commands and workflows.

## Issue Commands

### Create Issue

```bash
# Interactive mode (select template with fzf, edit in $EDITOR)
issue-create --title "Title"

# With specific template
issue-create --title "Title" --template tools/templates/story.md

# Without template
issue-create --title "Title" --no-template

# Template without editor (automation)
issue-create --title "Title" --template FILE --no-interactive

# With type and parent
issue-create --title "Story" --type story --parent 123

# Override repo safety check (for devenv repo)
issue-create --devenv --title "Internal issue" --type bug
```

### List Issues

```bash
issue-list                              # All open
issue-list --type bug                   # Bugs only
issue-list --milestone "Sprint 5"       # In sprint
issue-list --assignee "@me"             # Assigned to me
issue-list --state closed               # Closed issues
```

### Update Issue

```bash
issue-update 123 --title "New title"
issue-update 123 --add-label "priority:high"
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
issue-artifact-upsert --issue 123 \
    --body-file spike-001-topic.md

issue-artifact-upsert --issue 123 \
    --body-file spike-001-topic.md --dry-run
```

**Rules:**

- Body must contain exact line: `doc_id: <doc_id>`
- Matching is exact and limited to first 256 characters
- Exit `3` means duplicate `doc_id` conflict on the issue

### Generate Artifact `doc_id`

```bash
issue-artifact-doc-id --issue 123 --artifact-type spike --slug "Retry Strategy"
issue-artifact-doc-id --issue 123 --artifact-type redesign --source-file Redesign--003-Auth-Flow.md
issue-artifact-doc-id --issue 123 --artifact-type implementation-plan --source-file Implementation_plan-issue-123-001.md
```

### Get One Artifact Comment

```bash
issue-artifact-get --issue 123 \
    --doc-id "dv1:workinprogress-ai-devenv:issue-123:implementation-plan:implementation-plan-issue-123-001" \
    --full --pretty
```

### List Artifact Comments

```bash
issue-artifact-list --issue 123 --artifact-type implementation-plan --pretty
```

### Select One Artifact

```bash
issue-artifact-select --issue 123 --artifact-type implementation-plan --latest --format doc-id
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
issue-select --type story               # Filter by type
```

## Issue Hierarchy

| Type | Usage | Parent | Tasks |
|------|-------|--------|-------|
| Epic | Major feature/phase | None | No (use stories) |
| Story | Deliverable | Epic | Yes (checkboxes) |
| Bug | Defect | Epic or None | Yes (checkboxes) |

### Create with Parent

```bash
issue-create --title "Story" --type story --parent 123
```

## Project Commands

### Add Issue to Project

```bash
project-add-issue "Q1 2026" 123
```

### Update Issue Status in Project

```bash
project-update-issue "Q1 2026" 123 --status "Ready"
```

## Status Workflow

```text
TBD → To Groom → Ready → Implementing → Review → Merged → Staging → Production
                                                                      ↓
                                                            (Auto-closes)
```

### Set Status

```bash
project-update-issue "Project" 123 --status "Ready"
project-update-issue "Project" 123 --status "Implementing"
project-update-issue "Project" 123 --status "Review"
project-update-issue "Project" 123 --status "Merged"
project-update-issue "Project" 123 --status "Staging"
project-update-issue "Project" 123 --status "Production"
```

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
issue-groom
```

**Grooming sets:**

- Type (epic/story/bug)
- Acceptance criteria
- Tasks/checkboxes
- Labels (priority, etc.)
- Milestone (sprint)
- Assignee

## Workflow Examples

### Sprint Planning

```bash
issue-groom
issue-update 123 --milestone "Sprint 6"
project-add-issue "Q1 2026" 123
project-update-issue "Q1 2026" 123 --status "Ready"
```

### Start Development

```bash
gh issue edit 123 --add-assignee "@me"
project-update-issue "Q1 2026" 123 --status "Implementing"
git checkout -b feature/my-feature
```

### Submit PR

```bash
pr-create-for-merge
project-update-issue "Q1 2026" 123 --status "Review"
```

### Merge & Deploy

```bash
# After PR approval/merge
project-update-issue "Q1 2026" 123 --status "Merged"

# After staging validation
project-update-issue "Q1 2026" 123 --status "Staging"

# Deploy to production
project-update-issue "Q1 2026" 123 --status "Production"
# Issue auto-closes
```

## Filtering Cheatsheet

| Command | Filters By |
|---------|-----------|
| `--state open\|closed\|all` | Issue state |
| `--type epic\|story\|bug` | Issue type |
| `--milestone NAME` | Sprint/milestone |
| `--assignee USER\|none\|@me` | Assignee |
| `--label LABEL` | Label(s) |
| `--author USER` | Issue creator |

### Combine Filters

```bash
issue-list --type story --milestone "Sprint 5" --assignee none
```

## Label Conventions

### Type Labels

- `type:epic` - Phase or major feature
- `type:story` - Deliverable
- `type:bug` - Defect

### Priority Labels

- `priority:critical` - Blocking, urgent
- `priority:high` - Important, high value
- `priority:medium` - Normal priority
- `priority:low` - Nice to have

### Status Labels (optional, use project Status field)

- `status:ready` - Ready to implement
- `status:blocked` - Blocked by something
- `status:needs-review` - Waiting for review

## Common Issues

### Issue Won't Close When Set to Production

✅ Solution: Issue auto-closes when Status field set to "Production" in project

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
issue-create    # Create issue
issue-list      # List issues
issue-update    # Update issue
issue-close     # Close issue
issue-select    # Interactive picker
issue-groom     # Grooming wizard
project-add-issue     # Add to project
project-update-issue  # Update project fields
```

Use `alias` in shell to see all available aliases.

## Environment Variables

- `GH_USER` - Your GitHub username
- `GH_TOKEN` - GitHub API token
- `GITHUB_REPO` - Current repo (auto-detected)

## Get Help

```bash
issue-create --help
issue-list --help
issue-update --help
issue-close --help
issue-select --help
issue-groom --help
project-add-issue --help
project-update-issue --help
```

## See Full Documentation

- Complete guide: [GitHub Issues Management](./GitHub-Issues-Management.md)
- All tools: [Additional Tooling](./Additional-Tooling.md)
