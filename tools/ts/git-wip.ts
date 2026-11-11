#!/usr/bin/env node
// git-wip.ts - stage everything and push a WIP snapshot commit.
// Version: 1.1.0
// Description: WIP snapshots are throwaway checkpoints by design — the commit
//              is created with `git commit -n`, bypassing pre-commit/commit-msg
//              hooks (intentional, like the bash original: requiring WIP
//              snapshots to pass commitlint would defeat their purpose; normal
//              commits must always go through hooks).
//
//              Message input: positional args (joined with spaces) or
//              --file <path> for a pre-written message (used verbatim after
//              the WIP: prefix). --file and positional args are mutually
//              exclusive.
//
//              Failure is loud: a failed commit or push exits non-zero, and
//              refs/wip/last moves only after the push succeeded.
//
//              Scratchpad refusal (two layers, scratchpad.bash's contract):
//              Layer 1 — state: blocked while a scratchpad is active in this
//              repo (the WIP commit would land on the scratch branch and be
//              pushed). Layer 2 — branch: blocked on any scratchpad/* branch
//              even without state refs (defense-in-depth; scratch commits
//              carry no trailers). Each layer emits its own ratified message.
//
//              Protected-branch refusal: a hook-bypass snapshot is never
//              pushed to a protected branch (the remote's default branch,
//              master, main, develop, trunk, release/*), nor from a branch
//              whose configured upstream/push target is one — refused before
//              anything is staged, with no override flag. The push names its
//              destination explicitly (HEAD:refs/heads/<current-branch>).
// Requirements: Node >= 23.6 (native type-stripping execution)

import { existsSync, readFileSync } from "node:fs";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { gitCapture, gitInherit } from "../lib/core/git.ts";
import { protectedPushTarget, type ProtectedHit } from "../lib/core/protected-branch.ts";
import { logError } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const SCRATCHPAD_BRANCH_PREFIX = "scratchpad/";
const SCRATCHPAD_STATE_REF = "refs/scratchpad/state";
const SCRIPT_VERSION = "1.1.0";

function git(args: string[]): { status: number; out: string } {
  return gitCapture(null, args);
}

// The advice follows why the target is protected: re-pointing the upstream
// only helps when the upstream is the culprit, and never names a remote branch
// that may not exist.
function protectedRefusalMessage(branch: string, hit: ProtectedHit): string {
  const lead = `Error: git-wip refuses to snapshot '${branch}':`;
  const tail = "a hook-bypass WIP commit must not be pushed there.";
  switch (hit.source) {
    case "branch":
      return `Error: git-wip refuses to snapshot on protected branch '${branch}' — ${tail}\nSwitch to a feature branch first.`;
    case "upstream":
      return (
        `${lead} its upstream is protected branch '${hit.ref}' — ${tail}\n` +
        "Detach it from that upstream with: git branch --unset-upstream"
      );
    case "push":
      return (
        `${lead} its push target resolves to protected branch '${hit.ref}' — ${tail}\n` +
        `Adjust remote.${hit.remote ?? "<remote>"}.push, push.default or branch.${branch}.pushRemote so the branch pushes to its own name.`
      );
  }
}

function usage(): never {
  console.log(`Usage: git-wip [--staged-only] [-n, --dry-run] [--file <path>] ["<message words...>"]

Stage everything (or --staged-only to skip staging) and push a WIP snapshot
commit prefixed with "WIP: ".

  --staged-only   Do not run \`git add -A\`; commit the existing index.
  -n, --dry-run   Print what would happen (stage set, commit, push) and exit
                  without touching anything — the safe probe path.
  --file <path>   Read the message from a file (used verbatim after the
                  WIP: prefix). Mutually exclusive with positional words.
  --              Ends option parsing: every later token is a message word,
                  so a message may contain -n or --anything.

git-wip refuses on protected branches (the remote's default branch, master,
main, develop, trunk, release/*) and on a branch whose upstream or push target
is one, and has no override: switch to a feature branch first. It always
pushes HEAD to origin under the current branch's own name.

Commit and push require an interactive terminal (or --allow-non-tty): an
accidental non-interactive invocation must not publish a hook-bypass commit.

Options:
${usageCommonFlags({ noDevenv: true })}`);
  process.exit(0);
}

// --- scratchpad refusal (mirror of scratchpad.bash's two-layer contract) ---

function scratchpadRefuse(tool: string, slug: string): never {
  console.error(
    `Error: ${tool} is blocked while a scratchpad is active (${slug || "scratchpad branch"}).\n` +
      "Salvage: repo-scratchpad promote <sha> · or leave the mode: repo-scratchpad exit",
  );
  process.exit(EXIT_CONFLICT);
}

function scratchpadRefusePush(tool: string): never {
  console.error(
    `Error: ${tool} push is blocked on a scratchpad branch — scratch commits bypass hooks and carry no Devenv-Action/Change-Id trailers; they must never reach shared history.\n` +
      "Salvage to the base branch: repo-scratchpad promote <sha> · or leave the mode: repo-scratchpad exit",
  );
  process.exit(EXIT_CONFLICT);
}

function checkScratchpadRefusals(tool: string): void {
  if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) return; // outside a repo: fail later on its own git calls
  if (git(["show-ref", "--verify", "--quiet", SCRATCHPAD_STATE_REF]).status === 0) {
    // Active: name the branch — state-ref tip match first, unique prefix
    // match as the seed/self-heal fallback (scratchpad_active_branch's routes).
    const stateTip = git(["rev-parse", "--verify", SCRATCHPAD_STATE_REF]).out.trim();
    const refs = git(["for-each-ref", "--format=%(refname:short) %(objectname)", `refs/heads/${SCRATCHPAD_BRANCH_PREFIX}`]).out;
    const lines = refs.split("\n").filter((l) => l !== "");
    const byTip = lines.find((l) => l.split(" ")[1] === stateTip);
    const byPrefix = lines.length === 1 ? (lines[0]?.split(" ")[0] ?? "") : "";
    const slug = (byTip ?? byPrefix)?.split(" ")[0] ?? "";
    scratchpadRefuse(tool, slug);
  }
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
  if (branch.startsWith(SCRATCHPAD_BRANCH_PREFIX)) scratchpadRefusePush(tool);
}

// --- argument parsing (positional words + --file, mutually exclusive) ---

let stagedOnly = false;
let dryRun = false;
let allowNonTty = false;
let msgFile = "";
let words: string[] = [];

try {
  const parsed = toolCli({
    name: "git-wip",
    version: SCRIPT_VERSION,
    argv: process.argv.slice(2),
    options: {
      "staged-only": { type: "boolean", default: false },
      "allow-non-tty": { type: "boolean", default: false },
      file: { type: "string" },
    },
  });
  if (parsed.common.help) usage();
  stagedOnly = parsed.values["staged-only"] === true;
  dryRun = parsed.common.dryRun;
  allowNonTty = parsed.values["allow-non-tty"] === true;
  msgFile = typeof parsed.values.file === "string" ? parsed.values.file : "";
  // Message words are the positionals. A word that looks like a flag (or is
  // -n) is only reachable after the `--` separator, which parseArgs honors.
  words = parsed.positionals;
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (msgFile !== "" && words.length > 0) {
  console.error("Error: --file and a positional message are mutually exclusive");
  process.exit(EXIT_MISUSE);
}

let msg: string;
if (msgFile !== "") {
  if (!existsSync(msgFile)) {
    console.error(`Error: message file not found: ${msgFile}`);
    process.exit(EXIT_MISUSE);
  }
  msg = readFileSync(msgFile, "utf8");
} else {
  msg = words.join(" ");
}

// --- refusals before any mutation ---

// Specific guards precede the general TTY gate: a scratchpad-branch refusal
// (EXIT_CONFLICT, names the salvage path) must win over the non-interactive
// refusal (EXIT_MISUSE), or the scratchpad diagnostic is masked.
checkScratchpadRefusals("git-wip");

// Protected-branch gate: the snapshot commit bypasses hooks and is pushed, so
// it must never land on a branch other people build releases from. The branch
// is judged by its own name and by where its configuration would publish it
// (upstream / push target), so a feature branch created from origin/master
// cannot be steered onto master.
// A detached or unborn HEAD has no branch name to publish under: refuse
// rather than push to refs/heads/HEAD.
const currentBranch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]).out.trim();
// An unborn branch still has a symbolic name but nothing to push.
if (currentBranch === "" || git(["rev-parse", "--verify", "--quiet", "HEAD"]).status !== 0) {
  console.error(
    "Error: git-wip refuses to snapshot without a current branch (detached HEAD, or a repository with no commits yet) — " +
      "a snapshot needs a branch name to be pushed under.\n" +
      "Check out or create a branch first (nothing was staged, committed or pushed).",
  );
  process.exit(EXIT_CONFLICT);
}
{
  const hit = protectedPushTarget(currentBranch);
  if (hit !== null) {
    console.error(protectedRefusalMessage(currentBranch, hit));
    console.error("Nothing was staged, committed or pushed.");
    process.exit(EXIT_CONFLICT);
  }
}

// TTY gate (incident-driven): two sessions ran git-wip as a probe and each
// published a hook-bypass commit to the remote. Commit + push require an
// interactive terminal unless explicitly overridden — an accidental
// non-interactive invocation fails here instead of on the remote.
if (!dryRun && !allowNonTty && !process.stdin.isTTY) {
  console.error(
    "Error: git-wip commits and pushes; it requires an interactive terminal.\n" +
      "Probe safely with --dry-run, or force non-interactive use with --allow-non-tty.",
  );
  process.exit(EXIT_MISUSE);
}

// --- dry-run: report the plan, touch nothing ---

if (dryRun) {
  console.log("DRY RUN — nothing was staged, committed, or pushed.");
  console.log(`  Would ${stagedOnly ? "skip staging (commit the existing index)" : "run: git add -A"}`);
  console.log(`  Would commit: WIP: ${msg}`);
  const tracked = git(["ls-files", "--others", "--modified", "--exclude-standard"]);
  const count = tracked.out.split("\n").filter((l) => l.trim() !== "").length;
  console.log(`  Files the snapshot would include (tracked + untracked, modified or new): ${count}`);
  console.log("  Would push to origin.");
  process.exit(0);
}

// --- stage, commit (hook-bypass by design), push, then move the ref ---

if (!stagedOnly) {
  const add = git(["add", "-A"]);
  if (add.status !== 0) {
    console.error(add.out);
    process.exit(add.status);
  }
}

const commit = gitInherit(null, ["commit", "-m", `WIP: ${msg}`, "-n"]);
if (!commit.ok) {
  console.error("git-wip: commit failed (nothing to commit?) — no WIP snapshot was saved.");
  process.exit(EXIT_GENERAL_ERROR);
}
// Explicit destination: a bare `git push` follows push.default/upstream
// config and could publish to another branch (or several).
const push = gitInherit(null, ["push", "origin", `HEAD:refs/heads/${currentBranch}`]);
if (!push.ok) {
  console.error("git-wip: push failed — the WIP commit exists locally but was NOT saved to the remote; refs/wip/last is unchanged.");
  process.exit(EXIT_GENERAL_ERROR);
}
git(["update-ref", "refs/wip/last", "HEAD"]);
