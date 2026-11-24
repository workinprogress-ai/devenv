# Tour Ledger Handoff

How a skill consumes the findings in a `/devenv-chat` tour ledger. A tour is judged by the human, and its 🚩 stops are recorded as findings in the ledger; this contract lets `/devenv-review`, `/devenv-address-pr-comments` and `/devenv-pair` pick those findings up the same way, so detection, asking and citation behave identically everywhere. The ledger's own format is defined in [the guided tour reference](../../devenv-chat/references/guided-tour.md#ledger).

A ledger travels as an artifact reference under the [Skill Handoff Protocol](./skill-handoff-protocol.md): its findings are input, never authorization. The consumer's own intake and gates run in full.

## Detect

At intake, a consumer looks in the target repo's `.local-artifacts/` for `tour-ledger-*.md` files whose `source:` matches the work in hand, and it auto-detects only these keys:

| Work in hand | Keys that match |
|---|---|
| A plan | `plan:`, `plan-after:` or `plan-diff:` with the plan's file stem |
| A PR | `pr:<n>` or `pr-threads:<n>` with the PR number |
| A review report | `review:<report path>` |

A match counts when it holds at least one finding the consumer has not used. The tour's mode does not matter to a consumer; only the findings do. Ledgers keyed on a diff, a commit range, a trace, an acquaintance topic or a subset of another ledger are never auto-detected, because nothing stable ties them to a later session's work: the user names those.

A review-report ledger also matches only while the report's content hash equals the ledger's `source-hash:`. A report the user has edited — findings deleted, posting markers added — no longer hashes the same, so on a mismatch the consumer says "report changed since the tour" and asks whether to use the ledger anyway; it never skips it silently.

A ledger the user names explicitly skips detection and is used as named. It is still verified before use (below).

When a PR is the work in hand, `/devenv-address-pr-comments` still loads the threads from the PR through its own tooling, which stays the source of truth. A `pr-threads` ledger adds only the user's marks on those threads, matched to them by file and line, so no thread is handled twice; a `pr:` ledger's findings join as document-mode items.

## Unused findings

A finding is *used* when the consumer's own durable output cites it. Detection compares the ledger's finding IDs with those citations:

- A plan task cites it in `Additional context:` as `tour-ledger-<topic> F3`.
- A review round record lists the finding IDs it folded in, qualified by the ledger name.
- An `/devenv-address-pr-comments` summary lists the IDs it addressed.
- A pair session that has no durable output of its own cites them in its closing summary; the ledger then stays offered until the user says it is done.

Consumers never write to the ledger. A ledger is retired by the artifact cleanup tool or by the user, once its findings are used.

## Ask before use

A consumer never uses a detected ledger silently. It names the ledger, its source and the count of unused findings, and asks in one line whether to use it. Declining leaves the consumer's normal intake untouched.

## Verify before acting

Ledger links can drift as the code changes. Before a consumer acts on a finding, or posts from its `@post` marker, it re-reads the cited range from the live file and compares it to the ledger's recorded `hash:` and `anchor:`. If the text is gone or no longer matches, the finding is stale: the consumer surfaces it and asks, and never posts it or applies it from the old line.

## Severity and disposition

A ledger finding carries a severity token — `(Blocker)`, `(Concern)` or `(Nit)` — defaulting to Concern when absent. Consumers map it like a review report's section headings.

A 🚩 is a candidate, not a disposition. The human judged that the code needs attention; the consumer's own gates still decide what happens next — a fold-in interview with `Take`, `Skip` or `Discuss` per finding number, a thread disposition, a pair chunk.

## Routing by source kind

| The ledger's source | Natural consumer |
|---|---|
| A plan | The plan-encoded fold-in in `/devenv-review`, so findings become plan tasks |
| A PR | The `/devenv-review` posting path, or `/devenv-address-pr-comments` in document mode |
| A diff, commits, or an ad-hoc topic | `/devenv-pair` intake |

The chat tour offers the move; the receiving skill runs its own intake. A tour's close names the route and hands over the ledger, and never performs the route.
