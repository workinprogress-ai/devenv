# Diagnostic Mode Protocol

Shared protocol for capturing a skill erratum in a copiable markdown code block that can be fed into `/devenv-skill-maintenance`.

Use this protocol when the user indicates undesirable output or an undesirable/misaligned action from a skill, for example:

- "enter diagnostic mode"
- "that output was wrong, give me diagnostics"
- "capture why the skill did this"

## Output contract

When diagnostic mode is requested, produce a **single fenced markdown code block** (language tag: `markdown`) that the user can copy as-is.

This is mandatory. The diagnostic response itself must be inside the fence, not described or paraphrased outside it.

Do not add explanatory prose before or after the block unless the user explicitly asks.

The block must start with <code>```markdown</code> and end with <code>```</code>.

## Required contents

The diagnostic block must include all sections below:

1. Skill in effect at the time (or `none`).
2. Recent conversation leading to the erratum.
3. Decision trace summary that led to the erratum.
4. AI self-diagnosis of why that behavior occurred.
5. Other potentially relevant context.

If any section has no useful data, include the section anyway and write `none`.

## Reasoning safety rule

Do **not** expose hidden internal chain-of-thought. Provide a concise, user-facing **decision trace summary**: inputs considered, assumptions made, key branch points, and why the chosen path looked reasonable at the time.

## Markdown template

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
- Return only the fenced markdown block unless the user explicitly asks for commentary.
