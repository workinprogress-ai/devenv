# GitHub Issue Creation Flow

Shared five-step protocol for skills that optionally post a design document to a GitHub issue at the end of a session.

## When to invoke

After the output document has been written and the user has confirmed it, ask:

> *"Want to track this in a GitHub issue? I can create a new one, or post the document to an existing issue number. The document will go in a comment; the description stays as a short placeholder for the next skill."*

If the user says no, skip to session wrap-up.

## Protocol

1. **New issue or existing?** Ask whether to create a new issue or use an existing one. If the user provides an issue number, skip to step 4.

2. **Draft the issue title** — propose and ask the user to confirm or adjust. Use a skill-appropriate default title (see variants below).

3. **Draft the issue body** (placeholder — the document goes in the first comment). Use the skill-appropriate placeholder text (see variants below).

4. **Show a preview** (title + body for new issues; first ~15 lines of the document content for existing) and ask:
   > *"Ready to post? (y/n)"*

5. On confirmation:

   **If creating a new issue:**
   - `issue-create --repo "$GITHUB_REPO" --title "<title>" --body "<body>"`
   - Note the new issue number.
   - Write the document to a temp file.
   - `issue-comment <N> --body-file <temp-file>`
   - Surface the issue URL.

   **If posting to an existing issue:**
   - Write the document to a temp file.
   - `issue-comment-list <N>` — scan for an existing design comment (a comment whose body begins with `# Architecture and Implementation` or `# Redesign` as appropriate).
   - If found: `issue-comment-update <COMMENT_ID> --body-file <temp-file>` (replaces the prior version).
   - If not found: `issue-comment <N> --body-file <temp-file>` (adds a new comment).
   - Surface the issue URL.

Never create an issue or post a comment without explicit "yes" confirmation.

## Skill-specific title and body variants

### `devenv-create-technical-design`

**Default title:** `Technical Design: <component name> — <YYYY-MM-DD>`

**Issue body placeholder:**
```
Technical design document is in the first comment below.

Next step: use `/devenv-create-implementation-plan` or
`/devenv-plan-from-spec <issue number>` to generate a task-level implementation plan.
Document file: `<workspace-relative path to docs/Architecture_and_implementation.md>`
```

### `devenv-redesign-component`

**Default title:** `Redesign: <component name> — <YYYY-MM-DD>`

**Issue body placeholder:**
```
Redesign document is in the first comment below.

Next step: run `/devenv-plan-from-spec <issue number>` to generate a
concrete implementation plan from the redesign doc.
Document file: `<workspace-relative path to Redesign--NNN.md>`
```

### `devenv-design-discussion`

**Default title:** `Design: <topic> — <YYYY-MM-DD>`

**Issue body placeholder:**
```
Design discussion document is in the first comment below.

Next step: use `/devenv-create-implementation-plan` or `/devenv-plan-from-spec`
to move from design to implementation.
```
