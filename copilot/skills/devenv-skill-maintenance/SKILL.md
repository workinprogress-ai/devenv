---
name: devenv-skill-maintenance
description: 'Workspace-scoped maintenance skill for correcting problems in the current custom skill system. Use when the user wants to fix, update, or clean up SKILL.md files, routing docs, or registry/catalog artifacts after identifying broken routing, stale references, contradictory guidance, missing guardrails, template drift, or diagnostic findings from other skills.'
argument-hint: 'A list of skill problems to fix, plus optional target skill names or file paths'
user-invocable: true
---

# Skill maintenance

Use this skill to repair the workspace's custom skill system in a controlled way. The user will describe the problems to fix; your job is to inspect the current skills and governance docs, identify the smallest correct patch, apply it, and validate that the skill ecosystem remains coherent, complementary, and aligned with workspace norms.

## What to inspect first

Location conventions for this skill:

- Copilot knowledge source of truth location must be read from `devenv.config` under `[copilot]` (use `knowledge_repo` and `knowledge_subpath`) before making knowledge edits.
- Skills, conventions, and custom-skill governance in this workspace are maintained under `copilot/`.

1. Read the current custom skills under `copilot/skills/`.
2. Read `docs/Skills.md` so the catalog and the actual skills stay aligned.
3. Read `copilot/skills/devenv-skill-guru/references/skills-registry.md` because it is the routing source of truth.
4. Read `copilot/skills/devenv-skill-guru/SKILL.md` and `copilot/skills/common/references/skills-catalog.md` when routing behavior or discovery language may be affected.
5. Read `docs/Workflow.md` and treat its Principles section as core constraints.
6. Read any repo-local guidance that affects skill authoring or routing.
7. Confirm which files are actually in scope before changing anything.

## System norms and design constraints

When editing skills, preserve these invariants:

- Skills are complementary, not competing. Avoid broadening one skill so it steals another skill's core role.
- Skills are aware of each other. Update cross-references and boundary language when responsibilities shift.
- Registry, guru, and catalogs must stay synchronized after maintenance changes.
- Workflow core principles in `docs/Workflow.md` are non-negotiable and override convenience edits.
- Changes must be minimal and surgical; do not rewrite stable skill guidance without a reported problem.

## Problem types this skill handles

Classify each reported issue before editing:

- Broken routing or wrong trigger phrases.
- Stale references, links, paths, or file names.
- Contradictory instructions between skills or catalog entries.
- Missing guardrails, decision points, or completion checks.
- Scope drift, where the skill does more or less than its name says.
- Catalog discoverability problems, such as missing rows or wrong descriptions.
- Template drift, such as frontmatter or structure that no longer matches the workspace standard.
- Workflow misalignment, where skill behavior conflicts with principles in `docs/Workflow.md`.
- Attribution policy violations, where skills or docs attribute authorship/revision ownership to AI or specific models instead of the user/engineer.
- Ecosystem coherence problems, where skills overlap, conflict, or become unaware of each other.
- Diagnostic findings from other skills, where pasted output reveals routing failures, stale links, or contradictions.

Diagnostic intake sources accepted by this skill:

- Pasted diagnostic content directly in chat.
- A user-provided file path containing the diagnostic report (including `DIAGNOSTIC_REPORT.md`).

When a file path is provided, read that file first and treat it as the primary diagnostic input unless the user says otherwise.

If a reported problem does not fit one of these categories, stop and ask for clarification instead of guessing.

## Repair process

1. Restate the problem set in one short summary.
2. Parse diagnostic input and map each finding to one or more concrete files.
  - If diagnostics are pasted in chat, parse the pasted content.
  - If the user provides a file path, read that file and parse its contents.
  - If both are provided, use the file as canonical and treat pasted content as supplemental unless the user says otherwise.
3. Decide whether the fix is local to one skill or affects multiple skills plus shared routing/docs. For bulk edits across many skills (e.g., adding a new standard reference, updating a shared protocol), use a systematic batch operation rather than many individual edits.
4. Make the smallest patch that resolves the reported problems. If the pattern affects many skills (> 3), write a batch script or clearly documented find-replace rule; surface the pattern to the user for validation before applying.
5. Keep wording consistent with existing skill language and current workspace conventions.
6. Update linked governance docs as needed in the same change:
	- `docs/Skills.md` for user-facing catalog alignment.
	- `docs/Workflow.md` only when principles, flow semantics, or methodology wording are affected.
	- `copilot/skills/devenv-skill-guru/references/skills-registry.md` when discoverability/routing metadata changes.
	- `copilot/skills/devenv-skill-guru/SKILL.md` when routing logic or shortcut examples must change.
	- `copilot/skills/common/references/skills-catalog.md` when shared catalog wording must stay in sync.
7. Do not refactor unrelated skills or rewrite healthy guidance just to make docs look nicer.

## Standard bulk-edit patterns

When a fix must apply to many skills, document the pattern explicitly and use a consistent rule. Examples:

- **Add a shared protocol reference** (e.g., adding diagnostic mode to all skills)
  - Rule: "Add a `> Diagnostic mode: <reference>` blockquote below the skill's main title or immediately after an existing Tool help policy reference blockquote."
  - Pattern: one-liner reference pointing to a shared protocol file.
  - Affected files: all `devenv-*/SKILL.md` under `copilot/skills/`.
  - How to verify: `grep -r "Diagnostic Mode Protocol" copilot/skills/devenv-*/SKILL.md` should have no empty results after the edit.

- **Update a shared reference file or registry**
  - Pattern: surgically edit the one canonical file.
  - Verification: run any registry/catalog validation checks; confirm skill-guru can still reach the updated content.

## Quality checks

A repair is complete only when all of these are true:

- The affected skill files still have valid frontmatter and a clear purpose.
- The changed instructions match the intended user workflow.
- Any catalog or registry entry that points to the skill is accurate.
- Skill-guru can correctly route users to the maintained skill behavior.
- The skill no longer contains the reported contradiction or stale reference.
- Attribution language is compliant: artifacts and revision-history guidance attribute to the current user/engineer (or team context), never to AI/model actors.
- Complementary boundaries with related skills remain explicit.
- Changes do not violate workflow principles in `docs/Workflow.md`.
- Any obvious follow-up risk is called out explicitly.
- For bulk-edit patterns: all affected files were actually updated (spot-check a few via grep or diff).

## Wrap-up

When the fixes are done, summarize:

- What problems were fixed.
- Which skill files changed.
- Which governance docs were updated (`docs/Skills.md`, `docs/Workflow.md`, registry, guru, shared catalog).
- How diagnostics were interpreted and resolved (pasted chat content, file path input, or both).
- Any remaining ambiguity the user should resolve before the skill is considered final.

If the user has more issues to fix, continue with the next smallest repair rather than widening scope.
