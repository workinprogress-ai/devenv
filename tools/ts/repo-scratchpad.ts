// repo-scratchpad — governed experiment sandbox for AI sessions.
// Port of repo-scratchpad.sh over lib/domain/scratchpad.ts. Cuts a
// scratchpad/<slug> branch, records the base, permits hook-bypassing commits
// on it. reset/exit only touch scratch-created content; entry is fail-closed.

import { spawnSync } from "node:child_process";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { EXIT_API_FAILURE, EXIT_CONFLICT, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import {
  SCRATCHPAD_BRANCH_PREFIX, SCRATCHPAD_STATE_REF, activeBranch, baseCommit,
  bisectInFlight, clearState, git, isActive, isDirty, onActiveScratchBranch, onScratchBranch,
  recordState, returnToBaseChecked, snapshotCarry, syncStateRef, validateSlug,
  workingBranch,
} from "../lib/domain/scratchpad.ts";

assertNodeFloor();

function usage(): never {
  console.log(`Usage: repo-scratchpad enter [slug] [--carry]
       repo-scratchpad status
       repo-scratchpad resume
       repo-scratchpad commit "<title>"
       repo-scratchpad reset
       repo-scratchpad promote <sha>
       repo-scratchpad exit

Governed experiment sandbox. Cuts scratchpad/<slug> from the current HEAD;
hook-bypassing commits are permitted on it; reset returns to base AI-safe.

Entry is FAIL-CLOSED: a dirty working tree (tracked or untracked) refuses
entry. Save work first: git wip (recommended; notes: it pushes) or a normal
commit. --carry overrides with a loud warning + best-effort snapshot into
.local-artifacts/tmp/scratchpad/ — carried work is DESTROYED by reset.

Options:
${usageCommonFlags({ noDryRun: true, noDevenv: true })}

Exit codes:
    0   Success
    1   General error / safety refusal (dirty tree, bisect in flight, etc.)
    2   Invalid arguments (EXIT_MISUSE)
    3   Conflict (already active, nothing to reset) (EXIT_CONFLICT)
    4   Not found (unknown sha/promote target) (EXIT_API_FAILURE)`);
  process.exit(0);
}

const requireRepo = (): void => {
  if (!git(["rev-parse", "--git-dir"]).ok) process.exit(EXIT_GENERAL_ERROR);
};

// Subcommand dispatch is positionally driven (status/reset/promote/...);
// toolCli parses strictly, so an unknown flag is misuse and the subcommand and
// its operands (slug, title words, sha) are the positionals. A title word that
// looks like a flag is only reachable after `--` (repo-scratchpad commit -- "-x fix").
let carryFlag = false;
let positionals: string[] = [];
try {
  const cli = toolCli({
    name: "repo-scratchpad",
    version: "1.0.0",
    argv: process.argv.slice(2),
    noDryRun: true,
    options: {
      carry: { type: "boolean", default: false },
    },
  });
  if (cli.common.help) usage();
  carryFlag = cli.values["carry"] === true;
  positionals = cli.positionals;
} catch (err) {
  console.error(errorMessage(err));
  console.error("Use --help for usage information");
  process.exit(EXIT_MISUSE);
}

if (positionals.length === 0) usage();
const cmd = positionals[0] as string;
const rest = positionals.slice(1);

// --- enter ---
if (cmd === "enter") {
  requireRepo();
  if (bisectInFlight()) {
    console.error("Error: a git bisect session is mid-flight — finish or abort it (git bisect reset) before entering a scratchpad.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  let slug = "";
  for (const a of rest) {
    if (slug === "") slug = a;
    else { console.error(`Error: unexpected argument '${a}'`); process.exit(EXIT_MISUSE); }
  }
  if (slug === "") slug = "exp";
  if (!validateSlug(slug)) {
    console.error(`Error: slug must match [a-z0-9][a-z0-9.-]{0,38} with no '..': '${slug}'`);
    process.exit(EXIT_MISUSE);
  }
  if (isActive()) {
    console.error(`Error: a scratchpad is already active (${activeBranch()}). One per repo — exit it first.`);
    process.exit(EXIT_CONFLICT);
  }
  if (isDirty()) {
    if (carryFlag) {
      console.error("⚠️  CARRY: dirty tree carried into the scratchpad. scratchpad reset will DESTROY carried work.");
      if (!snapshotCarry(slug)) {
        console.error("Error: the carry snapshot could not be written — refusing entry (reset would destroy the carried work with no salvage record).");
        process.exit(EXIT_GENERAL_ERROR);
      }
    } else {
      console.error("Error: working tree is dirty — save work first (git wip or commit), or use --carry to snapshot and proceed.");
      process.exit(EXIT_GENERAL_ERROR);
    }
  }
  const base = git(["rev-parse", "HEAD"]).out;
  const origin = workingBranch();
  const branch = `${SCRATCHPAD_BRANCH_PREFIX}${slug}`;
  if (git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok) {
    console.error(`Error: branch '${branch}' already exists — pick another slug or remove it.`);
    process.exit(EXIT_CONFLICT);
  }
  if (base === "") {
    console.error("Error: cannot resolve HEAD (repository has no commits?) — nothing to cut a scratchpad from.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const cut = git(["checkout", "-q", "-b", branch]);
  if (!cut.ok) {
    console.error(`Error: could not create and check out '${branch}' — nothing was activated.`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  const recorded = recordState(slug, base, branch, origin);
  if (!recorded.ok) {
    // Roll the activation back: return to where entry started, then drop the
    // just-cut (commit-less) branch — never while still standing on it.
    const back = origin !== "" ? git(["checkout", "-q", origin]) : git(["checkout", "-q", "--detach", base]);
    const dropped = back.ok && git(["branch", "-q", "-D", branch]).ok;
    if (recorded.reason === "concurrent") {
      console.error(`Error: a scratchpad was activated concurrently — refusing to overwrite its state. Existing: ${activeBranch()}`);
    } else {
      console.error(`Error: could not record the scratchpad state (${recorded.detail}).`);
    }
    if (!dropped) {
      console.error(`Error: the activation rollback was incomplete — you may still be on '${branch}'. Recovery (user's hands): git checkout ${origin !== "" ? origin : base}; git branch -D ${branch}`);
    }
    process.exit(EXIT_GENERAL_ERROR);
  }
  console.log(`Scratchpad active: ${branch} (base: ${base.slice(0, 7)})`);
  console.log('Hook-bypassing commits enabled: repo-scratchpad commit "<title>"');
  process.exit(0);
}

// --- status ---
if (cmd === "status") {
  requireRepo();
  if (!isActive()) {
    console.log("No scratchpad active.");
    process.exit(0);
  }
  const branch = activeBranch();
  if (branch === "") {
    console.log("⚠️  Scratchpad state refs exist but no scratchpad/* branch matches (ghost state).");
    console.log("   Recovery (user's hands): git update-ref -d refs/scratchpad/state; git update-ref -d refs/scratchpad/base; git update-ref -d refs/scratchpad/origin-branch");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const base = baseCommit();
  console.log(`Scratchpad active: ${branch}`);
  console.log(`Base: ${base === "" ? "unknown" : base.slice(0, 7)}`);
  const ahead = git(["rev-list", "--count", `${base}..HEAD`]).out;
  console.log(`Ahead of base: ${ahead || "?"} commit(s)`);
  if (!onScratchBranch()) {
    console.log("⚠️  HEAD is NOT on the scratch branch (paused or mid-foreign-bisect) — commit/reset refuse until you repo-scratchpad resume.");
  }
  if (bisectInFlight()) console.log("⚠️  git bisect session in flight — reset/exit refuse until it finishes.");
  process.exit(0);
}

// --- resume ---
if (cmd === "resume") {
  requireRepo();
  if (!isActive()) {
    console.error("Error: no scratchpad active");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const branch = activeBranch();
  if (branch === "") {
    console.error("Error: ghost state — see repo-scratchpad status");
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (bisectInFlight()) {
    console.error("Error: a git bisect session is mid-flight — finish or abort it first.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (isDirty()) {
    console.error("Error: working tree/index is dirty — a post-promote pause may hold the staged salvage. Land it first (repo-scratchpad exit keeps staged work; then commit via the normal flow), or clean the tree, then resume.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (!git(["checkout", "-q", branch]).ok) {
    console.error(`Error: could not check out ${branch} — still not resumed.`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  syncStateRef();
  console.log(`Resumed: HEAD on ${branch}`);
  process.exit(0);
}

// --- commit ---
if (cmd === "commit") {
  requireRepo();
  if (rest.length === 0) {
    console.error("Error: commit requires a title");
    process.exit(EXIT_MISUSE);
  }
  if (!isActive()) {
    console.error("Error: no scratchpad active — enter one first (commits here are hook-bypassing and must stay on the scratchpad branch)");
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (!onActiveScratchBranch()) {
    console.error("Error: HEAD is not on the scratch branch (the active one) — return first: repo-scratchpad resume (raw git checkout is not sanctioned)");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const title = rest.join(" ");
  git(["add", "-A"]);
  // Hook-bypass (git-wip precedent): enforcement hooks skipped, message lands
  // verbatim with the scratch: brand. Exit code passes through unchanged —
  // the bisect probe contract depends on determinism here.
  const r = spawnSync("git", ["commit", "-n", "-q", "-m", `scratch: ${title}`], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
  syncStateRef();
  spawnSync("git", ["log", "-1", "--format=committed %h %s"], { stdio: "inherit" });
  process.exit(0);
}

// --- reset ---
if (cmd === "reset") {
  requireRepo();
  if (!isActive()) {
    console.error("Error: no scratchpad active");
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (bisectInFlight()) {
    console.error("Error: a git bisect session is mid-flight — finish or abort it (git bisect reset) before resetting the scratchpad.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (!onActiveScratchBranch()) {
    console.error("Error: HEAD is not on the scratch branch (the active one) — reset would rewind some other branch. Return first: repo-scratchpad resume");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const base = baseCommit();
  if (base === "") {
    console.error("Error: base ref missing — scratchpad state corrupt; exit and re-enter.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (!git(["reset", "--hard", "-q", base]).ok) {
    console.error("Error: git reset --hard failed — the scratchpad was NOT reset; inspect with git status.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  // Clean untracked scratch debris repo-wide BUT preserve .local-artifacts/
  // (the carry-snapshot salvage record). Runs at the toplevel, cwd-independent.
  const top = git(["rev-parse", "--show-toplevel"]).out;
  if (top === "" || !git(["-C", top, "clean", "-qfd", "-e", ".local-artifacts"]).ok) {
    console.error("Error: git clean failed after the reset — untracked scratch files may remain; inspect with git status.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  syncStateRef();
  console.log(`Reset to base ${base.slice(0, 7)}`);
  process.exit(0);
}

// --- promote ---
if (cmd === "promote") {
  requireRepo();
  if (rest.length !== 1) {
    console.error("Error: promote requires exactly one sha");
    process.exit(EXIT_MISUSE);
  }
  if (!isActive()) {
    console.error("Error: no scratchpad active");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const sha = rest[0] as string;
  const branch = activeBranch();
  const base = baseCommit();
  const shaFull = git(["rev-parse", "--verify", `${sha}^{commit}`]).out;
  if (shaFull === "") {
    console.error(`Error: '${sha}' is not a resolvable commit`);
    process.exit(EXIT_API_FAILURE);
  }
  const ancestor1 = git(["merge-base", "--is-ancestor", shaFull, `refs/heads/${branch}`]).ok;
  const ancestor2 = git(["merge-base", "--is-ancestor", base, shaFull]).ok;
  if (!ancestor1 || shaFull === base || !ancestor2) {
    console.error(`Error: '${sha}' is not a commit on the scratchpad branch`);
    process.exit(EXIT_API_FAILURE);
  }
  if (!git(["diff", "--cached", "--quiet"]).ok) {
    console.error("Error: the index already holds staged changes (an earlier promote's salvage, or other staged work). Land or clear them first — a second promote would mix with them. Nothing changed.");
    process.exit(EXIT_CONFLICT);
  }
  const rb = returnToBaseChecked();
  if (!rb.ok) {
    // Never cherry-pick onto the scratch branch because checkout failed.
    console.error(`Error: could not leave the scratch branch — ${rb.error}. Promote aborted; nothing changed.`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (!git(["cherry-pick", "--no-commit", shaFull]).ok) {
    // The index was empty before the pick (checked above), so reset --merge
    // undoes exactly the pick's staged and conflicted changes and keeps any
    // unrelated working-tree edits; no --hard on whatever branch we landed on.
    git(["cherry-pick", "--quit"]);
    const undone = git(["reset", "--merge"]);
    const back = undone.ok && git(["checkout", "-q", branch]).ok;
    if (back) syncStateRef();
    console.error("Error: cherry-pick conflicted — promote aborted");
    if (!back) {
      console.error(`Error: the abort could not be completed — inspect with git status. Recovery (user's hands): git reset --merge; git checkout ${branch}`);
    } else {
      console.error("Scratchpad state restored");
    }
    process.exit(EXIT_CONFLICT);
  }
  const scratchTip = git(["rev-parse", `refs/heads/${branch}`]).out;
  if (scratchTip === "" || !git(["update-ref", SCRATCHPAD_STATE_REF, scratchTip]).ok) {
    console.error("Error: the promote landed, but the scratchpad state ref could not be refreshed — run repo-scratchpad status.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  console.log(`Promoted ${shaFull.slice(0, 7)} onto ${base.slice(0, 7)} — staged, uncommitted.`);
  console.log("The scratchpad is PAUSED (state kept). To land the salvage: repo-scratchpad exit (staged work survives), then commit via the normal flow (/devenv-commit).");
  console.log("To keep hunting: repo-scratchpad resume");
  process.exit(0);
}

// --- exit ---
if (cmd === "exit") {
  requireRepo();
  if (!isActive()) {
    console.error("Error: no scratchpad active");
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (bisectInFlight()) {
    console.error("Error: a git bisect session is mid-flight — finish or abort it (git bisect reset) before exiting the scratchpad.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const branch = activeBranch();
  if (branch === "") {
    console.error("Error: ghost state — state refs exist but no scratchpad/* branch matches. See repo-scratchpad status for the recovery steps.");
    process.exit(EXIT_GENERAL_ERROR);
  }
  const base = baseCommit();
  const tip = git(["rev-parse", "--verify", `refs/heads/${branch}`]).out;
  const commits = git(["rev-list", "--count", `${base}..${branch}`]).out || "0";
  // Same F23 rule as promote: never mutate further after a failed checkout.
  // The next line deletes the branch — a failed checkout would leave us on
  // it and -D would drop the tip.
  const rb = returnToBaseChecked();
  if (!rb.ok) {
    console.error(`Error: could not leave the scratch branch — ${rb.error}. Exit aborted; nothing deleted.`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (!git(["branch", "-q", "-D", branch]).ok) {
    console.error(`Error: could not delete ${branch} — the scratchpad state is kept so the mode stays consistent. Retry repo-scratchpad exit.`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  clearState();
  console.log(`Scratchpad exited; branch ${branch} deleted (${commits} scratch commit(s)).`);
  console.log(`Tip ${tip} remains reachable via reflog until gc — salvage with cherry-pick if needed.`);
  process.exit(0);
}

console.error(`Error: unknown command '${cmd}'`);
process.exit(EXIT_MISUSE);
