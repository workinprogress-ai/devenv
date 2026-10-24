// scratchpad.ts — governed experiment sandbox state (port of scratchpad.bash).
// Refs: base (entry HEAD), state (scratch tip), origin-branch (symbolic ref to
// the working branch at entry). Destructive surface only touches scratch
// content; entry is fail-closed on a dirty tree.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

export function bisectInFlight(): boolean {
  return git(["show-ref", "--verify", "--quiet", "refs/bisect/start"]).ok;
}

export function onScratchBranch(): boolean {
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]).out;
  return branch !== "" && branch.startsWith(SCRATCHPAD_BRANCH_PREFIX);
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

/** Create the base/state/origin refs. Fails (false) on concurrent activation. */
export function recordState(slug: string, base: string, branch: string, origin: string): boolean {
  const absent = "0000000000000000000000000000000000000000";
  if (!git(["update-ref", SCRATCHPAD_BASE_REF, base, absent]).ok) return false;
  const tip = git(["rev-parse", "--verify", `refs/heads/${branch}`]).out;
  if (tip === "") return false;
  git(["update-ref", SCRATCHPAD_STATE_REF, tip]);
  if (origin !== "") {
    git(["symbolic-ref", SCRATCHPAD_ORIGIN_REF, `refs/heads/${origin}`]);
  } else {
    git(["update-ref", "-d", SCRATCHPAD_ORIGIN_REF]);
  }
  void slug;
  return true;
}

export function syncStateRef(): void {
  const branch = activeBranch();
  if (branch === "") return;
  const tip = git(["rev-parse", "--verify", `refs/heads/${branch}`]).out;
  if (tip === "") return;
  git(["update-ref", SCRATCHPAD_STATE_REF, tip]);
}

export function returnToBase(): void {
  const base = baseCommit();
  const origin = originBranch();
  if (origin !== "" && git(["show-ref", "--verify", "--quiet", `refs/heads/${origin}`]).ok) {
    git(["checkout", "-q", origin]);
    console.log(`Returned to branch ${origin}`);
  } else {
    git(["checkout", "-q", base]);
    console.log(`Returned to base commit ${base.slice(0, 7)} (detached — entry was from a detached HEAD)`);
  }
}

export function clearState(): void {
  git(["update-ref", "-d", SCRATCHPAD_BASE_REF]);
  git(["update-ref", "-d", SCRATCHPAD_STATE_REF]);
  git(["update-ref", "-d", SCRATCHPAD_ORIGIN_REF]);
}

/** Best-effort snapshot of dirty state into .local-artifacts/tmp/scratchpad/. */
export function snapshotCarry(slug: string): boolean {
  const carryDir = join(git(["rev-parse", "--show-toplevel"]).out, ".local-artifacts", "tmp", "scratchpad");
  try {
    mkdirSync(carryDir, { recursive: true });
  } catch {
    console.error("⚠️  WARNING: could not create carry-snapshot dir — carried work has NO salvage record.");
    return false;
  }
  const patch = join(carryDir, `${slug}-carry.patch`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const diff = git(["diff", "HEAD"]).out;
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).out;
  try {
    writeFileSync(patch, [
      `# scratchpad carry snapshot — ${now}`,
      "# WARNING: scratchpad reset will DESTROY carried work.",
      diff,
      "",
      "# Untracked files (contents NOT captured — list only):",
      untracked,
    ].join("\n"));
  } catch {
    console.error(`⚠️  WARNING: carry-snapshot write FAILED ('${patch}') — carried work has NO salvage record.`);
    return false;
  }
  console.log(`Carry snapshot: ${patch}`);
  return true;
}
