// markdown.ts — plan-markdown mutation helpers (domain/headless).
// Port of the markdown.bash functions the markdown-plan-complete-* tools use:
// checkbox find/set/count for AC items and tasks. Line/checkbox semantics are
// pinned by the test_markdown_plan_complete bats suite.

import { readFileSync, writeFileSync, renameSync } from "node:fs";

/** AC numbers: AC-N, AC-N.N, AC-N.N.N */
export function validateAcNumber(ac: string): boolean {
  return /^AC-[0-9]+(\.[0-9]+)*$/.test(ac);
}

/** Task numbers: X.Y or X.Y.Z */
export function validateTaskNumber(task: string): boolean {
  return /^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(task);
}

/** The bash AC locator: `- [x] ... **AC-N[.N...]**` (dots escaped). */
function acPattern(ac: string): RegExp {
  const escaped = ac.replaceAll(".", "\\.");
  return new RegExp(`^[ \\t]*- \\[[ x]\\][ \\t]+.*\\*\\*${escaped}\\*\\*`);
}

/** The bash task locator: `- [x] **N.N[.N] ` (bold title start). */
function taskPattern(task: string): RegExp {
  const escaped = task.replaceAll(".", "\\.");
  return new RegExp(`^[ \\t]*- \\[[ x]\\][ \\t]+\\*\\*${escaped}[ \\t]`);
}

/** 1-based line number of the first checkbox line matching, or null. */
export function findItemLine(content: string, pattern: RegExp): number | null {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i] as string)) return i + 1;
  }
  return null;
}

export function findAcLine(content: string, ac: string): number | null {
  return findItemLine(content, acPattern(ac));
}

export function findTaskLine(content: string, task: string): number | null {
  return findItemLine(content, taskPattern(task));
}

/**
 * Flip the checkbox on a 1-based line to [x] or [ ]. Already-in-state is a
 * no-op success (bash parity). Rewrites the file via temp+rename.
 */
export function setItemCompleteAtLine(
  file: string, lineNo: number, state: "complete" | "incomplete",
): void {
  const lines = readFileSync(file, "utf8").split("\n");
  const line = lines[lineNo - 1] ?? "";
  if (state === "complete" && line.includes("[x]")) return;
  if (state === "incomplete" && line.includes("[ ]")) return;
  lines[lineNo - 1] = line.replace(/\[[ x]\]/, state === "complete" ? "[x]" : "[ ]");
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, lines.join("\n"));
  renameSync(tmp, file);
}

/** Total and completed AC checkbox counts ("completed total" bash shape). */
export function countAcs(content: string): { completed: number; total: number } {
  const re = /^[ \t]*- \[[ x]\][ \t]+.*\*\*AC-[0-9]+(\.[0-9]+)*\*\*/;
  const doneRe = /^[ \t]*- \[x\][ \t]+.*\*\*AC-[0-9]+(\.[0-9]+)*\*\*/;
  let total = 0, completed = 0;
  for (const line of content.split("\n")) {
    if (re.test(line)) {
      total++;
      if (doneRe.test(line)) completed++;
    }
  }
  return { completed, total };
}

/** Total and completed generic checkbox counts (task progress). */
export function countTasks(content: string): { completed: number; total: number } {
  const re = /^[ \t]*- \[[ x]\]/;
  const doneRe = /^[ \t]*- \[x\]/;
  let total = 0, completed = 0;
  for (const line of content.split("\n")) {
    if (re.test(line)) {
      total++;
      if (doneRe.test(line)) completed++;
    }
  }
  return { completed, total };
}
