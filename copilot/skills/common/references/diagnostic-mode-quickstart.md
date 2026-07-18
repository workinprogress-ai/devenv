# Diagnostic Mode — Quick Start for Skills

When to add diagnostic mode to a skill:

- After any artifact is written or significant action is taken.
- As an optional user-requested override for troubleshooting.

## One-liner for every custom skill

Add this **blockquote immediately below the skill's main title** (before the opening paragraph):

```markdown
> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.
```

## Implementation checklist

1. ✅ Add the blockquote to your skill's SKILL.md body (below `# <Skill Title>`).
2. ✅ Link to [diagnostic-mode-protocol.md](./diagnostic-mode-protocol.md).
3. ✅ When the user requests diagnostics, or asks for a diagnostic/postmortem/findings report artifact without a format, follow the protocol exactly.
4. ✅ Write `DIAGNOSTIC_REPORT.md` to the active project root unless the user asks for a different path/filename.
5. ✅ Confirm the output path in chat; do not dump the full report body in chat unless explicitly asked.

## Wording variant (if space is tight)

```markdown
> Diagnostic mode: Say "enter diagnostic mode" for troubleshooting assistance (see [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md)).
```

## What the output looks like

The skill writes a self-contained report file at:

- `DIAGNOSTIC_REPORT.md` (active project root)

The chat response should be a short confirmation with the file path.
