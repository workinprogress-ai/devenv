#!/usr/bin/env node
// side-repo-sync.ts — clone-or-update a Copilot-side external repo and
// symlink its content into ~/.copilot/. Port of provision.bash
// sync_copilot_side_repo (the shared implementation behind knowledge-sync and
// engineering-sync).
//
// Contracts carried verbatim:
//   - keychain-first auth: the token resolves through the provider seam —
//     never from env, never via raw gh's default auth context
//   - no token: warn and skip (a missing side-repo is never a bootstrap
//     blocker)
//   - the auth header rides git's argv via -c http.extraheader (briefly
//     visible in process listings to local users; lives only for the fetch/
//     pull/clone)
//   - existing clone: set-url, fetch --prune, checkout the default branch,
//     pull --ff-only; on failure the stash ladder runs (stash → retry →
//     re-apply unless upstream already made the change → conflicted stash
//     stays in the stack, loudly). A stale clone is a warning, never fatal.
//   - existing NON-git folder: cloned beside it first, then moved aside to a
//     timestamped backup; a failed clone leaves it untouched and is an error
//   - a real file/folder at the link path is moved aside, never deleted
//   - missing subpath: ERROR (this one is fatal — the link target is broken)

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, mkdirSync, renameSync, rmSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { configGetRaw } from "../../lib/core/config.ts";
import { toolbox, home } from "./lib.ts";
import { providerSecretToken, gitAuthHeader } from "./provider-seam.ts";
import { providerDetect } from "../../lib/providers/provider-core.ts";
function git(dir: string, args: string[], header?: string): { status: number; out: string } {
  const argv = header ? ["-c", `http.extraheader=${header}`] : [];
  const r = spawnSync("git", [...argv, "-C", dir, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function gitArgs(args: string[], header?: string): { status: number; out: string } {
  const argv = header ? ["-c", `http.extraheader=${header}`] : [];
  const r = spawnSync("git", [...argv, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

/** bash normalize_copilot_knowledge_subpath: strip ./ and trailing /; empty → "." */
function normalizeSubpath(subpath: string): string {
  let s = subpath.replace(/^\.\//, "").replace(/\/$/, "");
  if (s === "") s = ".";
  return s;
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/** A not-yet-existing path under parent, so a move never nests into or overwrites an earlier backup. */
function uniqueBackupPath(parent: string, base: string): string {
  mkdirSync(parent, { recursive: true });
  let candidate = join(parent, base);
  for (let n = 1; existsSync(candidate); n++) candidate = join(parent, `${base}-${n}`);
  return candidate;
}

function gitStdout(dir: string, args: string[]): string {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return r.status === 0 ? (r.stdout ?? "").trim() : "";
}

/** The current stash@{N} reference of a stash commit, or "" when it is no longer in the stack. */
function stashRefOf(repoDir: string, sha: string): string {
  const shas = gitStdout(repoDir, ["stash", "list", "--format=%H"]).split("\n").filter(Boolean);
  const idx = shas.indexOf(sha);
  return idx < 0 ? "" : `stash@{${idx}}`;
}

/** Re-apply the stash commit onto the clean tree and drop exactly that entry on success; false leaves it in the stack. */
function restoreStash(repoDir: string, sha: string): boolean {
  const ref = stashRefOf(repoDir, sha);
  if (ref === "") return false;
  const patch = spawnSync("git", ["-C", repoDir, "stash", "show", "-p", ref], { encoding: "utf8" });
  if (patch.status !== 0) return false;
  const check = spawnSync("git", ["-C", repoDir, "apply", "--check", "--quiet", "-"], { input: patch.stdout });
  if (check.status !== 0) return false;
  if (git(repoDir, ["stash", "apply", "--quiet", ref]).status !== 0) return false;
  git(repoDir, ["stash", "drop", "--quiet", ref]);
  return true;
}

/** Fast-forward an existing clone. Never fatal and never loses local edits: they end up in the tree or in the stash stack. */
function updateClone(repoDir: string, repoUrl: string, label: string, header: string): void {
  git(repoDir, ["remote", "set-url", "origin", repoUrl]);
  const fetch = git(repoDir, ["fetch", "--prune", "origin"], header);
  if (fetch.status !== 0) {
    console.error(`WARNING: ${label} fetch failed; keeping the existing clone (it may be stale). Not a bootstrap blocker.`);
    return;
  }
  let defaultBranch = git(repoDir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).out.trim().replace(/^origin\//, "");
  if (defaultBranch === "") {
    defaultBranch = git(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
  }
  git(repoDir, ["checkout", defaultBranch]);
  if (git(repoDir, ["pull", "--ff-only", "origin", defaultBranch], header).status === 0) return;

  // Local modifications blocked the fast-forward. These clones are
  // machine-managed views; the sync must never block bootstrap on them.
  // Recovery ladder: stash, retry, re-apply when not superseded; a
  // conflicted stash stays in the stash stack (nothing lost), loudly.
  let stashSha = "";
  if (git(repoDir, ["status", "--porcelain"]).out.trim() !== "") {
    const before = gitStdout(repoDir, ["rev-parse", "-q", "--verify", "refs/stash"]);
    const pushed = git(repoDir, ["stash", "push", "-m", `pre-sync auto-stash ${new Date().toISOString().replace(/\.\d+Z$/, "")}`]);
    const after = gitStdout(repoDir, ["rev-parse", "-q", "--verify", "refs/stash"]);
    if (pushed.status !== 0) {
      console.error(`WARNING: ${label} has local changes that could not be stashed; the clone may be stale. Not a bootstrap blocker.`);
      return;
    }
    // "No local changes to save" exits 0 without a new entry; refs/stash is then the user's own.
    if (after !== "" && after !== before) {
      stashSha = after;
      console.log(`${label}: local changes stashed to make the fast-forward possible`);
    }
  }

  if (git(repoDir, ["pull", "--ff-only", "origin", defaultBranch], header).status !== 0) {
    console.error(`WARNING: ${label} could not be fast-forwarded (non-fast-forwardable state); the clone may be stale. Not a bootstrap blocker.`);
    if (stashSha !== "") {
      if (restoreStash(repoDir, stashSha)) {
        console.log(`${label}: local changes restored after the failed fast-forward`);
      } else {
        console.error(`WARNING: ${label} local changes could not be restored; they are preserved in the stash stack — recover with 'git stash pop' in ${repoDir}.`);
      }
    }
    return;
  }
  if (stashSha === "") return;

  // Re-apply the stashed edits unless upstream already made them. Redundancy
  // is judged per changed file: a stash whose post-image matches the updated
  // branch content is a no-op (the common "same rename made upstream" case)
  // and is dropped; anything else re-applies, and a true conflict stays in
  // the stash stack, never lost.
  const files = gitStdout(repoDir, ["diff", "--name-only", `${stashSha}^`, stashSha]).split("\n").filter(Boolean);
  const redundant = files.every((f) => gitStdout(repoDir, ["rev-parse", "-q", "--verify", `${stashSha}:${f}`]) === gitStdout(repoDir, ["rev-parse", "-q", "--verify", `${defaultBranch}:${f}`]));
  if (redundant) {
    const ref = stashRefOf(repoDir, stashSha);
    if (ref !== "" && git(repoDir, ["stash", "drop", "--quiet", ref]).status === 0) {
      console.log(`${label}: stashed local changes were already made upstream; dropped as redundant`);
    }
  } else if (restoreStash(repoDir, stashSha)) {
    console.log(`${label}: stashed local changes re-applied on top of the updated clone`);
  } else {
    console.error(`WARNING: ${label} local changes could not be re-applied onto the updated clone (upstream reworked the same areas); they are preserved in the stash stack — recover with 'git stash pop' in ${repoDir}. Not a bootstrap blocker.`);
  }
}

/** Clone beside the target first; the existing folder is only moved aside once a clone is in hand. */
function cloneFresh(repoDir: string, repoUrl: string, label: string, header: string, backupParent: string): boolean {
  const staging = `${repoDir}.sync-${process.pid}-${Date.now()}`;
  mkdirSync(dirname(repoDir), { recursive: true });
  const clone = gitArgs(["clone", repoUrl, staging], header);
  if (clone.status !== 0) {
    rmSync(staging, { recursive: true, force: true });
    console.error(`ERROR: ${label} clone failed; local data left untouched.\n${clone.out}`);
    return false;
  }
  if (existsSync(repoDir)) {
    if (readdirSync(repoDir).length > 0) {
      const backupDir = uniqueBackupPath(backupParent, `pre-sync.${stamp()}`);
      execFileSync("mv", [repoDir, backupDir]);
      console.log(`Existing non-git ${label} folder moved to ${backupDir}`);
    } else {
      rmdirSync(repoDir);
    }
  }
  renameSync(staging, repoDir);
  return true;
}

/** Point linkPath at the content; a symlink is replaced, anything real is moved aside, never deleted. */
function replaceLink(linkPath: string, target: string, label: string, backupParent: string): void {
  let existing = null;
  try {
    existing = lstatSync(linkPath);
  } catch {
    // nothing at the link path
  }
  if (existing?.isSymbolicLink()) {
    unlinkSync(linkPath);
  } else if (existing !== null) {
    const backupDir = uniqueBackupPath(backupParent, `pre-link.${stamp()}`);
    execFileSync("mv", [linkPath, backupDir]);
    console.log(`Existing ${label} link-path content moved to ${backupDir}`);
  }
  symlinkSync(target, linkPath);
}

export function syncCopilotSideRepo(
  repoUrl: string,
  subpathRaw: string,
  repoDir: string,
  linkPath: string,
  label: string,
  backupParent: string,
): number {
  const token = providerSecretToken();
  if (token === "") {
    console.error(`WARNING: provider credentials are not available; skipping ${label} sync (run 'key-update-provider')`);
    return 0;
  }

  const provider = providerDetect();
  const header = gitAuthHeader(provider, token);
  const subpath = normalizeSubpath(subpathRaw);

  if (existsSync(join(repoDir, ".git"))) {
    updateClone(repoDir, repoUrl, label, header);
  } else {
    const cloned = cloneFresh(repoDir, repoUrl, label, header, backupParent);
    if (!cloned) return 1;
  }

  const contentSource = join(repoDir, subpath);
  if (!existsSync(contentSource)) {
    console.error(`ERROR: ${label} subpath not found: ${contentSource}`);
    return 1;
  }

  mkdirSync(join(home(), ".copilot"), { recursive: true });
  replaceLink(linkPath, contentSource, label, backupParent);
  console.log(`${label} symlinked: ${linkPath} → ${contentSource}`);
  return 0;
}

/** Read [copilot] KEY from devenv.config ("" when unset). */
export function copilotConfig(key: string): string {
  return configGetRaw(join(toolbox(), "devenv.config"), "copilot", key) ?? "";
}
