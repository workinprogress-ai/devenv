// refs.ts — shared issue-reference parsing (byte-identical per-tool copies
// unified here so the parsers cannot drift). Lives beside the issues-graph
// domain module.
//
// The child_of parser is YAML-structure-aware (ported from the per-tool
// copies): it walks the issues-config's types list, tracking each `- name:`
// entry and its `child_of: [...]` line — NOT a flat "num: children" format.
import { readFileSync, existsSync } from "node:fs";

/** Parse an issue reference (bare number or a full web URL ending in one)
 * into its number; null when the reference names nothing. */
export function issueNumberFromRef(ref: string): number | null {
  const trimmed = ref.trim();
  if (/^[0-9]+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const m = /^https?:\/\/[^?#]*\/([0-9]+)\/?([?#].*)?$/.exec(trimmed);
  return m?.[1] !== undefined ? Number.parseInt(m[1], 10) : null;
}

/** Parse a type-name -> child_of list map from issues-config YAML content.
 * Walks the types list: each `- name:` entry starts a record; children
 * come from either the inline `child_of: [a, b]` form or the block form
 * (`child_of:` followed by `- item` lines). */
export function childOfMapFrom(content: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let inTypes = false;
  let current = "";
  let inChildOf = false;
  for (const line of content.split("\n")) {
    if (/^types:\s*$/.test(line)) {
      inTypes = true;
      continue;
    }
    if (inTypes && /^\S/.test(line) && !/^types:/.test(line)) {
      inTypes = false;
      inChildOf = false;
    }
    if (!inTypes) continue;
    const name = /^\s*-\s*name:\s*(.+)$/.exec(line);
    if (name?.[1] !== undefined) {
      current = name[1].replace(/^["']|["']$/g, "").trim();
      continue;
    }
    if (/^\s*child_of:\s*\[/.test(line)) {
      const list = /\[(.*)\]/.exec(line)?.[1] ?? "";
      map.set(
        current,
        list.split(",").map((x) => x.replace(/^["'\s]+|["'\s]+$/g, "")).filter((x) => x !== ""),
      );
      inChildOf = false;
      continue;
    }
    if (/^\s*child_of:\s*$/.test(line)) {
      inChildOf = true;
      continue;
    }
    if (inChildOf && /^\s*-\s*\S/.test(line)) {
      const item = map.get(current) ?? [];
      item.push(line.replace(/^\s*-\s*/, "").replace(/^["']|["']$/g, "").trim());
      map.set(current, item);
      continue;
    }
    // Terminator: a non-item line ends the block list — without this, a
    // sibling list field under the same record (`labels:` with `- item`
    // lines) bleeds its items into child_of.
    if (inChildOf && /^\s*\S/.test(line)) {
      inChildOf = false;
      continue;
    }
  }
  return map;
}

/** Read the child_of map from an issues-config file path; empty map when
 * the file is absent. */
export function childOfMapFromConfig(path: string): Map<string, string[]> {
  if (!existsSync(path)) return new Map();
  return childOfMapFrom(readFileSync(path, "utf8"));
}
