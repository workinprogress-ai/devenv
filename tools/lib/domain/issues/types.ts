// types.ts — the native issue-type vocabulary and its normalization (port of
// `normalize_issue_type` + the config vocabulary readers).
//
// Canonical set and aliases come from tools/config/issues-config.yml (name
// list); the alias map matches the bash policy layer's pairs. Matching is
// case-insensitive on both the canonical names and the aliases.

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load, JSON_SCHEMA } from "js-yaml";
import { resolveToolsRoot } from "../../core/self-root.ts";

export const TYPE_ALIASES: Record<string, string> = {
  defect: "Bug", bugfix: "Bug",
  enhancement: "Feature", feature: "Feature", story: "Feature",
  task: "Task", chore: "Task",
  epic: "Epic",
};

export interface IssueTypeDef {
  name: string;
  description?: string;
  childOf?: string[];
}

function toolsRoot(): string {
  return resolveToolsRoot(fileURLToPath(import.meta.url));
}

function issuesConfigPath(): string {
  const override = process.env["ISSUES_CONFIG"];
  return override !== undefined && override !== "" ? override : join(toolsRoot(), "config", "issues-config.yml");
}

/** Parse issues-config content into its type list; throws on malformed YAML or a missing `types` list. */
export function parseIssuesConfig(content: string): IssueTypeDef[] {
  let doc: unknown;
  try {
    doc = load(content, { schema: JSON_SCHEMA });
  } catch (err) {
    throw new Error(`Invalid issues config: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
  const list = (doc as { types?: unknown } | null | undefined)?.types;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("Invalid issues config: expected a non-empty top-level 'types' list");
  }
  return list.map((raw, i) => {
    const entry = raw as { name?: unknown; description?: unknown; child_of?: unknown } | null;
    if (entry === null || typeof entry !== "object" || typeof entry.name !== "string" || entry.name.trim() === "") {
      throw new Error(`Invalid issues config: types[${i}] needs a 'name'`);
    }
    const def: IssueTypeDef = { name: entry.name.trim() };
    if (typeof entry.description === "string") def.description = entry.description;
    if (Array.isArray(entry.child_of)) def.childOf = entry.child_of.map((x) => String(x).trim());
    return def;
  });
}

/** The configured types; throws when the file is absent or invalid. */
export function loadIssueTypes(): IssueTypeDef[] {
  const path = issuesConfigPath();
  if (!existsSync(path)) throw new Error(`Issues config not found: ${path}`);
  return parseIssuesConfig(readFileSync(path, "utf8"));
}

/** The type vocabulary from issues-config.yml (`types[].name`). */
export function issueTypeNames(): string[] {
  return loadIssueTypes().map((t) => t.name);
}

/** Type name -> allowed parent types; a type without `child_of` is absent (unrestricted). */
export function childOfMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of loadIssueTypes()) if (t.childOf !== undefined) map.set(t.name, t.childOf);
  return map;
}

/** Case-insensitive name + alias resolution onto the configured vocabulary; null when unknown. */
export function resolveIssueType(input: string): string | null {
  const lowered = input.trim().toLowerCase();
  const names = issueTypeNames();
  const exact = names.find((n) => n.toLowerCase() === lowered);
  if (exact !== undefined) return exact;
  const aliased = TYPE_ALIASES[lowered];
  return aliased === undefined ? null : (names.find((n) => n.toLowerCase() === aliased.toLowerCase()) ?? null);
}
