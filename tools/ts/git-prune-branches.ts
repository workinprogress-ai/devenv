#!/usr/bin/env node
// git-prune-branches.ts - delete local branches whose upstream is gone.
// Version: 1.1.0
// Description: Branches are detected via for-each-ref's machine-readable
//              upstream tracking (never human-formatted `git branch -vv`
//              output), previewed, and deleted only after an explicit 'Y'.
//              Deletion prefers a safe `git branch -d` per branch; a branch
//              that fails the safe delete (e.g. never-merged work) is
//              reported and left in place — force deletion never happens here.
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { readSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";

assertNodeFloor();

const GONE_MARKER = "|[gone]";

function git(args: string[], input?: string): { status: number; out: string } {
  const r = spawnSync("git", args, { encoding: "utf8", input });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
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

let anyDeleted = false;
for (const branch of gone) {
  if (git(["branch", "-d", branch]).status === 0) {
    console.log(`Deleted: ${branch}`);
    anyDeleted = true;
  } else {
    console.error(`SKIPPED (not safely deletable): ${branch}`);
  }
}
if (anyDeleted) console.log("\nPruned.");
