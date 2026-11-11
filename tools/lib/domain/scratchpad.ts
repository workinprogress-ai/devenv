// scratchpad.ts — governed experiment sandbox state (port of scratchpad.bash).
// Refs: base (entry HEAD), state (scratch tip), origin-branch (symbolic ref to
// the working branch at entry). Destructive surface only touches scratch
// content; entry is fail-closed on a dirty tree.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const SCRATCHPAD_BRANCH_PREFIX = "scratchpad/";
export const SCRATCHPAD_BASE_REF = "refs/scratchpad/base";
export const SCRATCHPAD_STATE_REF = "refs/scratchpad/state";
export const SCRATCHPAD_ORIGIN_REF = "refs/scratchpad/origin-branch";

export function git(args: string[]): { out: string; ok: boolean } {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { out: (r.stdout ?? "").trim(), ok: r.status === 0 };
}

export function validateSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,38}$/.test(slug) && !slug.includes("..");
}

export function workingBranch(): string {
  return git(["symbolic-ref", "--quiet", "--short", "HEAD"]).out;
}

export function isActive(): boolean {
  return git(["show-ref", "--verify", "--quiet", SCRATCHPAD_STATE_REF]).ok;
}

/** True while a real bisect session exists. Git records one in the
 * `BISECT_START` file of the git dir (and `refs/bisect/bad` once a bad commit
 * is marked); it never creates a `refs/bisect/start` ref. */
export function bisectInFlight(): boolean {
  const startFile = git(["rev-parse", "--git-path", "BISECT_START"]);
  if (startFile.ok && startFile.out !== "" && existsSync(resolve(startFile.out))) return true;
  return git(["show-ref", "--verify", "--quiet", "refs/bisect/bad"]).ok;
}

export function onScratchBranch(): boolean {
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]).out;
  return branch !== "" && branch.startsWith(SCRATCHPAD_BRANCH_PREFIX);
}

/** True only when HEAD is on the scratchpad branch the state refs name. The
 * prefix test above also accepts any stale `scratchpad/*` branch, so every
 * destructive operation (reset --hard, clean) requires this stricter check. */
export function onActiveScratchBranch(): boolean {
  const current = workingBranch();
  return current !== "" && current === activeBranch();
}

export function isDirty(): boolean {
  return git(["status", "--porcelain"]).out !== "";
}

/** Active scratch branch: state-ref tip match first, then a unique-prefix
 * match (seed/self-heal route). Empty when ambiguous or none. */
export function activeBranch(): string {
  const matches = git(["for-each-ref", "--format=%(refname:short)", `refs/heads/${SCRATCHPAD_BRANCH_PREFIX}`]).out;
  if (matches === "") return "";
  if (git(["show-ref", "--verify", "--quiet", SCRATCHPAD_STATE_REF]).ok) {
    const stateTip = git(["rev-parse", "--verify", SCRATCHPAD_STATE_REF]).out;
    for (const line of git(["for-each-ref", "--format=%(refname:short) %(objectname)", `refs/heads/${SCRATCHPAD_BRANCH_PREFIX}`]).out.split("\n")) {
      const [name = "", tip = ""] = line.split(" ");
      if (tip === stateTip) return name as string;
    }
  }
  const list = matches.split("\n").filter((l) => l !== "");
  return list.length === 1 ? list[0] as string : "";
}

export function baseCommit(): string {
  return git(["rev-parse", "--verify", `${SCRATCHPAD_BASE_REF}^{commit}`]).out;
}

export function originBranch(): string {
  const r = git(["symbolic-ref", "--quiet", SCRATCHPAD_ORIGIN_REF]);
  return r.ok ? r.out.replace("refs/heads/", "") : "";
}

export type RecordResult = { ok: true } | { ok: false; reason: "concurrent" | "failed"; detail: string };

/** Create the base/state/origin refs atomically enough: the branch tip is
 * verified BEFORE any ref is written, and a failure after the base ref was
 * created removes it again, so a half-written activation never wedges later
 * `enter` calls. A "concurrent" result means another activation owns the refs
 * (they are left untouched). */
export function recordState(slug: string, base: string, branch: string, origin: string): RecordResult {
  const absent = "0000000000000000000000000000000000000000";
  const tip = git(["rev-parse", "--verify", `refs/heads/${branch}`]).out;
  if (tip === "") return { ok: false, reason: "failed", detail: `branch tip of ${branch} is missing` };
  if (!git(["update-ref", SCRATCHPAD_BASE_REF, base, absent]).ok) {
    return { ok: false, reason: "concurrent", detail: "base ref already exists" };
  }
  const rollback = (): void => {
    git(["update-ref", "-d", SCRATCHPAD_STATE_REF]);
    git(["update-ref", "-d", "--no-deref", SCRATCHPAD_ORIGIN_REF]);
    git(["update-ref", "-d", SCRATCHPAD_BASE_REF]);
  };
  if (!git(["update-ref", SCRATCHPAD_STATE_REF, tip]).ok) {
    rollback();
    return { ok: false, reason: "failed", detail: "could not write the state ref" };
  }
  const originWritten = origin !== ""
    ? git(["symbolic-ref", SCRATCHPAD_ORIGIN_REF, `refs/heads/${origin}`]).ok
    : (git(["update-ref", "-d", "--no-deref", SCRATCHPAD_ORIGIN_REF]), true);
  if (!originWritten) {
    rollback();
    return { ok: false, reason: "failed", detail: "could not write the origin-branch ref" };
  }
  void slug;
  return { ok: true };
}

export function syncStateRef(): void {
  const branch = activeBranch();
  if (branch === "") return;
  const tip = git(["rev-parse", "--verify", `refs/heads/${branch}`]).out;
  if (tip === "") return;
  git(["update-ref", SCRATCHPAD_STATE_REF, tip]);
}

export function returnToBase(): void {
  const r = returnToBaseChecked();
  if (!r.ok) {
    // A failed checkout must be reported: proceeding silently would let a later reset run on the wrong branch.
    console.error(`returnToBase failed: ${r.error}`);
  }
}

/** returnToBase with an honest result: {ok} plus the named error. The
 * destructive callers (promote/exit) MUST check it before mutating further —
 * a cherry-pick or branch -D on the wrong branch drops scratch commits. */
export function returnToBaseChecked(): { ok: boolean; error?: string } {
  const base = baseCommit();
  const origin = originBranch();
  let r: { out: string; ok: boolean };
  if (origin !== "" && git(["show-ref", "--verify", "--quiet", `refs/heads/${origin}`]).ok) {
    r = git(["checkout", "-q", origin]);
    if (!r.ok) return { ok: false, error: `checkout ${origin} failed` };
    console.log(`Returned to branch ${origin}`);
    return { ok: true };
  }
  r = git(["checkout", "-q", base]);
  if (!r.ok) return { ok: false, error: `checkout ${base.slice(0, 7)} failed (dirty tree?)` };
  console.log(`Returned to base commit ${base.slice(0, 7)} (detached — entry was from a detached HEAD)`);
  return { ok: true };
}

/** The origin ref is symbolic: without --no-deref, deleting it deletes the
 * branch it points at (the user's own working branch). */
export function clearState(): void {
  git(["update-ref", "-d", SCRATCHPAD_BASE_REF]);
  git(["update-ref", "-d", SCRATCHPAD_STATE_REF]);
  git(["update-ref", "-d", "--no-deref", SCRATCHPAD_ORIGIN_REF]);
}

let carrySeq = 0;

/** Snapshot dirty state into .local-artifacts/tmp/scratchpad/ before reset can
 * destroy it: a binary-safe patch of tracked changes plus a copy of every
 * untracked file, under a name unique to this call (an earlier snapshot is
 * never overwritten). Returns false when the record could not be fully written. */
export function snapshotCarry(slug: string): boolean {
  const top = git(["rev-parse", "--show-toplevel"]).out;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  carrySeq += 1;
  const unique = `${stamp}-${process.pid}-${carrySeq}`;
  const carryDir = join(top, ".local-artifacts", "tmp", "scratchpad");
  const patch = join(carryDir, `${slug}-carry-${unique}.patch`);
  const untrackedDir = join(carryDir, `${slug}-carry-${unique}-untracked`);
  try {
    mkdirSync(carryDir, { recursive: true });
  } catch {
    console.error("⚠️  WARNING: could not create carry-snapshot dir — carried work has NO salvage record.");
    return false;
  }
  const diff = spawnSync(
    "git",
    ["diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv", "--no-color", "--src-prefix=a/", "--dst-prefix=b/"],
    { cwd: top, maxBuffer: 1 << 30 },
  );
  if (diff.status !== 0) {
    console.error("⚠️  WARNING: could not diff the dirty tree — carried work has NO salvage record.");
    return false;
  }
  const list = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: top, encoding: "utf8", maxBuffer: 1 << 30 });
  if (list.status !== 0) {
    console.error("⚠️  WARNING: could not list untracked files — carried work has NO salvage record.");
    return false;
  }
  const untracked = (list.stdout ?? "").split("\0").filter((f) => f !== "" && !f.startsWith(".local-artifacts/"));
  try {
    writeFileSync(patch, Buffer.concat([
      Buffer.from(`# scratchpad carry snapshot — ${stamp}\n# WARNING: scratchpad reset will DESTROY carried work.\n# Apply with: git apply <this file>; untracked files are copied beside it.\n`),
      diff.stdout as Buffer,
    ]));
    for (const rel of untracked) {
      const dest = join(untrackedDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(top, rel), dest);
    }
  } catch {
    console.error(`⚠️  WARNING: carry-snapshot write FAILED ('${patch}') — carried work has NO salvage record.`);
    return false;
  }
  console.log(`Carry snapshot: ${patch}`);
  if (untracked.length > 0) console.log(`Carry snapshot (untracked files): ${untrackedDir}`);
  return true;
}
