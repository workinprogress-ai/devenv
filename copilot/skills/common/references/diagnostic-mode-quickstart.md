# Diagnostic Mode — Quick Start for Skills

When to add diagnostic mode to a skill:

- After any artifact is written or significant action is taken.
- As an optional user-requested override for troubleshooting.

## One-liner for every custom skill

Add this **blockquote immediately below the skill's main title** (before the opening paragraph):

```markdown
> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to emit a copyable diagnostic block for `/devenv-skill-maintenance`.
```

## Implementation checklist

1. ✅ Add the blockquote to your skill's SKILL.md body (below `# <Skill Title>`).
2. ✅ Link to [diagnostic-mode-protocol.md](./diagnostic-mode-protocol.md).
3. ✅ When the user requests diagnostics, follow the protocol exactly.
4. ✅ Emit a single fenced markdown block; do not add prose before/after unless explicitly asked.

## Wording variant (if space is tight)

```markdown
> Diagnostic mode: Say "enter diagnostic mode" for troubleshooting assistance (see [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md)).
```

## What the output looks like

The user will receive a fenced markdown code block they can copy and paste directly into an issue or to `/devenv-skill-maintenance`:

```markdown
## Skill Diagnostic Report (DEVENV)

- timestamp_utc: <ISO-8601>
- active_skill: </devenv-...>
...
```

The block is designed to be self-contained and actionable for maintenance work.
