// domain/release/version.ts - Release version plumbing over git tags and
// commit history (port of release-operations.bash's tag/version functions:
// get_latest_version_tag, parse_semver, is_breaking_commit,
// commit_bump_from_header, calculate_next_version, get_version_change_type,
// check_release_config_supports_custom_types, get_conventional_commit_type).
// Consumers: repo-calc-version, repo-version-list, repo-bump-version.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function gitOut(args: string[]): string {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "") : "";
}

/** The highest `vX.Y.Z` tag, or "" when none exists. */
export function getLatestVersionTag(): string {
  return gitOut(["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*"])
    .split("\n")
    .filter((t) => /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(t))
    .sort((a, b) => compareVersionStrings(a, b))
    .pop() ?? "";
}

function compareVersionStrings(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

/** Parse semver "X.Y.Z" (leading `v` allowed; prerelease/metadata ignored).
 * Unparseable input reads as 0.0.0, as the bash original did. */
export function parseSemver(version: string): SemVer {
  const m = /^v?([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(version);
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) return { major: 0, minor: 0, patch: 0 };
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Whether a full commit message indicates a breaking change: a `!` after
 * the header's type/scope, or a BREAKING CHANGE(S)/BREAKING footer. */
export function isBreakingCommit(msg: string): boolean {
  if (/^[a-zA-Z]+(\([^)]*\))?!:\s/.test(msg)) return true;
  if (/(^|\n)BREAKING\s+(CHANGE|CHANGES):/i.test(msg)) return true;
  if (/(^|\n)BREAKING:/i.test(msg)) return true;
  return false;
}

export type Bump = "major" | "minor" | "patch" | "none";

/** The semver bump a conventional-commit header calls for. */
export function commitBumpFromHeader(header: string): Bump {
  const m = /^([a-zA-Z]+)(\(([^)]+)\))?(!)?:\s/.exec(header);
  if (!m) return "none";
  if (m[4] === "!") return "major";
  const typeLc = (m[1] ?? "").toLowerCase();
  if (typeLc === "major" || typeLc === "breaking") return "major";
  if (typeLc === "minor" || typeLc === "feat") return "minor";
  if (typeLc === "patch" || typeLc === "fix" || typeLc === "perf" || typeLc === "refactor" || typeLc === "style") {
    return "patch";
  }
  return "none";
}

/** Next semver (no `v` prefix) from the commits since LATEST_TAG — or from
 * the whole history when empty, starting at DEFAULT_START_VERSION. */
export function calculateNextVersion(latestTag: string, defaultStartVersion = "1.0.0"): string {
  const baseVersion = latestTag === "" ? defaultStartVersion : latestTag.replace(/^v/, "");
  const base = parseSemver(baseVersion);
  const commitsRange = latestTag === "" ? "" : `${latestTag}..HEAD`;

  // No commits since tag? Return base version.
  if (commitsRange !== "" && gitOut(["log", "--oneline", commitsRange]).trim() === "") {
    return baseVersion;
  }

  let bumpMajor = false;
  let bumpMinor = false;
  let bumpPatch = false;
  const sep = "\x1E";
  const logRange = commitsRange === "" ? "HEAD" : commitsRange;
  const r = spawnSync("git", ["log", logRange, "--pretty=format:%B" + sep], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const log = r.status === 0 ? (r.stdout ?? "") : "";
  for (let raw of log.split(sep)) {
    // git --pretty=format: adds a '\n' separator between entries; strip it.
    if (raw.startsWith("\n")) raw = raw.slice(1);
    if (raw.trim() === "") continue;
    if (isBreakingCommit(raw)) {
      bumpMajor = true;
      continue;
    }
    const header = raw.split("\n")[0] ?? "";
    switch (commitBumpFromHeader(header)) {
      case "major": bumpMajor = true; break;
      case "minor": bumpMinor = true; break;
      case "patch": bumpPatch = true; break;
      case "none": break;
    }
  }

  if (bumpMajor) return `${base.major + 1}.0.0`;
  if (bumpMinor) return `${base.major}.${base.minor + 1}.0`;
  if (bumpPatch) return `${base.major}.${base.minor}.${base.patch + 1}`;
  return `${base.major}.${base.minor}.${base.patch}`;
}

/** The change-type marker a version represents: 🔴 pre-1.0, 🔷 major bump,
 * 🟡 minor bump, 🟢 patch bump. */
export function getVersionChangeType(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  const major = m?.[1] ?? "0";
  const minor = m?.[2] ?? "0";
  const patch = (m?.[3] ?? "0").split("-")[0] ?? "0";
  if (major === "0") return "🔴";
  if (minor === "0" && patch === "0") return "🔷";
  if (patch === "0") return "🟡";
  return "🟢";
}

/** Whether a repo's release.config.js/.cjs declares custom commit-type rules
 * (`type: 'patch' | 'minor' | 'major'` all present). */
export function checkReleaseConfigSupportsCustomTypes(repoPath: string): boolean {
  const candidates = ["release.config.js", "release.config.cjs"];
  const config = candidates.map((c) => join(repoPath, c)).find((p) => existsSync(p));
  if (config === undefined) return false;
  const content = readFileSync(config, "utf8");
  return (
    content.includes("type: 'patch'") &&
    content.includes("type: 'minor'") &&
    content.includes("type: 'major'")
  );
}

/** The commit type a bump uses: the change type itself when the repo supports
 * custom types, else the conventional mapping (patch→fix, minor→feat,
 * major→feat!). */
export function getConventionalCommitType(changeType: string, supportsCustom: boolean): string {
  if (supportsCustom) return changeType;
  switch (changeType) {
    case "patch": return "fix";
    case "minor": return "feat";
    case "major": return "feat!";
    default:
      throw new Error(`Invalid change type: ${changeType}`);
  }
}
