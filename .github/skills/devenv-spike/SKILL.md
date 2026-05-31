---
name: devenv-spike
description: Run an exploratory investigation of a question, build a throwaway prototype if needed, and produce a structured findings + recommendation doc. USE WHEN the user says "spike on X", "investigate whether we can Y", "explore the feasibility of Z", "throwaway prototype for Q", "do a quick proof-of-concept", or hands off an open question that needs research before any plan exists. Auto-detects input: a free-form question, or a GitHub issue number whose body describes the question. Produces a markdown doc (`spike-NNN-<topic>.md`) at the workspace root, an explicitly throwaway prototype under `playground/devenv-spike-<topic>-<date>/` if code was needed, and a chat summary. Optionally offers to open a draft issue with the findings. All artifacts are clearly marked "NOT FOR PRODUCTION". DO NOT USE for writing production code (use `/devenv-pair-programming` or `/devenv-delegation`), for lightweight thinking-out-loud without artifacts (use `/devenv-rubber-duck`), or for executing an approved plan (use `/devenv-pair-programming` or `/devenv-delegation`).
argument-hint: A question / problem statement to investigate, OR a GitHub issue number containing the question
---

# Spike

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

Run a focused, exploratory investigation of an open question. Output is a structured findings doc and (optionally) throwaway prototype code — never production code. The goal is to reduce uncertainty before committing to a real implementation plan.

## When to use this skill

- The user wants to know whether something is feasible before committing to it.
- The right approach is unclear and needs to be discovered, not designed up front.
- A `/devenv-create-implementation-plan` invocation would stall on too many unknowns.
- A question can be answered faster by trying it than by reasoning about it.

If the user wants production code, use `/devenv-pair-programming` or `/devenv-delegation`. If the user wants to think out loud without producing artifacts, use `/devenv-rubber-duck`.

## Inputs

The user provides one of:

- **A free-form question / problem statement** — e.g. "can we use library X for our message bus?" or "what's the perf cost of serializing every event through Y?"
- **A GitHub issue number** — e.g. `42`. Fetch the issue body via `issue-get N --pretty`; the body describes the question.

**Auto-detection rule:** `^[0-9]+$` → issue number; otherwise treat as free-form. Ambiguous → ask.

## Workflow

### 1. Frame the question

Restate the question in one sentence. Confirm with the user before investigating:

> "I'll investigate: **<one-sentence framing>**. Anything to add or narrow before I start?"

If the framing is fuzzy, ask one focused clarifying question. Don't run a full interview — spikes work best when the question is clear.

### 2. Plan the investigation (briefly)

Inline in chat, list 2–4 angles you'll explore:

- Read relevant existing code / docs
- Try approach A
- Try approach B (if A doesn't work)
- Measure / compare

Keep it loose. Spikes are non-linear by nature.

### 3. Investigate

Do the work:

- Read code, docs, or external references as needed.
- If a prototype is required, create it under `playground/devenv-spike-<topic>-<YYYY-MM-DD>/` at the workspace root. Use a short slug for `<topic>`.
- Add a `README.md` to the prototype directory with a prominent header:

  ```markdown
  # ⚠️ THROWAWAY — NOT FOR PRODUCTION

  This is exploratory code from a spike. It is intentionally minimal,
  may have shortcuts, and is **not** intended to be merged or maintained.
  ```

- Run experiments. Capture commands, outputs, and observations as you go (you'll need them for the findings doc).
- If the spike grows beyond rough exploration, stop and recommend `/devenv-create-implementation-plan` instead.

### 4. Write the findings doc

Write `spike-NNN-<topic>.md` at the workspace root, where `NNN` is the next unused 3-digit suffix (never overwrite an existing spike doc). Structure:

```markdown
# ⚠️ SPIKE — NOT FOR PRODUCTION

# Spike: <one-line topic>

**Date**: YYYY-MM-DD
**Source**: free-form question (or `issue #42`)
**Prototype**: `playground/devenv-spike-<topic>-<date>/` (if applicable)

## Question

<The framed question, one or two sentences.>

## Approach

<What was tried, in order. Bullet points or short paragraphs. Include relevant commands and references.>

## Findings

<What was learned. Each finding is a bullet with evidence — code snippet, perf number, file link, or external reference. Distinguish "verified by trying" from "inferred from docs".>

## Recommendation

<One of:
- Do X (with rationale)
- Don't do Y (with rationale)
- More investigation needed (with the specific next question)
>

## Open questions

<Anything the spike surfaced but didn't answer. These are inputs to the next spike or to `/devenv-create-implementation-plan`.>
```

### 5. Summarise to chat

Inline summary: 3–5 bullets covering the question, the verdict, and the artifacts produced (doc path, prototype path).

### 6. Optional: file a GitHub issue

After writing the findings doc, ask:

> *"Want to file a GitHub issue to track this work? I'll add the spike findings as a comment and leave the description as a short placeholder so it can be picked up with `/devenv-plan-from-spec` later."*

If yes:

1. **Draft the issue title** — propose and ask the user to confirm or adjust:
   - `Spike: <one-line topic> — <YYYY-MM-DD>`

2. **Draft the issue body** (placeholder only — findings go in the comment):
   ```
   Spike findings are in the first comment below.

   Next step: use `/devenv-plan-from-spec <issue number>` to generate an implementation plan from the findings.
   Findings file: `<workspace-relative path to spike-NNN-<topic>.md>`
   Prototype: `<path>` (if applicable)
   ```

3. **Show a preview** (title, body, and first ~15 lines of the comment content) and ask:
   > *"Ready to create the issue and post the comment? (y/n)"*

4. On confirmation:
   - `issue-create --repo "$GITHUB_REPO" --title "<title>" --body "<body>"`
   - Write the spike findings doc to a temp file
   - `issue-comment <N> --body-file <temp-file>`
   - Surface the issue URL.

Never create an issue or post a comment without explicit "yes" confirmation.

## Anti-patterns

- **Drifting into production code** — spikes are throwaway. If the prototype is becoming clean and complete, stop and write a plan with `/devenv-create-implementation-plan`. Resist the urge to "just polish it a bit".
- **Hiding the throwaway-ness** — every artifact must carry the "NOT FOR PRODUCTION" header. No exceptions.
- **Skipping the framing step** — an unframed spike sprawls. Restate the question in one sentence before starting.
- **Burying findings in chat** — always write the doc. Chat is ephemeral; the doc is the deliverable.
- **Recommending without evidence** — every recommendation traces back to a finding. If you can't show your work, you didn't spike, you guessed.
- **Skipping the recommendation** — even "more investigation needed" is a real answer. The doc must end with a verdict.

## Sibling skills

- `/devenv-create-implementation-plan` — use spike findings as input to a real plan.
- `/devenv-design-discussion` — when the question is "which approach?" not "is this feasible?" — reasoning, not prototyping.
- `/devenv-refine-blueprint` — if the spike changes or invalidates an architectural decision, follow up here.
- `/devenv-rubber-duck` — lighter-weight thinking-out-loud without artifacts.
- `/devenv-pair-programming`, `/devenv-delegation` — for the actual implementation once the spike resolves.

See the [Skills catalog](../../../docs/Skills.md) for the full list and decision tree.
