# Plan-Encoded Review Protocol

Shared protocol for executing a plan's **Review** phase. Three consumers:

- **`/devenv-review --plan`** — direct invocation; runs the same workflow with the full review skill loaded.
- **`/devenv-delegate` / `/devenv-pair`** — executor encounters a Review-phase task (e.g. `4.1 Review round 1`) while running the plan. The executor does **not** invoke `/devenv-review` and does not switch skills; it executes the task under its own rules using this protocol: it dispatches a subagent for the adversarial review computation, then performs the fold-in, convergence decision, and plan stewardship itself.
- **`/devenv-plan`** — encodes the phase at planning time; cites this protocol in the phase tasks.

## Why a subagent for the computation

By the time the Review phase arrives, the executor session (delegate or pair) has usually produced much of the code under review. Inline self-review is adversarially weak. Dispatching the review computation to a subagent gives fresh eyes and preserves the executor's own voice, gates, and ledger discipline. The executor stays the single plan writer.

## Executor workflow (delegate / pair)

When a Review-phase task becomes current:

1. **Resolve the round.** Read the plan's Review phase. The round number is `1 + (number of already-ticked round tasks)`. If the previous round's convergence decision was "converged and closed" (the user accepted closing the cycle), do not start a new round — the phase is done; tick the current task with a `round skipped — converged` note only if it was left open in error. A hard cap of **4 rounds** bounds the cycle: at the cap, stop and hand back with the yield history instead of offering a further round — warning the user explicitly that the cycle hit the cap and unresolved issues may remain, so the diff still needs their manual attention.
2. **Resolve the diff target.** Cumulative branch diff vs base (the plan's execution branch vs its base), per the plan's Review-phase scope note. If a PR exists for the branch, PR mode may also be used; the computation is the same.
3. **Dispatch the review subagent** with the self-contained brief below. One subagent per round. Do not review inline. **User-run gate:** if the plan's Review phase records **user-run** execution mode (a planning-time choice — see `/devenv-plan` §4c), do not dispatch — stop at the round task and refer the round to the user instead: they may run it themselves (e.g. `/devenv-review` in another session), direct you to dispatch the subagent after all, or skip. The referral is a stop, not a prohibition — the user's choice governs. Absent a recorded mode, AI-autonomous dispatch is the default. **Before dispatching, resolve the two doc roots from `devenv.config` `[copilot]` (`knowledge_repo` + `knowledge_subpath`, `engineering_repo` + `engineering_subpath`) — in this workspace they are `~/.copilot/knowledge` and `~/.copilot/engineering` — and fill them into the brief's `KNOWLEDGE ROOT` / `ENGINEERING ROOT` parameters. The subagent is stateless and cannot resolve these itself.**
4. **Receive findings.** The subagent returns the structured findings report (numbered, severity-grouped hotspots, missing tests, ephemeral-artifact references, questions, and the Diagnostics appendix). When the user asks about coverage or where review effort went, cite the report's Diagnostics section.
5. **Present + fold in.** Write the full findings report to a `.local-artifacts/tmpN.md` working file in the target repo (next free number — the user's reviewable record), and present the findings in chat: every finding's number, severity, and file:line as a one-liner, pointing to the working file for full detail. A chat summary alone is not enough — the user cannot rule on findings they cannot read. Then run the fold-in interview (`vscode_askQuestions`), proposing set approval **by finding number**: blockers, concerns, missing tests; nits only if the user opts in; praise never. Apply approved encodings as normal numeric tasks in the Review phase (round number in the task **title**, never the task ID — plan tooling accepts dotted numeric IDs only); each task's `Additional context:` cites its finding number plus file:line and severity. Record rejected findings (number + reason) in the round summary; they are excluded from future yield counts.
6. **Convergence decision.** Compute the yield over non-rejected findings and present BOTH outcomes as a choice — the cycle repeats only with the user's permission, in both directions; it is never self-terminated:
   - **Below the bar** (any Blocker, or ≥ 3 Concerns): recommend another round on the updated cumulative diff; the user confirms.
   - **Converged** (0 Blockers and ≤ 2 Concerns): recommend **closing** the phase — but offer another round anyway if the user wants deeper assurance; their explicit choice.
   - **Anti-spiral guards:** at 4 rounds total, stop and hand back with the yield history rather than offering round 5 — warning the user that unresolved issues may remain and the diff needs their manual attention. And a round that keeps yielding findings at the same severity after fixes landed is churn, not progress — surface it as a handback signal instead of proposing a further round. Tick the round task, record yield + decision in the round summary. If issue-backed, offer the artifact re-upsert (plan-parse lint first).
7. **PR alongside (optional).** If a PR exists, offer once per round: post the kept findings as inline PR threads from the round's working file (tmpN). The fold-in and the PR posting are independent channels; either, both, or neither may be used.

## Subagent brief (self-contained prompt template)

Dispatch with this prompt, filling the bracketed values. The brief is self-contained on purpose: the subagent has no session context, no plan context, and no conversation history.

```text
You are an adversarial code reviewer. A review that finds nothing is a
hypothesis, not a result. Attack the diff the way a hostile reviewer would:
how do I make this fail? Feed it empty input, concurrent access, huge input,
unicode, missing files, expired tokens, network loss. Check the negative
space: the test that asserts the error path, the cleanup that runs on failure,
the lock released in a finally. Report what you tried to break and couldn't.
Severity stays honest: don't inflate a nit to look thorough, don't soften a
real find to be polite.

REFERENCE EXPLORATION — proportionate, not reflexive. Reference verification
serves the attack; scale it to the diff's blast radius, decided per diff:

- **Default tier:** the diff is internal (no public contract, schema, or
  shared-behavior surface changes). Derive the reference set from
  documentation — the knowledge repo's consumer/integration documentation (as
  located by its orchestration file) and README integration notes — plus local
  callers within the diff's own repo. Docs are the sufficient source here; do
  not sweep repositories looking for callers the docs don't name. **Hard cap: zero
  files outside the diff's own repo.**
- **Escalate to a targeted trace when:** the diff changes a public contract,
  message schema, or behavior another component consumes — then verify the
  consumers the docs actually name (all of them, but only those); or a doc
  names a consumer the diff could break — verify that consumer directly; or
  the user/plan supplies a specific concern, or one of your findings needs
  one verification to be confirmable — chase that lead. **Expect ~5 external
  files or fewer**; if a docs-named consumer set exceeds that, proceed — but
  declare the overage and why in Diagnostics.
- **Escalate to a full cross-repo trace only when** a public-surface change is
  real AND the docs are silent or contradicted about who consumes it — that
  sweep exists for the case docs can't answer, not as a default. **Before
  sweeping, write the sweep justification into the report** ("sweeping X
  because Y") — state the cost up front, don't discover it afterward.

WHEN TORN ABOUT A SURFACE — probe, don't reflexively escalate. Uncertainty
about whether a changed surface is public/contract-bearing is common; do not
resolve it by defaulting to the deeper tier. Instead run one cheap probe:
grep the changed symbol across the docs-named repos and this repo, record the
probe and its result in Diagnostics, and commit to the deeper tier only if
the probe hits an unexpected consumer. A skipped probe is the unrecoverable
error — a probe is the cheap unit of verification, a sweep is the expensive
one; extra verification is cheap per lead and expensive per sweep.

Thoroughness: medium — depth comes from attack quality (how hard you try to
break each thing), not coverage (how many things you open).

TARGET REPO ROOT: <absolute path>
KNOWLEDGE ROOT: <absolute path of the Copilot knowledge repo, resolved by the dispatcher — read its orchestration.md first for component classification and read routing>
ENGINEERING ROOT: <absolute path of the engineering repo, resolved by the dispatcher — Standards/Design-Principles/ holds the ratified principles>
DIFF: <branch> vs <base> — run: git -C <repo-root> diff <base>...<branch>
(If a PR number is supplied instead: fetch its diff via pr-diff <N>.)

SCOPE RULES:
- Review ONLY the diff. Do not review unchanged code around it; if unchanged
  context reveals a problem, mention it in a summary note, not as a finding.
- If the diff exceeds ~1500 changed lines, review it in full anyway, but
  order findings by blast radius.
- Every finding must cite file:line that you have verified exists in the
  current working tree.
- Read `KNOWLEDGE ROOT`/`orchestration.md` before classifying the diff's
  surface (it routes which knowledge docs matter). Judge the diff against the
  ratified patterns in `ENGINEERING ROOT` (e.g. `Standards/Design-Principles/`)
  the way /devenv-pair and /devenv-delegate apply them: a diff that violates a
  ratified pattern is a Concern (Blocker when the principle's adherence level
  makes it mandatory and the violation is structural); cite the pattern name.
  If either root is missing or its docs are absent, proceed on general skill
  knowledge and note the gap in Diagnostics — absence is a limitation to
  report, never a reason to skip the review.

OUTPUT (markdown, exactly this structure):

## Findings — review round <round>

**Source**: branch <branch> vs <base> (or PR #N)
**Files changed**: <count> (+<adds> / -<dels>)
**Exploration basis**: <default: docs + local callers | targeted trace: <which consumers, why> | full cross-repo trace: <why docs were insufficient>>

Every finding link points at the file that will contain this report — the
target repo's `.local-artifacts/tmpN.md` — so paths are repo-relative with a
single `../` prefix (the artifact sits one level below the repo root):
`../path/file.ext#LINE`. A link without the prefix resolves against
`.local-artifacts/` and is dead when the user opens the file.

### Summary
<1–2 sentences: what the change does, overall take.>

Number every finding sequentially — **F1, F2, F3, …** — continuing across
sections (Blockers, then Concerns, then Nits, then Praise, then Missing
tests). The number is the finding's identity for the whole round: the fold-in
interview, rejections, and the plan's task encodings all reference it.

### Findings

#### 🛑 Blocker
- **F1** [path/file.ext:LINE](../path/file.ext#LINE) — <reason>
(empty section header with "(none)" under it if none)

#### ⚠️ Concern
- **F2** [path/file.ext:LINE](../path/file.ext#LINE) — <reason>

#### 💭 Nit
- Only include nits that materially affect readability or correctness.

#### ✅ Praise
- Only genuine, specific praise. Skip if nothing qualifies.

### Missing tests
- New behavior in the diff lacking test coverage. "(none)" if covered.

### Diagnostics (mandatory — "none" is a valid entry per line)
**Beyond-diff files examined**: <count> — <capped list, "…" past ~10>
**External repos swept**: <names | none> — <one-line reason each>
**Dead ends**: <leads chased that produced nothing>
**Tier decisions**: <surface → tier chosen → one-line why>
**Probes**: <symbol greps run and their results, if any>
**Doc roots**: <both read | knowledge root unusable: <why> | engineering root unusable: <why> — one line each>

### Ephemeral-artifact references in added comments
- Comments citing finding IDs, plan task numbers, audit filenames — that
  vocabulary belongs in the plan or commit messages, not durable code.

### Questions for the author
- Open questions where the diff isn't self-explanatory.

Do not modify any files. Do not post to GitHub. Return the report as your
final message.
```

## Fold-in rules (shared by all consumers)

- Findings fold into the plan **only with user approval** (set-approval interview); the executor or review session is the single plan writer while it holds the ledger.
- **Finding numbers are per-round reference vocabulary** (F1…Fn, assigned by the reviewer in the round report). The fold-in interview, the user's keep/reject decisions, rejections in the round summary, and each folded task's `Additional context:` bullet all cite numbers; across rounds, qualify them ("round 2, F3"). Numbers live in the working file, chat, and plan — never in durable source comments (see the ephemeral-artifact rule).
- Eligible classes: Blockers, Concerns, Missing tests. Nits opt-in; praise never.
- Rejected findings: recorded with reason in the round summary and excluded from subsequent yield computation.
- Task encoding: normal numeric IDs (`4.2`, `4.3`, …); round number in the title; `Additional context:` cites the finding (file:line, severity).
- Convergence bar: 0 Blockers and ≤ 2 non-rejected Concerns. The cycle repeats only with the user's permission in BOTH directions — below the bar the recommendation is another round, at the bar the recommendation is closing, but the user may choose either at any round; the cycle is never self-terminated. Hard cap 4 rounds (hand back at the cap with the yield history and an explicit warning that unresolved issues may remain — the diff needs the user's manual attention); same-severity churn after fixes landed is a handback signal, not a further round.
- Other plan editing still routes to `/devenv-refine-plan`; the fold-in write is sanctioned only inside this protocol.
- Plan-encoded review is separate from `/devenv-commit`'s in-line pre-commit review; never start a fold-in cycle from an in-line review.
- **Conversational micro-reviews are not rounds.** The ordinary back-and-forth of a pair (or delegated) session — reacting to a user's diff, "does this look right?", navigator feedback mid-task — is conversation, works well as-is, and never enters this cycle. This protocol engages only through a plan Review-phase task or an explicit user request for a formal review; never from the mere presence of review-shaped feedback during execution.
