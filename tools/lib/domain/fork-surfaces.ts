// fork-surfaces.ts — the fork-stable surfaces contract (port of
// fork-surfaces.bash): parse the declaration, classify paths, list globs.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { selfRoot } from "../core/self-root.ts";

export interface SurfaceEntry { description: string; paths: string[] }
export interface SurfacesDecl {
  version?: number;
  classes: Record<"fork-stable" | "fork-replaced", SurfaceEntry[]>;
}

export function surfacesConfigPath(_devenvRoot?: string): string {
  // Fork-surfaces overrides: FORK_SURFACES_CONFIG first, then the TOOLS root
  // (the devenv checkout's own declaration — fork machinery is developed
  // here), never the ambient DEVENV_ROOT (forks run against arbitrary clones).
  if (process.env.FORK_SURFACES_CONFIG) return process.env.FORK_SURFACES_CONFIG;
  const tools = process.env.DEVENV_TOOLS ?? selfRoot(process.cwd());
  return join(tools, "config", "fork-surfaces.yml");
}

/** Minimal YAML reader for the declaration's flat shape: version + two class
 * lists of {description, paths[]}. Not a general YAML parser. */
function parseDecl(text: string): SurfacesDecl {
  const decl: SurfacesDecl = { classes: { "fork-stable": [], "fork-replaced": [] } };
  let currentClass: "fork-stable" | "fork-replaced" | null = null;
  let currentEntry: SurfaceEntry | null = null;
  let inPaths = false;
  const versionMatch = text.match(/^version:\s*(\d+)/m);
  if (versionMatch) decl.version = Number(versionMatch[1]);
  for (const raw of text.split("\n")) {
    if (/^\s*#/.test(raw) || raw.trim() === "") continue;
    const cls = raw.match(/^  (fork-stable|fork-replaced):\s*$/);
    if (cls) {
      currentClass = cls[1] as "fork-stable" | "fork-replaced";
      currentEntry = null;
      inPaths = false;
      continue;
    }
    if (/^[^ #]/.test(raw) && !raw.startsWith("  ")) { currentClass = null; continue; }
    const entry = raw.match(/^    - description:\s*(.*)$/);
    if (entry && currentClass) {
      currentEntry = { description: (entry[1] ?? "").trim(), paths: [] };
      decl.classes[currentClass].push(currentEntry);
      inPaths = false;
      continue;
    }
    const pathsKey = raw.match(/^      paths:\s*$/);
    if (pathsKey && currentEntry) { inPaths = true; continue; }
    const pathItem = raw.match(/^        - (.*)$/);
    if (pathItem && currentEntry && inPaths) {
      currentEntry.paths.push((pathItem[1] ?? "").trim());
    }
  }
  return decl;
}

/** Validate the declaration; returns a list of error strings (empty = valid). */
export function surfacesValidate(devenvRoot?: string): string[] {
  const config = surfacesConfigPath(devenvRoot);
  const errors: string[] = [];
  if (config === "" || !existsSync(config)) {
    errors.push(`surfaces declaration not found: ${config}`);
    return errors;
  }
  let decl: SurfacesDecl;
  try {
    decl = parseDecl(readFileSync(config, "utf8"));
  } catch {
    errors.push(`surfaces declaration unreadable: ${config}`);
    return errors;
  }
  if (decl.version === undefined) errors.push(`surfaces declaration missing version: ${config}`);
  for (const key of ["fork-stable", "fork-replaced"] as const) {
    const entries = decl.classes[key];
    if (!Array.isArray(entries)) {
      errors.push(`surfaces declaration missing class: ${key}`);
      continue;
    }
    entries.forEach((e, i) => {
      if (!e.description) errors.push(`class ${key} entry ${i} missing description`);
      if (e.paths.length === 0) errors.push(`class ${key} entry ${i} has no paths`);
    });
  }
  return errors;
}

/** Classify one repo-root-relative path: fork-stable, fork-replaced, or
 * upstream-stable (the undeclared default). First match wins. */
export function surfacesClassify(path: string, devenvRoot?: string): string {
  const config = surfacesConfigPath(devenvRoot);
  if (!existsSync(config)) {
    console.error(`fork-surfaces: declaration unreadable or invalid: ${config}`);
    throw new Error("fork-surfaces declaration invalid");
  }
  const decl = parseDecl(readFileSync(config, "utf8"));
  for (const key of ["fork-stable", "fork-replaced"] as const) {
    for (const entry of decl.classes[key]) {
      for (const glob of entry.paths) {
        if (globMatch(glob, path)) return key;
      }
    }
  }
  return "upstream-stable";
}

/** All declared globs as "<class> <glob>" lines (snapshot pathspec source). */
export function surfacesList(devenvRoot?: string): { cls: string; glob: string }[] {
  const config = surfacesConfigPath(devenvRoot);
  const out: { cls: string; glob: string }[] = [];
  if (!existsSync(config)) return out;
  const decl = parseDecl(readFileSync(config, "utf8"));
  for (const key of ["fork-stable", "fork-replaced"] as const) {
    for (const entry of decl.classes[key]) {
      for (const glob of entry.paths) out.push({ cls: key, glob });
    }
  }
  return out;
}

/** Bash `case $path in $glob)` semantics: * matches any string (including /),
 * ? one char, [class] char classes. Not fs-glob: no ** or {} expansion. */
function globMatch(glob: string, path: string): boolean {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(path);
}
