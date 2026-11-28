// domain/cs/merged-commit.ts — which commit the dependency wizard waits on
// after merging a repository's update.
//
// The single-repo wizard merges through the provider and then pulls, ignoring
// a failed pull. The clone's HEAD can therefore still be the pre-merge tip,
// whose earlier successful build would pass the wait. The merged commit is
// read from the remote branch after an explicit fetch instead.

import { spawnSync } from "node:child_process";

/** The tip of `branch` (the repository's default branch) on `origin`, fetched
 * now; "" when it cannot be fetched or resolved. After a merge this is the
 * merged commit, or a later commit that contains it. */
export function mergedTip(dir: string, branch: string): string {
  const fetched = spawnSync("git", ["-C", dir, "fetch", "--quiet", "origin", branch], { encoding: "utf8" });
  if (fetched.status !== 0) return "";
  const tip = spawnSync("git", ["-C", dir, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], { encoding: "utf8" });
  return tip.status === 0 ? (tip.stdout ?? "").trim() : "";
}

/** Single-repo wizard exits after which the user is asked to finish the merge
 * by hand: PR creation failed (40), PR merge failed (41). */
const MERGE_HANDED_TO_USER = new Set([40, 41]);

/** Single-repo wizard exit that leaves the update branch and its uncommitted
 * working tree in place: the tests (or the commit hooks) still fail after the
 * wizard's one in-prompt retry (30). */
const LEFT_BRANCH_TO_RESUME = 30;

/** Whether the last attempt left a half-done update a retry must resume with
 * `--continue`. A fresh run would stop at the uncommitted-changes guard (or
 * discard the user's fixes); the other failures delete the update branch, so
 * a fresh run is the right retry for them. */
export function resumesPausedRepo(exitCodes: number[]): boolean {
  return exitCodes[exitCodes.length - 1] === LEFT_BRANCH_TO_RESUME;
}

/** Whether the last attempt handed the merge to the user (who may have
 * finished it by hand since). */
export function mergeHandedToUser(exitCodes: number[]): boolean {
  const last = exitCodes[exitCodes.length - 1];
  return last !== undefined && MERGE_HANDED_TO_USER.has(last);
}

/** Whether a repository's attempts ended in a merge: the last attempt merged
 * (exit 0), or it found nothing left to change (exit 10) after an earlier
 * attempt handed the merge to the user — the user merged it by hand. */
export function attemptsMerged(exitCodes: number[]): boolean {
  const last = exitCodes[exitCodes.length - 1];
  if (last === 0) return true;
  if (last === 10) return exitCodes.slice(0, -1).some((code) => MERGE_HANDED_TO_USER.has(code));
  return false;
}

/** What the wait after level `idx` of `depths` guards. Every level is awaited,
 * the last one included: a filtered wave (only libraries, say) is followed by a
 * later wave that consumes what its last level publishes. */
export function levelWaitPurpose(idx: number, depths: number[]): string {
  const next = depths[idx + 1];
  return next === undefined ? "before finishing" : `before processing generation ${next}`;
}
