// types.ts — the native issue-type vocabulary and its normalization (port of
// `normalize_issue_type` + the config vocabulary readers).
//
// Canonical set and aliases come from tools/config/issues-config.yml (name
// list); the alias map matches the bash policy layer's pairs. Matching is
// case-insensitive on both the canonical names and the aliases.

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const CANONICAL_TYPES = ["Bug", "Feature", "Task", "Epic"] as const;

export const TYPE_ALIASES: Record<string, string> = {
  defect: "Bug", bugfix: "Bug",
  enhancement: "Feature", feature: "Feature", story: "Feature",
  task: "Task", chore: "Task",
  epic: "Epic",
};

function toolsRoot(): string {
  const override = process.env["DEVENV_TOOLS"];
  if (override !== undefined && override !== "") return override;
  return join(fileURLToPath(new URL("../../../..", import.meta.url)), "tools");
}

/** The type vocabulary from issues-config.yml (`types[].name`). */
export function issueTypeNames(): string[] {
  const override = process.env["ISSUES_CONFIG"];
  const path = override !== undefined && override !== "" ? override : join(toolsRoot(), "config", "issues-config.yml");
  if (!existsSync(path)) return [...CANONICAL_TYPES];
  const names: string[] = [];
  let inTypes = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (/^types:\s*$/.test(line)) {
      inTypes = true;
      continue;
    }
    if (inTypes && /^\S/.test(line) && !/^types:/.test(line)) inTypes = false;
    if (inTypes) {
      const m = /^\s*-\s*name:\s*(.+)$/.exec(line);
      if (m?.[1] !== undefined) names.push(m[1].replace(/^["']|["']$/g, "").trim());
    }
  }
  return names.length > 0 ? names : [...CANONICAL_TYPES];
}

/** Case-insensitive canonical-name + alias normalization; null when unknown. */
export function normalizeIssueType(input: string): string | null {
  const lowered = input.toLowerCase();
  for (const t of issueTypeNames()) {
    if (lowered === t.toLowerCase()) return t;
  }
  return TYPE_ALIASES[lowered] ?? null;
}
