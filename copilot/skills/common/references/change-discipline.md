# Change discipline

Short rules for making a code change under the execution skills (`/devenv-pair`,
`/devenv-delegate`) and in `/devenv-hunt`'s fix phase. They make the workspace's
Simplicity First rule operational: that rule says what to avoid, and these say what
to do instead. They apply to the change you are about to write, not to a plan's
structure.

## The ladder: the smallest complete change

Before writing code, go down these steps in order and stop at the first one that
answers the need:

1. Does it need to exist? Declining, or deleting, is a valid change.
2. Is it already in this codebase? Reuse it, and name its path.
3. Does the standard library or the platform provide it?
4. Does an already installed dependency provide it?
5. Is it a one-liner a reader understands at a glance?
6. Otherwise, write the minimum that works.

Be lazy about the solution, never about the change itself. Finish every part the
task needs, including the callers, tests and fixtures that your change breaks.

## Bug fixes: the root cause, once

Name the function you are fixing, search for every caller of it, and fix the cause
once in the shared code. A patch at the reported call site leaves its siblings
broken, so the root-cause fix is usually the smaller diff, not the larger one.

## Test reflex

New non-trivial logic leaves one small test or an assert-based self-check behind: a
branch, a loop, a parser, money or security handling, or a new script. Trivial
changes need none. Code without its check is unfinished. A plan task that declares
its own verification keeps it; this covers the edits that have none.

## Never cut

Minimalism never removes:

- validation at trust boundaries;
- error handling that prevents data loss;
- security;
- accessibility;
- anything the user asked for.

When the ladder says "less" and this list says "keep", keep.

## The closing line

Every handback ends with **Not checked:** what you skipped or could not verify, and
any risk the user must know. "Nothing material" is a valid answer, but it is written
out, never left blank, so an empty line cannot be mistaken for an omission.
