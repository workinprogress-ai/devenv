---
name: devenv-research
description: Run a timeboxed exploratory investigation of an open question — throwaway by design: a structured findings + recommendation doc, and a prototype under playground/devenv-research-<topic>-<date>/ if code is needed to answer the question. All artifacts are NOT FOR PRODUCTION; the skill ends at the findings handback (next steps route to /devenv-plan). Empowered like /devenv-hunt: may create code to prove something and run destructive-class experiments with just-in-time user permission (user-run git reset as recovery). USE WHEN the user says "research X", "spike on X", "investigate whether we can Y", "explore the feasibility of Z", "do a quick proof-of-concept", or hands off an open question that needs research before any plan exists. Input: a free-form question or an issue number. Produces a research-NNN-<topic>.md findings doc and a chat summary; optionally offers a draft issue. DO NOT USE for writing production code (use /devenv-pair or /devenv-delegate), for executing an approved plan (use /devenv-pair or /devenv-delegate), for verifying a specific suspected bug (use /devenv-hunt), or for work intended to ship — if it should survive into production, it is not research.
argument-hint: A question / problem statement to investigate, OR an issue number containing the question
user-invocable: true
---

# Research

> **Diagnostic mode:** If the output or action seemed undesirable, say "enter diagnostic mode" and follow the shared [Diagnostic Mode Protocol](../common/references/diagnostic-mode-protocol.md) to write `DIAGNOSTIC_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`.

> **Skill feedback:** If nothing is wrong but the user asks how the skill could be improved, follow the shared [Skill Feedback Protocol](../common/references/skill-feedback-protocol.md) to write `IMPROVEMENT_REPORT.md` under `.local-artifacts/` at the active project root for `/devenv-skill-maintenance`. Zero findings is a valid result; never offer unprompted.

> **Aggressive-measures gate, recovery-route rule, scope fence.** The research session runs under the shared [Empowered-Investigation Gate](../common/references/empowered-investigation-gate.md): just-in-time consent outlining what/why, category announcement before destructive-class actions, disapproval rejects the measure not the investigation, and no self-run mutating git commands. Mode-scoped deltas: the default lane is read-only plus a `playground/` prototype; temporary in-repo modifications carry `FIXME:DEVENV[research]: ...` markers; exhausted alternates end the run with the question reported **unanswerable as scoped**, reframed inside `playground/`.
>
> **Scratchpad lane (preferred for in-repo experiments).** When the workspace provides the sandbox, propose entering it once — declaring the experiment classes (patching call paths, swapping dependency versions, deleting modules, instrumenting hot paths) — and run in-repo experiments under the gate's [scratchpad lane](../common/references/empowered-investigation-gate.md): within the declared scope, individual experiments don't re-ask, and `repo-scratchpad reset` restores the tree between experiments AI-safe. Dirty target repo: surface `git wip` to the USER (their hands — it commits a `WIP:` snapshot on the originating branch and pushes) or a normal commit before entering; the sandbox refuses dirty entry. Inside the sandbox raw git stays forbidden — `repo-scratchpad commit/reset/promote/exit` are the only unlocked wrappers. Anything worth keeping flows through `repo-scratchpad promote <sha>` (staged-uncommitted on the base branch, trailers re-acquired) at closeout, feeding the decide-modified-code-fate step below.
>
> **Mid-scratchpad refusal UX.** `git-wip` / `repo-commit` / `pr-create` refuse (exit 3) while a scratchpad is active — first line: `Error: <tool> is blocked while a scratchpad is active (...)`. That refusal is the sandbox working, not an error to route around: salvage via `repo-scratchpad promote`, or `repo-scratchpad exit` to leave the mode; never bypass by raw git.

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

Keep it loose. Research is non-linear by nature. Two pre-commitments are mandatory, though:

- **Timebox:** a budget stated at framing in **wall-clock time** (e.g. "45 real minutes", "this session, capped at ~2 hours") — not estimated man-hours, which measure a human's imaginary effort rather than this session's actual clock. Budgets set in session-agnostic units get renegotiated implicitly; a wall-clock number can be checked against `date` at the futility checkpoint. When the budget burns out, checkpoint (`🔶`): the user may **extend the budget** (stated in wall-clock again — "another 30 minutes"), reframe, or receive unanswerable-as-scoped. Extension is the user's call, never the session's own; one extension is normal, repeated extensions are a scope signal worth naming.
- **Kill criteria:** before building a prototype, declare what kills each approach — "approach B is dead if X" (a measurement threshold, a missing API, a hard blocker). Declared in advance, they are evidence; discovered afterward, they are rationalization.

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

- **In-repo experiments (empowered lane):** prefer the **scratchpad lane** when the workspace provides the sandbox (see the gate blockquote above): enter once with declared experiment classes, run in-repo experiments AI-safe (`repo-scratchpad reset` between them), salvage keepers with `repo-scratchpad promote`. Without the sandbox, the per-measure flow applies — propose the specific edit, why it is needed, its aggression class, and the recovery route first:
  > *"To answer this, I need to [specific modification] in `repos/<target>`. That's a behavior-altering edit — afterward you'd `git reset` this repo (your hands, not mine). I'll mark it `FIXME:DEVENV[research]: ...`. Proceed?"*
  On approval: make the minimal change, mark it, run the experiment, capture results. Never widen beyond what was approved.
- **Benchmark protocol (perf claims).** Any "which is faster / what's the cost" answer follows a fixed micro-protocol: measure a **baseline first**, run **N ≥ 5** iterations after warmup, report **variance** (min/median/max — not a single number), and keep the environment fixed across compared options. A number without spread is an anecdote, not a finding — label it accordingly or re-measure.
- **Real debuggers (answering behavioral questions).** When the question is "what does this code *actually* do at runtime" — `csharp-debug` (C#: drives the bootstrap-installed vsdbg; launch/attach → breakpoints, step, watch, evaluate), `node --inspect-brk` + js-debugger (TS/Node), debugpy (Python). All Rung-3-safe, scratchpad-compatible; observation only, unless the declared experiment classes say otherwise.
- **Ladder pointer.** Hunt's [escalation ladder](../devenv-hunt/SKILL.md) is the menu of investigation moves when behavioral questions stall — cheapest-discriminating-first, and the axes (isolation, visibility, destruction, realism) apply to research questions as much as to defects.
- Run experiments. Capture commands, outputs, and observations as you go (you'll need them for the findings doc).
- If the research grows beyond rough exploration, stop and recommend `/devenv-plan` instead.

**Before closeout, decide modified-code fate:** if in-repo edits were made, ask the user what survives — keep (cherry-pick into a real branch/plan), discard (dies with the user's `git reset`), or promote (becomes the seed of a plan). Flag anything worth salvaging BEFORE the reset; once the user resets, uncommitted experiments are gone.

### 4. Write the findings doc

Write `research-NNN-<topic>.md` under the target repo's `.local-artifacts/` folder (the [standard local markdown folder](../_conventions.md#standard-local-markdown-folder-local-artifacts); use the workspace's `.local-artifacts/` when no single target repo is active), where `NNN` is the number printed by `next-id --pattern 'research-{N}-*' --width 3 --dir <artifacts-folder>` (number only — `next-id` replaces just `{N}`, so `--filename` would print a literal `*`; compose the filename yourself, which never overwrites an existing research doc). Structure:

```markdown
# ⚠️ RESEARCH — NOT FOR PRODUCTION

# Research: <one-line topic>

**Date**: YYYY-MM-DD
**Source**: free-form question (or `issue #42`)
**Prototype**: `playground/devenv-research-<topic>-<date>/` (if applicable)

## Question

<The framed question, one or two sentences.>

## Approach

<What was tried, in order. Bullet points or short paragraphs. Include relevant commands and references.>

## Findings

<What was learned. Each finding is a bullet with evidence — code snippet, perf number, file link, or external reference. Every finding carries an explicit evidence class: **verified-by-execution** (ran and observed), **measured-with-spread** (benchmark protocol: baseline, N runs, variance), or **inferred-from-docs** (not tried — stated as such). A perf claim without its measurement spread is an anecdote, not a finding. When comparing options, emit a decision matrix — a criteria × options table with the criteria that actually drove the answer (e.g. correctness risk, integration cost, perf, maintainability), each cell backed by its evidence class; grooming and design consume this shape directly.>

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
   - `Research: <one-line topic> — <YYYY-MM-DD>`

3. **Draft the issue body** (placeholder only — findings go in the comment):
   ```
   Research findings are in a comment identified by artifact doc_id.

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
   - Run `issue-create` per the [deterministic issue creation recipe](../_shared/references/protocol-common.md#deterministic-issue-creation), resolving the target `<owner>/<repo>` per the [repository targeting rules](../_shared/references/protocol-common.md#repository-targeting). For research findings the type is normally `Task` unless the user says otherwise.
   - Note the new issue number.
   - Apply the [Artifact Identity Convention](../_conventions.md#artifact-identity-convention): derive the `doc_id` with `issue-artifact-doc-id --issue <N> --artifact-type research --source-file <research-NNN-<topic>.md>` and put `doc_id: <value>` in the first 256 characters of the findings file itself (`research-NNN-<topic>.md`, written in step 4 — never a `tmpN.md` copy, which carries no `doc_id` and is never upserted).
   - `issue-artifact-upsert --issue <N> --body-file <path to research-NNN-<topic>.md>`
   - Surface the issue URL.

   **If posting to an existing issue:**
   - Apply the [Artifact Identity Convention](../_conventions.md#artifact-identity-convention) (`issue-artifact-doc-id … --artifact-type research`; `doc_id: <value>` in the first 256 characters of `research-NNN-<topic>.md` itself).
   - If the issue may already contain one or more research artifacts, resolve the canonical artifact first with `issue-artifact-select` or `issue-artifact-list`, then read it with `issue-artifact-get` before republishing.
   - `issue-artifact-upsert --issue <N> --body-file <path to research-NNN-<topic>.md>`
   - If upsert reports a duplicate `doc_id` conflict, stop and ask the user which comment ID to keep as canonical.
   - Surface the issue URL.

   The local research file is the canonical record; the issue comment identified by `doc_id` is a published copy kept in sync via upsert. (Same file-canonical rule as `/devenv-design`, per the [source-of-truth rule](../common/references/issue-backed-artifact-edit-protocol.md#source-of-truth-rule).)

Never create an issue or post a comment without explicit "yes" confirmation.

**Upstream-impact discovery:** if the investigation concludes that a specification or blueprint assumption is invalidated (not just a task-level unknown resolved), say so in the findings and offer to file an **upstream-impact issue** in the planning repo instead of (or alongside) the findings issue above, per the [upstream-impact filing recipe](../_shared/references/protocol-common.md#upstream-impact-filing). The refine skills consume this queue in cascade mode.

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
