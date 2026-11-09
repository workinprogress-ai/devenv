#!/usr/bin/env node
// git-unwip.ts - Soft-reset the current branch to its last non-WIP commit and,
//                when the remote tip is itself a WIP commit, force-push with a
//                lease. Takes no arguments.
// Version: 1.1.0
// Requirements: Node >= 23.6 (native type-stripping execution)

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { gitCapture, gitCheck } from "../lib/core/git.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

function git(args: string[]): { status: number; out: string } {
  return gitCapture(null, args);
}

const SCRIPT_VERSION = "1.1.0";

function usage(): never {
  console.log(USAGE_TEXT);
  process.exit(0);
}

const USAGE_TEXT = `Usage: git-unwip

Soft-reset the current branch to its last non-WIP commit and, when the
remote tip is itself a WIP commit, force-push with a lease.
Takes no arguments.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}`;

try {
  const cli = toolCli({
    name: "git-unwip",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    noDryRun: true,
    allowPositionals: false,
  });
  if (cli.common.help) usage();
} catch (err) {
  // Bash-parity refusal: the full usage block with a non-zero exit (the
  // helper-args suite pins both 'Usage' in the output and status != 0).
  logError(errorMessage(err));
  console.log(USAGE_TEXT);
  process.exit(EXIT_MISUSE);
}

// Guard 1: refuse to force-push on protected branches
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
if (/^(main|master|develop)$/.test(branch)) {
  console.log(`git-unwip: won't force-push on protected branch '${branch}'.`);
  process.exit(EXIT_GENERAL_ERROR);
}

// Find the last non-WIP commit: match the "WIP:" marker anchored to the START
// of the subject only (a real commit whose subject merely contains "wip:" is
// never skipped), and keep full hashes.
let commit = "";
for (const line of git(["log", "--format=%H%x09%s"]).out.split("\n")) {
  const tabIndex = line.indexOf("\t");
  if (tabIndex === -1) continue;
  const subject = line.slice(tabIndex + 1);
  if (!subject.startsWith("WIP:")) {
    commit = line.slice(0, tabIndex);
    break;
  }
}

if (commit === "") {
  console.error("git-unwip: no non-WIP commit found to reset to — refusing.");
  process.exit(EXIT_GENERAL_ERROR);
}

// Guard: the reset target must be an ancestor of HEAD (it always is when it
// comes from `git log HEAD..`, but verify explicitly — a wrong target would
// silently move the branch pointer).
if (git(["merge-base", "--is-ancestor", commit, "HEAD"]).status !== 0) {
  console.error(`git-unwip: reset target ${commit} is not an ancestor of HEAD — refusing.`);
  process.exit(EXIT_GENERAL_ERROR);
}

// Soft-reset to the last non-WIP commit
const reset = git(["reset", "--soft", commit]);
if (reset.status !== 0) {
  console.error(reset.out);
  process.exit(reset.status);
}

// Guard 3: only force-push if the remote tip is itself a WIP commit.
// A missing upstream is fine — nothing to force-push against.
const upstream = spawnUpstreamSubject();
if (upstream === null) {
  console.log("git-unwip: no upstream configured for this branch, skipping force-push.");
  process.exit(0);
}
if (!upstream.startsWith("WIP:")) {
  console.log("git-unwip: remote tip is not a WIP commit, skipping force-push.");
  process.exit(0);
}

// Guard 4: use --force-with-lease to avoid overwriting unexpected remote commits
const push = git(["push", "--force-with-lease"]);
if (push.status !== 0) {
  console.error(push.out);
  process.exit(push.status);
}

function spawnUpstreamSubject(): string | null {
  const r = gitCheck(null, ["log", "@{u}", "-1", "--format=%s"]);
  if (!r.ok) return null;
  return r.out;
}
