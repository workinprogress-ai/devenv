#!/usr/bin/env node
// repo-stage.ts — the sanitized staging surface (content selection).
// Version: 1.0.0
//
// Contract (the repo-stage half of the commit-batching family):
//   - repo-stage <path>...              stage exactly these literal paths
//   - repo-stage --unstage <path>...    unstage exactly these
//   - repo-stage --batch <file>         validate + summary only (no mutation)
//   - repo-stage --batch <file> --group N   validate, stage group N, echo stat
//   - --dry-run on any mutating mode: full validation, print, no mutation
//
// Safety (batch mode, every invocation, before any mutation): strict manifest
// parse; literal-paths-only; deletion-aware existence; duplicate membership;
// live coverage (every changed file claimed by a group or ## excluded); index
// purity (no unmanifested staged content). Path mode runs the light checks
// (literal + existence) only — it is the manual-control lane. No interactive
// prompt on any path: consent is the approved batch or the user's own words.
//
// Paths are repo-root-relative in every mode regardless of cwd. Never stages
// a directory (batch entries are files; path mode refuses directories).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { changedFiles } from "../lib/core/git.ts";
import { batchClaimedPaths, isLiteralFilePath, parseCommitBatch, validateCommitBatch } from "../lib/domain/commit-batch.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

function gitRaw(args: string[], cwd?: string): { status: number; out: string; err: string } {
  const r = spawnSync("git", args, { encoding: "utf8", ...(cwd !== undefined ? { cwd } : {}) });
  return { status: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

let repoRoot = "";

function git(args: string[]): { status: number; out: string; err: string } {
  // -C repoRoot always (set right after the root probe below): pathspecs
  // are repo-root-relative in every mode, regardless of the caller's cwd
  // (a cwd-relative add could stage the wrong file silently — the one
  // thing a sanitized staging tool must never do).
  const r = gitRaw(args, repoRoot === "" ? undefined : repoRoot);
  return r;
}

function die(...lines: string[]): never {
  for (const l of lines) logError(l);
  process.exit(EXIT_GENERAL_ERROR);
}

function usage(): void {
  console.log(`Usage: repo-stage <path>...
       repo-stage --unstage <path>...
       repo-stage --batch <manifest> [--group N] [--dry-run]

The sanitized staging surface: stages or unstages exactly the named literal
repo-root-relative paths. Batch mode validates a commit-batch manifest
(groups + excluded) against the live tree on every invocation and stages one
group at a time.

  --unstage        unstage the named paths (git restore --staged)
  --batch <file>   validate the manifest and print a summary (no mutation)
  --group N        with --batch: stage group N after validation
  --dry-run        full validation + report, no mutation

Validation (batch mode, always on, refuses rather than warns): strict parse,
literal paths only, deletion-aware existence, duplicate membership, coverage
(every changed file claimed by a group or ## excluded), index purity (nothing
staged outside the manifest). Exit 0 on success/no-op, 1 validation failure,
2 usage error. Never prompts.`);
}

// --- Parse argv.
let mode: "paths" | "unstage" | "batch" = "paths";
let batchFile = "";
let groupOpt: number | null = null;
let dryRun = false;
const paths: string[] = [];
{
  const argv = process.argv.slice(2);
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i++] ?? "";
    switch (arg) {
      case "-h":
      case "--help":
        usage();
        process.exit(0);
        break;
      case "--unstage":
        if (mode !== "paths") die("--unstage cannot combine with --batch (pick one mode)");
        mode = "unstage";
        break;
      case "--batch":
        if (mode !== "paths") die("--batch cannot combine with --unstage (pick one mode)");
        mode = "batch";
        batchFile = argv[i++] ?? "";
        if (batchFile === "") die("--batch requires a manifest path argument");
        break;
      case "--group": {
        const v = argv[i++] ?? "";
        const n = Number.parseInt(v, 10);
        if (Number.isNaN(n) || n < 1 || !/^[0-9]+$/.test(v)) die("--group requires a positive integer");
        groupOpt = n;
        break;
      }
      case "--dry-run":
        dryRun = true;
        break;
      default:
        if (arg.startsWith("-")) {
          logError(`unknown option '${arg}'`);
          usage();
          process.exit(EXIT_MISUSE);
        }
        paths.push(arg);
    }
  }
}

if (mode !== "batch" && groupOpt !== null) die("--group requires --batch");
if (mode === "batch" && paths.length > 0) die("path arguments are not valid with --batch");
if (mode !== "batch" && paths.length === 0) {
  usage();
  process.exit(EXIT_MISUSE);
}

// --- Resolve the repo root; every path is repo-root-relative regardless of cwd.
const rootProbe = gitRaw(["rev-parse", "--show-toplevel"]);
if (rootProbe.status !== 0) die("not inside a git repository");
repoRoot = rootProbe.out.trim();
const absolute = (p: string): string => join(repoRoot, p);

// --- Path-mode checks: literal + existence (deletion-aware) + not a directory.
function checkPathModePaths(): void {
  for (const p of paths) {
    if (!isLiteralFilePath(p)) die(`'${p}' is not a literal repo-root-relative file path (no globs, dirs, absolute, or traversal paths)`);
  }
  const changedSet = new Set(changedFiles(repoRoot).map((e) => e.path));
  for (const p of paths) {
    const abs = absolute(p);
    if (existsSync(abs) && !statSync(abs).isFile()) die(`'${p}' is a directory — list files explicitly`);
    const onDisk = existsSync(abs) && statSync(abs).isFile();
    if (!onDisk && !changedSet.has(p)) die(`'${p}' exists neither on disk nor as a changed/deleted file — typo?`);
  }
}

// --- Execute staging/unstaging.
function stage(pathsToStage: string[]): void {
  for (const p of pathsToStage) {
    const r = git(["add", "--", p]);
    if (r.status !== 0) {
      // Idempotent no-op case: the path's change is already fully staged
      // (e.g. one half of a `git mv` rename — the old path is in neither
      // worktree nor index, so `git add` cannot match it, but the staged
      // diff already carries it). Re-adding staged content is a no-op.
      // A staged rename lists only the new path under --name-only; the old
      // path appears in --name-status as "R<score>\told -> new".
      const carried = git(["-c", "core.quotePath=false", "diff", "--cached", "--name-status"]).out
        .split("\n")
        .some((l) => {
          const parts = l.split("\t");
          const st = parts[0] ?? "";
          if (st.startsWith("R") || st.startsWith("C")) {
            const origin = (parts[1] ?? "").trim();
            return origin === p;
          }
          return (parts[1] ?? "").trim() === p;
        });
      if (carried) continue;
      die(`git add failed for '${p}': ${r.err.trim()}`);
    }
  }
}

function unstage(pathsToUnstage: string[]): void {
  const r = git(["restore", "--staged", "--", ...pathsToUnstage]);
  if (r.status !== 0) die(`git restore --staged failed: ${r.err.trim()}`);
}

// --- Diffstat helper: the +A/-B line for a set of staged paths.
function stagedStat(pathsToStat: string[]): string {
  const r = git(["diff", "--cached", "--numstat", "--", ...pathsToStat]);
  let add = 0;
  let del = 0;
  for (const line of r.out.split("\n")) {
    if (line === "") continue;
    const [a, d] = line.split("\t");
    if (a === "-" || d === "-") continue; // binary
    add += Number.parseInt(a ?? "0", 10) || 0;
    del += Number.parseInt(d ?? "0", 10) || 0;
  }
  return `+${add} −${del}`;
}

function stagedPathsNow(): string[] {
  // quotePath=false: unicode paths must round-trip unquoted (the embedded-
  // repo guard and batch purity compare these against literal user paths —
  // octal-quoted names would falsely reject a correctly staged file).
  const r = git(["-c", "core.quotePath=false", "diff", "--cached", "--name-only"]);
  return r.out.split("\n").filter((l) => l !== "");
}

if (mode === "paths" || mode === "unstage") {
  checkPathModePaths();
  if (dryRun) {
    logInfo(`dry-run: would ${mode === "paths" ? "stage" : "unstage"} ${paths.length} path(s): ${paths.join(", ")}`);
    process.exit(0);
  }
  if (mode === "paths") {
    stage(paths);
    // Embedded-repo guard: `git add` inside a nested git repository exits 0
    // while staging THAT repo's index — verify the path is actually visible
    // in the TARGET repo before claiming success.
    const visible = stagedPathsNow();
    const missing = paths.filter((p) => !visible.includes(p));
    if (missing.length > 0) {
      die(
        `staged into a DIFFERENT repository: ${missing.join(", ")} is not in this repo's index — the path is likely inside an embedded git repository (gitignore it, remove it, or register it as a submodule)`,
      );
    }
  } else {
    unstage(paths);
  }
  const verb = mode === "paths" ? "staged" : "unstaged";
  logInfo(`${verb} ${paths.length} path(s) · index now ${stagedPathsNow().length} file(s) staged`);
  process.exit(0);
}

// --- Batch mode: parse, validate against the live tree, then act.
if (!existsSync(batchFile)) die(`manifest not found: ${batchFile}`);
const text = readFileSync(batchFile, "utf8");
const parsed = parseCommitBatch(text);
if ("errors" in parsed) {
  logError(`manifest parse refused (${parsed.errors.length} error(s)):`);
  for (const e of parsed.errors) logError(`  - ${e.message}`);
  process.exit(EXIT_GENERAL_ERROR);
}
const batch = parsed.batch;

const changed = changedFiles(repoRoot);
const changedSet = changed.map((e) => e.path);
const existsOnDisk = new Set<string>();
for (const p of batchClaimedPaths(batch)) {
  const abs = absolute(p);
  if (existsSync(abs) && statSync(abs).isFile()) existsOnDisk.add(p);
  else if (existsSync(abs) && !statSync(abs).isFile()) {
    const embedded = existsSync(join(abs, ".git"));
    die(
      `'${p}' is a directory${embedded ? " containing an embedded git repository" : ""} — batch entries are files only${embedded ? "; gitignore the embedded repo, remove it, or register it as a submodule before batching" : " (implicit sweeps are how unreviewed content rides along)"}`,
    );
  }
}
const stagedNow = stagedPathsNow();

const validationErrors = validateCommitBatch(batch, {
  changedPaths: changedSet,
  stagedPaths: stagedNow,
  exists: existsOnDisk,
});
if (validationErrors.length > 0) {
  logError(`batch validation refused (${validationErrors.length} error(s)):`);
  for (const e of validationErrors) logError(`  - ${e.message}`);
  process.exit(EXIT_GENERAL_ERROR);
}

const total = batch.groups.length;
logInfo(`batch ok: ${total} group(s), ${batch.groups.reduce((n, g) => n + g.files.length, 0)} file(s) claimed, ${batch.excluded.length} excluded`);

if (groupOpt === null) {
  // summary-only mode
  for (const g of batch.groups) {
    logInfo(`  group ${g.number}/${total} · ${g.files.length} file(s) · ${g.subject}`);
  }
  process.exit(0);
}

const group = batch.groups.find((g) => g.number === groupOpt);
if (!group) die(`group ${groupOpt} not in batch (groups 1..${total})`);

logInfo(`staging group ${group.number}/${total} · ${group.files.length} file(s) · ${group.subject}`);
if (dryRun) {
  logInfo(`dry-run: would stage ${group.files.join(", ")} · ${stagedStat(group.files)}`);
  process.exit(0);
}
stage(group.files);
logInfo(`staged group ${group.number}/${total} · ${group.files.length} file(s) · ${stagedStat(group.files)} · suggested: ${group.subject}`);
const remaining = batch.groups.filter((g) => g.number > group.number).length;
if (remaining > 0) logInfo(`${remaining} group(s) remain in this batch`);
if (remaining === 0 && batch.excluded.length > 0) {
  logWarn(`batch exhausted; ${batch.excluded.length} excluded path(s) intentionally left unstaged`);
}
process.exit(0);
