#!/usr/bin/env node
// repo-stage.ts — the sanitized staging surface (content selection).
// Version: 1.2.0
//
// Contract (the repo-stage half of the commit-batching family):
//   - repo-stage <path>...              stage exactly these literal paths
//   - repo-stage --unstage <path>...    unstage exactly these
//   - repo-stage --patch <file>         stage exactly the patch's hunks (direct request)
//   - repo-stage --batch <file>         validate + summary only (no mutation)
//   - repo-stage --batch <file> --group N   validate, stage group N, echo stat
//   - --dry-run on any mutating mode: full validation, print, no mutation
//
// Partial staging (hunk selectors + --patch) rides the engine in
// lib/domain/hunk-stage.ts: enumerate → resolve → build patch →
// apply --cached (preflight-checked) → verify the three-part invariant.
// Refused classes in v1: binary, rename pairs, new files (doctrine — broken
// intermediate commits and messy semantics, not mechanical limits).
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
import { errorMessage } from "../lib/core/logging.ts";
import { gitCheck } from "../lib/core/git.ts";
import { logError, logInfo, logWarn } from "../lib/core/logging.ts";
import { toolCli, usageCommonFlags } from "../lib/core/cli.ts";
import { changedFiles } from "../lib/core/git.ts";
import { batchClaimedPaths, isLiteralFilePath, parseCommitBatch, validateCommitBatch } from "../lib/domain/commit-batch.ts";
import { enumerateFile, stageSelection, extractPayloads } from "../lib/domain/hunk-stage.ts";
import { hunkPayload } from "../lib/domain/hunk-select.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";

assertNodeFloor();

function gitRaw(args: string[], cwd?: string): { status: number; out: string; err: string } {
  const r = gitCheck(cwd ?? null, args);
  return { status: r.ok ? 0 : 1, out: r.out, err: r.err };
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
       repo-stage --patch <patch-file>
       repo-stage --batch <manifest> [--group N] [--dry-run]

The sanitized staging surface: stages or unstages exactly the named literal
repo-root-relative paths. Patch mode stages exactly a patch file's hunks
(direct request; modification patches only). Batch mode validates a
commit-batch manifest (groups + excluded, whole-file and hunk-selector
entries) against the live tree on every invocation and stages one group at a
time; selector entries '- path @ 1-2,4' claim specific hunks of a file's
live diff.

Options:
${usageCommonFlags({ noDevenv: true })}
  --unstage               unstage the named paths (git restore --staged)
  --patch <file>          stage exactly the patch's hunks (git apply --cached)
  --batch <file>          validate the manifest and print a summary (no mutation)
  --group N               with --batch: stage group N after validation

Validation (batch mode, always on, refuses rather than warns): strict parse,
literal paths only, deletion-aware existence, duplicate membership, coverage
(every changed file claimed by a group or ## excluded; every hunk of a
partially-claimed file claimed), index purity (nothing staged outside the
manifest; no staged hunk content a group did not claim). Exit 0 on
success/no-op, 1 validation failure, 2 usage error. Never prompts.`);
}

// --- Parse argv.
let mode: "paths" | "unstage" | "batch" | "patch" = "paths";
let batchFile = "";
let patchFile = "";
let groupOpt: number | null = null;
let dryRun = false;
const paths: string[] = [];
try {
  const cli = toolCli({
    name: "repo-stage",
    version: "1.2.0",
    argv: process.argv.slice(2),
    options: {
      unstage: { type: "boolean", default: false },
      batch: { type: "string" },
      group: { type: "string" },
      patch: { type: "string" },
    },
  });
  if (cli.common.help) {
    usage();
    process.exit(0);
  }
  dryRun = cli.common.dryRun;
  if (cli.values["unstage"] === true) mode = "unstage";
  batchFile = typeof cli.values.batch === "string" ? cli.values.batch : "";
  patchFile = typeof cli.values.patch === "string" ? cli.values.patch : "";
  if (batchFile !== "" && patchFile !== "") die("--patch cannot combine with --batch (pick one mode)");
  if (patchFile !== "") {
    if (mode !== "paths") die("--unstage cannot combine with --patch (pick one mode)");
    mode = "patch";
  }
  if (batchFile !== "") {
    if (mode !== "paths") die("--unstage cannot combine with --batch (pick one mode)");
    mode = "batch";
  }
  const groupRaw = typeof cli.values.group === "string" ? cli.values.group : "";
  if (groupRaw !== "") {
    const n = Number.parseInt(groupRaw, 10);
    if (Number.isNaN(n) || n < 1 || !/^[0-9]+$/.test(groupRaw)) die("--group requires a positive integer");
    groupOpt = n;
  }
  paths.push(...cli.positionals);
} catch (err) {
  logError(errorMessage(err));
  usage();
  process.exit(EXIT_MISUSE);
}

if (mode !== "batch" && groupOpt !== null) die("--group requires --batch");
if (mode === "batch" && paths.length > 0) die("path arguments are not valid with --batch");
if (mode === "patch" && paths.length > 0) die("path arguments are not valid with --patch");
if (mode !== "batch" && mode !== "patch" && paths.length === 0) {
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

// --- Patch mode: stage exactly the patch's hunks (direct request).
if (mode === "patch") {
  if (!existsSync(patchFile)) die(`patch file not found: ${patchFile}`);
  const patch = readFileSync(patchFile, "utf8");
  if (patch.includes("GIT binary patch") || /Binary files .* differ/.test(patch)) {
    die("binary patches are refused in v1 — claim the whole file in one group or split the work by hand");
  }
  if (patch.includes("new file mode") || /^--- \/dev\/null$/m.test(patch)) {
    die("new-file patches are refused in v1 (intermediate commits must be individually mergeable) — claim the whole file in one group or split the work by hand");
  }
  if (/^rename from /m.test(patch) || /^rename to /m.test(patch)) {
    die("rename patches are refused in v1 — claim the whole file in one group or split the work by hand");
  }
  if (patch.includes("deleted file mode") || /^\+\+\+ \/dev\/null$/m.test(patch)) {
    die("deletion patches are refused in v1 — deletions are whole-file claims (stage the path in path mode or a batch group), not patch content");
  }
  if ((patch.match(/^diff --git /gm) ?? []).length > 1) {
    die("multi-file patches are refused — one patch file stages one file's hunks");
  }
  // Patch-mode git runner: git with -C repoRoot, stdin-forwarding (apply
  // reads the patch from stdin; gitCheck's input param covers this, but a
  // local runner keeps the patch lane self-contained).
  const runPatchGit = (args: string[], input: string) => {
    const r = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", input });
    return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  const check = runPatchGit(["apply", "--cached", "--check", "-"], patch);
  if (check.status !== 0) {
    die(`patch does not apply to the index: ${check.stderr || "(no stderr)"} — the worktree may have drifted since the patch was written; regenerate the patch or edit it`);
  }
  if (!/^diff --git a\/(.+) b\/.+$/m.test(patch)) {
    // The patch-mode verification contract requires the plain unified
    // header: it names the single staged path AND excludes traditional
    // format (whose multi-file shape the header-count guard cannot see).
    // Refuse rather than staging unverified.
    die("patch must carry the plain 'diff --git a/<path> b/<path>' header — traditional-format patches and quoted paths are refused (verification requires the path in plain form); stage via a batch selector claim instead");
  }
  if (dryRun) {
    const hunkCount = (patch.match(/^@@/gm) ?? []).length;
    logInfo(`dry-run: would stage ${hunkCount} hunk(s) from ${patchFile}`);
    process.exit(0);
  }
  // Pre-apply snapshot: staged payloads for the patched path (captured
  // BEFORE the apply — the apply changes the staged diff).
  const patchPathMatch = /^diff --git a\/(.+) b\//m.exec(patch);
  const patchedPath = patchPathMatch?.[1] ?? "";
  const preStagedP = extractPayloads(gitCheck(repoRoot, ["diff", "--cached", "--", patchedPath]).out);
  const applied = runPatchGit(["apply", "--cached", "-"], patch);
  if (applied.status !== 0) {
    die(`git apply --cached failed: ${applied.stderr || "(no stderr)"} — index unchanged`);
  }
  // Post-apply verification — the ENGINE's line-multiset comparison
  // (order- and merge-insensitive; pairwise/order-bound joins false-refuse
  // three-way and reversed merges — the engine lane learned this in review
  // round 2 and the patch lane reuses the fix wholesale): staged +/- lines
  // (counted) must equal pre-staged ∪ patch lines exactly.
  {
    const patchPayloads = extractPayloads(patch);
    const stagedNowP = extractPayloads(gitCheck(repoRoot, ["diff", "--cached", "--", patchedPath]).out);
    const countLines = (payloads: string[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const p of payloads) {
        for (const line of p.split("\n")) m.set(line, (m.get(line) ?? 0) + 1);
      }
      return m;
    };
    const stagedLines = countLines(stagedNowP);
    const knownLines = countLines([...preStagedP, ...patchPayloads]);
    let extra: string | null = null;
    for (const [line, n] of stagedLines) {
      if ((knownLines.get(line) ?? 0) < n) {
        extra = `the staged diff contains content that is neither prior staged content nor the patch's hunks`;
        break;
      }
    }
    if (extra === null) {
      for (const [line, n] of knownLines) {
        if ((stagedLines.get(line) ?? 0) < n) {
          extra = `expected patch content is absent from the staged diff`;
          break;
        }
      }
    }
    if (extra !== null) {
      die(`verification failed: ${extra} for '${patchedPath}' — restore with 'git restore --staged ${patchedPath}' and regenerate the patch (apply is context-tolerant and may have matched unexpected content)`);
    }
  }
  const stagedNow2 = stagedPathsNow();
  const hunkCount = (patch.match(/^@@/gm) ?? []).length;
  logInfo(`staged patch ${patchFile} · ${hunkCount} hunk(s) · ${stagedNow2.length} file(s) now staged · verify: git diff --cached`);
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

// --- Hunk facts: enumerate every hunk-claimed file for validation + staging.
const batchEngine = (args: string[], input?: string) => {
  const r = gitCheck(repoRoot, args, input);
  return { status: r.ok ? 0 : 1, stdout: r.out, stderr: r.err };
};
const hunkClaimPaths = [...new Set(batch.groups.flatMap((g) => [...g.hunkClaims.keys()]))];
const hunkFacts = hunkClaimPaths.length
  ? (() => {
      const liveCounts = new Map<string, number>();
      const refusalClasses = new Map<string, "binary" | "rename" | "new-file">();
      const stagedPayloads = new Map<string, string[]>();
      const payloadByNumber = new Map<string, string[]>();
      for (const p of hunkClaimPaths) {
        const e = enumerateFile(batchEngine, p);
        if ("message" in e) {
          // Structured classification: the engine's kind field names the
          // class. Refusal classes feed the validator's table; enum errors
          // (deletions, mode-only changes, parse failures) are hard errors
          // of their own — surfacing them as "0 hunks" drift would be a
          // false diagnosis.
          if (e.kind === "binary" || e.kind === "rename" || e.kind === "new-file") refusalClasses.set(p, e.kind);
          else die(`hunk-claim enumeration refused — ${e.message}`);
        } else {
          liveCounts.set(p, e.hunks.length);
          payloadByNumber.set(p, e.hunks.map(hunkPayload));
        }
        // Staged payloads (content identity) for purity.
        const stagedDiff = gitCheck(repoRoot, ["diff", "--cached", "--", p]).out;
        stagedPayloads.set(p, extractPayloads(stagedDiff));
      }
      return { liveCounts, refusalClasses, stagedPayloads, payloadByNumber };
    })()
  : undefined;


// A group is consumed when every file's worktree content matches HEAD — the
// group was committed and its files untouched since. Consumed groups are
// exempt from existence validation (their paths may have been renamed or
// deleted by later commits — consumption evidence, not a typo) and reported
// as done.
const consumedGroups = new Set<number>();
const changedPathSet = new Set(changedSet);
for (const g of batch.groups) {
  // Consumed = none of the group's claimed paths (whole-file or hunk)
  // remain in the changed set: the work the manifest described was
  // committed (a later commit renaming or deleting a consumed file is that
  // commit's business, not a manifest typo). A group whose claims are all
  // hunk selectors is NOT consumed while the file still carries any
  // change — after a partial commit the remaining groups' selectors have
  // renumbered and validation refuses with drift (renumber or re-group).
  const claimedPaths = [...g.files, ...g.hunkClaims.keys()];
  const untouched = claimedPaths.every((p) => !changedPathSet.has(p));
  if (untouched) consumedGroups.add(g.number);
}

const validationErrors = validateCommitBatch(batch, {
  changedPaths: changedSet,
  stagedPaths: stagedNow,
  exists: existsOnDisk,
  consumedGroups,
  ...(hunkFacts ? { hunkFacts } : {}),
});
if (validationErrors.length > 0) {
  logError(`batch validation refused (${validationErrors.length} error(s)):`);
  for (const e of validationErrors) logError(`  - ${e.message}`);
  process.exit(EXIT_GENERAL_ERROR);
}

const total = batch.groups.length;
logInfo(
  `batch ok: ${total} group(s), ${batch.groups.reduce((n, g) => n + g.files.length, 0)} file(s) claimed, ${hunkClaimPaths.length} hunk-claimed file(s), ${batch.excluded.length} excluded`,
);

if (groupOpt === null) {
  // summary-only mode
  for (const g of batch.groups) {
    if (consumedGroups.has(g.number)) {
      logInfo(`  group ${g.number}/${total} · done (consumed — committed, files unchanged since)`);
    } else {
      logInfo(`  group ${g.number}/${total} · ${g.files.length} file(s) · ${g.subject}`);
    }
  }
  process.exit(0);
}

const group = batch.groups.find((g) => g.number === groupOpt);
if (!group) die(`group ${groupOpt} not in batch (groups 1..${total})`);
if (consumedGroups.has(group.number)) {
  logInfo(`group ${group.number}/${total} is already consumed (committed, files unchanged since) — nothing to stage`);
  process.exit(0);
}

logInfo(`staging group ${group.number}/${total} · ${group.files.length} file(s) · ${group.hunkClaims.size} hunk-claim(s) · ${group.subject}`);
if (dryRun) {
  logInfo(`dry-run: would stage ${group.files.join(", ") || "(no whole-file entries)"}${group.hunkClaims.size > 0 ? ` · hunks: ${[...group.hunkClaims].map(([p, n]) => `${p} @ ${n.join(",")}`).join("; ")}` : ""}`);
  process.exit(0);
}
// Whole-file entries first (the existing per-path stage loop).
if (group.files.length > 0) stage(group.files);
// Hunk-claim entries via the engine, with per-file echo. Validation ran
// pre-mutation over every group's selectors (validate-then-mutate); the
// engine re-checks applicability per path before applying.
for (const [p, numbers] of group.hunkClaims) {
  const r = stageSelection(batchEngine, p, numbers);
  if ("message" in r) {
    die(`hunk staging refused — ${r.message}`);
  }
  const liveTotal = hunkFacts?.liveCounts.get(p) ?? 0;
  logInfo(`  ${p}: ${r.stagedHeaders.length}/${liveTotal} hunk(s) staged · ${r.remaining} remain`);
  for (const w of r.warnings) logWarn(`  ${p}: ${w}`);
}
logInfo(`staged group ${group.number}/${total} · ${group.files.length} file(s), ${group.hunkClaims.size} hunk-claim(s) · ${stagedStat([...group.files, ...group.hunkClaims.keys()])} · suggested: ${group.subject}`);
const remaining = batch.groups.filter((g) => g.number > group.number).length;
if (remaining > 0) logInfo(`${remaining} group(s) remain in this batch`);
if (remaining === 0 && batch.excluded.length > 0) {
  logWarn(`batch exhausted; ${batch.excluded.length} excluded path(s) intentionally left unstaged`);
}
process.exit(0);
