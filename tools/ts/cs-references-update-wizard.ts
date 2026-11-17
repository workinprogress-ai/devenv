// cs-references-update-wizard — single-repo NuGet dependency-update
// workflow. Port of cs-references-update-wizard.sh: create the update
// branch, run cs-references-update, detect major/TFM bumps via version
// snapshots, run tests (pause on failure), commit/push, create + merge the
// PR (via the pr-* wrapper tools), and return to the default branch.
// Provider interactions (PR create/merge) go through the pr-* wrapper
// tools — never raw gh.

import { spawnSync } from "node:child_process";
import { requireCommandOrExit } from "../lib/core/commands.ts";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { errorMessage } from "../lib/core/logging.ts";
import { gitCapture, gitCheck } from "../lib/core/git.ts";
import { EXIT_API_FAILURE, EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { siblingInvocation } from "../lib/core/sibling.ts";
import { csprojPackageReferences, targetFrameworksOf } from "../lib/domain/cs/csproj.ts";

assertNodeFloor();


const SCRIPT_VERSION = "1.0.0";
const DEFAULT_UPDATE_BRANCH = "auto-update-references";
const EXIT_GIT_FAILED = 20;
const EXIT_NO_CHANGES = 10;
const EXIT_UPDATE_FAILED = 21;
const EXIT_TESTS_FAILED = 30;
const EXIT_PR_FAILED = 40;
const EXIT_MERGE_FAILED = 41;

// Branch names the update branch may never take: the wizard force-resets and
// deletes its branch, which must not touch a long-lived branch.
const PROTECTED_BRANCHES = new Set(["master", "main", "develop", "development", "trunk", "HEAD"]);
const PROTECTED_BRANCH_PREFIXES = ["release/", "hotfix/"];

// TODO:DEVENV[Plan-001]: the commit message suffix below suppresses CI on the update commit while the dependency wizard waits for CI between generations — remove when the maintainer has confirmed what the skip-CI token does to the release workflows the dependency wizard waits on
const COMMIT_SUFFIX = " [skip ci]";

function showUsage(): never {
  console.log(`Usage: cs-references-update-wizard [OPTIONS] REPO_DIR

Runs the full NuGet dependency-update workflow for a single repository:
  1. Create branch '${DEFAULT_UPDATE_BRANCH}' (or the value of --branch)
  2. Run cs-references-update to update all NuGet packages
  3. Detect major version bumps in non-test code (breaking changes)
  4. Run tests — pause for user if they fail
  5. Determine change level (patch: or major:)
  6. Commit and push
  7. Create and merge PR

Options:
${usageCommonFlags({ noDryRunShort: true })}
    --branch NAME       Branch name to create (default: ${DEFAULT_UPDATE_BRANCH});
                        protected names (default branch, master, main, develop,
                        trunk, release/*, hotfix/*) are refused
    --continue          Resume a previously started update
    --framework TFM     Forwarded to cs-references-update
    --lang-version VER  Forwarded to cs-references-update
    --lang-default      Forwarded to cs-references-update

Exit codes:
    0   success
    10  no changes detected
    20  a git operation failed
    21  cs-references-update failed
    30  tests failed (interactive pause offered)
    40  PR creation failed
    41  PR merge failed
    2   invalid arguments`);
  process.exit(0);
}

// ── Prompts (read the terminal, never piped stdin) ───────────────────────

function promptUser(message: string): void {
  console.log("");
  console.log(`>>> ${message}`);
  spawnSync("bash", ["-c", 'read -r -p "    Press Enter to continue (or Ctrl+C to abort)... " < /dev/tty'], {
    stdio: "inherit",
  });
  console.log("");
}

/** True when a controlling terminal can be opened for an answer. */
function hasTerminal(): boolean {
  try {
    closeSync(openSync("/dev/tty", "r"));
    return true;
  } catch {
    return false;
  }
}

/** Ask a yes/no question on the terminal. Without a terminal there is nobody
 * to ask, so the answer is no. */
function promptYesNo(question: string): boolean {
  if (!hasTerminal()) {
    logWarn(`No terminal to ask: ${question} — treating as no`);
    return false;
  }
  console.log("");
  for (;;) {
    process.stdout.write(`>>> ${question} [y/n]: `);
    const r = spawnSync("bash", ["-c", 'read -r answer < /dev/tty; printf "%s" "$answer"'], {
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    });
    const a = (r.stdout ?? "").trim();
    if (/^[Yy]/.test(a)) return true;
    if (/^[Nn]/.test(a)) return false;
    console.log("    Please answer y or n.");
  }
}

// ── Git helper ───────────────────────────────────────────────────────────

function git(repoDir: string, args: string[], opts: { quiet?: boolean } = {}): { ok: boolean; out: string } {
  // quiet only suppressed terminal display in the old shape; output was
  // always captured into `out`. gitCapture captures both streams — callers
  // that printed stdout under non-quiet still print from `out`.
  void opts;
  const r = gitCapture(repoDir, args);
  return { ok: r.status === 0, out: r.out };
}

// ── Leftover update branch ───────────────────────────────────────────────

/** Number of commits on local `branch` that the remote counterpart does not
 * have. A branch with no remote counterpart is compared with `base`. Zero
 * when the branch does not exist. */
function unpushedCommitCount(repoDir: string, branch: string, base: string): number {
  if (!gitCheck(repoDir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok) return 0;
  const remoteRef = `refs/remotes/origin/${branch}`;
  const since = gitCheck(repoDir, ["rev-parse", "--verify", "--quiet", remoteRef]).ok ? remoteRef : base;
  const n = Number.parseInt(gitCheck(repoDir, ["rev-list", "--count", `${since}..refs/heads/${branch}`]).out.trim(), 10);
  // An unreadable count is treated as unpushed work: never delete on doubt.
  return Number.isNaN(n) ? 1 : n;
}

/** Whether a leftover local update branch may be deleted: only when it holds
 * no commits beyond its remote counterpart (or the base), or the operator
 * confirms. Without a terminal the answer is no. */
function mayDiscardLeftoverBranch(repoDir: string, branch: string, base: string): boolean {
  const n = unpushedCommitCount(repoDir, branch, base);
  if (n === 0) return true;
  logWarn(`Local branch '${branch}' holds ${n} commit(s) that are not on its remote counterpart.`);
  return promptYesNo(`Delete local branch '${branch}' and lose those commits`);
}

// ── Staging ──────────────────────────────────────────────────────────────

/** Stage the modified and deleted tracked files by explicit path. Untracked
 * files are never swept in; they are listed so nothing disappears silently.
 * The reference update itself only rewrites existing project files in place.
 * The only other writer is the repo's own boilerplate script, whose new files
 * cannot be told apart from operator residue, so they are reported, not
 * staged. */
function stageTrackedChanges(repoDir: string): void {
  const changed = gitCheck(repoDir, ["-c", "core.quotePath=false", "diff", "--name-only", "-z", "HEAD"]).out
    .split("\0")
    .filter((p) => p !== "");
  if (changed.length > 0 && !gitCheck(repoDir, ["add", "--", ...changed]).ok) {
    throw new Error(`git add failed in ${repoDir}`);
  }
  const untracked = gitCheck(repoDir, ["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard", "-z"]).out
    .split("\0")
    .filter((p) => p !== "");
  if (untracked.length > 0) {
    logWarn(`Untracked files are not part of the update commit: ${untracked.join(", ")}`);
  }
}

// ── Version snapshots ────────────────────────────────────────────────────

interface Snapshot {
  packages: string[]; // "NAME VERSION" sorted
  tfms: string[]; // "__TFM__ framework" sorted
}

function snapshotVersions(repoDir: string): Snapshot {
  const packages = new Set<string>();
  const tfms = new Set<string>();
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "test" || e.name === "tests" || e.name === "bin" || e.name === "obj") continue;
        // Scoped to src/ trees (bash original). The trailing separator makes
        // the repo's own src/ directory match — ".../src" alone does not
        // contain "/src/", which silently skipped every top-level csproj.
        if (!`${p}/`.includes("/src/")) continue;
        walk(p);
      } else if (e.name.endsWith(".csproj")) {
        for (const ref of csprojPackageReferences(p, repoDir)) {
          if (ref.version !== "") packages.add(`${ref.name} ${ref.version}`);
        }
        for (const t of targetFrameworksOf(readFileSync(p, "utf8"))) tfms.add(`__TFM__ ${t}`);
      }
    }
  };
  walk(repoDir);
  return { packages: [...packages].sort(), tfms: [...tfms].sort() };
}

function detectMajorBumps(before: Snapshot, after: Snapshot): { hasMajor: boolean; lines: string[] } {
  const oldVersions = new Map<string, string>();
  for (const line of before.packages) {
    const sp = line.indexOf(" ");
    if (sp > 0) oldVersions.set(line.slice(0, sp), line.slice(sp + 1));
  }
  const lines: string[] = [];
  let hasMajor = false;
  for (const line of after.packages) {
    const sp = line.indexOf(" ");
    if (sp <= 0) continue;
    const pkg = line.slice(0, sp);
    const newVer = line.slice(sp + 1);
    const oldVer = oldVersions.get(pkg);
    if (oldVer === undefined) continue;
    const oldMajor = parseInt(oldVer.split(".")[0] ?? "0", 10);
    const newMajor = parseInt(newVer.split(".")[0] ?? "0", 10);
    if (!Number.isNaN(oldMajor) && !Number.isNaN(newMajor) && newMajor !== oldMajor && newMajor > oldMajor) {
      lines.push(`  ${pkg}: ${oldVer} → ${newVer} (MAJOR)`);
      hasMajor = true;
    }
  }
  return { hasMajor, lines };
}

// ── Main ─────────────────────────────────────────────────────────────────

function main(): void {
  requireCommandOrExit("git", undefined, EXIT_GENERAL_ERROR);
  requireCommandOrExit("dotnet", undefined, EXIT_GENERAL_ERROR);

  let repoDir = "";
  let updateBranch = DEFAULT_UPDATE_BRANCH;
  let dryRun = false;
  let continueMode = false;
  let framework = "";
  let langVersion = "";
  let langDefault = false;

  try {
    const cli = toolCli({
      name: "cs-references-update-wizard",
      version: SCRIPT_VERSION,
      argv: process.argv.slice(2),
      options: {
        branch: { type: "string", default: DEFAULT_UPDATE_BRANCH },
        framework: { type: "string" },
        "lang-version": { type: "string" },
        "lang-default": { type: "boolean", default: false },
        continue: { type: "boolean", default: false },
      },
    });
    if (cli.common.help) showUsage();
    updateBranch = (cli.values["branch"] as string | undefined) ?? DEFAULT_UPDATE_BRANCH;
    framework = (cli.values["framework"] as string | undefined) ?? "";
    langVersion = (cli.values["lang-version"] as string | undefined) ?? "";
    langDefault = cli.values["lang-default"] === true;
    dryRun = cli.common.dryRun;
    continueMode = cli.values["continue"] === true;
    const positionals = cli.positionals;
    if (positionals.length > 1) {
      logError("Too many arguments. Use --help for usage information.");
      process.exit(EXIT_MISUSE);
    }
    repoDir = positionals[0] ?? "";
  } catch (err) {
    logError(errorMessage(err));
    console.error("Use --help for usage information");
    process.exit(EXIT_MISUSE);
  }

  repoDir = repoDir === "" ? "." : repoDir;
  if (!existsSync(repoDir)) {
    logError(`Directory not found: ${repoDir}`);
    process.exit(EXIT_API_FAILURE);
  }
  repoDir = spawnSync("bash", ["-c", `cd "$1" && pwd`, "cd", repoDir], { encoding: "utf8" }).stdout.trim();
  const repoName = basename(repoDir);

  // Default branch: origin/HEAD when resolvable, else master.
  let defaultBranch = git(repoDir, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { quiet: true }).out
    .trim()
    .replace(/^origin\//, "");
  if (defaultBranch === "") defaultBranch = "master";

  if (
    PROTECTED_BRANCHES.has(updateBranch) ||
    updateBranch === defaultBranch ||
    PROTECTED_BRANCH_PREFIXES.some((p) => updateBranch.startsWith(p))
  ) {
    logError(`Refusing protected branch name '${updateBranch}': the wizard resets and deletes its update branch.`);
    process.exit(EXIT_MISUSE);
  }
  if (!gitCheck(repoDir, ["check-ref-format", "--branch", updateBranch]).ok) {
    logError(`'${updateBranch}' is not a valid branch name.`);
    process.exit(EXIT_MISUSE);
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would update ${repoName} (branch: ${updateBranch})`);
    return;
  }

  let hasBreaking = false;
  let hasFrameworkChange = false;

  if (continueMode) {
    logInfo(`Continuing previous update in ${repoName}...`);
    const current = git(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"], { quiet: true }).out.trim();
    if (current !== updateBranch) {
      if (!git(repoDir, ["checkout", updateBranch], { quiet: true }).ok) {
        logError(`Branch '${updateBranch}' not found in ${repoName}. Nothing to continue.`);
        process.exit(EXIT_GIT_FAILED);
      }
    }
    const clean =
      git(repoDir, ["diff", "--quiet"], { quiet: true }).ok && git(repoDir, ["diff", "--cached", "--quiet"], { quiet: true }).ok;
    if (clean) {
      logInfo(`No staged or unstaged changes on branch '${updateBranch}' — nothing to continue.`);
      process.exit(EXIT_NO_CHANGES);
    }
    logInfo(`Found changes on branch '${updateBranch}' — resuming workflow`);
  } else {
    // Guard: refuse on uncommitted changes.
    const diffQuiet = git(repoDir, ["diff", "--quiet"], { quiet: true }).ok;
    const cachedQuiet = git(repoDir, ["diff", "--cached", "--quiet"], { quiet: true }).ok;
    if (!diffQuiet || !cachedQuiet) {
      logError(`There are uncommitted changes in ${repoName}. Please commit or stash them before running this script.`);
      process.exit(EXIT_GIT_FAILED);
    }

    // Never destroy uncommitted work: ask before the hard reset / clean.
    const dirtyStatus = gitCheck(repoDir, ["status", "--porcelain"]).out;
    if (dirtyStatus.trim() !== "") {
      logWarn(`${repoName} has uncommitted changes:`);
      console.error(dirtyStatus.split("\n").map((l) => `    ${l}`).join("\n"));
      if (!promptYesNo("Discard them via 'git reset --hard' + 'git clean -fd'")) {
        logError(`Aborted: refusing to discard uncommitted changes in ${repoName}`);
        process.exit(EXIT_GIT_FAILED);
      }
    }

    logInfo(`Syncing ${defaultBranch} to origin in ${repoName}...`);
    if (!git(repoDir, ["checkout", defaultBranch], { quiet: true }).ok) {
      logError(`Failed to checkout ${defaultBranch} in ${repoName}`);
      process.exit(EXIT_GIT_FAILED);
    }
    gitCheck(repoDir, ["fetch", "origin", defaultBranch, "--quiet"]);
    if (!git(repoDir, ["reset", "--hard", `origin/${defaultBranch}`, "--quiet"], { quiet: true }).ok) {
      logError(`Failed to reset ${defaultBranch} to origin/${defaultBranch} in ${repoName}`);
      process.exit(EXIT_GIT_FAILED);
    }
    gitCheck(repoDir, ["clean", "-fd", "--quiet"]);

    // Step 2: create the update branch (handle a leftover from an aborted run).
    logInfo(`Creating branch ${updateBranch} in ${repoName}...`);
    if (!git(repoDir, ["checkout", "-b", updateBranch], { quiet: true }).ok) {
      git(repoDir, ["checkout", defaultBranch], { quiet: true });
      if (!mayDiscardLeftoverBranch(repoDir, updateBranch, defaultBranch)) {
        logError(`Aborted: refusing to delete the leftover local branch '${updateBranch}' in ${repoName} (push it, merge it, or delete it by hand, or pass --branch with another name)`);
        process.exit(EXIT_GIT_FAILED);
      }
      git(repoDir, ["branch", "-D", updateBranch], { quiet: true });
      if (!git(repoDir, ["checkout", "-b", updateBranch], { quiet: true }).ok) {
        logError(`Failed to create branch ${updateBranch} in ${repoName}`);
        process.exit(EXIT_GIT_FAILED);
      }
    }

    // Step 3: snapshot versions before update.
    const before = snapshotVersions(repoDir);

    // Step 4: run the dependency update (through the sibling stub tool).
    const updateArgs = [repoDir];
    if (framework !== "") updateArgs.push("--framework", framework);
    if (langVersion !== "") updateArgs.push("--lang-version", langVersion);
    if (langDefault) updateArgs.push("--lang-default");
    logInfo(`Updating NuGet references in ${repoName}...`);
    const updInv = siblingInvocation("cs-references-update", updateArgs);
    const upd = spawnSync(updInv.command, updInv.args, { stdio: "inherit" });
    if (upd.status !== 0) {
      logError(`cs-references-update failed for ${repoName}`);
      git(repoDir, ["checkout", "-f", defaultBranch], { quiet: true });
      git(repoDir, ["branch", "-D", updateBranch], { quiet: true });
      process.exit(EXIT_UPDATE_FAILED);
    }

    // Step 5: detect breaking changes via the version diff.
    const after = snapshotVersions(repoDir);
    const bumps = detectMajorBumps(before, after);
    hasBreaking = bumps.hasMajor;
    let majorBumpText = bumps.lines.join("\n");

    // Framework change: a TFM present after but not before (strict superset).
    const tfmAfter = after.tfms.join("\n");
    const tfmBefore = before.tfms.join("\n");
    if (tfmAfter !== "" && tfmAfter !== tfmBefore) {
      hasFrameworkChange = true;
      const oldTfm = (tfmBefore.split("\n")[0] ?? "").replace("__TFM__ ", "");
      const newTfm = (tfmAfter.split("\n")[0] ?? "").replace("__TFM__ ", "");
      majorBumpText += `\n  ${oldTfm} → ${newTfm} (FRAMEWORK)`;
    }
    if (hasBreaking) {
      logWarn("Major version bumps detected in non-test code:");
      console.log(majorBumpText);
    }

    // Anything actually changed?
    const cleanAfter =
      git(repoDir, ["diff", "--quiet"], { quiet: true }).ok && git(repoDir, ["diff", "--cached", "--quiet"], { quiet: true }).ok;
    if (cleanAfter) {
      logInfo(`No changes after update — skipping ${repoName}`);
      git(repoDir, ["checkout", defaultBranch], { quiet: true });
      git(repoDir, ["branch", "-D", updateBranch], { quiet: true });
      process.exit(EXIT_NO_CHANGES);
    }

    void mkdtempSync; void writeFileSync; void tmpdir; void rmSync; void EXIT_API_FAILURE;
  }

  // ── Change level ──
  // Test-only detection: every changed csproj under a test tree downgrades
  // the commit to chore(tests) (no release). Src snapshots exclude test
  // trees, so has_breaking/has_framework_change can only be src-driven.
  const changedCsprojs =
    (gitCheck(repoDir, ["diff", "--name-only", "HEAD"]).out)
      .split("\n")
      .filter((l) => l.endsWith(".csproj"));
  const testOnly = changedCsprojs.length > 0 && changedCsprojs.every((p) => /(^|\/)(test|tests)\//.test(p));

  let changeLevel = "patch";
  if (testOnly) {
    logInfo("Only test csproj files changed — committing as chore(tests) (no release).");
    changeLevel = "chore(tests)";
  } else if (hasFrameworkChange) {
    logWarn(`Framework change detected in ${repoName} — forcing major update.`);
    changeLevel = "major";
  } else if (hasBreaking) {
    logWarn(`Breaking changes were detected in ${repoName} (major version bumps).`);
    changeLevel = "major";
  }

  let prTitle = `${changeLevel}: update references`;
  if (hasFrameworkChange) prTitle = `${changeLevel}: update references and target framework`;

  // ── Tests ──
  if (existsSync(join(repoDir, "run-tests"))) {
    console.log("Running tests...");
    let r = spawnSync(join(repoDir, "run-tests"), [], { stdio: "inherit" });
    if (r.status !== 0) {
      logWarn(`Tests failed for ${repoName}`);
      promptUser(`Please fix the issue in ${repoDir} so that TESTS PASS, then press Enter to retry.`);
      r = spawnSync(join(repoDir, "run-tests"), [], { stdio: "inherit" });
      if (r.status !== 0) {
        logError(`Tests failed for ${repoName}`);
        process.exit(EXIT_TESTS_FAILED);
      }
    }
    console.log("Tests passed!");
  } else {
    console.log(`No test runner found at ${repoDir}/run-tests; skipping tests.`);
  }

  // ── Commit and push (git hook will run tests) ──
  stageTrackedChanges(repoDir);
  let commit = gitCheck(repoDir, ["commit", "-m", `${prTitle}${COMMIT_SUFFIX}`, "--quiet"]);
  if (!commit.ok) {
    logWarn(`Commit failed for ${repoName} (likely a git hook failure)`);
    promptUser(`Please fix the issue in ${repoDir} so that COMMIT HOOKS PASS, then press Enter to retry.`);
    stageTrackedChanges(repoDir);
    commit = gitCheck(repoDir, ["commit", "-m", `${prTitle}${COMMIT_SUFFIX}`, "--quiet"]);
    if (!commit.ok) {
      logError(`Commit still failing for ${repoName} — aborting`);
      if (!promptYesNo(`Discard the working-tree changes and delete branch '${updateBranch}' (the fixes made for the commit hooks are lost)`)) {
        logError(`Left branch '${updateBranch}' and the working tree in ${repoName} untouched; fix the commit and re-run with --continue`);
        process.exit(EXIT_TESTS_FAILED);
      }
      git(repoDir, ["checkout", "-f", defaultBranch], { quiet: true });
      git(repoDir, ["branch", "-D", updateBranch], { quiet: true });
      process.exit(EXIT_TESTS_FAILED);
    }
  }

  logInfo(`Pushing branch ${updateBranch}...`);
  const push = gitCheck(repoDir, ["push", "-u", "origin", updateBranch, "--quiet"]);
  if (!push.ok) {
    logError(`Failed to push branch ${updateBranch} for ${repoName}; the wizard never force-pushes`);
    // The local branch holds the only copy of the update commit (including any
    // fixes made so the commit hooks pass), so it is kept. The next run's
    // leftover-branch guard refuses to delete it while it has unpushed commits.
    logWarn(
      `Kept local branch '${updateBranch}' with its update commit in ${repoName}. Retry the push by hand, or remove a leftover '${updateBranch}' on the remote first if one exists.`,
    );
    git(repoDir, ["checkout", defaultBranch], { quiet: true });
    process.exit(EXIT_GIT_FAILED);
  }

  // ── Create PR (via the pr-create wrapper — never raw gh) ──
  logInfo(`Creating PR: '${prTitle}' for ${repoName}...`);
  spawnSync("sleep", ["3"]);
  let prUrl = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    const createInv = siblingInvocation(
      "pr-create",
      ["--no-issue", "--repo-dir", repoDir, "--branch", updateBranch, "--label", "automated", prTitle],
    );
    const r = spawnSync(createInv.command, createInv.args, { encoding: "utf8" });
    const m = /https:\/\/[^\s]+/.exec(`${r.stdout ?? ""}${r.stderr ?? ""}`);
    if (m !== null && m[0] !== undefined) {
      prUrl = m[0];
      break;
    }
    logWarn(`PR creation attempt ${attempt} failed — retrying in 10s...`);
    console.log(`pr-create --no-issue --repo-dir "${repoDir}" --branch "${updateBranch}" --label "automated" "${prTitle}"`);
    spawnSync("sleep", ["10"]);
  }

  if (prUrl === "") {
    logError(`Failed to create PR for ${repoName} after 5 attempts`);
    promptUser("Please resolve the PR creation issue manually.  Merge it and then press Enter.");
    git(repoDir, ["checkout", defaultBranch], { quiet: true });
    git(repoDir, ["branch", "-D", updateBranch], { quiet: true });
    process.exit(EXIT_PR_FAILED);
  }

  logInfo(`PR created: ${prUrl}`);

  // ── Merge PR (via the pr-merge wrapper) ──
  logInfo(`Merging PR for ${repoName}...`);
  const mergeInv = siblingInvocation("pr-merge", ["--force", "--no-issue-id", prTitle]);
  const merge = spawnSync(mergeInv.command, mergeInv.args, {
    cwd: repoDir,
    stdio: "inherit",
  });
  if (merge.status !== 0) {
    logError(`Failed to merge PR for ${repoName}`);
    promptUser("Please merge manually, then press Enter.");
    git(repoDir, ["checkout", defaultBranch], { quiet: true });
    git(repoDir, ["branch", "-D", updateBranch], { quiet: true });
    process.exit(EXIT_MERGE_FAILED);
  }
  logInfo("PR merged successfully");

  // ── Return to default branch ──
  spawnSync("sleep", ["3"]);
  git(repoDir, ["checkout", defaultBranch], { quiet: true });
  gitCheck(repoDir, ["pull", "--quiet"]);
  git(repoDir, ["branch", "-D", updateBranch], { quiet: true });
}

try {
  main();
} catch (err) {
  logError(errorMessage(err));
  process.exit(EXIT_GENERAL_ERROR);
}
