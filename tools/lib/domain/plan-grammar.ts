// plan-grammar.ts — the one checkbox grammar for plans (pure, no imports).
// parsePlan, the markdown-plan-complete-* tools and the count helpers all
// classify lines through classifyCheckbox so they can never disagree about
// what is a task or an acceptance criterion.

export type CheckboxKind = "task" | "ac" | "other";

export interface CheckboxLine {
  kind: CheckboxKind;
  /** Task id ("2.1") or AC id ("AC-1.2"); "" for kind "other". */
  id: string;
  done: boolean;
  /** Leading whitespace; "" for a top-level item. */
  indent: string;
  /** Text after the checkbox, with any leading bold marker intact. */
  body: string;
}

// `.` does not match \r, so the pattern is deliberately not end-anchored.
const CHECKBOX = /^([ \t]*)-[ \t]+\[([ xX])\][ \t]+/;
// Task: optional bold, then a dotted numeric id (2.1, 2.1.1) at the start.
const TASK_ID = /^(?:\*\*)?(\d+(?:\.\d+)+)/;
// AC: optional anchor tag and bold, then AC-N[.N...] as the leading token.
const AC_ID = /^(?:<a\b[^>]*><\/a>)?(?:\*\*)?(AC-\d+(?:\.\d+)*)(?![\w])/;

/** Classify one line; null when it is not a checkbox item. Tasks are tested first. */
export function classifyCheckbox(line: string): CheckboxLine | null {
  const m = CHECKBOX.exec(line);
  if (!m) return null;
  const body = line.slice(m[0].length);
  const done = m[2] !== " ";
  const indent = m[1] as string;
  const task = TASK_ID.exec(body);
  if (task) return { kind: "task", id: task[1] as string, done, indent, body };
  const ac = AC_ID.exec(body);
  if (ac) return { kind: "ac", id: ac[1] as string, done, indent, body };
  return { kind: "other", id: "", done, indent, body };
}

/** The first line index (0-based) holding a checkbox item of this kind and id, or -1. */
export function findCheckboxIndex(lines: readonly string[], kind: "task" | "ac", id: string): number {
  for (let i = 0; i < lines.length; i++) {
    const c = classifyCheckbox(lines[i] as string);
    if (c && c.kind === kind && c.id === id && taskIdBoundaryOk(c)) return i;
  }
  return -1;
}

// A task id must end at the id: `2.1` is not `2.1a` and not the start of `2.1x`.
function taskIdBoundaryOk(c: CheckboxLine): boolean {
  if (c.kind !== "task") return true;
  const after = c.body.replace(/^\*\*/, "").slice(c.id.length);
  return !/^[A-Za-z0-9]/.test(after);
}
