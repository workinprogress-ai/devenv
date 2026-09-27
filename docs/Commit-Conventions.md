# Commit Conventions

This document is the canonical contract for commit messages across
repositories. Skills and tooling cite this page instead of restating the rules; when
this document and a skill disagree, this document wins and the skill gets fixed.

## The master-relative type

Every commit on a feature branch declares its type **relative to `master`**, not
relative to the sibling commits around it. A commit is a unit of change destined for
`master`: when it lands there via rebase, its type must still be true.

- `feat` means "this change is a feature, as seen from `master`" — even if it is the
  third of five commits building that feature.
- `fix` means "this change fixes something, as seen from `master`".
- A `chore` on the branch that is actually part of a feature's mechanics is a `feat`
  (or `fix`) relative to `master`.

Every commit must be **individually mergeable** to `master`: self-contained subject,
self-contained change, and a type that is true at the moment it lands. Commit
granularity follows mergeability, not phase boundaries.

## Type enum

The allowed types are defined once, in the repo's `commitlint.config.js`
`type-enum` rule (severity `2`, `always` — at the workspace root), and every
enforcement surface derives from it:

| Surface | Mechanism |
| --- | --- |
| Local commitlint | `type-enum` in `commitlint.config.js` — the single source |
| Repository ruleset | `commit_message_pattern` in `tools/config/ruleset-default.json` — generated to match the enum |
| Wrapper validation | `validate_conventional_commits` in `tools/lib/git-operations.bash` — regex built from the enum |
| Skills / prose | Skills cite this document; they do not restate type lists |

The enum is the conventional types plus the explicit bump types:

`build` · `chore` · `ci` · `docs` · `feat` · `fix` · `perf` · `refactor` ·
`revert` · `style` · `test` · `major` · `minor` · `patch`

## Breaking changes

Breaking changes are declared with a `!` before the colon (e.g. `refactor!: ...`)
or a `BREAKING CHANGE:` footer. Because every commit is individually mergeable, an
introduce-then-reverse breaking pair must be **restructured before merge**: squash
the pair locally (the user runs this), then merge the single corrected commit. An
introduce-then-reverse pair reaching `master` would momentarily break it.

## WIP commits

`WIP:` (anchored to the start of the subject, matching `git-unwip` detection) is the
escape-hatch commit for work-in-progress saves. WIP commits are temporary: they never
reach `master`. The merge tooling hard-rejects any merge range containing them; the
recovery is `git-unwip` (soft-reset to the last non-WIP commit) or finishing the work
into real commits. Only a WIP commit may follow a WIP commit (`tools/git-hooks/wip-gate.sh`
enforces this at commit time).

## Merge policy

Merges to `master` are **rebase merges**. On protected branches the ruleset
offers rebase only — squash and merge-commit are withdrawn there. The wrapper
retains `--method squash|merge` flags for provider-level support on unprotected
targets, but org policy and the wrappers default to rebase. Rationale and
recovery guidance live in [Workflow.md](Workflow.md#merge-policy).
