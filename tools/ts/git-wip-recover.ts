#!/usr/bin/env node
// git-wip-recover.ts - Inspect or restore a saved WIP commit from refs/wip/last
// Version: 1.1.0
// Description: refs/wip/last is written by git-wip after each push and is
//              intentionally NOT deleted by git-unwip, so the WIP commit
//              remains reachable for recovery. A failed --branch checkout
//              exits 1 (bash printed success unconditionally — a bug the
//              port fixed; anything asserting the old exit 0 must change).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { readSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const WIP_REF = "refs/wip/last";

function git(args: string[]): { status: number; out: string } {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

function showSummary(wipCommit: string): void {
  const msg = git(["log", "-1", "--format=%s", wipCommit]).out.trim();
  const date = git(["log", "-1", "--format=%cd", "--date=format:%Y-%m-%d %H:%M", wipCommit]).out.trim();
  console.log(`Saved WIP commit: ${wipCommit}`);
  console.log(`  Message : ${msg}`);
  console.log(`  Date    : ${date}`);
  console.log("");
  const stat = spawnSync("git", ["diff", `${wipCommit}^`, wipCommit, "--stat"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (stat.status === 0 && stat.stdout) process.stdout.write(stat.stdout);
}

function checkoutBranch(name: string, wipCommit: string): void {
  const r = git(["checkout", "-b", name, wipCommit]);
  if (r.status !== 0) {
    console.error(r.out);
    process.exit(r.status);
  }
  console.log(`git-wip-recover: checked out '${name}' at ${wipCommit}`);
}

const mode = process.argv[2] ?? "";

if (mode === "-h" || mode === "--help") {
  console.log(`Usage: git-wip-recover [--show | --branch [NAME]]

Inspect or restore the most recently saved WIP commit.

Options:
  (no args)       Show a summary and prompt to restore interactively
  --show          Print the saved WIP commit summary and diff stat
  --branch [NAME] Check out a new branch at the WIP commit
                  NAME defaults to 'wip-recovered'

The saved ref (refs/wip/last) is updated by git-wip after each push and is
NOT deleted by git-unwip, allowing short-term recovery after unwipping.`);
  process.exit(0);
}
if (mode !== "--show" && mode !== "--branch" && mode !== "") {
  console.error(`git-wip-recover: unknown option '${mode}'. Use --help for usage.`);
  process.exit(EXIT_GENERAL_ERROR);
}

// Resolve the ref (required for all remaining modes)
if (git(["rev-parse", "--verify", "--quiet", WIP_REF]).status !== 0) {
  console.log(`git-wip-recover: no saved WIP commit found (${WIP_REF} does not exist).`);
  process.exit(EXIT_GENERAL_ERROR);
}
const wipCommit = git(["rev-parse", WIP_REF]).out.trim();

if (mode === "--show") {
  showSummary(wipCommit);
} else if (mode === "--branch") {
  const branchName = process.argv[3] ?? "wip-recovered";
  checkoutBranch(branchName, wipCommit);
} else {
  showSummary(wipCommit);
  console.log("");
  // Interactive restore prompt. Lines come from stdin; loop exits at EOF
  // (the non-interactive answer is "no").
  const readLine = (): string | null => {
    let buf = Buffer.alloc(0);
    const chunk = Buffer.alloc(1);
    while (true) {
      const idx = buf.indexOf(0x0a);
      if (idx !== -1) return buf.subarray(0, idx).toString("utf8").trim();
      let n = 0;
      try {
        n = readSync(0, chunk, 0, 1, null);
      } catch {
        return buf.length > 0 ? buf.toString("utf8").trim() : null;
      }
      if (n <= 0) return buf.length > 0 ? buf.toString("utf8").trim() : null;
      buf = Buffer.concat([buf, chunk.subarray(0, n)]);
    }
  };
  while (true) {
    process.stdout.write(">>> Restore to a branch? [y/n]: ");
    const answer = readLine();
    if (answer === null) break;
    if (/^[Yy]/.test(answer)) {
      process.stdout.write("    Branch name [wip-recovered]: ");
      const nameAnswer = readLine();
      const branchName = nameAnswer === null || nameAnswer === "" ? "wip-recovered" : nameAnswer;
      checkoutBranch(branchName, wipCommit);
      break;
    }
    if (/^[Nn]/.test(answer)) break;
    console.log("    Please answer y or n.");
  }
}
