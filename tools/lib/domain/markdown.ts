// markdown.ts — plan-markdown mutation helpers (domain/headless).
// Checkbox find/set/count for AC items and tasks, built on the shared plan
// grammar so these tools tick exactly the lines plan-parse counts.

import { readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { classifyCheckbox, findCheckboxIndex } from "./plan-grammar.ts";

/** AC numbers: AC-N, AC-N.N, AC-N.N.N */
export function validateAcNumber(ac: string): boolean {
  return /^AC-[0-9]+(\.[0-9]+)*$/.test(ac);
}

/** Task numbers: X.Y or X.Y.Z */
export function validateTaskNumber(task: string): boolean {
  return /^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(task);
}

/** 1-based line number of the checkbox AC line with this id, or null. */
export function findAcLine(content: string, ac: string): number | null {
  const i = findCheckboxIndex(content.split("\n"), "ac", ac);
  return i < 0 ? null : i + 1;
}

/** 1-based line number of the checkbox task line with this id, or null. */
export function findTaskLine(content: string, task: string): number | null {
  const i = findCheckboxIndex(content.split("\n"), "task", task);
  return i < 0 ? null : i + 1;
}

/**
 * Flip the checkbox on a 1-based line to [x] or [ ]. Already-in-state is a
 * no-op success. Only the checkbox position is read or written, never a
 * "[x]" inside the item text. Rewrites the file via temp+rename.
 */
export function setItemCompleteAtLine(
  file: string, lineNo: number, state: "complete" | "incomplete",
): void {
  const lines = readFileSync(file, "utf8").split("\n");
  const line = lines[lineNo - 1] ?? "";
  const item = classifyCheckbox(line);
  if (item === null) return;
  if ((state === "complete") === item.done) return;
  lines[lineNo - 1] = line.replace(/^([ \t]*-[ \t]+\[)[ xX](\])/, `$1${state === "complete" ? "x" : " "}$2`);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, lines.join("\n"));
  renameSync(tmp, file);
}

// Counts cover top-level items only, matching what plan-parse counts.
function countKind(content: string, kind: "task" | "ac"): { completed: number; total: number } {
  let total = 0, completed = 0;
  for (const line of content.split("\n")) {
    const c = classifyCheckbox(line);
    if (c === null || c.kind !== kind || c.indent !== "") continue;
    total++;
    if (c.done) completed++;
  }
  return { completed, total };
}

/** Total and completed AC checkbox counts. */
export function countAcs(content: string): { completed: number; total: number } {
  return countKind(content, "ac");
}

/** Total and completed task checkbox counts (task progress). */
export function countTasks(content: string): { completed: number; total: number } {
  return countKind(content, "task");
}

const PLAN_FILE = /^(?:Plan-.*|Implementation_plan-.*)\.md$/;

/** Plan files in the first of `dirs` that holds any, sorted; empty when none. */
export function findPlanFiles(dirs: readonly string[]): { dir: string; files: string[] } {
  for (const dir of dirs) {
    try {
      const files = readdirSync(dir).filter((e) => PLAN_FILE.test(e)).sort();
      if (files.length > 0) return { dir, files };
    } catch { /* dir missing */ }
  }
  return { dir: "", files: [] };
}
