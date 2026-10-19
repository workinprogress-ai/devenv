// versioning.ts — version comparison and compatibility checks
// (port of versioning.bash).
//
// The bash contract, carried precisely: versions compare by their numeric
// MAJOR.MINOR.PATCH core; pre-release and build suffixes ("-rc.1", "+build5")
// are ignored, missing parts default to 0. The comparison result maps to an
// enum instead of bash's 0/1/2 exit codes.

import { spawnSync } from "node:child_process";

export type VersionOrder = "equal" | "greater" | "less";

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Keep only the leading digits of a part (bash `${v%%[!0-9]*}` contract). */
function numericCore(part: string | undefined): number {
  const m = (part ?? "").match(/^\d+/);
  return m ? Number.parseInt(m[0], 10) : 0;
}

function parseVersion(version: string): ParsedVersion {
  const parts = version.split(".");
  return {
    major: numericCore(parts[0]),
    minor: numericCore(parts[1]),
    patch: numericCore(parts[2]),
  };
}

/** Compare two version strings by numeric core; suffixes ignored. */
export function compareVersions(v1: string, v2: string): VersionOrder {
  const a = parseVersion(v1);
  const b = parseVersion(v2);
  if (a.major !== b.major) return a.major > b.major ? "greater" : "less";
  if (a.minor !== b.minor) return a.minor > b.minor ? "greater" : "less";
  if (a.patch !== b.patch) return a.patch > b.patch ? "greater" : "less";
  return "equal";
}

/** True when version1 >= version2. */
export function versionGte(version: string, required: string): boolean {
  const order = compareVersions(version, required);
  return order === "equal" || order === "greater";
}

/** The running git version, or null when git is absent/unparsable. */
export function getGitVersion(): string | null {
  const r = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return (r.stdout.match(/\d+\.\d+\.\d+/) ?? [null])[0];
}

/**
 * Check the git version against a floor. Returns the failure reason as a
 * string (for the caller to log or surface) or null when satisfied — TS tools
 * decide their own exit path; the library does not exit the process.
 */
export function checkGitVersion(required = "2.0"): string | null {
  const current = getGitVersion();
  if (current === null) return "Git is not installed";
  if (!versionGte(current, required)) {
    return `Git version ${required} or higher required. Current: ${current}`;
  }
  return null;
}

/** Check a script's own version against a required floor; reason or null. */
export function requireScriptVersion(
  currentVersion: string,
  requiredVersion: string,
  scriptName = "script",
): string | null {
  if (!versionGte(currentVersion, requiredVersion)) {
    return `${scriptName} version ${requiredVersion} or higher required. Current: ${currentVersion}`;
  }
  return null;
}
