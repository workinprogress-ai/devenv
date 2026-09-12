---
name: devenv-skill-maintenance
description: 'Workspace-scoped maintenance skill for correcting problems in the current custom skill system. USE WHEN the user wants to fix, update, or clean up SKILL.md files, routing docs, or registry/catalog artifacts after identifying broken routing, stale references, contradictory guidance, missing guardrails, template drift, or diagnostic findings from other skills; to file validated findings (diagnostic errata or IMPROVEMENT_REPORT.md candidates) as devenv issues; or to repair the skill system from existing devenv issues. DO NOT USE for authoring a brand-new skill from scratch (follow copilot/skills/_conventions.md directly) or for non-skill workspace work.'
argument-hint: 'A list of skill problems to fix; optional target skill names, file paths, diagnostic output, or devenv issue numbers'
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
- Improvement feedback from other skills, where an `IMPROVEMENT_REPORT.md` (per the shared Skill Feedback Protocol) or pasted observations propose changes with no defect alleged. Feedback capture is explicit-request-only; skills never offer it unprompted.

Intake sources accepted by this skill:

- Pasted diagnostic content directly in chat.
- A user-provided file path containing the diagnostic report (including `DIAGNOSTIC_REPORT.md`).
- An `IMPROVEMENT_REPORT.md` at the active project root (see the shared [Skill Feedback Protocol](../common/references/skill-feedback-protocol.md)) or pasted improvement observations.
- One or more devenv repo issues describing skill-system problems (fetched with `issue-get`; found with `issue-list`/`issue-search`).

When a file path is provided, read that file first and treat it as the primary diagnostic input unless the user says otherwise.

If a reported problem does not fit one of these categories, stop and ask for clarification instead of guessing.

## Evidence bar (non-negotiable)

The skill system is a foundation for many workflows; a wrong "improvement" is more damaging than no change.

- **A repair request is not an obligation to change something.** After validating the evidence, deciding that no change is warranted is a valid repair outcome — report it as such, not as a failure.

- **Diagnostic findings:** verify each reported erratum against the cited files before acting. If the trace is weak, the root cause is not reproducible from the described signals, or the behavior was actually correct, say so explicitly and decline or narrow the repair. Never repair an invented problem.

- **Improvement findings:** treat with a higher bar than defects. Each candidate must (1) cite a concrete observed interaction moment, (2) name a specific target file and section, and (3) survive the question: *would the proposed edit change behavior for the next user of this skill, or only satisfy the reporter?* Candidates failing any test are rejected explicitly with the reason, mirroring the report's evidence bar. Never modify a healthy skill to appear responsive.

- **Confidence is honest per finding.** Weak evidence yields an explicit "no change / insufficient evidence" outcome, not a soft or partial edit.

## Filing findings as devenv issues

Validated findings (diagnostic errata, evidence-passing improvement candidates) may be filed as issues in the devenv repo so they survive the session and queue repair work. Filing is always user-approved first — show the draft title and body, wait for explicit confirmation, then run `GITHUB_REPO=workinprogress-ai/devenv issue-create --type <Bug|Task> --no-template --no-interactive --title ... --body-file ...` (`Bug` for diagnostic errata, `Task` for improvement candidates).

Rules:

1. **Only validated findings are filed.** Anything rejected under the evidence bar is never filed.
2. **Deduplicate before proposing a filing.** Search first (`issue-search` with keywords from the finding; `issue-list --state open` for a scope scan); if an open issue already covers the finding, reference it instead of filing a duplicate.
3. **Check the local dedup ledger** (`/memories/repo/skill-findings-ledger.md`) before proposing — a finding recorded there as filed or refused should not be re-proposed without new evidence.
4. **Record the outcome in the ledger** after the user decides: issue URL (if filed) or the refusal with a one-line reason. Refusals are recorded so the same candidate is not re-raised when the user has already declined it.
5. The issue body is self-contained: symptom/evidence, affected files, suggested maintenance targets, and the report path if a `DIAGNOSTIC_REPORT.md`/`IMPROVEMENT_REPORT.md` backs it.

## Fixing from devenv issues

A devenv issue describing a skill-system problem is a first-class intake: fetch it with `issue-get <N>`, treat its body as the diagnostic input, and run the normal repair process (evidence bar, smallest patch, governance sync). Adaptations:

1. Validate the issue's claims against the current files exactly as a pasted diagnostic — issues can be stale relative to code already fixed.
2. After a user-approved repair from an issue, close the loop on the issue itself (with approval): post a summary comment via `issue-comment <N> --body ...` (what changed, which files), then close via `issue-close close <N> --reason completed`. Never close an issue the repair did not actually resolve.
3. Record the repair in the local ledger (`/memories/repo/skill-findings-ledger.md`) so the same finding is not re-raised.

## Repair process

1. Restate the problem set in one short summary.
2. Parse diagnostic input and map each finding to one or more concrete files.
  - If diagnostics are pasted in chat, parse the pasted content.
  - If the user provides a file path, read that file and parse its contents.
  - If both are provided, use the file as canonical and treat pasted content as supplemental unless the user says otherwise.
  - For `IMPROVEMENT_REPORT.md` input, validate every candidate against the evidence bar before mapping to files; rejected candidates are surfaced to the user with reasons, not silently dropped or applied.
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
- Improvement findings were validated against the evidence bar, and any candidate rejected there is reported with its reason.
- Findings proposed for filing were deduplicated (issue-search/issue-list plus the local ledger); filings and refusals were recorded in `/memories/repo/skill-findings-ledger.md`.
- For issue-sourced repairs: the summary comment and close were user-approved, and the repair is recorded in the local ledger.
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
- How diagnostics were interpreted and resolved (pasted chat content, file path input, or both), and how improvement findings were validated against the evidence bar — including any candidates rejected and why.
- Which findings were filed as devenv issues (with URLs) or refused, and what was recorded in the local dedup ledger.
- Any remaining ambiguity the user should resolve before the skill is considered final.

If the user has more issues to fix, continue with the next smallest repair rather than widening scope.
