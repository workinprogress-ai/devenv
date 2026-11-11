// protected-branch.ts — the one definition of "protected branch" shared by the
// tools that publish or rewrite remote history (git-wip, git-unwip): the
// remote's default branch (when origin/HEAD is known), master, main, develop,
// trunk, and release/*.

import { branchMatchesPattern, getDefaultBranch, gitCheck } from "./git.ts";

export const PROTECTED_BRANCH_PATTERNS: readonly string[] = ["master", "main", "develop", "trunk", "release/*"];

/** Whether a branch name is protected. `branch` is a plain branch name (no
 * `refs/heads/` or remote prefix). */
export function isProtectedBranch(branch: string, defaultBranch: string | null = getDefaultBranch()): boolean {
  if (branch === "" || branch === "HEAD") return false;
  if (defaultBranch !== null && defaultBranch !== "" && branch === defaultBranch) return true;
  return PROTECTED_BRANCH_PATTERNS.some((p) => branchMatchesPattern(branch, p));
}

/** Why a remote branch is tied to a local branch: `upstream` is its configured
 * tracking branch (`branch.<name>.merge`), `push` is where a push would land
 * (`@{push}`, which honours push.default, remote.<name>.push and pushRemote). */
export type PushTargetSource = "upstream" | "push";

export interface PushTarget {
  ref: string;
  source: PushTargetSource;
  /** The remote the target lives on, when it could be resolved. */
  remote?: string;
}

/** The remote branches a local branch tracks or would be published to.
 * Empty when neither is configured. */
export function configuredPushTargets(branch: string): PushTarget[] {
  const targets: PushTarget[] = [];
  const merge = gitCheck(null, ["config", "--get", `branch.${branch}.merge`]);
  if (merge.ok && merge.out.trim() !== "") {
    targets.push({ ref: merge.out.trim().replace(/^refs\/heads\//, ""), source: "upstream" });
  }

  const pushRef = gitCheck(null, ["rev-parse", "--abbrev-ref", `${branch}@{push}`]);
  if (pushRef.ok && pushRef.out.trim() !== "") {
    const abbrev = pushRef.out.trim();
    const remotes = gitCheck(null, ["remote"]).out.split("\n").map((r) => r.trim()).filter((r) => r !== "");
    // Longest remote name first: a remote may itself contain a slash.
    const remote = remotes.filter((r) => abbrev.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
    targets.push({
      ref: remote !== undefined ? abbrev.slice(remote.length + 1) : abbrev,
      source: "push",
      ...(remote !== undefined ? { remote } : {}),
    });
  }
  return targets;
}

/** A protected branch that publishing `branch` would touch, and why it is
 * tied to the local branch: `branch` (the branch itself), `upstream`, or
 * `push`. */
export interface ProtectedHit {
  ref: string;
  source: "branch" | PushTargetSource;
  remote?: string;
}

/** The protected branch (if any) that publishing `branch` would touch: the
 * branch itself, or any configured upstream/push target. Null when clear. */
export function protectedPushTarget(branch: string): ProtectedHit | null {
  const defaultBranch = getDefaultBranch();
  if (isProtectedBranch(branch, defaultBranch)) return { ref: branch, source: "branch" };
  for (const target of configuredPushTargets(branch)) {
    if (isProtectedBranch(target.ref, defaultBranch)) return { ref: target.ref, source: target.source, ...(target.remote !== undefined ? { remote: target.remote } : {}) };
  }
  return null;
}
