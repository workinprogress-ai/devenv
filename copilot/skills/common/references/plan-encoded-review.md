# Plan-Encoded Review Protocol

Shared protocol for executing a plan's **Review** phase. Three consumers:

- **`/devenv-review --plan`** — direct invocation; runs the same workflow with the full review skill loaded.
- **`/devenv-delegate` / `/devenv-pair`** — executor encounters a Review-phase task (e.g. `4.1 Review round 1`) while running the plan. The executor does **not** invoke `/devenv-review` and does not switch skills; it executes the task under its own rules using this protocol: it dispatches a subagent for the adversarial review computation, then performs the fold-in, convergence decision, and plan stewardship itself.
- **`/devenv-plan`** — encodes the phase at planning time; cites this protocol in the phase tasks.

## Why a subagent for the computation

By the time the Review phase arrives, the executor session (delegate or pair) has usually produced much of the code under review. Inline self-review is adversarially weak. Dispatching the review computation to a subagent gives fresh eyes and preserves the executor's own voice, gates, and ledger discipline. The executor stays the single plan writer.

## Executor workflow (delegate / pair)

When a Review-phase task becomes current:

1. **Resolve the round.** Read the plan's Review phase. The round number is `1 + (number of already-ticked round tasks)`. If the previous round's convergence decision was "converged" (or the user closed the cycle), do not start a new round — the phase is done; tick the current task with a `round skipped — converged` note only if it was left open in error.
2. **Resolve the diff target.** Cumulative branch diff vs base (the plan's execution branch vs its base), per the plan's Review-phase scope note. If a PR exists for the branch, PR mode may also be used; the computation is the same.
3. **Dispatch the review subagent** with the self-contained brief below. One subagent per round. Do not review inline.
4. **Receive findings.** The subagent returns the structured findings report (severity-grouped hotspots, missing tests, ephemeral-artifact references, questions).
5. **Present + fold in.** Present the findings summary in chat, then run the fold-in interview (`vscode_askQuestions` set approval: blockers, concerns, missing tests; nits only if the user opts in; praise never). Apply approved encodings as normal numeric tasks in the Review phase (round number in the task **title**, never the task ID — plan tooling accepts dotted numeric IDs only). Record rejected findings (with reason) in the round summary; they are excluded from future yield counts.
6. **Convergence decision.** Compute the yield over non-rejected findings: continue while any Blocker or ≥ 3 Concerns; converged at 0 Blockers and ≤ 2 Concerns. The user always confirms continue/stop. Tick the round task, record yield + decision in the round summary. If issue-backed, offer the artifact re-upsert (plan-parse lint first).
7. **PR alongside (optional).** If a PR exists, offer once per round: post the kept findings as inline PR threads from the round's working file (tmpN). The fold-in and the PR posting are independent channels; either, both, or neither may be used.

## Subagent brief (self-contained prompt template)

Dispatch with this prompt, filling the bracketed values. The brief is self-contained on purpose: the subagent has no session context, no plan context, and no conversation history.

```text
You are an adversarial code reviewer. A review that finds nothing is a
hypothesis, not a result. Attack the diff the way a hostile reviewer would:
how do I make this fail? Feed it empty input, concurrent access, huge input,
unicode, missing files, expired tokens, network loss. Trace each changed
function's callers — who else breaks when this signature or behavior shifts?
Check the negative space: the test that asserts the error path, the cleanup
that runs on failure, the lock released in a finally. Report what you tried
to break and couldn't. Severity stays honest: don't inflate a nit to look
thorough, don't soften a real find to be polite.

TARGET REPO ROOT: <absolute path>
DIFF: <branch> vs <base> — run: git -C <repo-root> diff <base>...<branch>
(If a PR number is supplied instead: fetch its diff via pr-diff <N>.)

SCOPE RULES:
- Review ONLY the diff. Do not review unchanged code around it; if unchanged
  context reveals a problem, mention it in a summary note, not as a finding.
- If the diff exceeds ~1500 changed lines, review it in full anyway, but
  order findings by blast radius.
- Every finding must cite file:line that you have verified exists in the
  current working tree.

OUTPUT (markdown, exactly this structure):

## Findings — review round <round>

**Source**: branch <branch> vs <base> (or PR #N)
**Files changed**: <count> (+<adds> / -<dels>)

### Summary
<1–2 sentences: what the change does, overall take.>

### Findings

#### 🛑 Blocker
- [path/file.ext:LINE](path/file.ext#LINE) — <reason>
(empty section header with "(none)" under it if none)

#### ⚠️ Concern
- [path/file.ext:LINE](path/file.ext#LINE) — <reason>

#### 💭 Nit
- Only include nits that materially affect readability or correctness.

#### ✅ Praise
- Only genuine, specific praise. Skip if nothing qualifies.

### Missing tests
- New behavior in the diff lacking test coverage. "(none)" if covered.

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
- Eligible classes: Blockers, Concerns, Missing tests. Nits opt-in; praise never.
- Rejected findings: recorded with reason in the round summary and excluded from subsequent yield computation.
- Task encoding: normal numeric IDs (`4.2`, `4.3`, …); round number in the title; `Additional context:` cites the finding (file:line, severity).
- Convergence bar: continue while a round yields any non-rejected Blocker or ≥ 3 non-rejected Concerns; converged at 0 Blockers and ≤ 2 Concerns. The user confirms.
- Other plan editing still routes to `/devenv-refine-plan`; the fold-in write is sanctioned only inside this protocol.
- Plan-encoded review is separate from `/devenv-commit`'s in-line pre-commit review; never start a fold-in cycle from an in-line review.
- **Conversational micro-reviews are not rounds.** The ordinary back-and-forth of a pair (or delegated) session — reacting to a user's diff, "does this look right?", navigator feedback mid-task — is conversation, works well as-is, and never enters this cycle. This protocol engages only through a plan Review-phase task or an explicit user request for a formal review; never from the mere presence of review-shaped feedback during execution.
