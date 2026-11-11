// repo-bisect — first-bad-commit identification over a commit range.
// Port of repo-bisect.sh: walks git bisect with a probe command; delivers the
// first bad commit with evidence. Non-destructive by nature (detached-HEAD
// visits); refuses on a dirty tree; outside a scratchpad prints a soft notice.

import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { gitCheck, gitInherit } from "../lib/core/git.ts";
import { logError } from "../lib/core/logging.ts";
import { bisectInFlight } from "../lib/domain/scratchpad.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_API_FAILURE, EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

const SCRIPT_VERSION = "1.0.0";

function usage(status: number = 0): never {
  // Requested help is stdout / exit 0; a misuse hint is stderr / exit 2.
  (status === 0 ? console.log : console.error)(`Usage: repo-bisect <bad-ref> <good-ref> -- <probe command...>
       repo-bisect status
       repo-bisect reset

First-bad-commit identification: walks git bisect, running the probe command
at each step. Probe exit 0 = good, non-zero = bad. Works on any branch.

  <bad-ref>    A commit known to have the defect (tip, tag, sha).
  <good-ref>   A commit known NOT to have it (defines the search range).
  probe        The command after '--'; run from the repo root at each step.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Outside a scratchpad, a notice names the operating branch — AI hunts should
start from: repo-scratchpad enter

Exit codes:
    0   Success (first-bad identified)
    1   General error / dirty-tree refusal
    2   Invalid arguments (EXIT_MISUSE)
    4   Not found (bad/good ref unresolvable)`);
  process.exit(status);
}

function git(args: string[]): { out: string; ok: boolean } {
  const r = gitCheck(null, args);
  return { out: r.out, ok: r.ok };
}

let cmd = "";
let rest: string[] = [];
try {
  // The probe command after '--' must survive verbatim (it may contain
  // tokens like -c or ! that belong to the probe, not to this tool), so
  // the raw argv splits at the first '--' before parsing: the left side
  // goes through toolCli, the right side is the probe, untouched.
  const raw = process.argv.slice(2);
  const sep = raw.indexOf("--");
  const flagSide = sep === -1 ? raw : raw.slice(0, sep);
  const probeSide = sep === -1 ? [] : raw.slice(sep + 1);
  const cli = toolCli({
    name: "repo-bisect",
    version: SCRIPT_VERSION,
    argv: flagSide,
    noDryRun: true,
    // Positional-driven: status / reset / <bad-ref> <good-ref>. The probe
    // never enters the parse (it lives in probeSide).
  });
  if (cli.common.help) usage();
  const positionals = [...cli.positionals, ...(sep === -1 ? [] : ["--", ...probeSide])];
  if (positionals.length === 0) usage(EXIT_MISUSE);
  cmd = positionals[0] ?? "";
  rest = positionals.slice(1);
} catch (err) {
  logError(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

const scratchpadActive = (): boolean =>
  gitCheck(null, ["show-ref", "--verify", "--quiet", "refs/scratchpad/state"]).ok;

const requireGitRepo = (): boolean =>
  git(["rev-parse", "--git-dir"]).ok;

if (cmd === "status") {
  if (!requireGitRepo()) process.exit(EXIT_GENERAL_ERROR);
  if (bisectInFlight()) {
    gitInherit(null, ["bisect", "log"]);
  } else {
    console.log("No bisect session in flight.");
  }
  process.exit(0);
}

if (cmd === "reset") {
  if (!requireGitRepo()) process.exit(EXIT_GENERAL_ERROR);
  if (!bisectInFlight()) {
    console.log("No bisect session in flight — nothing to reset.");
    process.exit(0);
  }
  gitInherit(null, ["bisect", "reset"]);
  console.log("Bisect session ended.");
  process.exit(0);
}

// --- run mode: cmd is the bad-ref ---
const bad = cmd;
const good = rest[0];
const afterGood = rest.slice(1);

if (bad === "--" || rest.length < 2) { usage(EXIT_MISUSE); }
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

// A walk started over a session in flight would silently discard it
// (`git bisect start` resets the session's state).
if (bisectInFlight()) {
  console.error("Error: a bisect session is already in flight — repo-bisect refuses to start a walk over it. End it first: repo-bisect reset");
  process.exit(EXIT_CONFLICT);
}

// Dirty-tree refusal (uniform fail-closed rule).
const status = gitCheck(null, ["status", "--porcelain"]);
if (status.out !== "") {
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

// The probe must be runnable: git treats a probe that cannot execute (126/127)
// as "bad" at every step, which would fabricate a verdict.
function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function probeRunnable(command: string): boolean {
  if (command.includes("/")) return isExecutableFile(command);
  return (process.env.PATH ?? "")
    .split(delimiter)
    .some((dir) => dir !== "" && isExecutableFile(join(dir, command)));
}

if (!probeRunnable(probe[0] as string)) {
  console.error(`Error: probe command not found or not executable: ${probe[0]}`);
  process.exit(EXIT_GENERAL_ERROR);
}

// Soft notice outside a scratchpad.
if (!scratchpadActive()) {
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]).out.trim() || "detached HEAD";
  console.error(`notice: operating on '${branch}' directly — AI hunts should start from: repo-scratchpad enter`);
}

// A probe that cannot pass on the known-good commit (missing interpreter, wrong
// directory, exit 126/127) would mark every step bad and fabricate a verdict.
// Exit 125 is a legitimate skip.
{
  const top = git(["rev-parse", "--show-toplevel"]).out.trim();
  const branchName = git(["symbolic-ref", "--quiet", "--short", "HEAD"]).out.trim();
  const origin = branchName || git(["rev-parse", "HEAD"]).out.trim();
  const visit = gitCheck(null, ["checkout", "-q", "--detach", `${good as string}^{commit}`]);
  if (!visit.ok) {
    console.error(`Error: could not check out good-ref to validate the probe: ${visit.err.trim()}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  const goodRun = spawnSync(probe[0] as string, probe.slice(1), { cwd: top, stdio: "ignore" });
  const restore = branchName
    ? gitCheck(null, ["checkout", "-q", branchName, "--"])
    : gitCheck(null, ["checkout", "-q", "--detach", origin]);
  if (!restore.ok) {
    console.error(`Error: could not return to '${branchName || origin}' after validating the probe: ${restore.err.trim()}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (goodRun.status !== 0 && goodRun.status !== 125) {
    console.error(`Error: probe did not pass on good-ref (${good}): ${goodRun.error ? goodRun.error.message : `exit ${goodRun.status}`} — fix the probe before bisecting`);
    process.exit(EXIT_GENERAL_ERROR);
  }
}

const started = gitCheck(null, ["bisect", "start", bad, good as string]);
if (!started.ok) {
  console.error("Error: git bisect start failed:");
  console.error(`${started.out}${started.err}`.trimEnd().split("\n").slice(-3).join("\n"));
  gitCheck(null, ["bisect", "reset"]);
  process.exit(EXIT_GENERAL_ERROR);
}

// Degenerate range: bad == good aborts `bisect run`.
const badSha = git(["rev-parse", "--verify", `${bad}^{commit}`]).out.trim();
const goodSha = git(["rev-parse", "--verify", `${good as string}^{commit}`]).out.trim();
if (badSha === goodSha) {
  gitCheck(null, ["bisect", "reset"]);
  console.error("Error: bad-ref and good-ref resolve to the same commit — nothing to search");
  process.exit(EXIT_MISUSE);
}

const run = gitCheck(null, ["bisect", "run", ...probe]);
const firstBad = run.out;

// The probe's output is untrusted text and may contain any phrase; git prints
// its verdict last, so the last matching line is the real one.
const verdicts = [...firstBad.matchAll(/^([0-9a-f]{7,64}) is the first '?bad'? commit$/gm)];
const firstBadSha = verdicts[verdicts.length - 1]?.[1] ?? "";
const ambiguous = /^The first '?bad'? commit could be any of:$/m.test(firstBad);
const walkAborted = /^bisect run failed:/m.test(firstBad);

if (walkAborted) {
  gitCheck(null, ["bisect", "reset"]);
  console.error("repo-bisect: git aborted the walk (the probe exited outside 0-127 or could not run) — fix the probe; last output:");
  console.error(firstBad.split("\n").slice(-8).join("\n"));
  process.exit(EXIT_GENERAL_ERROR);
}

// Evidence: the probe's own output, then the summary lines.
console.log(firstBad.split("\n").slice(-12).join("\n"));
console.log("--- summary ---");

if (firstBadSha !== "" && !ambiguous) {
  gitCheck(null, ["bisect", "reset"]);
  console.log(`FIRST-BAD: ${firstBadSha}`);
  gitInherit(null, ["show", "--no-patch", "--format=culprit: %h %s (%an, %ad)", firstBadSha]);
  process.exit(0);
}

gitCheck(null, ["bisect", "reset"]);
if (ambiguous) {
  console.error("repo-bisect: AMBIGUOUS — the probe skipped (exit 125) too many commits; the first bad commit could be any of those listed above.");
} else {
  console.error("repo-bisect: no first-bad identified (probe never discriminated — check probe correctness or range)");
}
process.exit(EXIT_GENERAL_ERROR);
