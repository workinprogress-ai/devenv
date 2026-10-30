// git.ts — git plumbing: repository state, branch operations, merge-context
// validation, and WIP-range guards (port of git-operations.bash's git-local
// half + rewrite-detect.bash).
//
// Scope note: PR operations (find_pr_by_branch, merge_pr,
// build_merge_commit_message, …) route through the provider facade and are
// not part of this module. Except for deleteBranch's remote leg (annotated
// below), this module is the git-local surface only.
//
// The bash library functions log-and-return-nonzero. Here, probes return
// values (booleans/enums) and the caller decides what to log or exit — except
// where a check mirrors a bash `die` path, where the failing reason is
// returned for the caller to render.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// low-level runner: every git call goes through here (typed argv, no shell)
// ---------------------------------------------------------------------------

function git(repo: string | null, args: string[]): { status: number; out: string } {
  const argv = repo ? ["-C", repo, ...args] : args;
  const r = spawnSync("git", argv, { encoding: "utf8" });
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

// ---------------------------------------------------------------------------
// repository state
// ---------------------------------------------------------------------------

/** The current checked-out branch, or null (detached HEAD / not a repo). */
export function getCurrentBranch(repo?: string): string | null {
  const { status, out } = git(repo ?? null, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (status !== 0) return null;
  const name = out.trim();
  return name === "" || name === "HEAD" ? null : name;
}

/** Whether the directory is inside a git work tree. */
export function isInGitRepo(repo?: string): boolean {
  return git(repo ?? null, ["rev-parse", "--is-inside-work-tree"]).out.trim() === "true";
}

/** Whether the working tree has no uncommitted or staged changes. */
export function isWorkingDirectoryClean(repo?: string): boolean {
  return git(repo ?? null, ["status", "--porcelain"]).out.trim() === "";
}

/** One entry of the working tree's changed set. `state` carries the
 * porcelain XY pair; `origin` is set only for rename/copy pairs (the
 * previous path). A rename enumerates as two entries: the deletion of
 * the old path plus the addition of the new one. */
export interface ChangedFile {
  path: string;
  state: string;
  origin?: string;
}

/** The working tree's full changed set (unstaged, staged, untracked,
 * deleted) with untracked files expanded (`-uall`) and rename pairs
 * split into both paths — the enumeration commit-batch coverage checks
 * and batch-draft expansion run against. Parsed from `-z` porcelain with
 * `core.quotePath=false`: NUL-delimited fields carry paths verbatim — no
 * quoting, no octal escapes, and a rename's two paths cannot be confused
 * with a path that merely contains " -> ". */
export function changedFiles(repo?: string): ChangedFile[] {
  const { status, out } = git(repo ?? null, [
    "-c",
    "core.quotePath=false",
    "status",
    "--porcelain",
    "-z",
    "-uall",
    "--find-renames",
  ]);
  if (status !== 0) return [];
  const entries: ChangedFile[] = [];
  // -z format: records are NUL-terminated; a rename/copy record carries a
  // SECOND NUL-terminated field (the origin path) right after the first.
  const fields = out.split("\0");
  let i = 0;
  while (i < fields.length) {
    const record = fields[i] ?? "";
    i += 1;
    if (record === "") continue;
    const state = record.slice(0, 2);
    const path = record.slice(3);
    if (state.startsWith("R") || state.startsWith("C")) {
      const origin = fields[i] ?? "";
      i += 1;
      // The record reports only the NEW path; the old path would never
      // enumerate on its own, and coverage must see it (a claimed old path
      // with no entry reads as an orphan). Split into both entries.
      entries.push({ path: origin, state: "D " });
      entries.push({ path, state, origin });
    } else {
      entries.push({ path, state });
    }
  }
  return entries;
}

/** The repository work-tree root (absolute), or null outside a repo. */
export function getRepoRoot(repo?: string): string | null {
  const { status, out } = git(repo ?? null, ["rev-parse", "--show-toplevel"]);
  return status === 0 ? out.trim() : null;
}

/** The repo's default branch as HEAD of the remote (origin/HEAD), or null. */
export function getDefaultBranch(repo?: string): string | null {
  const { status, out } = git(repo ?? null, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (status !== 0) return null;
  return out.trim().replace("refs/remotes/origin/", "") || null;
}

export function branchExistsLocal(repo: string, branch: string): boolean {
  return git(repo, ["show-ref", "--verify", `refs/heads/${branch}`]).status === 0;
}

export function branchExistsRemote(repo: string, remote: string, branch: string): boolean {
  return git(repo, ["show-ref", "--verify", `refs/remotes/${remote}/${branch}`]).status === 0;
}

/**
 * Whether BRANCH matches a glob pattern (`master`, `release/*`).
 * `*` matches any run of characters except `/` (so `release/*` matches
 * `release/1.4` but not `release/1.4/2`); `?` matches one character.
 * Note this is stricter than bash pathname glob, whose `*` also crosses `/`.
 */
export function branchMatchesPattern(branch: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex metachars except * and ?
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".") +
      "$",
  );
  return regex.test(branch);
}

// ---------------------------------------------------------------------------
// branch deletion
// ---------------------------------------------------------------------------

export function deleteLocalBranch(repo: string, branch: string, force = false): boolean {
  const flag = force ? "-D" : "-d";
  return git(repo, ["branch", flag, branch]).status === 0;
}

/**
 * Delete a local branch and its remote-tracking counterpart. The remote
 * deletion is a network/provider mutation — the only function here that
 * leaves the git-local surface (kept because the caller contract is a
 * single branch-teardown call; the provider facade does not yet own it).
 */
export function deleteBranch(
  repo: string,
  branch: string,
  remote = "origin",
  force = false,
): { local: boolean; remote: boolean } {
  const local = deleteLocalBranch(repo, branch, force);
  const remoteOk = git(repo, ["push", remote, "--delete", branch]).status === 0;
  return { local, remote: remoteOk };
}

// ---------------------------------------------------------------------------
// merge-context validation
// ---------------------------------------------------------------------------

export interface GitContextOptions {
  /** Glob patterns (`master`, `release/*`) the current branch must not be on. */
  excludeBranches?: string[];
}

/**
 * Validate a directory is usable as a merge target: inside a repo, clean
 * working tree, current branch not on an excluded pattern. Returns the first
 * failure reason or null.
 */
export function validateGitContext(
  repoDir: string,
  opts: GitContextOptions = {},
): string | null {
  if (!existsSync(repoDir)) return `Failed to change to directory: ${repoDir}`;
  if (!isInGitRepo(repoDir)) return "Not in a git repository";
  if (!isWorkingDirectoryClean(repoDir)) {
    return "Working directory has uncommitted or staged changes";
  }
  if (opts.excludeBranches?.length) {
    const current = getCurrentBranch(repoDir);
    if (current !== null) {
      for (const pattern of opts.excludeBranches) {
        if (branchMatchesPattern(current, pattern)) {
          return `Cannot run this script on ${current} branch`;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// WIP range guards (the merge-gate contract)
// ---------------------------------------------------------------------------

/**
 * Commits in RANGE whose subject carries the anchored `WIP:` prefix, or null
 * when the range cannot be scanned (empty range argument, or git rejected
 * the range — nonexistent ref, malformed `..`). Null means "couldn't check":
 * the guard treats it as a failure (fail closed), never a pass.
 * Subject matching only — never hash offsets (short hash length auto-scales
 * with repo size; an offset regex would fail open).
 */
export function wipRangeScan(repo: string | null, range: string): string[] | null {
  if (range === "") return null;
  const r = git(repo, ["log", range, "--format=%h %s"]);
  if (r.status !== 0) return null; // invalid range — never fail open
  return r.out
    .split("\n")
    .filter((l) => l.includes(" WIP:"))
    .map((l) => l.trim());
}

export interface WipGuardResult {
  ok: boolean;
  /** Offending commits (when !ok). */
  offenders: string[];
}

/** Fail when the merge range contains WIP: commits. */
export function wipRangeGuard(repo: string | null, range: string): WipGuardResult {
  const offenders = wipRangeScan(repo, range);
  if (offenders === null) return { ok: false, offenders: [] };
  return { ok: offenders.length === 0, offenders };
}

// ---------------------------------------------------------------------------
// history-rewrite classification (port of rewrite-detect.bash)
// ---------------------------------------------------------------------------

/** Same reflog cap the original detection used. */
export const REWRITE_DETECT_REFLOG_DEPTH = 50;

export type RewriteState =
  | { verdict: "none" }
  | { verdict: "clean"; pastTip: string }
  | { verdict: "diverged"; pastTip: string };

function isAncestor(repo: string, maybeAncestor: string, of: string): boolean {
  return git(repo, ["merge-base", "--is-ancestor", maybeAncestor, of]).status === 0;
}

function objectExists(repo: string, ref: string): boolean {
  return git(repo, ["cat-file", "-e", `${ref}^{commit}`]).status === 0;
}

/**
 * Classify the current branch against its upstream remote-tracking ref after
 * a history rewrite (fork-sync --replay + force-push):
 *
 * - `clean` — local HEAD IS a past remote tip from the reflog: the remote was
 *   rewritten and this clone kept nothing unique; a hard reset is lossless.
 * - `diverged` — local HEAD has unique commits; the update is a rebase.
 * - `none` — not diverged, or no rewritten past tip could be identified
 *   (shallow clones read as "not rewritten": their missing objects defeat
 *   the reachability probes).
 */
export function rewriteDetectState(repo: string, branch: string): RewriteState {
  const local = git(repo, ["rev-parse", branch]);
  if (local.status !== 0) return { verdict: "none" };
  const localHash = local.out.trim();
  const remote = git(repo, ["rev-parse", `origin/${branch}`]);
  if (remote.status !== 0) return { verdict: "none" };
  const remoteHash = remote.out.trim();

  // Not diverged: nothing to classify.
  if (localHash === remoteHash) return { verdict: "none" };
  if (isAncestor(repo, localHash, remoteHash)) return { verdict: "none" };
  if (isAncestor(repo, remoteHash, localHash)) return { verdict: "none" };

  // Diverged: find a past remote tip that explains it — recorded in the
  // remote-tracking reflog, an ancestor of local HEAD, no longer reachable
  // from the rewritten remote, and still present as an object.
  const reflog = git(repo, [
    "reflog", "show", "--format=%H", `origin/${branch}`,
    `-n`, String(REWRITE_DETECT_REFLOG_DEPTH),
  ]);
  for (const tip of reflog.out.split("\n").map((s) => s.trim())) {
    if (tip === "" || tip === remoteHash) continue;
    if (isAncestor(repo, tip, localHash) && !isAncestor(repo, tip, remoteHash) && objectExists(repo, tip)) {
      return localHash === tip
        ? { verdict: "clean", pastTip: tip }
        : { verdict: "diverged", pastTip: tip };
    }
  }
  return { verdict: "none" };
}

// ---------------------------------------------------------------------------
// repo identity helpers (used by provider-spec construction)
// ---------------------------------------------------------------------------

/** owner/repo parsed from a git remote URL, or null. */
export function repoUrlOwner(repo?: string): { owner: string; name: string } | null {
  const { out } = git(repo ?? null, ["remote", "get-url", "origin"]);
  const url = out.trim();
  if (url === "") return null;
  // SSH: git@host:owner/name.git · HTTPS: https://host/owner/name.git
  const m = url.match(/[:/]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/);
  return m ? { owner: m[1]!, name: m[2]! } : null;
}

/** Whether DIR is a devenv checkout (contains tools/ and devenv.config). */
export function isDevenvRepo(dir: string): boolean {
  return existsSync(join(dir, "tools")) && existsSync(join(dir, "devenv.config"));
}

/**
 * Whether DIR is a nested devenv clone (a devenv checkout inside another
 * devenv checkout's repos/ directory).
 */
export function isNestedDevenvClone(dir: string): boolean {
  if (!isDevenvRepo(dir)) return false;
  let cur = dirname(dir);
  while (cur !== dirname(cur)) {
    if (isDevenvRepo(cur)) return true;
    cur = dirname(cur);
  }
  return false;
}
