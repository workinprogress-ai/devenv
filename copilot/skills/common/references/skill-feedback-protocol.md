# Skill Feedback Protocol

Shared protocol for capturing evidence-backed improvement observations about the workspace's custom skill system in `IMPROVEMENT_REPORT.md` at the active project root so they can be used by `/devenv-skill-maintenance`.

Use this protocol when the user asks how a skill could be improved with no defect alleged, for example:

- "how could this skill be improved?"
- "capture improvement feedback from this session"
- "any suggestions for the skill itself?"

This is the sibling of the [Diagnostic Mode Protocol](diagnostic-mode-protocol.md). Diagnostic mode captures **errata** — something undesirable happened and must be captured for repair. This protocol captures **improvement observations** — nothing is broken, but concrete interactions suggest the skill's guidance could work better. If the user reports undesirable output or action, use diagnostic mode instead; if the ask is "make it better" rather than "that was wrong", use this protocol.

Organization-specific implementation lessons belong to the [Knowledge Distillation Protocol](knowledge-distillation-protocol.md); this protocol covers only the skill system itself.

## When to run

- **On explicit request only**, at any point in a session. Never offer to run this protocol unprompted; whether proactive offers should exist at all is deferred to the offer-gating design tracked in the devenv repo.

Unlike diagnostic mode, feedback capture never short-circuits implementation flow — it runs at a natural pause and does not preempt fixes.

## Evidence bar (non-negotiable)

- **A request to look is not an obligation to find.** Most sessions yield zero evidence-backed improvement candidates; an empty report is a valid and expected outcome. Never produce a finding to satisfy the request.
- **Every candidate must cite a concrete observed interaction moment** — what the user said or did, and what the skill did, specific enough to re-locate in the session. Generic suggestions ("be more detailed", "improve clarity") without a supporting moment are not findings.
- **Mark observed vs. inferred.** Directly observed friction (user correction, rework, repeated clarification) is observed; "this might be confusing" is inferred and must be labeled as such.
- **Confidence is honest per finding.** Weak evidence is labeled weak, with what would strengthen it.
- **Record rejected candidates** when any were considered and dropped, with the reason. This keeps the report honest about the search, not just the survivors.

## Acquisition pattern

Mine the session for interaction moments that suggest the skill's guidance could work better:

- The user corrected, worked around, or silently ignored part of the skill's flow without reporting it as a defect.
- The user repeatedly clarified something the skill should have settled once (or the skill over-asked about something already settled).
- A step the skill performed added no value for this user or workflow and was tolerated rather than welcomed.
- The user expressed a stable working preference ("I always do X first") that the skill's flow does not accommodate.

Each candidate must pass the evidence bar above. Expect few or zero.

## Output contract

When skill feedback is requested, write the report to:

- `IMPROVEMENT_REPORT.md` in the active project root.

Active project root means the repository currently being worked on for the request. If no narrower target repo is active, use the workspace root.

This is mandatory for feedback requests unless the user explicitly asks for a different path/filename. The report overwrites any previous `IMPROVEMENT_REPORT.md` at the same location, mirroring `DIAGNOSTIC_REPORT.md` semantics.

Do not emit the full report body in chat by default. After writing the file, return a brief confirmation with the path.

## Reasoning safety rule

Do **not** expose hidden internal chain-of-thought. Describe observations and candidates in concise, user-facing terms: what happened, what it suggests, and how confident the match is.

## Markdown template (file contents)

```markdown
## Skill Improvement Feedback Report (DEVENV)

- timestamp_utc: <ISO-8601>
- active_skill: </devenv-... | none>
- user_intent_summary: <one paragraph>
- finding_count: <N — zero is valid and expected>

### Candidate Improvements

#### 01. <short title>
- observation: <the concrete interaction moment — user words/actions and skill behavior>
- evidence_type: <observed | inferred>
- improvement: <what could work better, concretely>
- proposed_target: <file path and section, if known>
- confidence: <low|medium|high>
- what_would_strengthen: <what additional observation would raise confidence>

#### 02. <short title>
<same fields>

### Rejected / Weak Candidates
- <candidate considered and dropped>: <reason it failed the evidence bar>

### Confidence
- overall_confidence: <low|medium|high>
- additional_data_needed: <what would most improve confidence>
```

If `finding_count` is `0`, replace the Candidate Improvements section with a short statement that no evidence-backed findings emerged from the session, and keep any Rejected / Weak Candidates entries with their reasons. Do not pad.

## Quality bar

- Specific over generic; cite concrete moments, files, or sections when known.
- Every finding traces to an observed interaction moment; observed vs. inferred is marked.
- Zero findings is stated explicitly and plainly — it is a valid result, not a failure.
- Keep the file self-contained so `/devenv-skill-maintenance` can act (or legitimately decline to act) without extra context.

## Pre-send validation

- Did I write `IMPROVEMENT_REPORT.md` to the active project root?
- Does every finding cite a specific observed moment, with observed/inferred marked and honest confidence?
- If there are no evidence-backed findings, does the report say exactly that?
- Did I record rejected weak candidates rather than silently promoting or dropping them?
- Is the file self-contained for `/devenv-skill-maintenance`?
- Did I avoid outputting the full report body in chat by default?
