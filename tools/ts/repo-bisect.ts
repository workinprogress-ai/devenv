// repo-bisect — first-bad-commit identification over a commit range.
// Port of repo-bisect.sh: walks git bisect with a probe command; delivers the
// first bad commit with evidence. Non-destructive by nature (detached-HEAD
// visits); refuses on a dirty tree; outside a scratchpad prints a soft notice.

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: repo-bisect <bad-ref> <good-ref> -- <probe command...>
       repo-bisect status
       repo-bisect reset

First-bad-commit identification: walks git bisect, running the probe command
at each step. Probe exit 0 = good, non-zero = bad. Works on any branch.

  <bad-ref>    A commit known to have the defect (tip, tag, sha).
  <good-ref>   A commit known NOT to have it (defines the search range).
  probe        The command after '--'; run from the repo root at each step.

Outside a scratchpad, a notice names the operating branch — AI hunts should
start from: repo-scratchpad enter

Exit codes:
    0   Success (first-bad identified)
    1   General error / dirty-tree refusal
    2   Invalid arguments (EXIT_MISUSE)
    4   Not found (bad/good ref unresolvable)
Version: 1.0.0`);
  process.exit(0);
}

function git(args: string[]): { out: string; ok: boolean } {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { out: r.stdout ?? "", ok: r.status === 0 };
}

const argv = process.argv.slice(2);
if (argv.length === 0) usage();
const [cmd] = argv as [string];
const rest = argv.slice(1);

const scratchpadActive = (): boolean =>
  spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/scratchpad/state"], { stdio: "ignore" }).status === 0;

const requireGitRepo = (): boolean =>
  git(["rev-parse", "--git-dir"]).ok;

if (cmd === "-h" || cmd === "--help") usage();

if (cmd === "status") {
  if (!requireGitRepo()) process.exit(EXIT_GENERAL_ERROR);
  if (git(["show-ref", "--verify", "--quiet", "refs/bisect/start"]).ok) {
    spawnSync("git", ["bisect", "log"], { stdio: "inherit" });
  } else {
    console.log("No bisect session in flight.");
  }
  process.exit(0);
}

if (cmd === "reset") {
  if (!requireGitRepo()) process.exit(EXIT_GENERAL_ERROR);
  if (!git(["show-ref", "--verify", "--quiet", "refs/bisect/start"]).ok) {
    console.log("No bisect session in flight — nothing to reset.");
    process.exit(0);
  }
  spawnSync("git", ["bisect", "reset"], { stdio: "inherit" });
  console.log("Bisect session ended.");
  process.exit(0);
}

// --- run mode: cmd is the bad-ref ---
const bad = cmd;
const good = rest[0];
const afterGood = rest.slice(1);

if (bad === "--" || rest.length < 2) { usage(); }
if (afterGood[0] !== "--") {
  console.error("Error: probe command must be separated by '--'");
  process.exit(EXIT_MISUSE);
}
const probe = afterGood.slice(1);
if (probe.length === 0) {
  console.error("Error: empty probe command");
  process.exit(EXIT_MISUSE);
}

if (!requireGitRepo()) process.exit(EXIT_GENERAL_ERROR);

// Dirty-tree refusal (uniform fail-closed rule).
const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
if ((status.stdout ?? "") !== "") {
  console.error("Error: working tree is dirty — repo-bisect refuses (bisect checkouts + dirty tree = failure churn). Commit or save first.");
  process.exit(EXIT_GENERAL_ERROR);
}

// Refs must resolve.
if (!git(["rev-parse", "--verify", "--quiet", `${bad}^{commit}`]).ok) {
  console.error(`Error: bad-ref not resolvable: ${bad}`);
  process.exit(EXIT_API_FAILURE);
}
if (!git(["rev-parse", "--verify", "--quiet", `${good as string}^{commit}`]).ok) {
  console.error(`Error: good-ref not resolvable: ${good}`);
  process.exit(EXIT_API_FAILURE);
}

// Soft notice outside a scratchpad.
if (!scratchpadActive()) {
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]).out.trim() || "detached HEAD";
  console.error(`notice: operating on '${branch}' directly — AI hunts should start from: repo-scratchpad enter`);
}

if (spawnSync("git", ["bisect", "start", bad, good as string], { stdio: "ignore" }).status !== 0) {
  console.error("Error: git bisect start failed:");
  spawnSync("bash", ["-c", `git bisect start ${bad} ${good} 2>&1 | tail -3`], { stdio: "inherit" });
  spawnSync("git", ["bisect", "reset"], { stdio: "ignore" });
  process.exit(EXIT_GENERAL_ERROR);
}

// Degenerate range: bad == good aborts `bisect run`.
const badSha = git(["rev-parse", "--verify", `${bad}^{commit}`]).out.trim();
const goodSha = git(["rev-parse", "--verify", `${good as string}^{commit}`]).out.trim();
if (badSha === goodSha) {
  spawnSync("git", ["bisect", "reset"], { stdio: "ignore" });
  console.error("Error: bad-ref and good-ref resolve to the same commit — nothing to search");
  process.exit(EXIT_MISUSE);
}

const run = spawnSync("git", ["bisect", "run", ...probe], { encoding: "utf8" });
const firstBad = run.stdout ?? "";

// Probe could not EXECUTE somewhere (126/127 class): git treats that as 'bad',
// which would fabricate a verdict from a broken probe.
if (/(failed to run|command not found|permission denied|exit code 12[67])/.test(firstBad)) {
  spawnSync("git", ["bisect", "reset"], { stdio: "ignore" });
  console.error("repo-bisect: probe execution failed (exit 126/127 class) — the walk's conclusion would be fabricated. Fix the probe; full output above.");
  console.error(firstBad.split("\n").slice(-8).join("\n"));
  process.exit(EXIT_GENERAL_ERROR);
}

// Evidence: the probe's own output, then the summary lines.
console.log(firstBad.split("\n").slice(-12).join("\n"));
console.log("--- summary ---");

const definitive = /first '?'bad'?,? commit/i.test(firstBad) && !firstBad.includes("could be any of");
if (definitive) {
  let sha = firstBad.match(/^[0-9a-f]{7,} is the first '?'bad'? commit/m)?.[0]?.split(" ")[0] ?? "";
  if (sha === "") {
    sha = firstBad.match(/[0-9a-f]{7,}/g)?.pop() ?? "";
  }
  spawnSync("git", ["bisect", "reset"], { stdio: "ignore" });
  console.log(`FIRST-BAD: ${sha}`);
  spawnSync("git", ["show", "--no-patch", "--format=culprit: %h %s (%an, %ad)", sha], { stdio: "inherit" });
  process.exit(0);
}

spawnSync("git", ["bisect", "reset"], { stdio: "ignore" });
if (firstBad.includes("could be any of")) {
  console.error("repo-bisect: AMBIGUOUS — the probe skipped (exit 125) too many commits; the first bad commit could be any of those listed above.");
} else {
  console.error("repo-bisect: no first-bad identified (probe never discriminated — check probe correctness or range)");
}
process.exit(EXIT_GENERAL_ERROR);
