# Solution_Proposal_<topic>-NNN.md template

Use this template when capturing outputs from design discussion. The goal is a conversation-derived, decision-ready proposal that records the final state and can be consumed by engineers, architects, and management.

This is a one-time artifact. Do not include a revision-history section.

---

```markdown
<!-- DEVENV_ARTIFACT_V1
doc_id: dv1:<owner-repo>:local:solution-proposal:<artifact-slug>
artifact_type: solution-proposal
artifact_scope: local-file
issue_number: <N | none>
source_file: <workspace-relative file path>
updated_at_utc: <ISO-8601>
-->

# Solution Proposal: <Topic in Title Case>

> **Status:** Recommended | Approved
> **Date:** YYYY-MM-DD
> **Authors:** <names / handles>
> **Audience:** Engineering, Architecture, Management
> **Related:** <Blueprint-*.md, Requirements-*.md, issues, prior decisions>

## 1. Executive summary

- **Problem:** <one sentence>
- **Decision needed:** <one sentence>
- **Recommended option:** <Option name>
- **Why this option:** <2-4 bullets>
- **Expected outcome:** <success criteria>

## 2. Problem statement

**What is the specific problem?**

**Why now?**

**Impact if not addressed:**

**Scope and constraints:** budget, timeline, skills, infrastructure, compliance, backward compatibility.

## 3. Forces and constraints

Document the tensions that make this decision non-trivial.

- **Force A vs. Force B** - explanation
- **Force C vs. Force D** - explanation

## 4. Alternatives considered (brief)

Capture alternatives briefly for context. Keep emphasis on why the final option(s) were selected.

### Option A: <name>

**Overview**

**How it works**

**Consequences**
- Benefits
- Drawbacks
- Risks

**Mitigations**

**Effort estimate**
- Development
- Test/rollout
- Ongoing maintenance
- Team learning curve

**Pattern references (full GitHub URLs only)**

### Option B: <name>

(same structure)

### Option C: <name>

(same structure)

## 5. Decision summary

**Selected option(s):** <Option name(s)>

**Why this final state:**
- <force/constraint tie-in>
- <operational/team rationale>
- <risk and mitigation summary>

## 6. Comparison table (optional)

| Dimension | Option A | Option B | Option C |
|---|---|---|---|
| Resolves core problem | ... | ... | ... |
| Development effort | ... | ... | ... |
| Maintenance burden | ... | ... | ... |
| Team learning curve | ... | ... | ... |
| Timeline to production | ... | ... | ... |
| Risk level | ... | ... | ... |
| 2-year regret risk | ... | ... | ... |

## 7. Recommendation and rationale

**Pick:** Option <X>

**Rationale:** tie to forces and constraints explicitly.

**If a different option is chosen:** capture accepted risks and contingency actions.

## 8. Assumptions and dependencies

- **Assumption 1** - validation approach
- **Dependency 1** - owner and timing

## 9. Follow-up work

- [ ] Follow-up item
- [ ] Follow-up item

Suggested next steps:
- Feasibility uncertainty remains -> /devenv-spike
- Systemic architecture update needed -> /devenv-create-blueprint or /devenv-refine-blueprint
- Approach settled and implementation planning needed -> /devenv-plan-from-spec or /devenv-create-implementation-plan

## Appendix (optional): Technical design handoff context

Use this appendix only when helpful for downstream formal technical design work.

- Additional constraints discovered during discussion
- Context that shaped the final decision
- Edge cases, assumptions to validate, and implementation cautions
- References another AI/human should read before drafting blueprint/grooming artifacts
```
