// fork-export — export a commit range for transfer into a clone of the
// upstream repository. Port of fork-export.sh over lib/domain/fork.ts and
// lib/core/change-id.ts. Non-interactive paths are fully supported; the fzf
// pickers map to clack multiselect on a TTY and fail closed without one.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import {
  changeIdGenerate, changeIdGetFromCommit, changeIdGetFromMessage,
  changeIdIsForkAdapted, changeIdIsForkOnly, skipListAdd, skipListHasCommit,
  skipListList, skipListLoad, skipListRemove,
} from "../lib/core/change-id.ts";
import { forkConfigFromEnv, getSelectionSlug, normalizeGitUrl, upstreamMatches } from "../lib/domain/fork.ts";

assertNodeFloor();

/** fzf multi-select with optional expect keys (fzf_select_multi[_or_action]
 * parity). Rows are tab-separated `ref\tdisplay`; returns the picked rows and
 * whether the action key fired. Rejects (null) on cancel/no-fzf. */
function fzfMulti(rows: string[], prompt: string, preview: string, expectKeys = ""): { rows: string[]; action: boolean } | null {
  const args = [
    `--prompt=${prompt}`,
    "--height=40%", "--border", "--multi",
    "--bind=tab:toggle+down",
    "--header=TAB to select | Shift-Tab to toggle all | Enter to confirm",
  ];
  if (expectKeys !== "") args.push(`--expect=${expectKeys}`);
  if (preview !== "") args.push(`--preview=${preview}`, "--preview-window=right:50%");
  const r = spawnSync("fzf", args, { input: `${rows.join("\n")}\n`, encoding: "utf8" });
  if (r.status === 130) return null;
  const out = r.stdout ?? "";
  const nl = out.indexOf("\n");
  const key = expectKeys !== "" && nl >= 0 ? out.slice(0, nl) : "";
  const body = expectKeys !== "" && nl >= 0 ? out.slice(nl + 1) : out;
  const picked = body.split("\n").filter((l) => l !== "");
  return { rows: picked, action: key === expectKeys && expectKeys !== "" };
}

/** Interactive conflict loop (wait_for_conflict_resolution parity). */
function waitForConflictResolution(targetRoot: string, operation: "cherry-pick" | "am"): boolean {
  for (;;) {
    if (operation === "cherry-pick") {
      if (!g(["-C", targetRoot, "rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]).ok) return true;
    } else {
      const statePath = g(["-C", targetRoot, "rev-parse", "--absolute-git-dir"]).out;
      if (!existsSync(join(statePath, "rebase-apply"))) return true;
    }
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true || !existsSync("/dev/tty")) {
      console.error(`${operation} conflict in ${targetRoot}; resolve and stage the conflicted files, then run 'git -C ${targetRoot} ${operation} --continue'.`);
      return false;
    }
    const unresolved = g(["-C", targetRoot, "diff", "--name-only", "--diff-filter=U"]).out;
    if (unresolved !== "") console.error(`Conflicts remain in:\n${unresolved}`);
    console.error("Resolve and stage these files in the target clone, then press Enter to continue (Ctrl-C leaves the operation paused).");
    spawnSync("bash", ["-c", 'read -r _ < /dev/tty || true'], { stdio: "inherit" });
    if (g(["-C", targetRoot, "diff", "--name-only", "--diff-filter=U"]).out !== "") {
      console.error("Unresolved files remain; resolve and stage them before continuing.");
      continue;
    }
    if (operation === "cherry-pick") {
      const r = spawnSync("git", ["-C", targetRoot, "cherry-pick", "--continue"], {
        stdio: "inherit", env: { ...process.env, GIT_EDITOR: "true" },
      });
      if (r.status !== 0) {
        if (g(["-C", targetRoot, "rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]).ok) {
          console.error("Cherry-pick could not continue; review the target clone and resolve any remaining issue.");
          continue;
        }
        return false;
      }
      stampForkAdapted(targetRoot);
    } else {
      const r = spawnSync("git", ["-C", targetRoot, "am", "--continue"], {
        stdio: "inherit", env: { ...process.env, GIT_EDITOR: "true" },
      });
      const statePath = g(["-C", targetRoot, "rev-parse", "--absolute-git-dir"]).out;
      if (r.status !== 0) {
        if (!existsSync(join(statePath, "rebase-apply"))) return false;
        console.error("Patch application could not continue; review the target clone and resolve any remaining issue.");
      } else {
        stampForkAdapted(targetRoot);
      }
    }
  }
}

/** Amend Fork-Adapted: yes onto the target's conflict-resolved HEAD (best-effort). */
function stampForkAdapted(targetRoot: string): void {
  const sha = g(["-C", targetRoot, "rev-parse", "-q", "--verify", "HEAD"]).out;
  if (sha === "") return;
  const message = g(["-C", targetRoot, "log", "-1", "--format=%B", sha]).out;
  if (changeIdIsForkAdapted(message)) return;
  spawnSync("bash", ["-c", 'printf \'%s\\n\' "$1" | git -C "$2" interpret-trailers --trailer "Fork-Adapted: yes" | git -C "$2" commit --amend -q --no-edit -F -', "_", message, targetRoot], { stdio: "ignore" });
}

const die = (msg: string, code = 1): never => {
  console.error(msg.startsWith("ERROR:") ? msg : `ERROR: ${msg}`);
  process.exit(code);
};
const g = (args: string[]): { out: string; ok: boolean } => {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { out: (r.stdout ?? "").trim(), ok: r.status === 0 };
};

function usage(): never {
  console.log(`fork-export.sh — export commits for transfer into a clone of the upstream repository

Exports from the merge-base with \`upstream/<branch>\` to \`[<end-ref>]\` (default
HEAD); the upstream-derived base is always used. With a TTY and no explicit
refs, a picker selects the commits to export from the commits not in upstream.
\`--start-ref <commit> <end-ref>\` selects a range non-interactively;
\`--all\` exports the complete upstream-to-end range without prompting.
\`--format\` selects \`bundle\` (default), \`patch\`, or \`both\`.
Without \`--apply-to\`, a unique clone under \`repos/\` whose \`origin\` matches
\`[fork] upstream_repo\` is used automatically. If none matches, files go under
.local-artifacts/fork-export/<range-slug>/; use \`--export-only\` to force that.
A range that contains merge commits is refused with guidance. Patches apply
with \`git am -3\` so context drift falls back to a three-way merge.
When applying an export interactively, the script waits for conflicts to be
resolved and staged, then continues the queued operation. Without a TTY, it
prints the manual continuation command and leaves the Git operation intact.

USAGE
  fork-export [<end-ref>] [--all] [--export-only] [--format bundle|patch|both] [--apply-to <path>] [--dry-run] [--include-untracked] [--include-skipped]
  fork-export --start-ref <start-commit> <end-ref> [--export-only] [--format bundle|patch|both] [--apply-to <path>]
  fork-export --skip <commit> | --unskip <commit-or-change-id> | --list-skipped`);
  process.exit(0);
}

// --- argv ---
const argv = process.argv.slice(2);
if (argv[0] === "--help" || argv[0] === "-h") usage();

let format = "bundle";
let applyTo = "";
let exportOnly = false;
let dryRun = false;
let endRef = "HEAD";
let endRefSet = false;
let startRef = "";
let all = false;
let includeUntracked = false;
let includeSkipped = false;
let skipRef = "";
let skipInteractive = false;
let unskipRef = "";
let listSkipped = false;
// Whether the range will be chosen interactively: TTY stdin+stdout, no
// explicit refs. The dry run and the real run must agree on this.
let pickerWillRun = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  const val = (flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined) die(`Missing value for ${flag}`, EXIT_MISUSE);
    i++;
    return v as string;
  };
  if (a === "--skip") {
    const v = argv[i + 1];
    if (v !== undefined && !v.startsWith("--")) { skipRef = v; i++; }
    else skipInteractive = true;
  } else if (a === "--unskip") unskipRef = val(a);
  else if (a === "--list-skipped") listSkipped = true;
  else if (a === "--include-untracked") includeUntracked = true;
  else if (a === "--include-skipped") includeSkipped = true;
  else if (a === "--start-ref") startRef = val(a);
  else if (a === "--all") all = true;
  else if (a === "--export-only") exportOnly = true;
  else if (a === "--format") {
    format = val(a);
    if (!["bundle", "patch", "both"].includes(format)) {
      die(`invalid format '${format}'; choose bundle, patch, or both`, EXIT_MISUSE);
    }
  } else if (a === "--apply-to") applyTo = val(a);
  else if (a === "--dry-run") dryRun = true;
  else if (a.startsWith("--")) die(`unknown option: ${a}`, EXIT_MISUSE);
  else {
    if (endRefSet) die("only one end commit/ref may be provided", EXIT_MISUSE);
    endRef = a;
    endRefSet = true;
  }
}
if (all && startRef !== "") die("--all cannot be combined with --start-ref", EXIT_MISUSE);
if (exportOnly && applyTo !== "") die("--export-only cannot be combined with --apply-to", EXIT_MISUSE);
if (dryRun && (skipRef !== "" || skipInteractive || unskipRef !== "" || listSkipped)) {
  die("--dry-run cannot be combined with --skip, --unskip or --list-skipped (they change the skip list)", EXIT_MISUSE);
}
const skipInteractiveAllowed = process.stdin.isTTY === true && process.stdout.isTTY === true;
if (skipInteractive && !skipInteractiveAllowed) {
  die("--skip needs an explicit commit when not running interactively (no TTY for the picker)", EXIT_MISUSE);
}

const repoRoot = g(["rev-parse", "--show-toplevel"]).out;
if (repoRoot === "") die("run fork-export from inside a git repository", EXIT_GENERAL_ERROR);

// --- skip-list management commands ---
if (skipRef !== "") {
  const sha = g(["-C", repoRoot, "rev-parse", "--verify", "--quiet", `${skipRef}^{commit}`]).out;
  if (sha === "") die(`not a commit: ${skipRef}`, EXIT_MISUSE);
  const subject = g(["-C", repoRoot, "log", "-1", "--format=%s", sha]).out;
  const id = changeIdGetFromCommit(repoRoot, sha) ?? "";
  skipListAdd(repoRoot, "sha", sha, subject);
  if (id !== "") skipListAdd(repoRoot, "change-id", id, subject);
  spawnSync("git", ["--no-pager", "-C", repoRoot, "show", "-s", "--format=skipped %h %s", sha], { stdio: "inherit" });
  process.exit(0);
}
if (unskipRef !== "") {
  const removed = skipListRemove(repoRoot, unskipRef);
  if (!removed.ok) die(`no skip-list entry matches: ${unskipRef}`, EXIT_MISUSE);
  console.log(`removed from the skip list: ${unskipRef}`);
  process.exit(0);
}
if (listSkipped) {
  const listed = skipListList(repoRoot, (line) => console.log(line));
  if ("error" in listed) {
    console.error(`ERROR: ${listed.error}`);
    process.exit(EXIT_GENERAL_ERROR);
  }
  if (listed.entries.length === 0) {
    console.log("no skipped commits");
  } else {
    for (const e of listed.entries) {
      console.log(`${e.kind} ${e.value}${e.note ? ` # ${e.note}` : ""}`);
    }
  }
  process.exit(0);
}

// --- config + upstream ---
process.env.DEVENV_ROOT = process.env.DEVENV_ROOT ?? "";
const config = forkConfigFromEnv();
const upstreamRef = `refs/remotes/upstream/${config.upstreamBranch}`;

const upstreamUrl = g(["-C", repoRoot, "remote", "get-url", "upstream"]).out;
if (upstreamUrl === "") die("upstream remote is missing; run fork-setup.sh first", EXIT_GENERAL_ERROR);
if (!upstreamMatches(repoRoot, config.upstreamRepo)) {
  die("upstream remote URL does not match [fork] upstream_repo", EXIT_GENERAL_ERROR);
}

// --- target detection ---
let targetRoot = "";
if (applyTo !== "") {
  targetRoot = g(["-C", applyTo, "rev-parse", "--show-toplevel"]).out;
  if (targetRoot === "") die(`--apply-to target is not a git repository: ${applyTo}`, EXIT_MISUSE);
} else if (!exportOnly) {
  const configured = normalizeGitUrl(config.upstreamRepo);
  const matches: string[] = [];
  try {
    for (const candidate of readdirSync(join(repoRoot, "repos"))) {
      const candidateAbs = join(repoRoot, "repos", candidate);
      const root = g(["-C", candidateAbs, "rev-parse", "--show-toplevel"]).out;
      if (root === "" || root === repoRoot) continue;
      const origin = g(["-C", root, "remote", "get-url", "origin"]).out;
      if (origin === "") continue;
      if (normalizeGitUrl(origin) === configured && !matches.includes(root)) matches.push(root);
    }
  } catch { /* no repos/ dir */ }
  if (matches.length === 1) {
    applyTo = matches[0] as string;
    targetRoot = applyTo;
    console.log(`detected upstream clone: ${applyTo}`);
  } else if (matches.length > 1) {
    console.error("multiple repos/ clones match [fork] upstream_repo; pass --apply-to <path> to choose one:");
    for (const m of matches) console.error(`  ${m}`);
    process.exit(EXIT_MISUSE);
  } else {
    console.log("no matching clone found in repos/; writing export artifacts");
  }
}

let targetHead = "";
if (targetRoot !== "") {
  targetHead = g(["-C", targetRoot, "rev-parse", "HEAD"]).out;
}

// --- merge refusals ---
function refuseMerges(range: string): void {
  const merges = g(["-C", repoRoot, "--no-pager", "log", "--merges", "--format=  %h %s", range]).out;
  if (merges === "") return;
  console.error(`the range ${range} contains merge commit(s), which cannot be exported:`);
  console.error(merges);
  console.error("Replay the branch on top of upstream first (fork-sync --replay) so the range is linear,");
  console.error("or choose commits that exclude the merge (--start-ref, or the picker).");
  process.exit(EXIT_MISUSE);
}

// --- candidate filtering ---
interface FilterCounts {
  targetDupes: number; idDupes: number; skipped: number; hiddenUntracked: number;
}

function filterCandidates(commits: string[], baseSha: string, endSha: string, counts: FilterCounts): string[] {
  const loaded = skipListLoad(repoRoot);
  const skipList = "list" in loaded ? loaded.list : null;
  const targetChangeIds = new Set<string>();
  const targetEquivalent = new Set<string>();
  if (targetRoot !== "") {
    if (!g(["-C", targetRoot, "merge-base", "--is-ancestor", baseSha, targetHead]).ok) {
      die(`--apply-to target does not descend from the upstream merge-base ${baseSha}`, EXIT_MISUSE);
    }
    // Read the target's history through its object store (bash alternate-objects
    // mechanism): git cherry and rev-list run in the SOURCE repo but can see the
    // target's commits.
    const objects = g(["-C", targetRoot, "rev-parse", "--path-format=absolute", "--git-path", "objects"]).out;
    if (objects === "") die("could not locate target Git object store", EXIT_GENERAL_ERROR);
    const alternates = process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES
      ? `${objects}:${process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES}`
      : objects;
    const env = { ...process.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: alternates };
    const cherry = spawnSync("git", ["-C", repoRoot, "cherry", targetHead, endSha, baseSha], { encoding: "utf8", env });
    if (cherry.status !== 0) die("could not compare the commits with the target (git cherry failed)", EXIT_GENERAL_ERROR);
    for (const line of (cherry.stdout ?? "").split("\n")) {
      if (line === "" || !line.startsWith("-")) continue;
      const abbr = line.split(/\s+/)[1] ?? "";
      const full = g(["-C", repoRoot, "rev-parse", "--verify", "--quiet", `${abbr}^{commit}`]).out;
      if (full === "") die(`git cherry returned an unresolvable commit: ${abbr}`, EXIT_GENERAL_ERROR);
      targetEquivalent.add(full);
    }
    // Commits the target already contains by ancestry are present too.
    const missing = spawnSync("git", ["-C", repoRoot, "rev-list", endSha, "--not", baseSha, targetHead], { encoding: "utf8", env });
    if (missing.status !== 0) die("could not read the target's history (git rev-list failed)", EXIT_GENERAL_ERROR);
    const missingSet = new Set((missing.stdout ?? "").split("\n").filter((l) => l !== ""));
    const range = spawnSync("git", ["-C", repoRoot, "rev-list", `${baseSha}..${endSha}`], { encoding: "utf8", env });
    if (range.status !== 0) die("could not list the commits to export (git rev-list failed)", EXIT_GENERAL_ERROR);
    for (const c of (range.stdout ?? "").split("\n")) {
      if (c !== "" && !missingSet.has(c)) targetEquivalent.add(c);
    }
    // Change-Ids in the target's history since the shared base.
    const log = spawnSync("git", ["-C", repoRoot, "log", "--format=%B", `${baseSha}..${targetHead}`], { encoding: "utf8", env });
    if (log.status !== 0) die("could not read the target's commit messages (git log failed)", EXIT_GENERAL_ERROR);
    for (const id of [...(log.stdout ?? "").matchAll(/^Change-Id: (.*)$/gm)].map((m) => (m[1] as string).trim())) {
      if (id !== "") targetChangeIds.add(id);
    }
  }
  // Duplicate source Change-Ids are not matched against the target.
  const idCounts = new Map<string, number>();
  for (const c of commits) {
    const id = changeIdGetFromCommit(repoRoot, c);
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  const duplicateIds = new Set([...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  for (const [id, n] of idCounts) {
    if (n > 1) {
      const carriers = commits
        .filter((c) => changeIdGetFromCommit(repoRoot, c) === id)
        .map((c) => g(["-C", repoRoot, "rev-parse", "--short", c]).out)
        .join(" ");
      console.error(`warning: Change-Id ${id} is carried by ${n} commits (${carriers}); it is not matched against the target for them`);
    }
  }

  const remaining: string[] = [];
  for (const c of commits) {
    const message = g(["-C", repoRoot, "log", "-1", "--format=%B", c]).out;
    const id = changeIdGetFromMessage(message) ?? "";
    if (!includeSkipped && ((skipList !== null && skipListHasCommit(skipList, c, id)) || changeIdIsForkOnly(message))) {
      counts.skipped++;
      continue;
    }
    if (id === "" && !includeUntracked) { counts.hiddenUntracked++; continue; }
    if (targetEquivalent.has(c)) { counts.targetDupes++; continue; }
    if (id !== "" && !duplicateIds.has(id) && targetChangeIds.has(id)) { counts.idDupes++; continue; }
    remaining.push(c);
  }
  return remaining;
}

function reportFiltered(counts: FilterCounts): void {
  if (counts.targetDupes > 0) console.log(`excluded ${counts.targetDupes} commit(s) already present in target by patch equivalence`);
  if (counts.idDupes > 0) console.log(`excluded ${counts.idDupes} commit(s) already present in target by Change-Id`);
  if (counts.skipped > 0) console.log(`skipped ${counts.skipped} commit(s) marked Fork-Only or in the skip list (--include-skipped shows them)`);
  if (counts.hiddenUntracked > 0) console.log(`${counts.hiddenUntracked} commit(s) without a Change-Id hidden (--include-untracked shows them)`);
}

// --- range resolution ---
pickerWillRun = startRef === "" && !endRefSet && !all && process.stdin.isTTY === true && process.stdout.isTTY === true;
let baseSha = "";
let endSha = "";

if (dryRun) {
  endSha = g(["-C", repoRoot, "rev-parse", "--verify", "--quiet", `${endRef}^{commit}`]).out;
  if (endSha === "") die(`end ref '${endRef}' does not resolve to a commit`, EXIT_MISUSE);
  console.log(`dry run: would fetch upstream/${config.upstreamBranch} and export ${endRef} as ${format}`);
  if (g(["-C", repoRoot, "show-ref", "--verify", "--quiet", upstreamRef]).ok) {
    baseSha = g(["-C", repoRoot, "merge-base", upstreamRef, endSha]).out;
    if (baseSha === "") die(`upstream/${config.upstreamBranch} and '${endRef}' have no common history`, EXIT_GENERAL_ERROR);
    let commits = g(["-C", repoRoot, "rev-list", "--topo-order", "--reverse", `${baseSha}..${endSha}`]).out.split("\n").filter((l) => l !== "");
    const counts: FilterCounts = { targetDupes: 0, idDupes: 0, skipped: 0, hiddenUntracked: 0 };
    commits = filterCandidates(commits, baseSha, endSha, counts);
    reportFiltered(counts);
    if (startRef === "" && !pickerWillRun) refuseMerges(`${baseSha}..${endSha}`);
    const bs = g(["-C", repoRoot, "rev-parse", "--short", baseSha]).out;
    const es = g(["-C", repoRoot, "rev-parse", "--short", endSha]).out;
    console.log(`dry run: would export ${commits.length} commit(s) from ${bs} to ${es}`);
  } else {
    console.log("dry run: upstream ref is not fetched; range will be resolved after fetch");
  }
  console.log(applyTo !== "" ? `dry run: would apply export to ${targetRoot}` : "dry run: output would be written under .local-artifacts/fork-export/");
  process.exit(0);
}

if (!g(["-C", repoRoot, "fetch", "upstream"]).ok) die("failed to fetch upstream", EXIT_GENERAL_ERROR);
if (!g(["-C", repoRoot, "show-ref", "--verify", "--quiet", upstreamRef]).ok) {
  die(`upstream branch '${config.upstreamBranch}' was not fetched`, EXIT_GENERAL_ERROR);
}
endSha = g(["-C", repoRoot, "rev-parse", "--verify", "--quiet", `${endRef}^{commit}`]).out;
if (endSha === "") die(`end ref '${endRef}' does not resolve to a commit after fetching upstream`, EXIT_MISUSE);
baseSha = g(["-C", repoRoot, "merge-base", upstreamRef, endSha]).out;
if (baseSha === "") die(`upstream/${config.upstreamBranch} and '${endRef}' have no common history`, EXIT_GENERAL_ERROR);

// The whole range is checked here only when nothing narrows it later: an
// explicit --start-ref, or the interactive picker, selects the checked range.
if (startRef === "" && !pickerWillRun) refuseMerges(`${baseSha}..${endSha}`);

let commits = g(["-C", repoRoot, "rev-list", "--topo-order", "--reverse", `${baseSha}..${endSha}`]).out.split("\n").filter((l) => l !== "");
if (commits.length === 0) die(`no commits to export from '${endRef}' beyond its upstream merge-base`, EXIT_MISUSE);

const counts: FilterCounts = { targetDupes: 0, idDupes: 0, skipped: 0, hiddenUntracked: 0 };
commits = filterCandidates(commits, baseSha, endSha, counts);
reportFiltered(counts);
if (commits.length === 0) {
  if (counts.skipped === 0 && counts.hiddenUntracked === 0) {
    die("all candidate commits are already present in target", EXIT_MISUSE);
  }
  die("no exportable commits remain; see the lines above", EXIT_MISUSE);
}

// --- interactive skip picker ---
if (skipInteractive && skipInteractiveAllowed) {
  const preview = `git -C ${repoRoot} show --format=fuller --stat --patch {1}`;
  const rows = commits.map((c) => `${c}\t${g(["-C", repoRoot, "show", "-s", "--format=%h %cs %s", c]).out}`);
  const picked = fzfMulti(rows, "Commits to skip for good (TAB marks): ", preview);
  if (picked === null) { console.error("ERROR: commit selection cancelled"); process.exit(EXIT_MISUSE); }
  if (picked.rows.length === 0) die("no commits selected", EXIT_MISUSE);
  for (const row of picked.rows) {
    const commit = row.split("\t")[0] as string;
    const subject = g(["-C", repoRoot, "log", "-1", "--format=%s", commit]).out;
    const id = changeIdGetFromCommit(repoRoot, commit) ?? "";
    skipListAdd(repoRoot, "sha", commit, subject);
    if (id !== "") skipListAdd(repoRoot, "change-id", id, subject);
    spawnSync("git", ["--no-pager", "-C", repoRoot, "show", "-s", "--format=skipped %h %s", commit], { stdio: "inherit" });
  }
  console.log(`skipped ${picked.rows.length} commit(s) for good (fork-export --unskip <commit> reverses it)`);
  process.exit(0);
}

// --- interactive export picker ---
if (pickerWillRun) {
  const preview = `git -C ${repoRoot} show --format=fuller --stat --patch {1}`;
  const offerExclusion = (unselected: string[]): void => {
    if (unselected.length === 0) return;
    console.log(`${unselected.length} commit(s) were not selected:`);
    for (const c of unselected) {
      spawnSync("git", ["--no-pager", "-C", repoRoot, "show", "-s", "--format=  %h %cs %s", c], { stdio: "inherit" });
    }
    process.stdout.write("Exclude them from future exports? [n]one / [a]ll / [c]hoose (default none): ");
    // Read from /dev/tty so the choice works through the script(1) harness.
    const r = spawnSync("bash", ["-c", 'read -r choice < /dev/tty || true; printf "%s" "$choice"'], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    const choice = (r.stdout ?? "").trim().toLowerCase();
    if (choice === "a" || choice === "all") {
      for (const c of unselected) {
        const subject = g(["-C", repoRoot, "log", "-1", "--format=%s", c]).out;
        const id = changeIdGetFromCommit(repoRoot, c) ?? "";
        skipListAdd(repoRoot, "sha", c, subject);
        if (id !== "") skipListAdd(repoRoot, "change-id", id, subject);
      }
      console.log(`excluded ${unselected.length} commit(s) from future exports`);
    } else if (choice === "c" || choice === "choose") {
      const rows = unselected.map((c) => `${c}\t${g(["-C", repoRoot, "show", "-s", "--format=%h %cs %s", c]).out}`);
      const pickedRows = fzfMulti(rows, "Commits to exclude for good (TAB marks): ", preview);
      if (pickedRows === null) return;
      for (const row of pickedRows.rows) {
        const c = row.split("\t")[0] as string;
        const subject = g(["-C", repoRoot, "log", "-1", "--format=%s", c]).out;
        const id = changeIdGetFromCommit(repoRoot, c) ?? "";
        skipListAdd(repoRoot, "sha", c, subject);
        if (id !== "") skipListAdd(repoRoot, "change-id", id, subject);
      }
      console.log(`excluded ${pickedRows.rows.length} commit(s) from future exports`);
    }
  };

  for (;;) {
    const rows = commits.map((c) => `${c}\t${g(["-C", repoRoot, "show", "-s", "--format=%h %cs %s", c]).out}`);
    const picked = fzfMulti(rows, "Commits to export (TAB marks, ctrl-x skips for good): ", preview, "ctrl-x");
    if (picked === null) { console.error("ERROR: commit selection cancelled"); process.exit(EXIT_MISUSE); }
    if (picked.rows.length === 0) die("no commits selected", EXIT_MISUSE);
    const selected = picked.rows.map((row) => row.split("\t")[0] as string);
    if (!picked.action) {
      // Plain confirm: chosen = selected; offer exclusion of the rest.
      const chosen = commits.filter((c) => selected.includes(c));
      const unselected = commits.filter((c) => !selected.includes(c));
      commits = chosen;
      const display = commits.map((c) => g(["-C", repoRoot, "show", "-s", "--format=  %h %cs %s", c]).out).join("\n");
      console.log(`Selected commits (${commits.length}):`);
      console.log(display);
      process.stdout.write("Export these commits? [y/N] ");
      const conf = spawnSync("bash", ["-c", 'read -r y < /dev/tty || true; printf "%s" "$y"'], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
      if (!/^[Yy]([Ee][Ss])?$/.test((conf.stdout ?? "").trim())) die("commit export cancelled", EXIT_MISUSE);
      offerExclusion(unselected);
      break;
    }
    // ctrl-x: skip the selected for good and reopen without them.
    const skippedNow = new Set<string>();
    for (const c of selected) {
      const subject = g(["-C", repoRoot, "log", "-1", "--format=%s", c]).out;
      const id = changeIdGetFromCommit(repoRoot, c) ?? "";
      skipListAdd(repoRoot, "sha", c, subject);
      if (id !== "") skipListAdd(repoRoot, "change-id", id, subject);
      skippedNow.add(c);
    }
    console.log(`skipped ${selected.length} commit(s) for good (fork-export --unskip <commit> reverses it)`);
    commits = commits.filter((c) => !skippedNow.has(c));
    if (commits.length === 0) die("no exportable commits remain", EXIT_MISUSE);
  }
  // Picker narrowed the range: re-derive endSha and refuse merges in the selection.
  endSha = commits[commits.length - 1] as string;
  const selMerges = g(["-C", repoRoot, "--no-pager", "log", "--no-walk=unsorted", "--merges", "--format=  %h %s", ...commits]).out;
  if (selMerges !== "") {
    console.error(`the selection contains merge commit(s), which cannot be exported:\n${selMerges}`);
    process.exit(EXIT_MISUSE);
  }
}

// --- start-ref narrowing ---
if (startRef !== "") {
  const startSha = g(["-C", repoRoot, "rev-parse", "--verify", "--quiet", `${startRef}^{commit}`]).out;
  if (startSha === "") die(`start ref '${startRef}' does not resolve to a commit`, EXIT_MISUSE);
  if (startSha === baseSha) die("start commit must be after the upstream merge-base", EXIT_MISUSE);
  if (!g(["-C", repoRoot, "merge-base", "--is-ancestor", baseSha, startSha]).ok) {
    die("start commit is not based on the upstream merge-base", EXIT_MISUSE);
  }
  if (!g(["-C", repoRoot, "merge-base", "--is-ancestor", startSha, endSha]).ok) {
    die("start commit must be an ancestor of the end commit", EXIT_MISUSE);
  }
  const exportBase = g(["-C", repoRoot, "rev-parse", "--verify", "--quiet", `${startSha}^`]).out;
  if (exportBase === "") die("start commit has no parent", EXIT_MISUSE);
  if (!g(["-C", repoRoot, "merge-base", "--is-ancestor", baseSha, exportBase]).ok) {
    die("start commit is not on a contiguous range from upstream", EXIT_MISUSE);
  }
  refuseMerges(`${exportBase}..${endSha}`);
  commits = g(["-C", repoRoot, "rev-list", "--topo-order", "--reverse", `${exportBase}..${endSha}`]).out.split("\n").filter((l) => l !== "");
  const narrowed = filterCandidates(commits, baseSha, endSha, counts);
  if (narrowed.length === 0 || narrowed[0] !== startSha) {
    die("the start commit is not exportable (already in the target, skipped, or without a Change-Id; see --include-untracked and --include-skipped)", EXIT_MISUSE);
  }
  commits = narrowed;
  console.log(`Selected range (${commits.length} commit(s)) from ${startRef}:`);
  for (const c of commits) spawnSync("git", ["--no-pager", "-C", repoRoot, "show", "-s", "--format=  %h %cs %s", c], { stdio: "inherit" });
}

// --- export-slug + output root ---
const fullRange = g(["-C", repoRoot, "rev-list", "--topo-order", "--reverse", `${baseSha}..${endSha}`]).out.split("\n").filter((l) => l !== "");
const isFull = fullRange.length === commits.length && fullRange.every((s, i) => s === commits[i]);
const baseShort = g(["-C", repoRoot, "rev-parse", "--short", baseSha]).out;
endSha = commits[commits.length - 1] as string;
const endShort = g(["-C", repoRoot, "rev-parse", "--short", endSha]).out;
let rangeSlug: string;
if (startRef !== "") {
  const startShort = g(["-C", repoRoot, "rev-parse", "--short", startRef]).out;
  rangeSlug = isFull ? `${baseShort}-${startShort}-${endShort}` : getSelectionSlug(repoRoot, baseShort, endShort, commits);
} else if (isFull) {
  rangeSlug = `${baseShort}-${endShort}`;
} else {
  rangeSlug = getSelectionSlug(repoRoot, baseShort, endShort, commits);
}

// --- stamping: Change-Id (generated when absent) + Exported-From trailer ---
const stampMap = new Map<string, string>();
function buildStamped(commit: string, parentArgs: string[]): string {
  const tree = g(["-C", repoRoot, "rev-parse", `${commit}^{tree}`]).out;
  const message = g(["-C", repoRoot, "log", "-1", "--format=%B", commit]).out;
  let id = changeIdGetFromMessage(message) ?? "";
  if (id === "") {
    // A Change-Id glued to the subject (no blank line before trailers) is
    // reused rather than generating a second one that breaks twin matching.
    const buried = message.match(/^Change-Id: (.*)$/gm)?.pop();
    if (buried) id = buried.replace(/^Change-Id: /, "").trim();
  }
  const trimmed = message.replace(/\s+$/, "");
  const newMessage = id === ""
    ? (() => {
        const gen = changeIdGenerate();
        if (gen === null) die(`could not generate a Change-Id for ${commit}`, EXIT_GENERAL_ERROR);
        return `${trimmed}\n\nChange-Id: ${gen}\nExported-From: ${commit}`;
      })()
    : `${trimmed}\n\nExported-From: ${commit}`;
  const an = g(["-C", repoRoot, "log", "-1", "--format=%an", commit]).out;
  const ae = g(["-C", repoRoot, "log", "-1", "--format=%ae", commit]).out;
  const ad = g(["-C", repoRoot, "log", "-1", "--format=%aI", commit]).out;
  const r = spawnSync("git", ["-C", repoRoot, "commit-tree", tree, ...parentArgs], {
    input: `${newMessage}\n`,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_AUTHOR_DATE: ad },
  });
  const stamped = r.stdout.trim();
  if (r.status !== 0 || stamped === "") die(`could not build the stamped export copy of ${commit}`, EXIT_GENERAL_ERROR);
  return stamped;
}
const stampedCommits: string[] = [];
for (const c of commits) {
  const parents = g(["-C", repoRoot, "rev-list", "--parents", "-1", c]).out.split(" ").slice(1);
  const parentArgs = parents.map((p) => ["-p", stampMap.get(p) ?? p]).flat();
  const stamped = buildStamped(c, parentArgs);
  stampMap.set(c, stamped);
  stampedCommits.push(stamped);
}
const finalCommits = stampedCommits;
endSha = finalCommits[finalCommits.length - 1] as string;

// --- output ---
let outputRoot = join(repoRoot, ".local-artifacts", "fork-export", rangeSlug);
let tempOutputRoot = "";
if (applyTo !== "") {
  tempOutputRoot = mkdtempSync(join(tmpdir(), "fork-export."));
  outputRoot = tempOutputRoot;
} else {
  mkdirSync(outputRoot, { recursive: true });
}
const tempRefs: { name: string; tip: string }[] = [];
process.on("exit", () => {
  for (const { name, tip } of tempRefs) g(["-C", repoRoot, "update-ref", "-d", name, tip]);
  if (tempOutputRoot !== "") rmSync(tempOutputRoot, { recursive: true, force: true });
});

let bundleFile = "";
if (format === "bundle" || format === "both") {
  bundleFile = join(outputRoot, "commits.bundle");
  const tips = g(["-C", repoRoot, "merge-base", "--independent", ...finalCommits]).out.split("\n").filter((l) => l !== "");
  if (tips.length === 0) die("could not determine the bundle endpoints", EXIT_GENERAL_ERROR);
  const refNames: string[] = [];
  tips.forEach((tip, idx) => {
    const name = `refs/fork-export/${rangeSlug}-${process.pid}-${idx}`;
    if (!g(["-C", repoRoot, "update-ref", name, tip]).ok) die("failed to prepare bundle endpoint", EXIT_GENERAL_ERROR);
    tempRefs.push({ name, tip });
    refNames.push(name);
  });
  if (!g(["-C", repoRoot, "bundle", "create", bundleFile, ...refNames, `^${baseSha}`]).ok) {
    die("failed to create git bundle", EXIT_GENERAL_ERROR);
  }
  if (applyTo === "") console.log(`Bundle: ${bundleFile}`);
}
let patchDir = "";
if (format === "patch" || format === "both") {
  patchDir = join(outputRoot, "patches");
  mkdirSync(patchDir, { recursive: true });
  let n = 1;
  for (const c of finalCommits) {
    const r = spawnSync("git", ["-C", repoRoot, "format-patch", `--start-number=${n}`, "--output-directory", patchDir, "-1", c], { stdio: "ignore" });
    if (r.status !== 0) die("failed to create patch series", EXIT_GENERAL_ERROR);
    n++;
  }
  if (applyTo === "") console.log(`Patches: ${patchDir}`);
}
console.log(`Commits: ${finalCommits.length}`);

// --- apply to the target clone ---
if (applyTo !== "") {
  if (bundleFile !== "") {
    const refArgs = tempRefs.map((t) => t.name);
    if (!g(["-C", targetRoot, "fetch", "--no-tags", bundleFile, ...refArgs]).ok) {
      die(`failed to fetch the bundle into ${targetRoot}`, EXIT_GENERAL_ERROR);
    }
    if (targetHead === baseSha && startRef === "" && isFull) {
      if (!g(["-C", targetRoot, "merge", "--ff-only", "FETCH_HEAD"]).ok) {
        die(`could not fast-forward ${targetRoot} to the exported commits`, EXIT_GENERAL_ERROR);
      }
    } else if (g(["-C", targetRoot, "merge-base", "--is-ancestor", endSha, targetHead]).ok) {
      console.log(`Target already contains the exported commits: ${targetRoot}`);
    } else if (g(["-C", targetRoot, "merge-base", "--is-ancestor", baseSha, targetHead]).ok) {
      // FETCH_HEAD tips were fetched; cherry-pick the stamped copies.
      const pick = spawnSync("git", ["-C", targetRoot, "cherry-pick", "--no-edit", ...finalCommits], { encoding: "utf8" });
      if (pick.status !== 0) {
        if (!g(["-C", targetRoot, "rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]).ok) {
          die("bundle cherry-pick failed without an active conflict", EXIT_GENERAL_ERROR);
        }
        if (!waitForConflictResolution(targetRoot, "cherry-pick")) process.exit(EXIT_GENERAL_ERROR);
      }
    } else {
      die(`--apply-to target does not contain the upstream merge-base ${baseShort}`, EXIT_MISUSE);
    }
    if (g(["-C", targetRoot, "rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]).ok) {
      die("bundle application remains unfinished", EXIT_GENERAL_ERROR);
    }
    stampForkAdapted(targetRoot);
    console.log(`Applied bundle to ${targetRoot}; cherry-pick sequence finalized`);
  } else {
    const patches = readdirSync(patchDir as string).map((f) => join(patchDir as string, f)).sort();
    const am = spawnSync("git", ["-C", targetRoot, "am", "-3", ...patches], { stdio: "inherit" });
    if (am.status !== 0) {
      if (!existsSync(join(targetRoot, ".git", "rebase-apply"))) {
        die("patch application failed without an active conflict", EXIT_GENERAL_ERROR);
      }
      if (!waitForConflictResolution(targetRoot, "am")) process.exit(EXIT_GENERAL_ERROR);
    }
    stampForkAdapted(targetRoot);
    console.log(`Applied patch series to ${targetRoot}; patch sequence finalized`);
  }
}
void existsSync;
void config;
