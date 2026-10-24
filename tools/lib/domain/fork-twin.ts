// fork-twin.ts — divergent-commit classification between the fork and
// upstream (port of fork-twin.bash): patch-ids, Change-Id matching, the
// adoption map, and the pick-range classifier.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { changeIdGetFromCommit } from "../core/change-id.ts";

export const ADOPTION_MAP_FILE_NAME = "fork-adoption-map";
export const PICK_VERDICT_PICK = "pick";
export const PICK_VERDICT_DROP = "drop";

export function gitIn(repo: string, args: string[]): { out: string; ok: boolean } {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return { out: (r.stdout ?? "").trim(), ok: r.status === 0 };
}

/** git patch-id --stable of one commit's diff (empty when it cannot be computed). */
export function patchId(repo: string, commit: string): string {
  const show = spawnSync("git", ["-C", repo, "show", commit], { encoding: "utf8" });
  if (show.status !== 0) return "";
  const pid = spawnSync("git", ["patch-id", "--stable"], { input: show.stdout, encoding: "utf8" });
  return (pid.stdout ?? "").split(" ")[0] ?? "";
}

/** Patch-ids equal (computed with the upstream repo's objects as alternates). */
export function patchesIdentical(localRepo: string, upstreamRepo: string, localSha: string, upstreamSha: string): boolean {
  const objects = gitIn(upstreamRepo, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]).out;
  const env = { ...process.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: objects };
  const a = spawnSync("git", ["-C", localRepo, "show", localSha], { encoding: "utf8", env });
  const pa = spawnSync("git", ["patch-id", "--stable"], { input: a.stdout, encoding: "utf8" });
  const b = spawnSync("git", ["-C", localRepo, "show", upstreamSha], { encoding: "utf8", env });
  const pb = spawnSync("git", ["patch-id", "--stable"], { input: b.stdout, encoding: "utf8" });
  const va = (pa.stdout ?? "").split(" ")[0] ?? "";
  const vb = (pb.stdout ?? "").split(" ")[0] ?? "";
  return va !== "" && va === vb;
}

/** The adoption-map path: one file in the git common dir. */
export function mapGetPath(repo: string): string | null {
  const common = gitIn(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).out;
  return common === "" ? null : join(common, ADOPTION_MAP_FILE_NAME);
}

export function mapLookupUpstream(mapPath: string, upstreamRepo: string, upstreamSha: string): string {
  const full = gitIn(upstreamRepo, ["rev-parse", "--verify", "--quiet", `${upstreamSha}^{commit}`]).out;
  if (full === "") return "";
  try {
    for (const line of readFileSync(mapPath, "utf8").split("\n")) {
      const [local = "", up = ""] = line.split(" ");
      if (up === full) return local as string;
    }
  } catch { /* no map */ }
  return "";
}

export function mapLookupLocal(mapPath: string, localRepo: string, localSha: string): string {
  const full = gitIn(localRepo, ["rev-parse", "--verify", "--quiet", `${localSha}^{commit}`]).out;
  if (full === "") return "";
  try {
    for (const line of readFileSync(mapPath, "utf8").split("\n")) {
      const [local = "", up = ""] = line.split(" ");
      if (local === full) return up as string;
    }
  } catch { /* no map */ }
  return "";
}

/** Record one adoption pair (localSha <-> upstreamSha). The local sha
 * resolves in `repo`, the upstream sha in `upstreamRepo` (its object store is
 * the only place it exists). Returns false when either cannot resolve. */
export function mapAdd(repo: string, localSha: string, upstreamSha: string, note: string, upstreamRepo?: string): boolean {
  const path = mapGetPath(repo);
  if (path === null) return false;
  const lFull = gitIn(repo, ["rev-parse", "--verify", "--quiet", `${localSha}^{commit}`]).out;
  const uRepo = upstreamRepo ?? process.env.FORK_TWIN_UPSTREAM_REPO ?? repo;
  const uFull = gitIn(uRepo, ["rev-parse", "--verify", "--quiet", `${upstreamSha}^{commit}`]).out;
  if (lFull === "" || uFull === "") return false;
  let existing = "";
  try {
    existing = readFileSync(path, "utf8");
    if (existing.split("\n").some((line) => line.startsWith(`${lFull} ${uFull}`))) return true;
  } catch { /* new map */ }
  const cleanNote = note.replaceAll("\n", " ");
  const entry = `${lFull} ${uFull}${cleanNote ? ` # ${cleanNote}` : ""}\n`;
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, existing + entry);
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/** Remove every entry naming the value (local or upstream sha/change-id-ish). */
export function mapRemove(repo: string, value: string): boolean {
  const path = mapGetPath(repo);
  if (path === null || !existsSync(path)) return false;
  const lines = readFileSync(path, "utf8").split("\n");
  const kept: string[] = [];
  let removed = 0;
  for (const line of lines) {
    if (line === "") continue;
    if (line.includes(value)) { removed++; continue; }
    kept.push(line);
  }
  if (removed === 0) return false;
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${kept.join("\n")}\n`);
  renameSync(tmp, path);
  return true;
}

export interface PickRow { sha: string; verdict: string; signal: string }

/**
 * Classify upstream_range's commits against local_range's signals:
 * 1. Change-Id intersection · 2. recorded adoption link · 3. patch-id.
 * Emits one row per upstream commit, oldest first.
 */
export function classifyPickRange(
  localRepo: string, upstreamRepo: string, upstreamFrom: string, upstreamTo: string,
  localFrom: string, localTo: string,
): PickRow[] {
  // Local signals: Change-Id index + patch-id set.
  const localShas = gitIn(localRepo, ["rev-list", localTo, "--not", localFrom]).out.split("\n").filter((s) => s !== "");
  const idIndex = new Map<string, string>();
  const localPatchIds = new Set<string>();
  for (const sha of localShas) {
    const id = changeIdGetFromCommit(localRepo, sha);
    if (id) idIndex.set(id, sha);
    const pid = patchId(localRepo, sha);
    if (pid !== "") localPatchIds.add(pid);
  }
  const mapPath = mapGetPath(localRepo);

  // Endpoints resolve in the CALLER's repo (the upstream clone shares
  // upstream's objects but may lack the caller's remote-tracking refs).
  const uFrom = gitIn(localRepo, ["rev-parse", upstreamFrom]).out;
  const uTo = gitIn(localRepo, ["rev-parse", upstreamTo]).out;
  if (uFrom === "" || uTo === "") return [];
  const uShas = gitIn(upstreamRepo, ["rev-list", "--reverse", uTo, "--not", uFrom]).out.split("\n").filter((s) => s !== "");
  const rows: PickRow[] = [];
  for (const uSha of uShas) {
    let verdict = PICK_VERDICT_PICK;
    let signal = "";
    const uId = changeIdGetFromCommit(upstreamRepo, uSha);
    if (uId && idIndex.has(uId)) {
      verdict = PICK_VERDICT_DROP;
      signal = "change-id";
    }
    if (verdict === PICK_VERDICT_PICK && mapPath !== null && existsSync(mapPath)) {
      if (mapLookupUpstream(mapPath, upstreamRepo, uSha) !== "") {
        verdict = PICK_VERDICT_DROP;
        signal = "adoption-link";
      }
    }
    if (verdict === PICK_VERDICT_PICK) {
      const pid = patchId(upstreamRepo, uSha);
      if (pid !== "" && localPatchIds.has(pid)) {
        verdict = PICK_VERDICT_DROP;
        signal = "patch-id";
      }
    }
    rows.push({ sha: uSha, verdict, signal });
  }
  return rows;
}

/** Ranked adoption candidates: subject/author-date/file-set scoring. */
export function mapPropose(localRepo: string, upstreamRepo: string, localRange: string, upstreamRange: string): string {
  const lines: string[] = [];
  const localShas = gitIn(localRepo, ["rev-list", localRange]).out.split("\n").filter((s) => s !== "");
  const upstreamLog = gitIn(upstreamRepo, ["log", "--format=%H %s", upstreamRange]).out.split("\n").filter((l) => l !== "");
  for (const sha of localShas) {
    if (changeIdGetFromCommit(localRepo, sha) !== null) continue;
    const lSubject = gitIn(localRepo, ["log", "-1", "--format=%s", sha]).out;
    const lDate = gitIn(localRepo, ["log", "-1", "--format=%ad", sha]).out;
    const lFiles = gitIn(localRepo, ["show", "--name-only", "--format=", sha]).out.split("\n").sort().join(" ");
    for (const uLine of upstreamLog) {
      const uSha = uLine.split(" ")[0] ?? "";
      const uSubject = uLine.slice((uSha as string).length + 1);
      let score = 0;
      if (uSubject === lSubject) score++;
      const uDate = gitIn(upstreamRepo, ["log", "-1", "--format=%ad", uSha as string]).out;
      if (uDate === lDate) score++;
      const uFiles = gitIn(upstreamRepo, ["show", "--name-only", "--format=", uSha as string]).out.split("\n").sort().join(" ");
      if (uFiles === lFiles) score++;
      if (score > 0) lines.push(`${score} ${sha} ${uSha} ${lSubject}`);
    }
  }
  return lines.join("\n");
}
