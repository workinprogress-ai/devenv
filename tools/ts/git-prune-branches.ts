#!/usr/bin/env node
// git-prune-branches.ts - delete local branches whose upstream is gone.
// Version: 1.2.0
// Description: Branches are detected via for-each-ref's machine-readable
//              upstream tracking (never human-formatted `git branch -vv`
//              output), previewed, and deleted only after an explicit 'Y'.
//              Deletion prefers a safe `git branch -d` per branch. Rebase
//              merges rewrite commit hashes, so a refused `-d` is retried
//              with `git cherry`: when every commit on the branch is
//              patch-equivalent to something on HEAD, the work provably
//              landed and the branch is deleted with `-D` ("fully merged by
//              patch content"); any unique commit leaves the branch in
//              place. --force deletes every upstream-gone branch
//              unconditionally (still behind the Y-confirm preview).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { readSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { parseArgs } from "node:util";

assertNodeFloor();

const GONE_MARKER = "|[gone]";

function git(args: string[], input?: string): { status: number; out: string } {
  const r = spawnSync("git", args, { encoding: "utf8", input });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    force: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help === true) {
  console.log(`Usage: git-prune-branches [--force]

Delete local branches whose upstream is gone (after git fetch -p).

  (default)   Safe delete per branch: git branch -d; a refused branch is
              retried via git cherry — all commits patch-equivalent to HEAD
              means the work landed (rebase merge) and the branch is
              force-deleted; any unique commit leaves it skipped.
  --force     Delete every upstream-gone branch unconditionally (the Y
              confirm still applies).
  -h, --help  Show this help.`);
  process.exit(0);
}
const force = values.force === true;

console.log("Running git fetch, just a moment...");
const fetchRun = git(["fetch", "-p"]);
if (fetchRun.status !== 0) {
  console.error(fetchRun.out);
  process.exit(fetchRun.status);
}

// Branches whose upstream is gone: "<refname:short>|[gone]" — the track token
// is exactly "[gone]" only when the remote ref no longer exists. (Do not guard
// on upstream:trackshort: it is empty for a gone upstream.)
const fetched = git(["for-each-ref", "--format=%(refname:short)|%(upstream:track)", "refs/heads"]);
const gone = fetched.out
  .split("\n")
  .filter((l) => l.includes(GONE_MARKER))
  .map((l) => l.slice(0, l.indexOf(GONE_MARKER)))
  .filter((b) => b !== "");

if (gone.length === 0) {
  console.log("No branches with a gone upstream. Nothing to prune.");
  process.exit(0);
}

console.log("\nThese are the branches that will be pruned.\n");
for (const b of gone) console.log(b);
console.log("\nType 'Y' to proceed");
const buf = Buffer.alloc(1);
let conf = "";
try {
  const n = readSync(0, buf, 0, 1, null);
  if (n > 0) conf = buf.toString("utf8");
} catch {
  // no input — treated as not-Y below
}
console.log("\n\n");

if (conf !== "y" && conf !== "Y") {
  console.log("Aborted — nothing deleted.");
  process.exit(0);
}

/** Every commit on the branch is patch-equivalent to something on HEAD:
 * the rebase-merge proof that the work landed (git cherry prints '+'
 * for commits HEAD lacks; none means fully merged by patch content). */
function fullyMergedByPatch(branch: string): boolean {
  const r = git(["cherry", "HEAD", branch]);
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
  if (git(["branch", "-d", branch]).status === 0) {
    console.log(`Deleted: ${branch}`);
    anyDeleted = true;
    continue;
  }
  if (fullyMergedByPatch(branch)) {
    if (git(["branch", "-D", branch]).status === 0) {
      console.log(`Deleted: ${branch} (fully merged by patch content)`);
      anyDeleted = true;
    } else {
      console.error(`SKIPPED (delete failed): ${branch}`);
    }
  } else {
    console.error(`SKIPPED (has commits not on HEAD; use --force to delete): ${branch}`);
  }
}
if (anyDeleted) console.log("\nPruned.");
