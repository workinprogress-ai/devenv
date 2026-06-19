# GitHub Issue Creation Flow

Shared five-step protocol for skills that optionally post an output document to a GitHub issue at the end of a session.

## When to invoke

After the output document has been written and the user has confirmed it, ask:

> *"Want to track this in a GitHub issue? I can create a new one, or post the document to an existing issue number. The document will go in a comment; the description stays as a short placeholder for the next skill."*

If the user says no, skip to session wrap-up.

## Protocol

1. **New issue or existing?** Ask whether to create a new issue or use an existing one. If the user provides an issue number, skip to step 4.

2. **Draft the issue title** — propose and ask the user to confirm or adjust. Use a skill-appropriate default title (see variants below).

3. **Draft the issue body** (placeholder — the document goes in an artifact comment identified by doc_id). Use the skill-appropriate placeholder text (see variants below).

4. **Show a preview** (title + body for new issues; first ~15 lines of the document content for existing) and ask:
   > *"Ready to post? (y/n)"*

5. On confirmation:

   **If creating a new issue:**
   - `issue-create --repo "$GITHUB_REPO" --title "<title>" --body "<body>"`
   - Note the new issue number.
   - Generate doc_id using tooling:
     - `doc_id=$(issue-artifact-doc-id --issue <N> --artifact-type <artifact-type> --slug <artifact-slug>)`
   - Apply the [Artifact Identity Convention](../../_conventions.md#artifact-identity-convention).
   - Write the document to a temp file.
   - `issue-artifact-upsert --issue <N> --doc-id "$doc_id" --body-file <temp-file>`
   - Surface the issue URL.

   **If posting to an existing issue:**
   - Generate doc_id using tooling:
     - `doc_id=$(issue-artifact-doc-id --issue <N> --artifact-type <artifact-type> --slug <artifact-slug>)`
   - Apply the [Artifact Identity Convention](../../_conventions.md#artifact-identity-convention).

   - Write the document to a temp file.
   - `issue-artifact-upsert --issue <N> --doc-id "$doc_id" --body-file <temp-file>`
   - If upsert reports a duplicate `doc_id` conflict, stop and ask the user which comment ID to keep as canonical.
   - Surface the issue URL.

Never create an issue or post a comment without explicit "yes" confirmation.

## Skill-specific title and body variants

### `devenv-grooming`

**Default title:** `Design Grooming: <component name> — <YYYY-MM-DD>`

**Issue body placeholder:**

```
Design grooming notes are in a comment identified by artifact doc_id.

Next step: use `/devenv-design-discussion`, `/devenv-grooming`, or
`/devenv-create-implementation-plan` as appropriate.
Document file: `<workspace-relative path to the relevant design or planning artifact>`
```

### `devenv-grooming`

**Default title:** `Design Grooming: <component name> — <YYYY-MM-DD>`

**Issue body placeholder:**

```
Grooming notes are in a comment identified by artifact doc_id.

Next step: continue with `/devenv-design-discussion` or `/devenv-create-implementation-plan` as appropriate.
Document file: `<workspace-relative path to the relevant design artifact>`
```

### `devenv-design-discussion`

**Default title:** `Design: <topic> — <YYYY-MM-DD>`

**Issue body placeholder:**

```
Design discussion document is in a comment identified by artifact doc_id.

Next step: use `/devenv-create-implementation-plan` or `/devenv-plan-from-spec`
to move from design to implementation.
```

### `devenv-tech-debt-audit`

**Default title:** `Tech Debt Audit: <focus-area> — <repo-name> — <YYYY-MM-DD>`

Without focus area: `Tech Debt Audit — <repo-name> — <YYYY-MM-DD>`

**Issue body placeholder:**

```
Tech debt audit findings are in a comment identified by artifact doc_id.

Document file: `<workspace-relative path to TECH_DEBT_AUDIT.md>`
Next step: create an implementation plan from the Top Findings section.
```

**Artifact mapping for doc_id metadata:**

- `artifact_type`: `tech-debt-audit`
- `artifact_slug`: `<repo-name>` or `<repo-name>-<focus-area-slug>` when a focus area is used
- `source_file`: `<workspace-relative path to TECH_DEBT_AUDIT.md>`
