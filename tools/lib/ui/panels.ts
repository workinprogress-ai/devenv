// ui/panels.ts — styled output: headings, key-value tables, boxes, log styles.
//
// picocolors carries color; styles are disabled automatically when the
// context is non-TTY (picocolors handles TTY detection itself), so callers
// never branch on color support.

import pc from "picocolors";

/** Accent heading with an underline rule. */
export function heading(title: string): string {
  return `${pc.bold(title)}\n${pc.dim("─".repeat(Math.min(title.length, 60)))}`;
}

export interface KVRow {
  key: string;
  value: string;
}

/** Two-column key/value listing, keys padded to the widest key. */
export function kvTable(rows: KVRow[]): string {
  const width = Math.max(...rows.map((r) => r.key.length));
  return rows.map((r) => `${pc.dim(r.key.padEnd(width))}  ${r.value}`).join("\n");
}

/** Single-line status styles consistent with lib/core/logging prefixes. */
export const styles = {
  success: (s: string): string => pc.green(s),
  error: (s: string): string => pc.red(s),
  warn: (s: string): string => pc.yellow(s),
  info: (s: string): string => pc.cyan(s),
  dim: (s: string): string => pc.dim(s),
  bold: (s: string): string => pc.bold(s),
};

/** A bordered box around arbitrary text (no wrapping — caller formats lines). */
export function box(lines: string[]): string {
  if (lines.length === 0) return "";
  const width = Math.max(...lines.map((l) => l.length));
  const top = pc.dim(`┌${"─".repeat(width + 2)}┐`);
  const bottom = pc.dim(`└${"─".repeat(width + 2)}┘`);
  const body = lines.map((l) => `${pc.dim("│")} ${l.padEnd(width)} ${pc.dim("│")}`);
  return [top, ...body, bottom].join("\n");
}

export interface TableRow {
  cells: string[];
}

/**
 * Column-aligned data table: every column as wide as its widest cell
 * (header included), two spaces between columns. gh's table shape without
 * gh's no-TTY fallback (which emits unaligned tab-separated fields when
 * stdout is not a terminal — the reason tools render their own tables).
 */
export function formatTable(headers: string[], rows: TableRow[]): string {
  if (headers.length === 0) return "";
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r.cells[i] ?? "").length)),
  );
  const render = (cells: string[]): string =>
    cells
      .map((c, i) => (c ?? "").padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  const headerLine = pc.bold(render(headers));
  const bodyLines = rows.map((r) => render(r.cells));
  return [headerLine, ...bodyLines].join("\n");
}
