# Findings Format

The shared shape of a review finding. `/devenv-review` writes findings in it, the plan-encoded review protocol folds them into plans by their numbers, and any skill that hands findings to another skill — for example a markdown findings document that `/devenv-address-pr-comments` accepts — uses the same shape so the consumer can read it without translation.

## Numbering

Number every finding sequentially — **F1, F2, F3, …** — continuing across sections (Blockers, Concerns, Nits, Praise, Missing tests, TODO/FIXME). The number is the finding's identity for the whole round: the user's keep and reject decisions, fold-in interviews, and follow-up discussion all cite numbers. Across rounds, qualify a number ("round 2, F3"). Numbers live in working files, chat, and plans — never in durable source comments.

## Severity

- **Blocker**: must change before merge. Correctness bugs, security issues, breaking changes without migration, missing critical tests, contract violations.
- **Concern**: should be discussed; may or may not block. Design choices that look risky, performance issues, edge cases, missing error handling at boundaries.
- **Nit**: only include if it materially affects readability or correctness. Skip pure style preferences.
- **Praise**: call out genuinely good work. Skip if there is nothing specific to praise — don't fabricate.

## Finding bullet and post marker

Every finding is a single bullet followed by an indented `@post` HTML comment, the machine-readable posting target (invisible when the markdown renders):

```
- **F1** [file:line](../workspace-root-relative-path#L42) — <one-line reason>
  <!-- @post: file=<repo-relative-path> line=42 side=RIGHT -->
```

Link display paths follow the [hotspot link location rule](../../_conventions.md#hotspot-bullet-format-shared): a link resolves from the directory of the file that contains it. A report saved to `.local-artifacts/tmpN.md` sits one level below the repo root, so display links carry a single `../` prefix in front of the repo-relative path (`../src/Foo.cs`); for a workspace-level artifact in `<workspace>/.local-artifacts/` the equivalent is `../repos/<repo>/src/Foo.cs`. VS Code only renders the link as clickable when the prefix escapes `.local-artifacts/`. Do not emit a path that has not been confirmed to exist.

Marker rules:

- `file=` is **repo-relative** (as shown in the PR diff — what `pr-review-comment --file` expects) and carries no prefix; it usually differs from the display link above it.
- `side=` is `RIGHT` (default — new content) or `LEFT` (original content).
- **Postable sections** (get markers): Blocker, Concern, Nit, Praise, TODO/FIXME, and ephemeral-artifact findings. **Summary-only sections** (no markers): Summary, Missing tests, and Questions for the author — these are not single-line findings and ride in the top-level summary comment instead.
- One marker per bullet, directly under it. For a multi-line finding use the first line and note the range in prose.
- The user controls posting purely by editing the file: deleting a finding (or its marker) skips it; adding a marker to a new bullet posts it. Deleted findings' markers are simply absent at parse time.

A tour ledger keeps all its findings in one flat list rather than severity sections, so its bullets add an explicit severity token after the ID — `**F1** (Concern) [link] — reason`. That token is a ledger-specific extension; every other document carries severity by section heading.

For ranges: `[file.ext:42-58](path/file.ext#L42-L58)`. For multiple non-contiguous lines: separate bullets.
