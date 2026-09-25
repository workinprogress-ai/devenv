---
name: devenv-research
description: Run a timeboxed exploratory investigation of an open question — throwaway by design: a structured findings + recommendation doc, and a prototype under playground/research--/ only if code was needed to answer the question. All artifacts are NOT FOR PRODUCTION; the skill ends at the findings handback (next steps route to /devenv-plan). Empowered like /devenv-hunt: may create code to prove something and run destructive-class experiments with just-in-time user permission (user-run git reset as recovery). USE WHEN the user says "research X", "spike on X", "investigate whether we can Y", "explore the feasibility of Z", "do a quick proof-of-concept", or hands off an open question that needs research before any plan exists. Input: a free-form question or an issue number. Produces a research-NNN-<topic>.md findings doc and a chat summary; optionally offers a draft issue. DO NOT USE for writing production code (use /devenv-pair or /devenv-delegate), for executing an approved plan (use /devenv-pair or /devenv-delegate), for verifying a specific suspected bug (use /devenv-hunt), or for work intended to ship — if it should survive into production, it is not research.
argument-hint: A question / problem statement to investigate, OR an issue number containing the question
user-invocable: true
---

# Research

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`.

> **Skill feedback:** If nothing is wrong but the user asks how the skill could be improved, follow the shared [Skill Feedback Protocol](../common/references/skill-feedback-protocol.md) to write `IMPROVEMENT_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`. Zero findings is a valid result; never offer unprompted.

> **Aggressive-measures gate, recovery-route rule, scope fence.** The research session runs under the shared [Empowered-Investigation Gate](../common/references/empowered-investigation-gate.md): just-in-time consent outlining what/why, category announcement before destructive-class actions, disapproval rejects the measure not the investigation, and no self-run mutating git commands. Mode-scoped deltas: the default lane is read-only plus a `playground/` prototype; temporary in-repo modifications carry `FIXME:DEVENV[research]: ...` markers; exhausted alternates end the run with the question reported **unanswerable as scoped**, reframed inside `playground/`.

Run a focused, exploratory investigation of an open question. Output is a structured findings doc and (optionally) throwaway prototype code — never production code. The goal is to reduce uncertainty before committing to a real plan.

## When to Use

- The user wants to know whether something is feasible before committing to it.
- The right approach is unclear and needs to be discovered, not designed up front.
- A `/devenv-plan` invocation would stall on too many unknowns.
- A question can be answered faster by trying it than by reasoning about it.

If the user wants production code, use `/devenv-pair` (collaborative) or `/devenv-delegate` (commissioned autonomous mechanical run).

## Inputs

The user provides one of:

- **A free-form question / problem statement** — e.g. "can we use library X for our message bus?" or "what's the perf cost of serializing every event through Y?"
- **An issue number** — e.g. `42`. Fetch the issue body via `issue-get N --pretty`; the body describes the question.
- **A structured handoff block** — plan-encoded research tasks (`owner: User`) and grooming research handoffs deliver the question, why it matters, constraints, and a return route. Honor the block as the question source and the stated return route as the findings destination.

**Auto-detection rule:** `^[0-9]+$` → issue number; otherwise treat as free-form. Ambiguous → ask.

## Workflow

### 1. Frame the question

Before any in-repo inspection or modification, run `devenv-marker-check --todo-report <target-scope>`. Every reported TODO is a prior session's cross-plan message: surface it in chat and honor its condition — or explicitly resolve it with the user — before that file is touched.

Restate the question in one sentence. Confirm with the user before investigating:

> "I'll investigate: **<one-sentence framing>**. Anything to add or narrow before I start?"

If the framing is fuzzy, ask one focused clarifying question. Don't run a full interview — research sessions work best when the question is clear.

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
- If a prototype is required, create it under `playground/devenv-research-<topic>-<YYYY-MM-DD>/` at the workspace root. Use a short slug for `<topic>`.
- Add a `README.md` to the prototype directory with a prominent header:

  ```markdown
  # ⚠️ THROWAWAY — NOT FOR PRODUCTION

  This is exploratory code from a research session. It is intentionally minimal,
  may have shortcuts, and is **not** intended to be merged or maintained.
  ```

- **In-repo experiments (empowered lane):** when the question can only be answered by touching real code — patching a call path, swapping a dependency version, deleting a module to see what breaks, instrumenting a hot path — propose the specific edit, why it is needed, its aggression class, and the recovery route first:
  > *"To answer this, I need to [specific modification] in `repos/<target>`. That's a behavior-altering edit — afterward you'd `git reset` this repo (your hands, not mine). I'll mark it `FIXME:DEVENV[research]: ...`. Proceed?"*
  On approval: make the minimal change, mark it, run the experiment, capture results. Never widen beyond what was approved.
- Run experiments. Capture commands, outputs, and observations as you go (you'll need them for the findings doc).
- If the research grows beyond rough exploration, stop and recommend `/devenv-plan` instead.

**Before closeout, decide modified-code fate:** if in-repo edits were made, ask the user what survives — keep (cherry-pick into a real branch/plan), discard (dies with the user's `git reset`), or promote (becomes the seed of a plan). Flag anything worth salvaging BEFORE the reset; once the user resets, uncommitted experiments are gone.

### 4. Write the findings doc

Write `research-NNN-<topic>.md` under the target repo's `.local-artifacts/` folder (the [standard local markdown folder](../_conventions.md#standard-local-markdown-folder-local-artifacts); use the workspace's `.local-artifacts/` when no single target repo is active), where `NNN` comes from `next-id --pattern 'research-{N}-*' --width 3 --dir <artifacts-folder> --filename` (never overwrites an existing research doc). Structure:

```markdown
# ⚠️ SPIKE — NOT FOR PRODUCTION

# Spike: <one-line topic>

**Date**: YYYY-MM-DD
**Source**: free-form question (or `issue #42`)
**Prototype**: `playground/devenv-research-<topic>-<date>/` (if applicable)

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

<Anything the research surfaced but didn't answer. These are inputs to follow-up research or to `/devenv-plan`.>
```

### 5. Summarise to chat

Inline summary: 3–5 bullets covering the question, the verdict, and the artifacts produced (doc path, prototype path).

### 6. Optional: file an issue

After writing the findings doc, ask:

> *"Want to track this in an issue? I can create a new one, or post the findings to an existing issue number. The findings doc will go in a comment; the description stays as a short placeholder for `/devenv-plan`."*

If yes:

1. **New issue or existing?** Ask whether to create a new issue or use an existing one. If the user provides an issue number, skip to step 4.

2. **Draft the issue title** — propose and ask the user to confirm or adjust:
   - `Spike: <one-line topic> — <YYYY-MM-DD>`

3. **Draft the issue body** (placeholder only — findings go in the comment):
   ```
   Spike findings are in a comment identified by artifact doc_id.

   Next step depends on the scope of work the research revealed:
   - System-level architectural work → `/devenv-create-blueprint`
   - Component design direction needed before tasks can be written → `/devenv-groom`
   - Narrow, well-scoped implementation (the research answered the key unknowns) → `/devenv-plan <issue number>`

   Findings file: `<workspace-relative path to research-NNN-<topic>.md>`
   Prototype: `<path>` (if applicable)
   ```

4. **Show a preview** (title + body for new issues; first ~15 lines of the findings content for existing) and ask:
   > *"Ready to post the findings? (y/n)"*

5. On confirmation:

   **If creating a new issue:**
   - Run `issue-create` per the [deterministic issue creation recipe](../_shared/references/provider-protocols/github.md#deterministic-issue-creation), resolving the target `<owner>/<repo>` per the [repository targeting rules](../_shared/references/provider-protocols/github.md#repository-targeting). For research findings the type is normally `Task` unless the user says otherwise.
   - Note the new issue number.
   - Apply the [Artifact Identity Convention](../_conventions.md#artifact-identity-convention).
   - Write the findings doc to `.local-artifacts/tmpN.md` (next free number) with `doc_id: <value>` in first 256 characters.
   - `issue-artifact-upsert --issue <N> --body-file <that-file>`
   - Surface the issue URL.

   **If posting to an existing issue:**
   - Apply the [Artifact Identity Convention](../_conventions.md#artifact-identity-convention).
    - If the issue may already contain one or more research artifacts, resolve the canonical artifact first with `issue-artifact-select` or `issue-artifact-list`, then read it with `issue-artifact-get` before republishing.
   - Write the findings doc to `.local-artifacts/tmpN.md` (next free number) with `doc_id: <value>` in first 256 characters.
   - `issue-artifact-upsert --issue <N> --body-file <that-file>`
   - If upsert reports a duplicate `doc_id` conflict, stop and ask the user which comment ID to keep as canonical.
   - Surface the issue URL.

   The local research file is the canonical record; the GH issue comment identified by `doc_id` is a published copy kept in sync via upsert. (Same file-canonical rule as `/devenv-design` per [issue-artifact-integration](../common/references/issue-artifact-integration.md).)

Never create an issue or post a comment without explicit "yes" confirmation.

**Upstream-impact discovery:** if the investigation concludes that a specification or blueprint assumption is invalidated (not just a task-level unknown resolved), say so in the findings and offer to file an **upstream-impact issue** in the planning repo instead of (or alongside) the findings issue above, per the [upstream-impact filing recipe](../_shared/references/provider-protocols/github.md#upstream-impact-filing). The refine skills consume this queue in cascade mode.

## Next-step offer

Per the shared [next-step offer](../common/references/execution-gates.md#next-step-offer-wrap-up-convention) convention, wrap-up ends with one structured offer: the findings doc feeds `/devenv-plan` ("plan this") if the question resolved into implementable work, or another research pass if unknowns remain.

## Anti-patterns

- **Drifting into production code** — research artifacts are throwaway. If the prototype is becoming clean and complete, stop and write a plan with `/devenv-plan`. Resist the urge to "just polish it a bit". (Empowered in-repo experiments are not production code — they are marked, consented, and reset away.)
- **Unannounced aggression** — modifying target-repo code, deleting anything, or mutating environments without the consent gate and a stated recovery route. Powerful but announced, always.
- **Treating a declined measure as a dead end** — disapproval reroutes the investigation (deeper reading, `playground/` prototype, different experiment); only exhausted alternates stop it, and any aggressive alternate re-enters the gate.
- **Unmarked in-repo edits** — empowered changes without `FIXME:DEVENV[research]: ...` markers can slip into a commit; the marker keeps the reset clean and intentional.
- **Running the reset yourself** — the research session never runs mutating git commands. Recovery is the user's hands, every time.
- **Hiding the throwaway-ness** — every artifact must carry the "NOT FOR PRODUCTION" header. No exceptions.
- **Skipping the framing step** — an unframed research session sprawls. Restate the question in one sentence before starting.
- **Burying findings in chat** — always write the doc. Chat is ephemeral; the doc is the deliverable.
- **Recommending without evidence** — every recommendation traces back to a finding. If you can't show your work, you didn't research it, you guessed.
- **Skipping the recommendation** — even "more investigation needed" is a real answer. The doc must end with a verdict.

## Sibling skills

- `/devenv-plan` — use research findings as input to a real plan.
- `/devenv-design` — when the question is "which approach?" not "is this feasible?" — reasoning, not prototyping.
- `/devenv-refine-blueprint` — if the research changes or invalidates an architectural decision, follow up here.
- `/devenv-pair`, `/devenv-delegate` (commissioned autonomous mechanical run) — for the actual implementation once the research resolves.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
