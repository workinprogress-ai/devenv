# Diagnostic Mode Rollout — Remaining Skills

## Status
✅ **Pattern established and validated** on 5 representative skills:
- [devenv-bug-fix](devenv-bug-fix/SKILL.md)
- [devenv-chat-with-code](devenv-chat-with-code/SKILL.md)
- [devenv-code-review](devenv-code-review/SKILL.md)
- [devenv-create-blueprint](devenv-create-blueprint/SKILL.md)
- [devenv-delegation](devenv-delegation/SKILL.md)

## Standard Blockquote

Add immediately **after existing blockquotes** (Model check or Tool help policy):

```markdown
> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to emit a copiable fenced markdown code block for `/devenv-skill-maintenance`.
```

## Remaining 25 Skills

| # | Skill | Status |
|---|-------|--------|
| 1 | devenv-address-pr-comments | ⬜ Pending |
| 2 | devenv-create-implementation-plan | ⬜ Pending |
| 3 | devenv-create-roadmap | ⬜ Pending |
| 4 | devenv-design-discussion | ⬜ Pending |
| 5 | devenv-document | ⬜ Pending |
| 6 | devenv-gather-requirements | ⬜ Pending |
| 7 | devenv-grooming | ⬜ Pending |
| 8 | devenv-open-pr | ⬜ Pending |
| 9 | devenv-pair-programming | ⬜ Pending |
| 10 | devenv-plan-from-spec | ⬜ Pending |
| 11 | devenv-plan-status | ⬜ Pending |
| 12 | devenv-plan-update | ⬜ Pending |
| 13 | devenv-pre-commit | ⬜ Pending |
| 14 | devenv-refine-blueprint | ⬜ Pending |
| 15 | devenv-refine-implementation-plan | ⬜ Pending |
| 16 | devenv-refine-requirements | ⬜ Pending |
| 17 | devenv-refine-roadmap | ⬜ Pending |
| 18 | devenv-refresh-implementation-plan | ⬜ Pending |
| 19 | devenv-rubber-duck | ⬜ Pending |
| 20 | devenv-session-handoff | ⬜ Pending |
| 21 | devenv-skill-guru | ⬜ Pending |
| 22 | devenv-skill-maintenance | ⬜ Pending (has full maintenance guidance instead) |
| 23 | devenv-spike | ⬜ Pending |
| 24 | devenv-tech-debt-audit | ⬜ Pending |
| 25 | devenv-triage-issue | ⬜ Pending |
| 26 | devenv-update-roadmap | ⬜ Pending |

## Application Instructions

### For `/devenv-skill-maintenance` (Governance skill):
Add **after the first blockquote** (before "When to Use" or main introduction):

```markdown
> **Diagnostic mode:** When users report problems with skill ecosystem alignment (doc/registry/guru/catalog sync, routing issues, or provide diagnostic output from other skills), enter [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to capture structured context for repair work.
```

### For all other 25 skills:
1. Locate the skill's SKILL.md file
2. Find the existing blockquote(s) at the top (Model check, Tool help policy, or similar)
3. Insert the standard diagnostic blockquote immediately after the last blockquote
4. Run verification: `grep "Diagnostic Mode Protocol" copilot/skills/devenv-<skill>/SKILL.md`

### Bulk Verification Command

After applying all edits:
```bash
cd /workspaces/devenv
grep -l "Diagnostic Mode Protocol" copilot/skills/devenv-*/SKILL.md | wc -l
# Should output: 31 (5 done + 26 remaining)
```

## See Also

- [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md)
- [Diagnostic Mode Quick Start](../common/references/diagnostic-mode-quickstart.md)
- [Skill Maintenance](devenv-skill-maintenance/SKILL.md)
