# Design-<topic>-NNN.md template

Use this template when capturing a design discussion as a document. Keep it focused — design discussions are intentionally narrower than blueprints or requirements docs. If your draft is sprawling toward services/events/per-component sections, you've outgrown this template; escalate to `/devenv-create-blueprint`.

**Single-file only.** No splitting, no `Index.md` companion.

---

```markdown
# Design: <Topic in Title Case>

> **Status:** Draft | Accepted | Superseded by Design-<topic>-NNN.md
> **Date:** YYYY-MM-DD
> **Participants:** <names / handles>
> **Related:** <Blueprint-*.md, Requirements-*.md, issue links — if any>

## 1. Problem context

**What is the problem?** Be specific. Not "we need a better X" but "X fails at Y because Z."

**Why now?** What changed — load, requirements, understanding, scope — that makes this decision urgent today rather than next quarter?

**Who lives with the result?** Team(s), ops, customers, downstream consumers.

**Existing context.** Reference any blueprint, requirements doc, or prior decision that this builds on or contradicts.

## 2. Forces

The conflicting pressures that make this non-trivial. If there are no forces, there's no decision — just pick the obvious one and move on.

- **Force A vs. Force B** — explanation of the tension
- **Force C vs. Force D** — ...
- (typically 2–4 force pairs)

## 3. Options considered

Aim for **3–4**. Fewer is a rubber stamp; more is paralysis.

### Option A: <one-line name>

**Overview.** One-sentence description.

**How it works.** Sketch — components, sequence, integration with existing system.

**Benefits.** Which forces does this resolve, and how specifically?

**Drawbacks.** Which forces remain unresolved? What gets harder?

**Risks.** What could break? What assumptions might be wrong?

**Mitigations.** What would reduce the impact of each significant risk? Be honest — some risks can't be mitigated, only accepted.

**Effort.** Rough sizing: dev, testing, rollout, maintenance, team learning curve.

### Option B: <one-line name>

(same structure)

### Option C: <one-line name>

(same structure)

## 4. Trade-off comparison

Only include dimensions that actually discriminate the options.

| Dimension | Option A | Option B | Option C |
|---|---|---|---|
| Resolves core problem | ... | ... | ... |
| Dev effort | ... | ... | ... |
| Maintenance | ... | ... | ... |
| Team learning curve | ... | ... | ... |
| Risk level | ... | ... | ... |
| 2-year regret risk | ... | ... | ... |

## 5. Recommendation

**Pick:** Option <X>.

**Reasoning** — tie back to the forces explicitly:

- Resolves <force tension> by <mechanism>
- Accepts <trade-off> in exchange for <benefit>
- Avoids <pitfall> that bit us in <prior context, if any>

**If overruled:** if the team chose a different option, record it here along with the risks being accepted and any agreed contingencies.

## 6. Assumptions

Assumptions whose invalidation would change the recommendation. For each, sketch how to check it.

- **Assumption 1.** <statement> — *Check by:* <approach>
- **Assumption 2.** <statement> — *Check by:* <approach>

## 7. Open questions / follow-ups

- [ ] Question or follow-up item
- [ ] ...

Suggested next steps (delete those that don't apply):
- Feasibility check needed → `/devenv-spike`
- Ready to formalise systemically → `/devenv-create-blueprint`
- Ready to plan implementation → `/devenv-create-implementation-plan`
- In-flight refactor execution → see `repos/docs.engineering/docs/NOICE/Context_Library/Architectural_Change/`

## Revision history

| Date | Change | Author |
|---|---|---|
| YYYY-MM-DD | Initial draft | <name> |
```
