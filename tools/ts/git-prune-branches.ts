#!/usr/bin/env node
// git-prune-branches.ts - delete local branches whose upstream is gone.
// Version: 1.2.0
// Description: Branches are detected via for-each-ref's machine-readable
//              upstream tracking (never human-formatted `git branch -vv`
//              output), previewed, and deleted only after an explicit 'Y'.
//              A branch is deleted only when its work provably landed on the
//              remote's default branch (origin/<default>, never the checked-out
//              branch, so running from a feature branch cannot misjudge): it is
//              an ancestor of it, or — rebase merges rewrite commit hashes —
//              every commit on it is patch-equivalent (`git cherry`) to
//              something on it ("fully merged by patch content"). Any other
//              branch is left in place. --force deletes every upstream-gone branch
//              unconditionally (still behind the Y-confirm preview).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { readLineStdin } from "../lib/core/stdin-line.ts";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const GONE_TRACK = "[gone]";
const SCRIPT_VERSION = "1.2.0";

import { gitCapture } from "../lib/core/git.ts";

function git(args: string[], input?: string): { status: number; out: string } {
  return gitCapture(null, args, input);
}

let force = false;
try {
  const cli = toolCli({
    name: "git-prune-branches",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
    options: {
      force: { type: "boolean", default: false },
    },
  });
  if (cli.common.help) {
    console.log(`Usage: git-prune-branches [--force]

Delete local branches whose upstream is gone (after git fetch -p).

  (default)   Delete a branch only when its work provably landed on the
              remote default branch (origin/<default>, whatever branch is
              checked out): it is an ancestor of it, or all its commits are
              patch-equivalent to commits on it (rebase merge); any other
              branch is skipped.
  --force     Delete every upstream-gone branch unconditionally (the Y
              confirm still applies).

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`);
    process.exit(0);
  }
  force = cli.values["force"] === true;
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

console.log("Running git fetch, just a moment...");
const fetchRun = git(["fetch", "-p"]);
if (fetchRun.status !== 0) {
  console.error(fetchRun.out);
  process.exit(fetchRun.status);
}

// Branches whose upstream is gone: "<refname:short>|[gone]" — the track token
// is exactly "[gone]" only when the remote ref no longer exists. (Do not guard
// on upstream:trackshort: it is empty for a gone upstream.)
// NUL separates the two fields: a branch name may contain '|' (or any text a
// printable separator could be confused with), never NUL.
const fetched = git(["for-each-ref", "--format=%(refname:short)%00%(upstream:track)", "refs/heads"]);
const gone = fetched.out
  .split("\n")
  .map((l) => l.split("\0") as [string, string?])
  .filter(([, track]) => track === GONE_TRACK)
  .map(([name]) => name)
  .filter((b) => b !== "");

if (gone.length === 0) {
  console.log("No branches with a gone upstream. Nothing to prune.");
  process.exit(0);
}

console.log("\nThese are the branches that will be pruned.\n");
for (const b of gone) console.log(b);
console.log("\nType 'Y' to proceed");
const conf = readLineStdin() ?? "";
console.log("\n\n");

if (conf !== "y" && conf !== "Y") {
  console.log("Aborted — nothing deleted.");
  process.exit(0);
}

/** The remote default branch every merge proof is measured against, or null
 * when it cannot be determined (then nothing counts as merged). */
function defaultRef(): string | null {
  const head = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head.status === 0 && head.out.trim() !== "") return head.out.trim();
  for (const candidate of ["origin/main", "origin/master"]) {
    if (git(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]).status === 0) return candidate;
  }
  return null;
}

const base = defaultRef();

/** The branch tip is already reachable from the remote default branch. */
function mergedAsAncestor(branch: string): boolean {
  return base !== null && git(["merge-base", "--is-ancestor", branch, base]).status === 0;
}

/** Every commit on the branch is patch-equivalent to something on the remote
 * default branch: the rebase-merge proof that the work landed (git cherry
 * prints '+' for commits the base lacks; none means fully merged by patch
 * content). */
function fullyMergedByPatch(branch: string): boolean {
  if (base === null) return false;
  const r = git(["cherry", base, branch]);
  if (r.status !== 0) return false;
  return !r.out.split("\n").some((l) => l.startsWith("+"));
}

let anyDeleted = false;
for (const branch of gone) {
  if (force) {
    if (git(["branch", "-D", branch]).status === 0) {
      console.log(`Deleted (forced): ${branch}`);
      anyDeleted = true;
    } else {
      console.error(`SKIPPED (delete failed): ${branch}`);
    }
    continue;
  }
  const how = mergedAsAncestor(branch) ? "" : fullyMergedByPatch(branch) ? " (fully merged by patch content)" : null;
  if (how === null) {
    console.error(
      base === null
        ? `SKIPPED (cannot determine the default branch to prove it merged; use --force to delete): ${branch}`
        : `SKIPPED (has commits not on ${base}; use --force to delete): ${branch}`,
    );
    continue;
  }
  if (git(["branch", "-D", branch]).status === 0) {
    console.log(`Deleted: ${branch}${how}`);
    anyDeleted = true;
  } else {
    console.error(`SKIPPED (delete failed): ${branch}`);
  }
}
if (anyDeleted) console.log("\nPruned.");
