---
name: devenv-bug-fix
description: 'Investigate a bug from a GH issue or description, trace the root cause through the codebase, and produce a structured findings report with proposed resolution steps. USE WHEN the user says "fix this bug", "investigate this issue", "find the root cause of", "diagnose this problem", "why is X broken", hands off a GH issue number with a bug report, or needs systematic root cause analysis before fixing. Investigates the call chain with file:line citations, proposes a failing test + fix sequence, posts findings to the GH issue if one is involved, and lets the user choose: create an implementation plan (for larger effort), fix immediately, or fix themselves. DO NOT USE FOR feature work (use `/devenv-create-implementation-plan`), general code exploration (use `/devenv-chat-with-code`), or feasibility research (use `/devenv-spike`).'
argument-hint: '<issue-number | bug description>'
user-invocable: true
---

# Bug Fix

> **Model check:** This skill is optimized for Claude Sonnet or Claude Opus. If you are running as a different model, warn the user before proceeding: *"⚠️ This skill is optimized for Claude Sonnet or Claude Opus. You are currently on [your model name] — consider switching before we begin."*

> **Do NOT run `--help` on any tool.** All CLI signatures are pre-documented in [`../_tools-reference.md`](../_tools-reference.md) — read that file instead.

Investigate first, propose second, fix only with direction. The skill exists because bugs require diagnosis before they require code — a fix written without understanding the root cause often papers over the symptom rather than resolving it.

## When to Use

Trigger phrases:

- "fix this bug" / "investigate this issue" / "find the root cause"
- "why is X broken?" / "diagnose this" / "something's wrong with Y"
- A GH issue number referencing a bug

Do **not** use for:

- Feature work → use [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md)
- General codebase Q&A → use [`/devenv-chat-with-code`](../devenv-chat-with-code/SKILL.md)
- Feasibility research → use [`/devenv-spike`](../devenv-spike/SKILL.md)
- Known cause, just needs a plan → use [`/devenv-create-implementation-plan`](../devenv-create-implementation-plan/SKILL.md) directly

## Output Signals

| Signal | Use when |
|--------|----------|
| `📁` | Opening a **Files in scope** block |
| `🔶` | A **decision or clarification is required** before continuing |
| `→` | Starting an investigation step |
| `✅` | Root cause confirmed / fix applied |
| `⚠️` | Concern — something adjacent that might matter |
| `🛑` | Investigation blocked — user input required |
| `🏁` | Findings report ready |

---

## Phase 0 — Load the bug

Accept one of:

- **GH issue number** → `issue-get <N> --pretty`, read `body` and `comments`. Extract: reported symptoms, affected area, reproduction steps, any stack traces or error messages.
- **Free-text description** → use as-is. Ask the user for any reproduction steps or error output they have before proceeding.

If the report is too thin to begin investigation (no symptoms, no error, no affected area):

> "I need a bit more to go on — what does the failure look like? (error message, wrong output, exception, etc.)"

Wait for the answer before proceeding.

Identify upfront:

- **Symptom:** what the user observes (the visible failure)
- **Suspected area:** any code areas already named in the report (optional — investigation may find something different)
- **Scope:** which repo(s) to search (default: current repo; note other repos in `repos/` if the bug might span a service boundary)

---

## Phase 1 — Investigate

Trace the symptom to a root cause. Work systematically; document every step briefly so the user can follow along.

### Investigation protocol

1. **Orient** — `semantic_search` the key terms from the symptom to find relevant code areas.
2. **Find the entry point** — where does the code path that triggers the bug begin? (API handler, event handler, worker entry, etc.)
3. **Trace forward** — follow the call chain from the entry point toward where the symptom manifests.
4. **Read suspects** — `read_file` on any function, class, or module that looks like it could be the cause. Read enough context to understand the surrounding logic.
5. **Check recent changes** — `git log --oneline -10 <file>` on any file that looks central. A recently changed file is a strong candidate.
6. **Cross-repo** — if the call chain leads into a library or service in another repo under `repos/`, follow it there.
7. **Confirm** — does the suspected root cause fully explain the symptom? If yes, move to Phase 2. If not, continue narrowing.

### When to ask the user

Stop and ask (`🔶`) when:

- Three or more investigation branches have come up empty and no clear suspect remains.
- The bug report references runtime state or configuration the AI cannot determine from code (e.g., "only happens in production with X flag set").
- There are two or more equally plausible root causes that can't be ruled out without information only the user has.
- Reproducing the logic mentally produces a contradiction — the code looks correct but the symptom says otherwise.

Do **not** ask about things that can be determined by reading the code.

### Investigation log (inline)

As investigation proceeds, emit brief inline progress notes so the user can see where the trail is leading:

> `→ Tracing from AuthController.Login → TokenService.Issue → JwtBuilder.Sign`
> `→ Found: JwtBuilder.Sign does not validate expiry < now before signing`
> `→ Checking tests to confirm expected behaviour`

These are not prompts — the user does not need to respond. Continue unless stuck.

---

## Phase 2 — Findings report

When the root cause is identified (or the best available hypothesis), emit the findings report.

```
🏁 Bug Findings — <one-line summary>
─────────────────────────────────────────

Root cause
  [AuthController.cs:142](repos/lib.cs.services.chassis/src/AuthController.cs#L142)
  JwtBuilder.Sign does not check that the requested expiry is not in the past.
  Any token with a backdated expiry is signed without error, allowing issuance
  of tokens that are immediately invalid.

Confidence: High  ← (High / Medium / Low — see note below)

Proposed resolution(s)
  1. [Recommended] Add an expiry guard in JwtBuilder.Sign before signing:
       if (expiry <= DateTime.UtcNow) throw new ArgumentException(...)
     Localised — one file, one method. Low risk of side effects.

  2. [Alternative] Add the check at the call site in AuthController.Login.
     Less defensive — does not protect other callers of JwtBuilder.Sign.

Failing test to write first
  AuthController.Login_WithBackdatedExpiry_ThrowsOrReturnsError
  Arrange: request a token with expiry = DateTime.UtcNow.AddMinutes(-1)
  Assert:  400 Bad Request or ArgumentException before token is issued

Side effects / risks
  - Other callers of JwtBuilder.Sign are also unprotected; the fix covers them
    all if applied there. Worth a grep to confirm there are no callers that
    legitimately pass a past expiry.

Effort estimate: Small (1 file, 1 method + 1 test)
─────────────────────────────────────────
```

**Confidence levels:**
- **High** — root cause confirmed by reading the code; the fix is clear and the symptom fully explained.
- **Medium** — strong suspect; one or two alternative explanations remain but are less likely.
- **Low** — multiple plausible causes; further investigation or a reproduction environment is needed to confirm.

If confidence is Medium or Low, say so explicitly and describe what would be needed to raise it.

### Post to GH issue

If a GH issue was provided, offer:

> "Want me to post these findings as a comment on issue #<N>? I'll show you the draft first."

Show the draft, wait for `y / edit / skip`. On `y`, post via `issue-comment <N> --body-file <path>`.

---

## Phase 3 — User chooses path

After the findings report (and any GH issue comment), present the options:

```
What would you like to do next?

  A) Create an implementation plan  — for effort that's medium or larger, or
                                      if you want a reviewable plan first
  B) Fix it now                     — AI applies the fix (failing test first,
                                      then the change, then docs if needed)
  C) I'll fix it myself             — I'll stop here; you have everything you need
```

Wait for the user's choice. Do not proceed without one.

### Path A — Create an implementation plan

Hand off to `/devenv-create-implementation-plan` with the findings as context:

> "To create a plan from these findings, start a new chat and invoke `/devenv-create-implementation-plan`. You can paste the findings report as the input — it contains all the context needed to skip the discovery phase."

If the user wants, draft a one-paragraph summary of the findings in plan-input format for them to paste.

### Path B — Fix it now

Apply the fix in sequence:

1. **Write the failing test first** (if applicable). Show it, wait for `y / edit / skip` before creating the file.
2. **Apply the fix.** Show each change as a before/after block. Wait for `y / n / edit` per change before applying.
3. **Update docs only if necessary** — a documentation gap was revealed (e.g., the public API behaves differently from what the docs say). Do not add docs speculatively.
4. **Offer a commit suggestion** (see below). Never run `git commit`.

If at any point during the fix the scope turns out to be larger than the findings suggested:

> "🔶 This is wider than the findings indicated — [explain]. Continuing would touch [X files / change Y behaviour]. Want to proceed, or would you prefer to create an implementation plan instead?"

Wait for the user's answer before continuing.

### Path C — Fix it yourself

Confirm the user has everything they need:

> "You have the root cause, the recommended fix, and the failing test to write first. If anything is unclear, ask before you start — it's easier to clarify now."

---

## Commit suggestion

Never commit. At the end of Path B (or on request), offer a commit message suggestion following the workspace's commitlint convention: `type(optional-scope): subject`.

For a bug fix the type is almost always `fix`. Include a scope if the fix is clearly within one module or service:

```
fix(auth): guard against backdated expiry in JwtBuilder.Sign
```

If the fix + test + docs update are all small and cohesive, one commit is fine. If the test and fix are substantial, suggest two:

```
1. test(auth): add failing test for backdated token expiry
2. fix(auth): guard against backdated expiry in JwtBuilder.Sign
```

Never suggest `git commit` commands. Only suggest the message text.

---

## Guardrails

- **Investigate before proposing.** Never suggest a fix without tracing the root cause first.
- **Symptom ≠ cause.** The reported symptom tells you where to start, not where the bug is.
- **Never make changes outside the scope of the bug.** Do not fix adjacent issues, improve nearby code, or add unrelated tests — even if they look obviously broken. Note them as `⚠️` and move on.
- **Never apply a fix without `y`.** Every before/after change block is shown and confirmed before applying.
- **Never commit or run git mutations.** Suggest commit message text only.
- **Never confabulate a root cause.** If the trail goes cold, say so and ask. Low-confidence findings are surfaced honestly with their confidence level.
- **Multi-repo awareness:** if the bug call chain crosses into a repo under `repos/`, follow it. Do not assume the bug is in the current repo just because that is where it was reported.
- **Ask before non-trivial choices** — ambiguous acceptance criteria, multiple competing fix approaches with meaningfully different trade-offs, anything that contradicts what the bug report implies.

---

## Anti-patterns

- **Proposing a fix before reading the relevant code** — always trace the call chain first.
- **Treating the symptom as the root cause** — "the error is thrown at line 88" is not a root cause explanation.
- **Fixing adjacent issues discovered during investigation** — note them, don't fix them.
- **Low-confidence root cause presented as confirmed** — always state confidence level honestly.
- **Skipping the failing test step** — writing the fix before the test means there is no way to confirm the fix works.
- **Updating docs speculatively** — only update docs if the bug revealed an actual documentation gap.
- **Continuing past a blocked investigation without asking** — if the trail is cold, stop and ask.

---

## Sibling skills

- `/devenv-create-implementation-plan` — use after Path A if the bug warrants a full plan before fixing.
- `/devenv-pair-programming` — for fixing the bug collaboratively once the cause is known.
- `/devenv-delegation` — for applying a fix plan that is already fully defined.
- `/devenv-chat-with-code` — for exploring how code works without a specific bug in mind.
- `/devenv-spike` — for investigating whether a proposed fix approach is feasible.
- `/devenv-triage-issue` — for classifying and labelling the GH issue before or after investigation.
- `/devenv-pre-commit` — run quality gates after applying a fix.
