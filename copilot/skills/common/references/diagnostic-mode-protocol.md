# Diagnostic Mode Protocol

Shared protocol for capturing a skill erratum in `DIAGNOSTIC_REPORT.md` at the active project root so it can be used by `/devenv-skill-maintenance`.

Use this protocol when the user indicates undesirable output or an undesirable/misaligned action from a skill, for example:

- "enter diagnostic mode"
- "that output was wrong, give me diagnostics"
- "capture why the skill did this"

Also use this output contract by default when the user asks for a diagnostic report, postmortem, incident report, or findings artifact and does not specify a format.

## Output contract

When diagnostic mode is requested, write the diagnostic report to:

- `DIAGNOSTIC_REPORT.md` in the active project root.

Active project root means the repository currently being worked on for the request. If no narrower target repo is active, use the workspace root.

This is mandatory for diagnostic requests unless the user explicitly asks for a different path/filename.

Do not emit the full diagnostic body in chat by default. After writing the file, return a brief confirmation with the path.

## Required contents

The diagnostic file must include all sections below:

1. Skill in effect at the time (or `none`).
2. Recent conversation leading to the erratum.
3. Decision trace summary that led to the erratum.
4. AI self-diagnosis of why that behavior occurred.
5. Other potentially relevant context.

If any section has no useful data, include the section anyway and write `none`.

## Reasoning safety rule

Do **not** expose hidden internal chain-of-thought. Provide a concise, user-facing **decision trace summary**: inputs considered, assumptions made, key branch points, and why the chosen path looked reasonable at the time.

## Markdown template (file contents)

```markdown
## Skill Diagnostic Report (DEVENV)

- timestamp_utc: <ISO-8601>
- active_skill: </devenv-... | none>
- user_intent_summary: <one paragraph>
- erratum_type: <undesirable_output | undesirable_action | misalignment>

### 1) Skill In Effect
<Skill name, file path if known, and whether skill routing was explicit or inferred>

### 2) Recent Conversation Leading To Erratum
<Concise transcript summary of the immediately relevant turns and triggers>

### 3) Decision Trace Summary
<User-facing reasoning summary: observed signals, assumptions, decision points, and why the chosen path was selected>

### 4) AI Self-Diagnosis
<Root-cause hypothesis: prompt/routing ambiguity, stale guidance, conflicting constraints, missing guardrail, etc.>

### 5) Related Context
<Model/runtime/tool context, workspace conditions, active files, policy constraints, or missing information that likely affected behavior>

### Suggested Maintenance Targets
- <file path>: <what should be adjusted>
- <file path>: <what should be adjusted>

### Confidence
- confidence: <low|medium|high>
- additional_data_needed: <what would most improve confidence>
```

## Quality bar

- Specific over generic.
- Cite concrete files/sections when known.
- Name assumptions explicitly.
- Keep it concise but sufficient for `/devenv-skill-maintenance` to act.
- Prefer transferability and actionable specificity over narrative formatting.
- Keep the file self-contained so `/devenv-skill-maintenance` can act without extra context.

## Pre-send validation

- Did I write `DIAGNOSTIC_REPORT.md` to the active project root?
- Does the file include every required section, with `none` where data is unavailable?
- Is the file self-contained for `/devenv-skill-maintenance`?
- Did I avoid outputting the full diagnostic body in chat by default?
