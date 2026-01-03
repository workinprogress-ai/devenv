# GitHub Issues Management Guide

This guide covers the complete GitHub Issues workflow in Devenv, from issue creation through deployment to production.

## Table of Contents

1. [Workflow Overview](#workflow-overview)
2. [Issue Types and Hierarchy](#issue-types-and-hierarchy)
3. [Status Workflow](#status-workflow)
4. [Common Workflows](#common-workflows)
5. [Script Reference](#script-reference)
6. [Examples](#examples)
7. [Best Practices](#best-practices)

## Workflow Overview

The GitHub Issues workflow in Devenv replaces Azure DevOps work items with a GitHub-native approach:

```
Issue Types:
├── Epic (type:epic)
│   └── Story (type:story, linked to epic)
│       └── Tasks (checkboxes in story body)
│   └── Bug (type:bug, linked to epic)
│       └── Tasks (checkboxes in bug body)
└── Standalone Bug (type:bug, unlinked)

Milestones: Sprint tracking (Sprint 1, Sprint 2, etc.)

Projects: Long-term efforts with Status workflow (TBD → Production)
```

## Issue Types and Hierarchy

### Epic (type:epic)

**Purpose**: Represents a phase or major feature encompassing multiple stories/bugs.

**Characteristics:**
- Label: `type:epic`
- No parent issue
- Can have multiple child stories/bugs
- Usually assigned to a project for long-term tracking
- May span multiple sprints

**Creation:**
```bash
issue-create --title "User Authentication System" --type epic \
    --body "Complete authentication system with OAuth2, SSO, and MFA support" \
    --project "Q1 2026"
```

### Story (type:story)

**Purpose**: A specific deliverable that implements part of an epic or feature.

**Characteristics:**
- Label: `type:story`
- Has a parent epic (using "Part of #123" reference)
- Contains implementation tasks as checkboxes
- Assigned to a milestone (sprint)
- Should have acceptance criteria

**Creation:**
```bash
issue-create --title "Implement OAuth2 Provider Integration" --type story \
    --parent 42 \
    --body "## Acceptance Criteria
- [ ] OAuth2 provider client configured
- [ ] Authorization endpoint working
- [ ] Token refresh mechanism implemented
- [ ] Tests covering happy path and error cases

## Tasks
- [ ] Create OAuth2 configuration
- [ ] Implement authorization flow
- [ ] Add token refresh logic
- [ ] Write integration tests" \
    --milestone "Sprint 5" \
    --label "priority:high"
```

### Bug (type:bug)

**Purpose**: Represents a defect or issue that needs fixing.

**Characteristics:**
- Label: `type:bug`
- Can be standalone or linked to an epic
- Contains reproduction steps and fix tasks
- Assigned to a milestone if part of sprint
- May have "blocked by" relationships

**Creation:**
```bash
# Standalone bug
issue-create --title "Login fails with special characters in password" --type bug \
    --body "## Steps to Reproduce
1. Create account with special chars: !@#$%^&*()
2. Try to login with that password
3. Login fails

## Expected
Login succeeds

## Actual
'Invalid password' error" \
    --milestone "Sprint 5"

# Bug linked to epic
issue-create --title "OAuth2 token not refreshing on expiration" --type bug \
    --parent 42 \
    --label "priority:critical"
```

### Tasks (Checkboxes)

Tasks are **NOT** separate issues. They are checkboxes in story/bug bodies:

```markdown
## Implementation Tasks
- [ ] Create OAuth2 configuration in settings
- [ ] Implement authorization endpoint
- [ ] Add token refresh mechanism
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Update API documentation
- [ ] Deploy to staging

## Verification Tasks
- [ ] Test with real OAuth2 provider
- [ ] Verify token refresh works
- [ ] Check error handling
- [ ] Load test with multiple concurrent requests
```

Update task progress:
```bash
# Edit the issue to update checkboxes
issue-update 123 --body-file updated-story.md
```

## Status Workflow

Issues in GitHub Projects use a Status field with 8 states:

### 1. **TBD** (To Be Determined)
- Newly created issues
- Not yet ready for grooming
- May lack acceptance criteria
- Not assigned to anyone

**Transition to:** To Groom (when ready for refinement)

### 2. **To Groom** (Ready for Grooming)
- Ready for backlog grooming session
- Has basic description
- Needs refinement and acceptance criteria
- May need estimation

**Actions during grooming:**
- Add acceptance criteria
- Clarify requirements
- Break down into tasks
- Add type label
- Set priority level
- Estimate effort (via labels if using)

**Transition to:** Ready (when grooming complete)

### 3. **Ready** (Ready for Implementation)
- Fully groomed and understood
- Has clear acceptance criteria
- Has implementation tasks
- Assigned to milestone
- Can begin work immediately

**Transition to:** Implementing (when developer starts work)

### 4. **Implementing** (Active Development)
- Developer is actively working
- Assigned to team member
- Code changes in progress
- Tasks being completed

**Transition to:** Review (when ready for code review)

### 5. **Review** (Code Review)
- Pull request created and open
- Waiting for code review
- May have review comments
- Tests passing

**Substates:**
- Approved → proceed to Merged
- Changes Needed → go back to Implementing
- Blocked → may go back to Ready

**Transition to:** Merged (when PR approved) or Implementing (if changes needed)

### 6. **Merged** (Merged to Main)
- Pull request merged to main branch
- Code in development environment
- May be in QA testing
- Not yet deployed to staging

**Note:** From here, issues may go back to Ready/Implementing if bugs found during QA

**Transition to:** Staging (when ready for deployment)

### 7. **Staging** (Deployed to Staging)
- Code deployed to staging environment
- End-to-end testing happening
- May go back to Implementing if critical issues found

**Transition to:** Production (when staging validation complete)

### 8. **Production** (Deployed to Production)
- **Issue automatically closed when reaching Production**
- Feature/fix live for all users
- No further work on original issue
- New bugs created as separate issues

**Note:** Issues are closed when moved to Production. Don't reopen for Production bugs—create new bug issues instead.

## Common Workflows

### Sprint Planning Workflow

```bash
# 1. Groom issues (interactive)
issue-groom --milestone "Sprint 5"

# 2. Assign groomed issues to sprint
issue-update 123 --milestone "Sprint 6"
issue-update 124 --milestone "Sprint 6"
issue-update 125 --milestone "Sprint 6"

# 4. Add issues to project
project-add "Q1 2026" 123 124 125

# 5. Set status to Ready
project-update "Q1 2026" 123 --status "Ready"
project-update "Q1 2026" 124 --status "Ready"
project-update "Q1 2026" 125 --status "Ready"
```

### Development Workflow

```bash
# 1. Select an issue to work on
issue_num=$(issue-select --milestone "Sprint 6" --status "Ready")

# 2. Start implementing
gh issue edit $issue_num --add-assignee "@me"
project-update "Q1 2026" $issue_num --status "Implementing"

# 3. Create branch and make changes
git checkout -b feature/my-feature

# 4. When ready for review, create PR
pr-create-for-merge

# 5. Update status to Review
project-update "Q1 2026" $issue_num --status "Review"

# 6. After PR approved and merged, update status
project-update "Q1 2026" $issue_num --status "Merged"

# 7. Deploy to staging
# (via your deployment process)
project-update "Q1 2026" $issue_num --status "Staging"

# 8. After staging validation, deploy to production
# (via your deployment process)
project-update "Q1 2026" $issue_num --status "Production"

# 9. Issue automatically closes when moved to Production
```

### Backlog Grooming Workflow

```bash
# 1. List issues in TBD state
issue-list --state open --label "status:tbd" --limit 50

# 2. Start interactive grooming session
issue-groom

# 3. For each issue, the wizard will help you:
#    - Set type (epic/story/bug)
#    - Edit title and description
#    - Add acceptance criteria
#    - Set milestone
#    - Add assignee
#    - Add priority labels
#    - Mark as Ready when complete

# 4. After grooming, move to project
project-add "Q1 2026" 42 43 44 45
project-update "Q1 2026" 42 --status "To Groom"
```

### Finding and Filtering Issues

```bash
# All open issues
issue-list

# Open bugs only
issue-list --type bug

# Issues in current sprint
issue-list --milestone "Sprint 5"

# Unassigned high-priority items
issue-list --assignee none --label "priority:high"

# Issues assigned to me
issue-list --assignee "@me"

# Closed bugs in Sprint 5
issue-list --type bug --state closed --milestone "Sprint 5"

# Get JSON for scripting
issue-list --format json --limit 100

# Open in web browser
issue-list --type story --web
```

## Script Reference

### Safety Checks

The issue management scripts include built-in safety checks to prevent accidental operations against the devenv repository itself. These tools are designed to work with your target project repositories.

**Repo Validation:**
- `issue-create`, `issue-list`, `issue-update`, `issue-close`, and `issue-select` detect when running against devenv repo
- If detected, they fail with a helpful error message
- To override and operate on devenv anyway, pass the `--devenv` flag

**Example Override:**
```bash
issue-create --devenv --title "Internal issue" --type bug
```

This safety mechanism ensures your team's issue management tools consistently target the right repositories.

---

### Issue Creation & Management

**`issue-create`** - Create new issues with optional template support
```bash
# Default: Interactive template selection with editor
issue-create --title "Title"

# With specific template
issue-create --title "Title" --template FILE

# Without template
issue-create --title "Title" --no-template [--body TEXT]

# Template without editor (for automation)
issue-create --title "Title" --template FILE --no-interactive

# Full example with all options
issue-create --title "Title" [--type epic|story|bug] [--parent ISSUE#] \
    [--template FILE] [--no-template] [--no-interactive] [--devenv] \
    [--body TEXT] [--milestone SPRINT] [--project NAME] \
    [--assignee USER] [--label LABEL]
```

**Template Workflow:**
- Default behavior: Script auto-discovers templates in `.github/ISSUE_TEMPLATE/`
- Uses fzf to let you select a template interactively
- Selected template opens in `$EDITOR` for customization
- `--no-template`: Bypass template selection entirely
- `--no-interactive`: Use template without editor (for scripts/automation)

**`issue-list`** - List and filter issues
```bash
issue-list [--state open|closed|all] [--type epic|story|bug] \
    [--milestone NAME] [--assignee USER] [--label LABEL] \
    [--format table|json|simple] [--limit N]
```

**`issue-update`** - Update issue fields
```bash
issue-update ISSUE# [--title TEXT] [--body TEXT] \
    [--add-label LABEL] [--remove-label LABEL] \
    [--add-assignee USER] [--remove-assignee USER] \
    [--milestone NAME] [--state open|closed]
```

**`issue-close`** - Close or reopen issues
```bash
issue-close [close|reopen] ISSUE# [--comment TEXT]
```

**`issue-select`** - Interactive issue browser
```bash
issue-select [--type TYPE] [--milestone NAME] [--multi] \
    [--format number|url|json]
```

### Project Management

**`project-add`** - Add issues to projects
```bash
project-add PROJECT_NAME ISSUE# [ISSUE#] ... \
    [--field NAME=VALUE]
```

**`project-update`** - Update project fields
```bash
project-update PROJECT_NAME ISSUE# [--status STATUS] \
    [--field NAME=VALUE] [--list-fields]
```

### Grooming & Workflow

**`issue-groom`** - Interactive grooming wizard
```bash
issue-groom [--project NAME] [--milestone NAME]
```

## Examples

### Example 1: Complete Epic with Stories

```bash
# 1. Create epic
issue-create --title "Payment Processing System" --type epic \
    --body "Complete rewrite of payment processing with:
- Multiple payment provider support
- Webhook handling
- Reconciliation reports
- PCI compliance" \
    --project "Q1 2026"
# Returns: https://github.com/owner/repo/issues/100

# 2. Create stories for epic
issue-create --title "Stripe Integration" --type story \
    --parent 100 \
    --body "## Acceptance Criteria
- Stripe account configured in staging and production
- Charge creation API working
- Refund API working
- Error handling for declined cards

## Tasks
- [ ] Add Stripe API credentials to config
- [ ] Implement charge endpoint
- [ ] Implement refund endpoint
- [ ] Write tests
- [ ] Add error handling" \
    --milestone "Sprint 5" \
    --label "priority:high"
# Returns: https://github.com/owner/repo/issues/101

issue-create --title "PayPal Integration" --type story \
    --parent 100 \
    --body "..." \
    --milestone "Sprint 6" \
    --label "priority:medium"
# Returns: https://github.com/owner/repo/issues/102

# 3. Add to project
project-add "Q1 2026" 100 101 102

# 4. Set statuses
project-update "Q1 2026" 100 --status "To Groom"
project-update "Q1 2026" 101 --status "Ready"
```

### Example 2: Development Workflow

```bash
# 1. Start work on an issue
issue_num=101
gh issue edit $issue_num --add-assignee "@me"
project-update "Q1 2026" $issue_num --status "Implementing"

# 2. Create branch and work
git checkout -b feature/stripe-integration
# ... make changes, commit ...

# 3. Create PR when ready
create-merge-pr
# This creates PR and moves to Review

# 4. Update status in project
project-update "Q1 2026" $issue_num --status "Review"

# 5. After PR approval and merge
project-update "Q1 2026" $issue_num --status "Merged"

# 6. After QA/staging validation
project-update "Q1 2026" $issue_num --status "Staging"

# 7. Deploy to production
# Run your deployment process
project-update "Q1 2026" $issue_num --status "Production"

# 8. Issue closes automatically
# You can verify:
gh issue view 101
# State: Closed
```

### Example 3: Bug Fix in Production

```bash
# 1. Create bug
issue-create --title "Stripe charge fails with PayPal accounts" \
    --type bug \
    --parent 100 \
    --body "## Steps to Reproduce
1. Create account with PayPal
2. Add payment method
3. Try to charge card

## Error
'This payment method is not supported'

## Expected
Charge succeeds

## Actual
Charge fails with generic error" \
    --milestone "Sprint 5" \
    --label "priority:critical"
# Returns: https://github.com/owner/repo/issues/150

# 2. Start work
gh issue edit 150 --add-assignee "@me"
project-update "Q1 2026" 150 --status "Implementing"

# 3. Work on fix and create PR
git checkout -b bugfix/stripe-paypal-support
# ... fix code ...
pr-create-for-merge

# 4. Update status
project-update "Q1 2026" 150 --status "Review"

# 5. After merge
project-update "Q1 2026" 150 --status "Merged"

# 6. After staging
project-update "Q1 2026" 150 --status "Staging"

# 7. Deploy to production
project-update "Q1 2026" 150 --status "Production"
# Bug automatically closes
```

## Best Practices

### Issue Creation

1. **Use meaningful titles**: Action-oriented and specific
   - ✅ "Implement OAuth2 token refresh mechanism"
   - ❌ "Fix auth stuff"

2. **Set type immediately**: Every issue should have a type
   - Epic for phases/major features
   - Story for deliverables
   - Bug for defects

3. **Link to parent**: Stories and bugs under epics should use `--parent`
   - Makes hierarchy clear
   - Helps track epic progress

4. **Add acceptance criteria**: For stories and bugs, always include "Definition of Done"
   ```markdown
   ## Acceptance Criteria
   - [ ] User can authenticate with OAuth2
   - [ ] Tokens refresh automatically
   - [ ] Expired tokens are handled gracefully
   - [ ] All tests passing
   ```

5. **Include tasks**: Break down work into checkboxes
   ```markdown
   ## Implementation Tasks
   - [ ] Task 1
   - [ ] Task 2
   - [ ] Task 3
   ```

### Grooming

1. **Do grooming as a team**: Use `issue-groom` wizard together
2. **Estimate effort**: Add labels for story points if using
3. **Add priority**: Use labels: `priority:critical`, `priority:high`, `priority:medium`, `priority:low`
4. **Identify blockers**: Add label `blocked` and comment on blocking issues
5. **Mark TBD → To Groom → Ready**: Follow the workflow progression

### Status Management

1. **Keep status up-to-date**: Update status as work progresses
2. **Don't skip states**: Follow the workflow (don't jump from Ready to Merged)
3. **Use for reporting**: Status field is the single source of truth for progress
4. **Automate transitions**: Use project workflows to auto-update status from PR status
5. **Close in Production**: Never manually close issues—let Production status do it

### Project Maintenance

1. **One project per quarter/initiative**: "Q1 2026", "Payment Processing", etc.
2. **Regular grooming cadence**: Weekly or bi-weekly grooming sessions
3. **Archive old projects**: Keep current work visible
4. **Use swimlanes**: Group by team, priority, or epic
5. **Review board regularly**: Daily standup boards, weekly planning

## See Also

- [Additional Tooling](./Additional-Tooling.md) - Complete script reference
- [Contributing Guidelines](./Contributing.md) - Development workflow
- [Coding Standards](./Coding-standards.md) - Code quality standards
