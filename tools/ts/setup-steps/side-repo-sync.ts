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
//   - existing NON-git folder: moved aside to a timestamped backup, then
//     cloned fresh
//   - missing subpath: ERROR (this one is fatal — the link target is broken)

import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
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
    git(repoDir, ["remote", "set-url", "origin", repoUrl]);
    const fetch = git(repoDir, ["fetch", "--prune", "origin"], header);
    if (fetch.status !== 0) {
      console.error(`WARNING: ${label} fetch failed; keeping the existing clone (it may be stale). Not a bootstrap blocker.`);
      return 0;
    }
    let defaultBranch = git(repoDir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).out.trim().replace(/^origin\//, "");
    if (defaultBranch === "") {
      defaultBranch = git(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
    }
    git(repoDir, ["checkout", defaultBranch]);
    const pull = git(repoDir, ["pull", "--ff-only", "origin", defaultBranch], header);
    if (pull.status === 0) {
      // fast-forwarded
    } else {
      // Local modifications blocked the fast-forward. These clones are
      // machine-managed views; the sync must never block bootstrap on them.
      // Recovery ladder: stash, retry, re-apply when not superseded; a
      // conflicted stash stays in the stash stack (nothing lost), loudly.
      let stashRef = "";
      const dirty = git(repoDir, ["status", "--porcelain"]).out.trim();
      if (dirty !== "") {
        const stamp = new Date().toISOString().replace(/\.\d+Z$/, "").replace("T", "T");
        const pushed = git(repoDir, ["stash", "push", "-m", `pre-sync auto-stash ${stamp}`]);
        if (pushed.status === 0) {
          stashRef = git(repoDir, ["rev-parse", "-q", "--verify", "refs/stash"]).out.trim();
          console.log(`${label}: local changes stashed to make the fast-forward possible`);
        } else {
          console.error(`WARNING: ${label} has local changes that could not be stashed; the clone may be stale. Not a bootstrap blocker.`);
          return 0;
        }
      }
      const retry = git(repoDir, ["pull", "--ff-only", "origin", defaultBranch], header);
      if (retry.status === 0) {
        if (stashRef !== "") {
          // Re-apply the stashed edits unless upstream already made them.
          // Redundancy is judged per changed file: a stash whose post-image
          // matches the updated HEAD content is a no-op (the common
          // "same rename made upstream" case) and is dropped; anything else
          // re-applies via apply --check, and a true conflict stays in the
          // stash stack, never lost.
          let redundant = true;
          const files = git(repoDir, ["diff", "--name-only", `${stashRef}^`, stashRef]).out.split("\n").map((l) => l.trim()).filter(Boolean);
          for (const f of files) {
            const changed = git(repoDir, ["diff", "--quiet", `${stashRef}^`, stashRef, "--", f]);
            if (changed.status !== 0) {
              const stashShow = spawnSync("bash", ["-c", `git -C '${repoDir}' show '${stashRef}':'${f}' 2>/dev/null | git -C '${repoDir}' hash-object --stdin 2>/dev/null`], { encoding: "utf8" });
              const upstreamRev = git(repoDir, ["rev-parse", `${defaultBranch}:${f}`]).out.trim();
              if ((stashShow.stdout ?? "").trim() !== upstreamRev) {
                redundant = false;
                break;
              }
            }
          }
          if (redundant) {
            spawnSync("git", ["-C", repoDir, "stash", "drop", stashRef], { stdio: "ignore", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
            console.log(`${label}: stashed local changes were already made upstream; dropped as redundant`);
          } else {
            const patch = spawnSync("bash", ["-c", `git -C '${repoDir}' stash show -p '${stashRef}' 2>/dev/null | git -C '${repoDir}' apply --check --quiet 2>/dev/null`]);
            if (patch.status === 0) {
              spawnSync("git", ["-C", repoDir, "stash", "pop"], { stdio: "ignore", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
              console.log(`${label}: stashed local changes re-applied on top of the updated clone`);
            } else {
              console.error(`WARNING: ${label} local changes could not be re-applied onto the updated clone (upstream reworked the same areas); they are preserved in the stash stack — recover with 'git stash pop' in ${repoDir}. Not a bootstrap blocker.`);
            }
          }
        }
      } else {
        console.error(`WARNING: ${label} could not be fast-forwarded (non-fast-forwardable state); the clone may be stale. Not a bootstrap blocker.`);
      }
    }
  } else {
    if (existsSync(repoDir) && readdirSync(repoDir).length > 0) {
      mkdirSync(backupParent, { recursive: true });
      const backupDir = join(backupParent, `pre-sync.${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`);
      execFileSync("mv", [repoDir, backupDir]);
      console.log(`Existing non-git ${label} folder moved to ${backupDir}`);
    }
    rmSync(repoDir, { recursive: true, force: true });
    const clone = gitArgs(["clone", repoUrl, repoDir], header);
    if (clone.status !== 0) {
      console.error(clone.out);
    }
  }

  const contentSource = join(repoDir, subpath);
  if (!existsSync(contentSource)) {
    console.error(`ERROR: ${label} subpath not found: ${contentSource}`);
    return 1;
  }

  mkdirSync(join(home(), ".copilot"), { recursive: true });
  rmSync(linkPath, { force: true, recursive: true });
  symlinkSync(contentSource, linkPath);
  console.log(`${label} symlinked: ${linkPath} → ${contentSource}`);
  return 0;
}

/** Read [copilot] KEY from devenv.config ("" when unset). */
export function copilotConfig(key: string): string {
  return configGetRaw(join(toolbox(), "devenv.config"), "copilot", key) ?? "";
}
