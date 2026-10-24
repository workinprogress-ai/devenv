// fork.ts — fork-domain basics (port of fork.bash): config load, git-URL
// normalization (Azure spellings reduced), upstream-match, selection slugs.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { configGetRaw } from "../core/config.ts";
import { selfRoot } from "../core/self-root.ts";

export interface ForkConfig {
  upstreamRepo: string;
  upstreamBranch: string;
}

/** loadConfig against the ambient DEVENV_ROOT (the tool-facing form). */
export function forkConfigFromEnv(): ForkConfig {
  return loadConfig(process.env.DEVENV_ROOT);
}

/** Read [fork] upstream_repo / upstream_branch from $DEVENV_ROOT/devenv.config.
 * Throws with the bash die-messages when either is missing. */
export function loadConfig(devenvRoot?: string): ForkConfig {
  const root = devenvRoot ?? process.env.DEVENV_ROOT ?? selfRoot(process.cwd());
  const file = join(root, "devenv.config");
  if (!existsSync(file)) throw new Error(`could not read ${file}`);
  const upstreamRepo = configGetRaw(file, "fork", "upstream_repo") ?? "";
  const upstreamBranch = configGetRaw(file, "fork", "upstream_branch") ?? "";
  if (upstreamRepo === "") throw new Error(`missing required [fork] upstream_repo in ${file}`);
  if (upstreamBranch === "") throw new Error(`missing required [fork] upstream_branch in ${file}`);
  return { upstreamRepo, upstreamBranch };
}

function uriDecode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * Reduce a git URL to `host/path` form (credentials, schemes, ports, .git
 * suffix, trailing slash all stripped; lowercased). Azure DevOps spellings
 * collapse to dev.azure.com/ORG/PROJECT/_git/REPO.
 */
export function normalizeGitUrl(rawUrl: string): string {
  let url = rawUrl;
  if (url.includes("://")) {
    url = url.slice(url.indexOf("://") + 3);
    const slash = url.indexOf("/");
    let authority = slash < 0 ? url : url.slice(0, slash);
    let path = slash < 0 ? "" : url.slice(slash + 1);
    const at = authority.lastIndexOf("@");
    if (at >= 0) authority = authority.slice(at + 1);
    const colon = authority.indexOf(":");
    if (colon >= 0 && !/^\d*$/.test(authority.slice(colon + 1))) {
      // host:org with no numeric port is scp-style text inside a URL scheme
      path = `${authority.slice(colon + 1)}${path ? `/${path}` : ""}`;
    }
    authority = authority.split(":")[0] ?? authority;
    url = path !== "" ? `${authority}/${path}` : authority;
  } else if (url.includes(":")) {
    // scp-style: [user@]host:path (no scheme, so no port)
    url = url.replace(/^[^@]*@/, "");
    const colon = url.indexOf(":");
    const authority = url.slice(0, colon);
    const path = url.slice(colon + 1).replace(/^\//, "");
    url = `${authority}/${path}`;
  }
  url = uriDecode(url).replace(/\/$/, "").replace(/\.git$/, "").toLowerCase();
  // Azure DevOps spellings → https form
  const ssh = url.match(/^(ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com)\/v3\/([^/]+)\/([^/]+)\/(.+)$/);
  if (ssh) {
    url = `dev.azure.com/${ssh[2]}/${ssh[3]}/_git/${ssh[4]}`;
  } else {
    const vso = url.match(/^([^/.]+)\.visualstudio\.com\/(defaultcollection\/)?([^/]+)\/_git\/(.+)$/);
    if (vso) url = `dev.azure.com/${vso[1]}/${vso[3]}/_git/${vso[4]}`;
  }
  return url;
}

/** Whether the repo's `upstream` remote URL normalizes to the configured one. */
export function upstreamMatches(repoRoot: string, configured: string): boolean {
  const r = spawnSync("git", ["-C", repoRoot, "remote", "get-url", "upstream"], { encoding: "utf8" });
  const contacted = r.stdout.trim();
  if (contacted === "") return false;
  return normalizeGitUrl(contacted) === normalizeGitUrl(configured);
}

/** Slug for a selection (fork_get_selection_slug parity):
 * `<base>-sel<hash7>-<end>` where hash is git hash-object of the sha list. */
export function getSelectionSlug(repoRoot: string, baseShort: string, endShort: string, commits: string[]): string {
  const hash = spawnSync("git", ["-C", repoRoot, "hash-object", "--stdin"], {
    input: `${commits.join("\n")}\n`,
    encoding: "utf8",
  });
  return `${baseShort}-sel${(hash.stdout ?? "").trim().slice(0, 7)}-${endShort}`;
}

/** Whether the selection covers BASE..END entirely (contiguous full range). */
export function isFullRangeSelection(repoRoot: string, base: string, end: string, commits: string[]): boolean {
  const full = spawnSync("git", ["-C", repoRoot, "rev-list", "--topo-order", "--reverse", `${base}..${end}`], { encoding: "utf8" });
  const fullList = full.stdout.split("\n").filter((l) => l !== "");
  return fullList.length === commits.length && fullList.every((sha, i) => sha === commits[i]);
}

/** Read fork-surfaces config paths (fork-surfaces.bash parity). */
export function surfacesConfigPath(devenvRoot?: string): string {
  return join(devenvRoot ?? selfRoot(process.cwd()), "tools", "config", "fork-surfaces.yml");
}

/** Fork-only: the change-id lib lives in core; re-export nothing — importers
 * use lib/core/change-id.ts directly. Kept for surface parity documentation. */
export const _surfacesReadNote = (path: string): string =>
  existsSync(path) ? readFileSync(path, "utf8") : "";
