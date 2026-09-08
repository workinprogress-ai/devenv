---
name: devenv-spike
description: Run an exploratory investigation of a question, build a throwaway prototype if needed, and produce a structured findings + recommendation doc. Empowered like the bug hunter: may create code to prove something, modify target-repo code, and run destructive-class experiments — with just-in-time user permission and a clear recovery route (user-run git reset). USE WHEN the user says "spike on X", "investigate whether we can Y", "explore the feasibility of Z", "throwaway prototype for Q", "do a quick proof-of-concept", or hands off an open question that needs research before any plan exists. Auto-detects input: a free-form question, or a GitHub issue number whose body describes the question. Produces a markdown doc (`spike-NNN-<topic>.md`) at the workspace root, an explicitly throwaway prototype under `playground/devenv-spike-<topic>-<date>/` if code was needed, and a chat summary. Optionally offers to open a draft issue with the findings. All artifacts are clearly marked "NOT FOR PRODUCTION". DO NOT USE for writing production code (use `/devenv-pair-programming` or `/devenv-delegation`), for lightweight thinking-out-loud without artifacts (use `/devenv-rubber-duck`), for executing an approved plan (use `/devenv-pair-programming` or `/devenv-delegation`), or for verifying a specific suspected bug (use `/devenv-bug-hunter`).
argument-hint: A question / problem statement to investigate, OR a GitHub issue number containing the question
---

# Spike

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` at the active project root for `/devenv-skill-maintenance`.

> **Aggressive-measures gate.** The spike is empowered like the bug hunter: some questions can only be answered by doing — creating code to prove something works, modifying target-repo code, deleting code to test what breaks, or running destructive-class experiments. The default lane is read-only plus a `playground/` prototype; anything beyond that (in-repo edits, behavior-altering changes, deletions, environment mutation) requires **just-in-time consent**: if the needed aggression level is visible at planning, ask then; otherwise ask the moment it emerges in investigation. Before any destructive-class action, announce the category and get a go-ahead — including the warning that afterward the user should be prepared to `git reset` the affected repo. The spike NEVER runs mutating git commands itself; restore is always the user's hands. Every temporary in-repo modification carries `TODO:(DEVENV[spike]): ...` markers so nothing empowered blends into permanent code unnoticed.

> **Recovery-route rule.** No aggressive measure without a clear recovery path stated *before* the action: what will be touched, and how it comes back (usually user-run `git reset`, plus any non-git state — spun-up containers, generated files — with their teardown). If recovery cannot be described, the measure is not taken; reframe the experiment inside `playground/` instead.

> **Scope fence.** Read and explore freely across `repos/` — the investigation may wander in pursuit of the answer. But modify code ONLY in the agreed target repo(s), and only with the consent flow above. Expanding the change-scope requires explicit user permission, raised as a `🔶` decision gate.

Run a focused, exploratory investigation of an open question. Output is a structured findings doc and (optionally) throwaway prototype code — never production code. The goal is to reduce uncertainty before committing to a real implementation plan.

## When to Use

- The user wants to know whether something is feasible before committing to it.
- The right approach is unclear and needs to be discovered, not designed up front.
- A `/devenv-create-implementation-plan` invocation would stall on too many unknowns.
- A question can be answered faster by trying it than by reasoning about it.

If the user wants production code, use `/devenv-pair-programming` (collaborative) or `/devenv-delegation` (commissioned autonomous mechanical run). If the user wants to think out loud without producing artifacts, use `/devenv-rubber-duck`.

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

- **In-repo experiments (empowered lane):** when the question can only be answered by touching real code — patching a call path, swapping a dependency version, deleting a module to see what breaks, instrumenting a hot path — propose the specific edit, its aggression class, and the recovery route first:
  > *"To answer this, I need to [specific modification] in `repos/<target>`. That's a behavior-altering edit — afterward you'd `git reset` this repo (your hands, not mine). I'll mark it `TODO:(DEVENV[spike]): ...`. Proceed?"*
  On approval: make the minimal change, mark it, run the experiment, capture results. Never widen beyond what was approved.
- Run experiments. Capture commands, outputs, and observations as you go (you'll need them for the findings doc).
- If the spike grows beyond rough exploration, stop and recommend `/devenv-create-implementation-plan` instead.

**Before closeout, decide modified-code fate:** if in-repo edits were made, ask the user what survives — keep (cherry-pick into a real branch/plan), discard (dies with the user's `git reset`), or promote (becomes the seed of an implementation plan). Flag anything worth salvaging BEFORE the reset; once the user resets, uncommitted experiments are gone.

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

> *"Want to track this in a GitHub issue? I can create a new one, or post the findings to an existing issue number. The findings doc will go in a comment; the description stays as a short placeholder for `/devenv-create-implementation-plan`."*

If yes:

1. **New issue or existing?** Ask whether to create a new issue or use an existing one. If the user provides an issue number, skip to step 4.

2. **Draft the issue title** — propose and ask the user to confirm or adjust:
   - `Spike: <one-line topic> — <YYYY-MM-DD>`

3. **Draft the issue body** (placeholder only — findings go in the comment):
   ```
   Spike findings are in a comment identified by artifact doc_id.

   Next step depends on the scope of work the spike revealed:
   - System-level architectural work → `/devenv-create-blueprint`
   - Component design direction needed before tasks can be written → `/devenv-grooming`
   - Narrow, well-scoped implementation (spike answered the key unknowns) → `/devenv-create-implementation-plan <issue number>`

   Findings file: `<workspace-relative path to spike-NNN-<topic>.md>`
   Prototype: `<path>` (if applicable)
   ```

4. **Show a preview** (title + body for new issues; first ~15 lines of the findings content for existing) and ask:
   > *"Ready to post the findings? (y/n)"*

5. On confirmation:

   **If creating a new issue:**
   - `GITHUB_REPO=<owner>/<repo> issue-create --title "<title>" --type "<type>" --body "<body>" --no-template`
   - `issue-create` has no `--repo` flag; the target repo is selected via the `GITHUB_REPO` env var. `--type` is required for non-interactive creation — pick from `tools/config/issues-config.yml` (Bug, Feature, Task, Epic); for spike findings this is normally `Task` unless the user says otherwise.
   - Note the new issue number.
   - Apply the [Artifact Identity Convention](../_conventions.md#artifact-identity-convention).
   - Write the findings doc to a temp file with `doc_id: <value>` in first 256 characters.
   - `issue-artifact-upsert --issue <N> --body-file <temp-file>`
   - Surface the issue URL.

   **If posting to an existing issue:**
   - Apply the [Artifact Identity Convention](../_conventions.md#artifact-identity-convention).
    - If the issue may already contain one or more spike artifacts, resolve the canonical artifact first with `issue-artifact-select` or `issue-artifact-list`, then read it with `issue-artifact-get` before republishing.
   - Write the findings doc to a temp file with `doc_id: <value>` in first 256 characters.
   - `issue-artifact-upsert --issue <N> --body-file <temp-file>`
   - If upsert reports a duplicate `doc_id` conflict, stop and ask the user which comment ID to keep as canonical.
   - Surface the issue URL.

   The local spike file is the canonical record; the GH issue comment identified by `doc_id` is a published copy kept in sync via upsert. (Same file-canonical rule as `/devenv-design-discussion` per [issue-artifact-integration](../../common/references/issue-artifact-integration.md).)

Never create an issue or post a comment without explicit "yes" confirmation.

**Upstream-impact discovery:** if the investigation concludes that a specification or blueprint assumption is invalidated (not just a task-level unknown resolved), say so in the findings and offer to file an **upstream-impact issue** in the planning repo instead of (or alongside) the findings issue above: `GITHUB_REPO=<org>/<planning-repo> issue-create --type Task --label upstream-impact --no-template`, body covering what was invalidated, why, and the affected upstream sections. The refine skills consume this queue in cascade mode.

## Anti-patterns

- **Drifting into production code** — spikes are throwaway. If the prototype is becoming clean and complete, stop and write a plan with `/devenv-create-implementation-plan`. Resist the urge to "just polish it a bit". (Empowered in-repo experiments are not production code — they are marked, consented, and reset away.)
- **Unannounced aggression** — modifying target-repo code, deleting anything, or mutating environments without the consent gate and a stated recovery route. Powerful but announced, always.
- **Unmarked in-repo edits** — empowered changes without `TODO:(DEVENV[spike]): ...` markers can slip into a commit; the marker keeps the reset clean and intentional.
- **Running the reset yourself** — the spike never runs mutating git commands. Recovery is the user's hands, every time.
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
- `/devenv-pair-programming`, `/devenv-delegation` (commissioned autonomous mechanical run) — for the actual implementation once the spike resolves.

See the [Skills catalog](../common/references/skills-catalog.md) for the full list and decision tree.
