#!/usr/bin/env node
// git-wip-recover.ts - Inspect or restore a saved WIP commit from refs/wip/last
// Version: 1.1.0
// Description: refs/wip/last is written by git-wip after each push and is
//              intentionally NOT deleted by git-unwip, so the WIP commit
//              remains reachable for recovery. A failed --branch checkout
//              forwards git checkout's own status (typically 128 for a
//              conflicting branch name; bash printed success
//              unconditionally — a bug the port fixed; anything asserting
//              the old exit 0 or a fixed 1 must match the forwarded code).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { readSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { gitCapture, gitCheck } from "../lib/core/git.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_GENERAL_ERROR } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const WIP_REF = "refs/wip/last";
const SCRIPT_VERSION = "1.1.0";

function git(args: string[]): { status: number; out: string } {
  return gitCapture(null, args);
}

function usage(): never {
  console.log(`Usage: git-wip-recover [--show | --branch [NAME]]

Inspect or restore the most recently saved WIP commit.

Options:
  (no args)       Show a summary and prompt to restore interactively
  --show          Print the saved WIP commit summary and diff stat
  --branch [NAME] Check out a new branch at the WIP commit
                  NAME defaults to 'wip-recovered'
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

The saved ref (refs/wip/last) is updated by git-wip after each push and is
NOT deleted by git-unwip, allowing short-term recovery after unwipping.`);
  process.exit(0);
}

let mode = "";
let branchNameArg = "";
try {
  const cli = toolCli({
    name: "git-wip-recover",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      show: { type: "boolean", default: false },
      branch: { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  if (cli.values["show"] === true) mode = "--show";
  else if (cli.values["branch"] === true) mode = "--branch";
  branchNameArg = cli.positionals[0] ?? "";
} catch (err) {
  // The bash original refused unknown options with exit 1 (general error),
  // not exit 2 — preserved on adoption.
  logError(`git-wip-recover: unknown option. Use --help for usage.`);
  process.exit(EXIT_GENERAL_ERROR);
}

// Resolve the ref (required for all remaining modes)
if (git(["rev-parse", "--verify", "--quiet", WIP_REF]).status !== 0) {
  console.log(`git-wip-recover: no saved WIP commit found (${WIP_REF} does not exist).`);
  process.exit(EXIT_GENERAL_ERROR);
}
const wipCommit = git(["rev-parse", WIP_REF]).out.trim();

function showSummary(wipCommit: string): void {
  const msg = git(["log", "-1", "--format=%s", wipCommit]).out.trim();
  const date = git(["log", "-1", "--format=%cd", "--date=format:%Y-%m-%d %H:%M", wipCommit]).out.trim();
  console.log(`Saved WIP commit: ${wipCommit}`);
  console.log(`  Message : ${msg}`);
  console.log(`  Date    : ${date}`);
  console.log("");
  const stat = gitCheck(null, ["diff", `${wipCommit}^`, wipCommit, "--stat"]);
  if (stat.ok && stat.out) process.stdout.write(stat.out);
}

function checkoutBranch(name: string, wipCommit: string): void {
  const r = git(["checkout", "-b", name, wipCommit]);
  if (r.status !== 0) {
    console.error(r.out);
    process.exit(r.status);
  }
  console.log(`git-wip-recover: checked out '${name}' at ${wipCommit}`);
}

if (mode === "--show") {
  showSummary(wipCommit);
} else if (mode === "--branch") {
  const branchName = branchNameArg !== "" ? branchNameArg : "wip-recovered";
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
