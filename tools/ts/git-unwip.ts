#!/usr/bin/env node
// git-unwip.ts - Soft-reset the current branch to its last non-WIP commit and,
//                when the remote tip is itself a WIP commit, force-push with a
//                lease — but only when every remote commit above the reset
//                target is a WIP. Pushes before resetting, so a failure never
//                leaves a half-done state. Takes no arguments.
// Version: 1.1.0
// Requirements: Node >= 23.6 (native type-stripping execution)

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { gitCapture, gitCheck } from "../lib/core/git.ts";
import { logError } from "../lib/core/logging.ts";
import { protectedPushTarget } from "../lib/core/protected-branch.ts";
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
remote tip is itself a WIP commit, force-push with a lease. The force-push
only happens when every remote commit above the reset target is a WIP commit,
and it runs before the local reset. Takes no arguments.

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
const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]).out.trim();
if (branch === "") {
  console.error("git-unwip: refusing on a detached HEAD — there is no branch to reset or push.");
  process.exit(EXIT_GENERAL_ERROR);
}
// The branch itself, its upstream and its push target are all judged: a
// feature branch tracking a protected branch must not force-push to it.
const protectedHit = protectedPushTarget(branch);
if (protectedHit !== null) {
  console.log(
    protectedHit.source === "branch"
      ? `git-unwip: won't force-push on protected branch '${branch}'.`
      : `git-unwip: won't force-push from '${branch}': its ${protectedHit.source === "upstream" ? "upstream" : "push target"} is protected branch '${protectedHit.ref}'.`,
  );
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

// Work out the remote side BEFORE touching anything. The remote branch is
// rewritten only when its whole range above the reset target is WIP commits:
// a non-WIP commit under a WIP tip (a teammate's push, fetched but never
// merged here) would be destroyed by the force-push.
const upstream = upstreamTarget();
let pushPlan: { remote: string; mergeRef: string; expected: string } | null = null;
if (upstream === null) {
  console.log("git-unwip: no upstream configured for this branch, skipping force-push.");
} else if (!upstream.subject.startsWith("WIP:")) {
  console.log("git-unwip: remote tip is not a WIP commit, skipping force-push.");
} else {
  const range = git(["log", "--format=%H%x09%s", `${commit}..${upstream.sha}`]);
  if (range.status !== 0) {
    console.error(`git-unwip: cannot list ${commit}..${upstream.sha}; refusing to rewrite anything.`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  const lines = range.out.split("\n").filter((l) => l !== "");
  const foreign = lines.filter((l) => !l.slice(l.indexOf("\t") + 1).startsWith("WIP:"));
  if (lines.length === 0 || foreign.length > 0) {
    console.error(
      lines.length === 0
        ? `git-unwip: the remote tip is not above the reset target ${commit}; refusing to rewrite anything.`
        : `git-unwip: the remote branch has ${foreign.length} non-WIP commit(s) above ${commit} (first: ${foreign[0]?.slice(0, 7)}); ` +
            "force-pushing would destroy them. Nothing was changed.",
    );
    process.exit(EXIT_GENERAL_ERROR);
  }
  pushPlan = { remote: upstream.remote, mergeRef: upstream.mergeRef, expected: upstream.sha };
}

// Push first, reset second: a failed push leaves the local branch exactly as
// it was, so there is never a half-done state (remote rewound but local not
// or the reverse can only happen if the soft reset itself fails after a push,
// and that reset only moves the branch pointer to an ancestor).
if (pushPlan !== null) {
  const push = git([
    "push",
    `--force-with-lease=${pushPlan.mergeRef}:${pushPlan.expected}`,
    pushPlan.remote,
    `${commit}:${pushPlan.mergeRef}`,
  ]);
  if (push.status !== 0) {
    console.error(push.out);
    console.error("git-unwip: the force-push failed; the local branch was not changed.");
    process.exit(push.status);
  }
}

// Soft-reset to the last non-WIP commit
const reset = git(["reset", "--soft", commit]);
if (reset.status !== 0) {
  console.error(reset.out);
  process.exit(reset.status);
}

interface UpstreamTarget {
  remote: string;
  mergeRef: string;
  sha: string;
  subject: string;
}

// The branch's configured upstream (remote, remote ref, tip), or null when it
// has none.
function upstreamTarget(): UpstreamTarget | null {
  const remote = gitCheck(null, ["config", "--get", `branch.${branch}.remote`]);
  const merge = gitCheck(null, ["config", "--get", `branch.${branch}.merge`]);
  if (!remote.ok || !merge.ok || remote.out.trim() === "" || merge.out.trim() === "") return null;
  const tip = gitCheck(null, ["log", "@{u}", "-1", "--format=%H%x09%s"]);
  if (!tip.ok) return null;
  const tab = tip.out.indexOf("\t");
  if (tab === -1) return null;
  return {
    remote: remote.out.trim(),
    mergeRef: merge.out.trim(),
    sha: tip.out.slice(0, tab),
    subject: tip.out.slice(tab + 1),
  };
}
