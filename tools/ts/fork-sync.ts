// fork-sync.sh — report or apply upstream's new commits against the configured
// upstream. Port of fork-sync.sh over lib/domain/{fork,fork-twin,fork-surfaces}.ts.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertNodeFloor } from "../lib/core/node-floor.ts";
import { EXIT_GENERAL_ERROR, EXIT_MISUSE } from "../lib/core/exit-codes.ts";
import { changeIdGetFromCommit } from "../lib/core/change-id.ts";
import { loadConfig, normalizeGitUrl, upstreamMatches } from "../lib/domain/fork/index.ts";
import {
  PICK_VERDICT_PICK, classifyPickRange, gitIn, mapAdd, mapGetPath,
  mapLookupLocal, mapPropose, mapRemove, patchesIdentical, type PickRow,
} from "../lib/domain/fork/twin.ts";
import { surfacesClassify, surfacesList, surfacesValidate } from "../lib/domain/fork/surfaces.ts";
import { selfRoot } from "../lib/core/self-root.ts";

assertNodeFloor();

const die = (msg: string, code = 1): never => {
  console.error(msg.startsWith("ERROR:") ? msg : `ERROR: ${msg}`);
  process.exit(code);
};
const g = (args: string[]): { out: string; ok: boolean } => {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { out: (r.stdout ?? "").trim(), ok: r.status === 0 };
};

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  console.log(`fork-sync — report or apply upstream's new commits against the configured upstream

Fetches \`upstream\` and reports ahead/behind counts and commits by default;
it does not change history or push unless explicitly requested. \`--replay\`
applies \`upstream/<branch>\`'s new commits on top of the branch (commits the
branch already has are skipped, not re-applied; the branch's own SHAs never
move, so \`--push-to-origin\` stays a fast-forward). On a conflict, it prints
\`git cherry-pick --abort\` guidance and exits without pushing.
\`--push-to-origin\` uses a normal fast-forward push; \`--rewrite-origin\`
replaces origin-only commits with \`--force-with-lease\`. Applying commits
requires confirmation: \`--yes\` confirms without a prompt; otherwise a TTY gets a
y/N prompt and non-TTY use fails closed.
\`--dry-run\` reports the planned operations.

Divergent commits are matched by Change-Id trailer, patch-equivalence,
subject, or reachability from a local ref, in both directions.

USAGE
    fork-sync [--dry-run] [--replay] [--push-to-origin [--rewrite-origin]] [--yes]
    fork-sync --link <local-commit> <upstream-commit>
    fork-sync --unlink <local-or-upstream-sha>
    fork-sync --drift
    fork-sync --propose-links`);
  process.exit(0);
}

process.env.DEVENV_ROOT = process.env.DEVENV_ROOT ?? selfRoot(process.cwd());
const config = loadConfig();

let dryRun = false, replay = false, push = false, rewriteOrigin = false, yes = false;
let linkLocal = "", linkUpstream = "", unlinkSha = "";
let proposeLinks = false, drift = false;

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i] as string;
  if (a === "--dry-run") dryRun = true;
  else if (a === "--replay") replay = true;
  else if (a === "--push-to-origin") push = true;
  else if (a === "--rewrite-origin") rewriteOrigin = true;
  else if (a === "--yes") yes = true;
  else if (a === "--link") {
    const l = argv[i + 1];
    const u = argv[i + 2];
    if (l === undefined || u === undefined) die("Missing value for --link", EXIT_MISUSE);
    linkLocal = l as string;
    linkUpstream = u as string;
    i += 2;
  } else if (a === "--propose-links") proposeLinks = true;
  else if (a === "--drift") drift = true;
  else if (a === "--unlink") {
    const v = argv[i + 1];
    if (v === undefined) die("Missing value for --unlink", EXIT_MISUSE);
    unlinkSha = v as string;
    i++;
  } else if (a === "--rebase") {
    die("--rebase was renamed --replay (the sync applies upstream's commits on top of the branch; it no longer describes itself as a rebase)", EXIT_MISUSE);
  } else die(`unknown option: ${a}`, EXIT_MISUSE);
}

if (yes && !push && !replay) die("--yes requires --push-to-origin or --replay", EXIT_MISUSE);
if (linkLocal !== "" && (replay || push || dryRun || proposeLinks || unlinkSha !== "")) die("--link runs alone", EXIT_MISUSE);
if (proposeLinks && (replay || push || dryRun || linkLocal !== "" || unlinkSha !== "")) die("--propose-links runs alone", EXIT_MISUSE);
if (drift && (replay || push || dryRun || proposeLinks || linkLocal !== "" || unlinkSha !== "")) die("--drift runs alone", EXIT_MISUSE);
if (unlinkSha !== "" && (replay || push || dryRun || linkLocal !== "" || proposeLinks)) die("--unlink runs alone", EXIT_MISUSE);
if (rewriteOrigin && !push) die("--rewrite-origin requires --push-to-origin", EXIT_MISUSE);
if (push && !yes && process.stdin.isTTY !== true) {
  die("non-TTY --push-to-origin requires --yes", EXIT_MISUSE);
}

const repoRoot = g(["rev-parse", "--show-toplevel"]).out;
if (repoRoot === "") die("run fork-sync from inside a git repository", EXIT_GENERAL_ERROR);

// --- adoption-map support ---
function discoverUpstreamClone(): string {
  if (process.env.FORK_UPSTREAM_CLONE) return process.env.FORK_UPSTREAM_CLONE;
  const configured = normalizeGitUrl(config.upstreamRepo);
  const matches: string[] = [];
  try {
    for (const candidate of existsSync(join(repoRoot, "repos")) ? require0(join(repoRoot, "repos")) : []) {
      const abs = join(repoRoot, "repos", candidate);
      const root = g(["-C", abs, "rev-parse", "--show-toplevel"]).out;
      if (root === "" || root === repoRoot) continue;
      const origin = g(["-C", root, "remote", "get-url", "origin"]).out;
      if (origin === "") continue;
      if (normalizeGitUrl(origin) === configured && !matches.includes(root)) matches.push(root);
    }
  } catch { /* no repos/ dir */ }
  return matches.length === 1 ? matches[0] as string : "";
}

function require0(dir: string): string[] {
  try {
    return spawnSync("ls", [dir], { encoding: "utf8" }).stdout.split("\n").filter((e) => e !== "");
  } catch {
    return [];
  }
}

const upstreamRef = `refs/remotes/upstream/${config.upstreamBranch}`;

// --- --unlink ---
if (unlinkSha !== "") {
  if (!g(["-C", repoRoot, "remote", "get-url", "upstream"]).ok) {
    die("upstream remote is missing; run fork-setup first", EXIT_GENERAL_ERROR);
  }
  if (mapRemove(repoRoot, unlinkSha)) {
    console.log(`removed adoption pair(s) naming ${unlinkSha}`);
  } else {
    die(`no adoption-map entry matches: ${unlinkSha}`, EXIT_MISUSE);
  }
  process.exit(0);
}

// --- --link / --propose-links ---
if (linkLocal !== "" || proposeLinks) {
  if (!g(["-C", repoRoot, "remote", "get-url", "upstream"]).ok) {
    die("upstream remote is missing; run fork-setup first", EXIT_GENERAL_ERROR);
  }
  const upstreamClone = discoverUpstreamClone();
  if (upstreamClone === "") {
    die("could not identify the upstream clone (set FORK_UPSTREAM_CLONE, or keep exactly one matching clone under repos/)", EXIT_MISUSE);
  }
  if (linkLocal !== "") {
    if (!mapAdd(repoRoot, linkLocal, linkUpstream, "", upstreamClone)) {
      die("could not record the adoption pair", EXIT_GENERAL_ERROR);
    }
    console.log(`recorded adoption pair: ${linkLocal} <-> ${linkUpstream}`);
    process.exit(0);
  }
  spawnSync("git", ["-C", repoRoot, "fetch", "--prune", "upstream"], { stdio: "ignore" });
  const upstreamTip = gitIn(upstreamClone, ["rev-parse", "HEAD"]).out;
  const base = g(["-C", repoRoot, "merge-base", `upstream/${config.upstreamBranch}`, "HEAD"]).out;
  if (base === "") die("HEAD and upstream share no common history", EXIT_GENERAL_ERROR);
  const candidates = mapPropose(repoRoot, upstreamClone, `${base}..HEAD`, `${base}..${upstreamTip}`);
  if (candidates === "") {
    console.log("no adoption candidates found (every unlinked local commit lacks a plausible upstream twin)");
    process.exit(0);
  }
  if (process.stdin.isTTY === true && process.stdout.isTTY === true) {
    let confirmed = 0;
    for (const line of candidates.split("\n")) {
      const [score = "", lSha = "", uSha = "", ...subjectParts] = line.split(" ");
      if (score === "") continue;
      const subject = subjectParts.join(" ");
      console.log("---");
      console.log(`score ${score}: ${subject}`);
      console.log(`  local:    ${lSha}`);
      console.log(`  upstream: ${uSha}`);
      const map = mapGetPath(repoRoot) ?? "";
      if (map !== "" && mapLookupLocalSafe(map, repoRoot, lSha as string) !== "") {
        console.log("  already recorded; skipping");
        continue;
      }
      process.stdout.write("  link this pair? [y/N] ");
      const r = spawnSync("bash", ["-c", 'read -r a < /dev/tty || true; printf "%s" "$a"'], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
      const answer = (r.stdout ?? "").trim();
      if (/^[Yy]/.test(answer)) {
        if (!mapAdd(repoRoot, lSha as string, uSha as string, subject, upstreamClone)) {
          die("could not record the adoption pair", EXIT_GENERAL_ERROR);
        }
        confirmed++;
      }
    }
    console.log("---");
    console.log(`${confirmed} pair(s) recorded.`);
  } else {
    console.log("Adoption candidates (score, local, upstream, subject) — record with fork-sync --link:");
    for (const line of candidates.split("\n")) {
      const [score = "", lSha = "", uSha = "", ...subjectParts] = line.split(" ");
      if (score === "") continue;
      console.log(`  fork-sync --link ${lSha} ${uSha}   # ${subjectParts.join(" ")}`);
    }
  }
  process.exit(0);
}
void linkUpstream;

// --- --drift ---
if (drift) {
  if (surfacesValidate().length > 0) die("fork-surfaces declaration is invalid", EXIT_GENERAL_ERROR);
  if (!g(["-C", repoRoot, "remote", "get-url", "upstream"]).ok) {
    die("upstream remote is missing; run fork-setup first", EXIT_GENERAL_ERROR);
  }
  const localDriftRef = upstreamRef;
  if (!g(["-C", repoRoot, "show-ref", "--verify", "--quiet", localDriftRef]).ok) {
    die("upstream branch not fetched yet; run fork-sync (without --drift) once to fetch", EXIT_GENERAL_ERROR);
  }
  const baseDrift = g(["-C", repoRoot, "merge-base", localDriftRef, "HEAD"]).out;
  if (baseDrift === "") {
    die("cannot compute the drift base — is upstream/... still fetched and related to HEAD? run fork-sync once to refresh", EXIT_GENERAL_ERROR);
  }
  console.log("Drift inventory: fork-local edits on upstream-stable paths");
  console.log(`  (compared against the last-fetched upstream/${config.upstreamBranch})`);
  let driftCount = 0;
  const paths = g(["-C", repoRoot, "diff", "--name-only", `${baseDrift}..HEAD`, "--", "."]).out.split("\n").sort();
  for (const p of paths) {
    if (p === "") continue;
    let cls = "";
    try {
      cls = surfacesClassify(p);
    } catch {
      die("fork-surfaces declaration is invalid", EXIT_GENERAL_ERROR);
    }
    if (cls !== "upstream-stable") continue;
    driftCount++;
    if (driftCount === 1) console.log("");
    console.log(`  ${p}`);
  }
  if (driftCount === 0) {
    console.log("  none — no fork-local edits on upstream-stable paths.");
  } else {
    console.log("");
    console.log(`  ${driftCount} upstream-stable path(s) carry fork-local edits.`);
    console.log("  These are maintained at the fork's own cost; upstream changes to");
    console.log("  them may conflict at sync time.");
  }
  process.exit(0);
}

// --- unfinished-operation guards ---
if (g(["-C", repoRoot, "rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).ok) {
  die(`a merge is already in progress; finish it (git -C ${repoRoot} merge --continue) or abort it (--abort) before syncing`, EXIT_GENERAL_ERROR);
}
if (g(["-C", repoRoot, "rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]).ok) {
  die(`a cherry-pick is already in progress; finish it (git -C ${repoRoot} cherry-pick --continue) or abort it (--abort) before syncing`, EXIT_GENERAL_ERROR);
}
for (const stateDir of ["rebase-merge", "rebase-apply"]) {
  const p = g(["-C", repoRoot, "rev-parse", "--git-path", stateDir]).out;
  if (p !== "" && existsSync(p)) {
    die("a rebase (or 'git am') is already in progress; finish it (--continue) or abort it (--abort) before syncing", EXIT_GENERAL_ERROR);
  }
}
if (!g(["-C", repoRoot, "remote", "get-url", "upstream"]).ok) {
  die("upstream remote is missing; run fork-setup first", EXIT_GENERAL_ERROR);
}
if (!upstreamMatches(repoRoot, config.upstreamRepo)) {
  die("upstream remote URL does not match [fork] upstream_repo", EXIT_GENERAL_ERROR);
}
const currentBranch = g(["-C", repoRoot, "symbolic-ref", "--quiet", "--short", "HEAD"]).out || "HEAD";

// --- pick plan ---
interface PickPlan {
  rows: PickRow[]; pickCount: number; dropCount: number;
  residueCount: number; residueLines: string[];
}

function buildPickPlan(base: string): PickPlan {
  const upstreamClone = process.env.FORK_UPSTREAM_CLONE || discoverUpstreamClone() || repoRoot;
  const rows = classifyPickRange(repoRoot, upstreamClone, base, upstreamRef, base, "HEAD");
  let pickCount = 0, dropCount = 0, residueCount = 0;
  const residueLines: string[] = [];
  for (const row of rows) {
    if (row.verdict === PICK_VERDICT_PICK) { pickCount++; continue; }
    dropCount++;
    // Residue: the skipped upstream commit's local twin differs in patch.
    const uId = changeIdGetFromCommit(upstreamClone, row.sha) ?? "";
    let localTwin = "";
    if (uId !== "") {
      for (const lSha of g(["-C", repoRoot, "rev-list", "HEAD"]).out.split("\n")) {
        if (lSha === "") continue;
        if ((changeIdGetFromCommit(repoRoot, lSha) ?? "") === uId) { localTwin = lSha; break; }
      }
    }
    if (localTwin !== "" && !patchesIdentical(repoRoot, upstreamClone, localTwin, row.sha)) {
      residueCount++;
      const subject = g(["-C", repoRoot, "log", "-1", "--format=  %h %s", row.sha]).out;
      residueLines.push(`${subject} — upstream copy differs from your local version (local kept)`);
    }
  }
  return { rows, pickCount, dropCount, residueCount, residueLines };
}

function printPickPlan(plan: PickPlan): void {
  for (const row of plan.rows) {
    const line = g(["-C", repoRoot, "log", "-1", "--format=%h %s", row.sha]).out;
    if (row.verdict === PICK_VERDICT_PICK) {
      console.log(`  ${line} — new upstream work, will be applied`);
    } else {
      console.log(`  ${line} — already on your branch (via ${row.signal}), skipped`);
    }
  }
  if (plan.residueCount > 0) {
    console.log("Divergence on skipped commit(s) — your local copy kept:");
    for (const l of plan.residueLines) console.log(l);
  }
}

function printSurfaceForecast(plan: PickPlan): void {
  if (surfacesValidate().length > 0) die("fork-surfaces declaration is invalid; cannot forecast surface classes", EXIT_GENERAL_ERROR);
  const upstreamClone = process.env.FORK_UPSTREAM_CLONE || discoverUpstreamClone() || repoRoot;
  const fr: string[] = [], fs: string[] = [], us: string[] = [];
  for (const row of plan.rows) {
    if (row.verdict !== PICK_VERDICT_PICK) continue;
    for (const p of gitIn(upstreamClone, ["diff", "--name-only", `${row.sha}^`, row.sha]).out.split("\n")) {
      if (p === "") continue;
      let cls = "";
      try { cls = surfacesClassify(p); } catch { die("fork-surfaces declaration is invalid", EXIT_GENERAL_ERROR); }
      if (cls === "fork-replaced") { if (!fr.includes(p)) fr.push(p); }
      else if (cls === "fork-stable") { if (!fs.includes(p)) fs.push(p); }
      else if (!us.includes(p)) us.push(p);
    }
  }
  if (fr.length === 0 && fs.length === 0 && us.length === 0) return;
  console.log("Surface forecast for the applied work:");
  if (fr.length > 0) {
    console.log(`  ${fr.length} fork-replaced path(s) — expect manual reconciliation (setup):`);
    for (const p of fr) console.log(`    ${p}`);
  }
  if (fs.length > 0) {
    console.log(`  ${fs.length} fork-stable path(s) — yours to keep, no reconciliation needed:`);
    for (const p of fs) console.log(`    ${p}`);
  }
  if (us.length > 0) {
    console.log(`  ${us.length} upstream-stable path(s) — should merge cleanly:`);
    for (const p of us) console.log(`    ${p}`);
  }
}

function pickConflictGuidance(plan: PickPlan): void {
  if (g(["-C", repoRoot, "rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]).ok) {
    const conflicting = g(["-C", repoRoot, "rev-parse", "--short", "CHERRY_PICK_HEAD"]).out;
    console.error(`Conflict while applying upstream commit ${conflicting}.`);
    const full = g(["-C", repoRoot, "rev-parse", "CHERRY_PICK_HEAD"]).out;
    const row = plan.rows.find((r) => r.sha === full);
    if (row) {
      if (row.verdict === PICK_VERDICT_PICK) {
        console.error(`This commit was classified: pick (signal: ${row.signal || "-"}).`);
      } else {
        console.error(`This commit was classified: ${row.verdict} (signal: ${row.signal || "-"}) — it may already exist on your branch; skipping it may be the resolution.`);
      }
    }
    console.error("Resolve the conflicts and continue, skip this commit, or return to the exact pre-sync state:");
    console.error(`  git -C ${repoRoot} cherry-pick --continue`);
    console.error(`  git -C ${repoRoot} cherry-pick --skip`);
    console.error(`  git -C ${repoRoot} cherry-pick --abort`);
  } else {
    die(`apply of upstream/${config.upstreamBranch} onto ${currentBranch} failed`, EXIT_GENERAL_ERROR);
  }
}

if (replay) {
  if (currentBranch === "HEAD") die("cannot replay while HEAD is detached", EXIT_GENERAL_ERROR);
  if (g(["-C", repoRoot, "status", "--porcelain"]).out !== "") {
    die("working tree has uncommitted changes; commit, stash, or discard them before --replay", EXIT_GENERAL_ERROR);
  }
}

// --- dry run: reports against the last-fetched state, never fetches ---
if (dryRun) {
  console.log("dry run: would fetch upstream and compare HEAD with upstream/...");
  if (replay) {
    console.log("dry run: would apply upstream's new commits onto the branch (local history unchanged)");
    if (g(["-C", repoRoot, "show-ref", "--verify", "--quiet", upstreamRef]).ok) {
      const dryBase = g(["-C", repoRoot, "merge-base", upstreamRef, "HEAD"]).out;
      if (dryBase === "") die(`dry run: HEAD and upstream/${config.upstreamBranch} share no common history`, EXIT_GENERAL_ERROR);
      console.log("dry run: pick plan (as of the last fetch):");
      const plan = buildPickPlan(dryBase);
      printPickPlan(plan);
      printSurfaceForecast(plan);
      console.log(`dry run: would apply ${plan.pickCount} new upstream commit(s), skip ${plan.dropCount} already present.`);
    } else {
      console.log("dry run: upstream/... not fetched yet; fetch first to see the pick plan");
    }
  }
  if (rewriteOrigin) console.log("dry run: would allow an explicit origin history rewrite if required");
  process.exit(0);
}

// --- default report (fetch + counts) ---
if (!g(["-C", repoRoot, "fetch", "--prune", "upstream"]).ok) die("failed to fetch upstream", EXIT_GENERAL_ERROR);
if (!g(["-C", repoRoot, "show-ref", "--verify", "--quiet", upstreamRef]).ok) {
  die(`upstream branch '${config.upstreamBranch}' was not fetched`, EXIT_GENERAL_ERROR);
}
const baseSha = g(["-C", repoRoot, "merge-base", upstreamRef, "HEAD"]).out;
if (baseSha === "") {
  die("HEAD and upstream/... share no common history; check [fork] upstream_repo", EXIT_GENERAL_ERROR);
}

function collectChangeIds(range: string): Set<string> {
  const r = spawnSync("git", ["-C", repoRoot, "log", "--format=%B", range], { encoding: "utf8" });
  const ids = new Set<string>();
  for (const m of (r.stdout ?? "").matchAll(/^Change-Id: (.*)$/gm)) {
    const raw = (m[1] ?? "").trim();
    if (raw !== "") ids.add(raw);
  }
  return ids;
}

function knownByOtherRef(sha: string): boolean {
  return g(["-C", repoRoot, "for-each-ref", "--contains", sha, "--format=%(refname)", "refs/heads", "refs/tags", "refs/remotes/origin"]).out !== "";
}

// --- replay preconditions ---
if (replay) {
  const merges = g(["-C", repoRoot, "--no-pager", "log", "--merges", "--format=  %h %s", `${baseSha}..HEAD`]).out;
  if (merges !== "") {
    console.error("local history since the upstream merge-base contains merge commit(s); the sync only handles linear history");
    console.error("(the result must stay exportable by fork-export, which refuses merge-bearing ranges):");
    console.error(merges);
    console.error("Restructure the branch (e.g. rebase it yourself with --rebase-merges) before syncing.");
    process.exit(EXIT_MISUSE);
  }
}

// --- likely-mine reporting ---
let unrecognizedBehind = 0;
// Local commits upstream appears to already have (patch-equivalent via cherry,
// same Change-Id, or same subject on upstream).
{
  const upstreamSubjects = g(["-C", repoRoot, "log", "--format=%s", `${baseSha}..${upstreamRef}`]).out;
  const upstreamIds = collectChangeIds(`${baseSha}..${upstreamRef}`);
  let found = false;
  const cherryUp = g(["-C", repoRoot, "cherry", upstreamRef, "HEAD"]).out;
  for (const line of cherryUp.split("\n")) {
    if (line === "") continue;
    const status = line.slice(0, 1);
    const sha = line.slice(2);
    const subject = g(["-C", repoRoot, "log", "-1", "--format=%s", sha]).out;
    const id = changeIdGetFromCommit(repoRoot, sha) ?? "";
    if (status === "-" || (id !== "" && upstreamIds.has(id)) || upstreamSubjects.includes(subject)) {
      if (!found) {
        console.log("Local commits that look already upstream (patch-equivalent, same Change-Id, or the same subject on upstream):");
        found = true;
      }
      console.log(`  ${g(["-C", repoRoot, "rev-parse", "--short", sha]).out} ${subject}`);
    }
  }
  if (found) {
    console.log("  The replay drops these (and any twin) automatically; rework them by hand only if upstream is missing something.");
  }
}
// Upstream-only commits that look like your own work coming back (a squash-
// or rebase-merge of a local contribution). Unrecognized ones drive action-needed.
{
  const localSubjects = g(["-C", repoRoot, "log", "--format=%s", `${baseSha}..HEAD`]).out;
  const localIds = collectChangeIds(`${baseSha}..HEAD`);
  const cherry = g(["-C", repoRoot, "cherry", "HEAD", upstreamRef]).out;
  let found = false;
  for (const line of cherry.split("\n")) {
    if (line === "") continue;
    const status = line.slice(0, 1);
    const sha = line.slice(2);
    const subject = g(["-C", repoRoot, "log", "-1", "--format=%s", sha]).out;
    const id = changeIdGetFromCommit(repoRoot, sha) ?? "";
    const recognized = status === "-" || (id !== "" && localIds.has(id)) || localSubjects.includes(subject) || knownByOtherRef(sha);
    if (recognized) {
      if (!found) {
        console.log("Upstream commits that look like your own work (patch-equivalent, same Change-Id, same subject locally, or already reachable from a local branch/tag):");
        found = true;
      }
      console.log(`  ${g(["-C", repoRoot, "rev-parse", "--short", sha]).out} ${subject}`);
    } else {
      unrecognizedBehind++;
    }
  }
}

// Push requires an up-to-date branch: behind means replay first.
if (push && !replay) {
  const pushCounts = g(["-C", repoRoot, "rev-list", "--left-right", "--count", `${upstreamRef}...HEAD`]).out.split(/\s+/);
  const pushBehind = Number(pushCounts[0] ?? 0);
  if (pushBehind !== 0) die("branch is behind upstream; pass --replay before --push-to-origin", EXIT_MISUSE);
}

let plan: PickPlan | null = null;
if (replay) {
  plan = buildPickPlan(baseSha);
  if (dryRun) {
    console.log("dry run: would fetch upstream and compare HEAD with upstream/...");
    console.log("dry run: would apply upstream's new commits onto the branch (local history unchanged)");
    printPickPlan(plan);
    printSurfaceForecast(plan);
    console.log(`dry run: would apply ${plan.pickCount} new upstream commit(s), skip ${plan.dropCount} already present.`);
    process.exit(0);
  }
}

// --- snapshot + apply (real replay) ---
if (replay && !dryRun) {
  let snapshotted = false;
  let snapshotPaths: string[] = [];
  if (surfacesValidate().length === 0) {
    snapshotPaths = surfacesList().map((s) => s.glob);
    if (snapshotPaths.length > 0) {
      const snapshotIndex = join(tmpdir(), `fork-sync-snapidx.${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
      const idx = (file: string): string[] => ["--no-pager", "-c", `GIT_INDEX_FILE=${file}`];
      void idx;
      const readTree = spawnSync("git", ["-C", repoRoot, "read-tree", "HEAD"], {
        env: { ...process.env, GIT_INDEX_FILE: snapshotIndex },
      });
      void readTree;
      const add = spawnSync("git", ["-C", repoRoot, "add", "-A", "--", ...snapshotPaths], {
        env: { ...process.env, GIT_INDEX_FILE: snapshotIndex },
        stdio: "ignore",
      });
      if (add.status !== 0) {
        console.error("WARNING: could not stage some fork-owned paths; the snapshot may be incomplete");
      }
      const tree = spawnSync("git", ["-C", repoRoot, "write-tree"], {
        env: { ...process.env, GIT_INDEX_FILE: snapshotIndex },
        encoding: "utf8",
      });
      const snapshotTree = (tree.stdout ?? "").trim();
      if (snapshotTree !== "") {
        const commit = spawnSync("git", ["-C", repoRoot, "commit-tree", snapshotTree, "-p", "HEAD", "-m", "fork-sync: pre-sync snapshot of fork-owned surfaces"], { encoding: "utf8" });
        const snapshotCommit = (commit.stdout ?? "").trim();
        g(["-C", repoRoot, "update-ref", "-m", "fork-sync: pre-sync snapshot", "refs/fork-sync/snapshot", snapshotCommit]);
        console.log(`Snapshot of fork-owned surfaces: ${snapshotCommit} (refs/fork-sync/snapshot)`);
        snapshotted = true;
      }
      rmSync(snapshotIndex, { force: true, recursive: true });
    }
  }

  const upstreamClone0 = process.env.FORK_UPSTREAM_CLONE || discoverUpstreamClone() || repoRoot;
  const plan0 = plan as PickPlan;
  if (plan0.pickCount === 0) {
    console.log(`Nothing to apply from upstream/${config.upstreamBranch} (skipped ${plan0.dropCount} already-present commit(s)).`);
  } else if (plan0.dropCount === 0 && g(["-C", repoRoot, "rev-list", "--count", `${baseSha}..HEAD`]).out === "0") {
    if (!g(["-C", repoRoot, "merge", "--ff-only", upstreamRef]).ok) {
      pickConflictGuidance(plan0);
      process.exit(EXIT_GENERAL_ERROR);
    }
    console.log(`No local commits; fast-forwarded to upstream/${config.upstreamBranch}.`);
  } else {
    if (plan0.residueCount > 0) {
      console.log("Divergence on skipped commit(s) — your local copy kept:");
      for (const l of plan0.residueLines) console.log(l);
    }
    printPickPlan(plan0);
    printSurfaceForecast(plan0);
    if (!yes) {
      if (process.stdin.isTTY !== true) die("non-TTY --replay requires --yes", EXIT_MISUSE);
      process.stdout.write(`Apply ${plan0.pickCount} upstream commit(s) onto ${currentBranch}? [y/N] `);
      const r = spawnSync("bash", ["-c", 'read -r a < /dev/tty || true; printf "%s" "$a"'], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
      if (!/^[Yy]/.test((r.stdout ?? "").trim())) {
        console.log("Apply cancelled.");
        process.exit(0);
      }
    }
    let failed = false;
    for (const row of plan0.rows) {
      if (row.verdict !== PICK_VERDICT_PICK) continue;
      const pick = spawnSync("git", ["-C", repoRoot, "cherry-pick", row.sha], { stdio: "ignore" });
      if (pick.status !== 0) {
        console.error(`Conflict while applying ${row.sha}.`);
        pickConflictGuidance(plan0);
        failed = true;
        break;
      }
      const newHead = g(["-C", repoRoot, "rev-parse", "HEAD"]).out;
      if (!mapAdd(repoRoot, newHead, row.sha, "fork-sync auto-record", upstreamClone0)) {
        console.error(`WARNING: could not record adoption link for ${row.sha} — the next sync may re-apply it`);
      }
    }
    if (failed) process.exit(EXIT_GENERAL_ERROR);
    console.log(`Applied ${plan0.pickCount} upstream commit(s) onto ${currentBranch} (skipped ${plan0.dropCount} already present).`);
  }

  if (snapshotted) {
    const globs = surfacesList().map((s) => s.glob);
    const changed = g(["-C", repoRoot, "diff", "--name-only", "refs/fork-sync/snapshot", "HEAD", "--", ...globs]).out;
    if (changed !== "") {
      console.log("Fork-owned paths touched by the applied work:");
      for (const p of changed.split("\n")) if (p !== "") console.log(`  ${p}`);
      console.log("  Review before continuing: diff with");
      console.log(`    git -C ${repoRoot} diff refs/fork-sync/snapshot HEAD -- ${snapshotPaths.join(" ")}`);
      console.log("  The pre-sync state remains at refs/fork-sync/snapshot.");
    } else {
      console.log("Fork-owned surfaces verified: untouched by the applied work.");
    }
  }
  console.log(`Synced upstream/${config.upstreamBranch} onto ${currentBranch} — local history unchanged.`);
}

// --- final report ---
const counts = g(["-C", repoRoot, "rev-list", "--left-right", "--count", `${upstreamRef}...HEAD`]).out.split(/\s+/);
const behind = Number(counts[0] ?? 0);
const ahead = Number(counts[1] ?? 0);
console.log(`Upstream: upstream/${config.upstreamBranch}`);
console.log(`Current: ${currentBranch}`);
console.log(`Behind: ${behind}`);
console.log(`Ahead: ${ahead}`);
if (behind === 0 && ahead === 0) {
  console.log("No divergent commits. Up to date -- nothing to sync.");
} else {
  console.log("Divergent commits (< upstream-only, > local-only):");
  spawnSync("git", ["-C", repoRoot, "--no-pager", "log", "--oneline", "--left-right", "--no-color", `${upstreamRef}...HEAD`], { stdio: "inherit" });
  if (behind === 0) {
    console.log("No action needed: local-only commits, nothing to pull from upstream.");
  } else if (unrecognizedBehind > 0) {
    console.log(`Action needed: upstream has ${unrecognizedBehind} commit(s) that don't look like your own work -- run 'fork-sync --replay' to sync.`);
  } else {
    console.log(`No urgent action needed: all ${behind} upstream-only commit(s) look like your own contributions coming back. 'fork-sync --replay' still replays genuinely fork-only commits on top of upstream's tip (twins are dropped).`);
  }
}

// --- push ---
if (push) {
  if (currentBranch === "HEAD") die("cannot push while HEAD is detached", EXIT_GENERAL_ERROR);
  const originUrl = g(["-C", repoRoot, "remote", "get-url", "origin"]).out;
  if (originUrl === "") die("origin remote is missing", EXIT_GENERAL_ERROR);
  const upstreamDestination = normalizeGitUrl(config.upstreamRepo);
  const pushUrls = g(["-C", repoRoot, "remote", "get-url", "--push", "--all", "origin"]).out.split("\n").filter((u) => u !== "");
  for (const u of pushUrls) {
    if (normalizeGitUrl(u) === upstreamDestination) {
      die("origin push destination matches configured upstream; refusing to push", EXIT_MISUSE);
    }
  }
  if (!g(["-C", repoRoot, "fetch", "--prune", "origin"]).ok) die("failed to fetch origin", EXIT_GENERAL_ERROR);
  const originRef = `refs/remotes/origin/${currentBranch}`;
  if (!g(["-C", repoRoot, "show-ref", "--verify", "--quiet", originRef]).ok) {
    die(`origin branch '${currentBranch}' was not fetched; cannot establish a push lease`, EXIT_GENERAL_ERROR);
  }
  const originExpected = g(["-C", repoRoot, "rev-parse", originRef]).out;
  const originCounts = g(["-C", repoRoot, "rev-list", "--left-right", "--count", `${originExpected}...HEAD`]).out.split(/\s+/);
  const originAhead = Number(originCounts[0] ?? 0);
  const localAhead = Number(originCounts[1] ?? 0);
  console.log(`Origin: origin/${currentBranch}`);
  console.log(`Origin ahead: ${originAhead}`);
  console.log(`Local ahead of origin: ${localAhead}`);
  if (originAhead > 0) {
    console.log("Origin-only commits (< origin-only, > local-only):");
    spawnSync("git", ["-C", repoRoot, "--no-pager", "log", "--oneline", "--left-right", "--no-color", `${originExpected}...HEAD`], { stdio: "inherit" });
    if (!rewriteOrigin) die("origin contains commits absent locally; use --rewrite-origin with --push-to-origin to replace them", EXIT_MISUSE);
    console.log(`WARNING: --rewrite-origin will replace origin-only commits on origin/${currentBranch}.`);
  }
  if (localAhead === 0) {
    console.log("No push needed; origin already contains the current branch.");
    process.exit(0);
  }
  if (!yes) {
    process.stdout.write(originAhead > 0
      ? `Replace origin-only commits on origin/${currentBranch}? [y/N] `
      : "Proceed with push? [y/N] ");
    const r = spawnSync("bash", ["-c", 'read -r a < /dev/tty || true; printf "%s" "$a"'], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    if (!/^[Yy]/.test((r.stdout ?? "").trim())) {
      console.log("Push cancelled.");
      process.exit(0);
    }
  }
  if (originAhead > 0) {
    if (!g(["-C", repoRoot, "push", `--force-with-lease=refs/heads/${currentBranch}:${originExpected}`, "origin", `HEAD:refs/heads/${currentBranch}`]).ok) {
      die(`lease-protected rewrite of origin/${currentBranch} failed`, EXIT_GENERAL_ERROR);
    }
    console.log(`Rewrote origin/${currentBranch} with --force-with-lease`);
  } else {
    if (!g(["-C", repoRoot, "push", "origin", `HEAD:refs/heads/${currentBranch}`]).ok) {
      die(`fast-forward push to origin/${currentBranch} failed`, EXIT_GENERAL_ERROR);
    }
    console.log(`Pushed current branch to origin/${currentBranch}`);
  }
}

function mapLookupLocalSafe(mapPath: string, repo: string, sha: string): string {
  return mapLookupLocal(mapPath, repo, sha);
}
