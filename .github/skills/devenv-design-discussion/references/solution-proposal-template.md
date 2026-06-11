# Solution_Proposal_<topic>-NNN.md template

Use this template when capturing outputs from design discussion. The goal is a decision-ready proposal that can be consumed by engineers, architects, and management.

---

```markdown
# Solution Proposal: <Topic in Title Case>

> **Status:** Draft | Recommended | Approved | Superseded
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

## 4. Options considered

Aim for 2-4 viable options.

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

## 5. Comparison table

| Dimension | Option A | Option B | Option C |
|---|---|---|---|
| Resolves core problem | ... | ... | ... |
| Development effort | ... | ... | ... |
| Maintenance burden | ... | ... | ... |
| Team learning curve | ... | ... | ... |
| Timeline to production | ... | ... | ... |
| Risk level | ... | ... | ... |
| 2-year regret risk | ... | ... | ... |

## 6. Recommendation and rationale

**Pick:** Option <X>

**Rationale:** tie to forces and constraints explicitly.

**If a different option is chosen:** capture accepted risks and contingency actions.

## 7. Assumptions and dependencies

- **Assumption 1** - validation approach
- **Dependency 1** - owner and timing

## 8. Follow-up work

- [ ] Follow-up item
- [ ] Follow-up item

Suggested next steps:
- Feasibility uncertainty remains -> /devenv-spike
- Systemic architecture update needed -> /devenv-create-blueprint or /devenv-refine-blueprint
- Approach settled and implementation planning needed -> /devenv-plan-from-spec or /devenv-create-implementation-plan

## Revision history

| Date | Change | Author |
|---|---|---|
| YYYY-MM-DD | Initial draft | <name> |
```
