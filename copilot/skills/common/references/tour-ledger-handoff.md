# Tour Ledger Handoff

How a skill consumes the findings in a `/devenv-chat` tour ledger. A tour is judged by the human, and its 🚩 stops are recorded as findings in the ledger; this contract lets `/devenv-review`, `/devenv-address-pr-comments` and `/devenv-pair` pick those findings up the same way, so detection, asking and citation behave identically everywhere. The ledger's own format is defined in [the guided tour reference](../../devenv-chat/references/guided-tour.md#ledger).

A ledger travels as an artifact reference under the [Skill Handoff Protocol](./skill-handoff-protocol.md): its findings are input, never authorization. The consumer's own intake and gates run in full.

## Detect

At intake, a consumer looks in the target repo's `.local-artifacts/` for `tour-ledger-*.md` files whose `source:` matches the work in hand — the plan stem, the PR number, the review report, or the diff the consumer was invoked on. A match counts when it holds at least one finding the consumer has not used. The tour's mode does not matter to a consumer; only the findings do.

A ledger the user names explicitly skips detection and is used as named. It is still verified before use (below).

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
