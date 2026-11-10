// hunk-select.ts — hunk-level selection over a unified diff (domain/headless).
//
// Partial staging needs three pure primitives over a file's unified diff:
// enumerate its hunks, select some of them, and re-serialize the selection
// as a standalone patch. This module provides those primitives with no I/O
// and no git dependency — the engine (repo-stage) and the tests share the
// same enumeration contract: 1-based, file-local hunk numbers over the
// tool's own `git diff` output (default context U3).
//
// The parser is intentionally narrow: it handles exactly the shape git
// emits for a single-file worktree-vs-index diff (the diff --no-prefix
// form repo-stage builds patches from). Multi-file diffs refuse with a
// named file count. Malformed input refuses with the offending line
// number — the same strict-parse posture as commit-batch.ts.

/** A single hunk of a unified diff: its @@ header and body lines. */
export interface DiffHunk {
  /** 1-based position of this hunk within the file's diff. */
  readonly index: number;
  /** The `@@ -a,b +c,d @@ …` header line, verbatim. */
  readonly header: string;
  /** Body lines (context/added/removed), verbatim, header excluded. */
  readonly lines: string[];
}

/** Parse failures: named, collectable, renderable by the CLI. */
export class HunkParseError extends Error {
  /** The 1-based line number in the input diff that failed to parse. */
  readonly lineNumber: number;
  /** What the offending line is, verbatim. */
  readonly line: string;

  constructor(lineNumber: number, line: string, reason: string) {
    super(`line ${lineNumber}: ${reason} (got: ${line.slice(0, 80)})`);
    this.name = "HunkParseError";
    this.lineNumber = lineNumber;
    this.line = line;
  }
}

/**
 * Split a single-file unified diff into preamble and hunks.
 *
 * The input is the verbatim stdout of `git diff` for ONE file. The preamble
 * (diff --git / --- / +++ / index / mode lines) is returned separately so a
 * selection of hunks can be re-serialized under the same file headers.
 *
 * Refuses (HunkParseError) when the input does not match that shape.
 */
export function splitDiff(input: string): { preamble: string[]; hunks: DiffHunk[] } {
  const lines = input.split("\n");
  // Trailing newline on git output splits to one empty tail element.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const preamble: string[] = [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let fileCount = 0;
  let sawHunk = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNumber = i + 1;
    if (line === undefined) break;
    if (line.startsWith("diff --git ")) {
      fileCount += 1;
      if (fileCount > 1) {
        throw new HunkParseError(
          lineNumber,
          line,
          `multi-file diff — expected exactly one file, found ${fileCount} diff --git headers`,
        );
      }
    }
    if (line.startsWith("@@")) {
      if (current) hunks.push(current);
      current = { index: hunks.length + 1, header: line, lines: [] };
      sawHunk = true;
      continue;
    }
    if (!sawHunk) {
      preamble.push(line);
      continue;
    }
    if (!line.startsWith(" ") && !line.startsWith("+") && !line.startsWith("-") && !line.startsWith("\\")) {
      throw new HunkParseError(lineNumber, line, "line outside any hunk that is not a preamble construct");
    }
    if (current) current.lines.push(line);
  }
  if (current) hunks.push(current);
  if (fileCount !== 1) {
    throw new HunkParseError(1, "", `expected exactly one diff --git header, found ${fileCount}`);
  }
  if (!sawHunk) {
    throw new HunkParseError(1, "", "no hunks found — the file has no unstaged diff");
  }
  return { preamble, hunks };
}

/** Parse a hunk-selection spec: `1-2,4` → [1, 2, 4]; `3` → [3]. Ranges
 * are capped at the same ceiling as manifest specs — a fat-fingered huge
 * range refuses instead of hanging. */
export const HUNK_SPEC_CEILING = 10000;

export function parseHunkSpec(spec: string): number[] {
  const out: number[] = [];
  for (const partRaw of spec.split(",")) {
    const part = partRaw.trim();
    if (part === "") throw new HunkParseError(1, spec, "empty range element");
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) throw new HunkParseError(1, spec, "not a hunk number or a-b range");
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1) throw new HunkParseError(1, spec, "hunks are 1-based — 0 is not a hunk");
    if (to < from) throw new HunkParseError(1, spec, "range end before start");
    if (to - from >= HUNK_SPEC_CEILING) {
      throw new HunkParseError(1, spec, `range exceeds the ceiling (${HUNK_SPEC_CEILING}) — fix the spec`);
    }
    // TOTAL-expansion cap: repeated/disjoint ranges multiply work on the
    // comma path — bound the expanded size, not just each range's span
    // (a spec of many in-ceiling ranges must refuse, not hang).
    if (out.length >= HUNK_SPEC_CEILING) {
      throw new HunkParseError(1, spec, `expands past the total ceiling (${HUNK_SPEC_CEILING} hunks) — fix the spec`);
    }
    for (let n = from; n <= to; n += 1) {
      if (!out.includes(n)) out.push(n);
    }
  }
  if (out.length === 0) throw new HunkParseError(1, spec, "no hunks selected");
  return out.sort((a, b) => a - b);
}

/**
 * Re-serialize a selection of hunks as a standalone patch: the original
 * preamble (file headers) plus exactly the chosen hunks, in order.
 *
 * The returned string is directly feedable to `git apply --cached`. Hunk
 * numbers are 1-based positions in `hunks`; out-of-range selections refuse
 * with a diagnostic naming the file's live hunk count.
 */
export function buildSelectionPatch(
  preamble: string[],
  hunks: DiffHunk[],
  selected: number[],
): string {
  const max = hunks.length;
  const bad = selected.filter((n) => n < 1 || n > max);
  if (bad.length > 0) {
    throw new HunkParseError(
      1,
      selected.join(","),
      `hunk ${bad[0]} is out of range — the file has ${max} hunk${max === 1 ? "" : "s"}; re-check the grouping or edit the selectors`,
    );
  }
  // Selection order follows the diff, not the spec order, so the patch
  // stays a valid unified diff regardless of how the spec listed hunks.
  // Mode lines are STRIPPED from the reused preamble: an unstaged chmod
  // riding along would silently flip the file's mode when only content
  // hunks were claimed.
  const keptPreamble = preamble.filter((l) => !l.startsWith("old mode ") && !l.startsWith("new mode "));
  const chosen = hunks.filter((h) => selected.includes(h.index));
  const body = chosen.map((h) => [h.header, ...h.lines].join("\n")).join("\n");
  return [keptPreamble.join("\n"), body].join("\n") + "\n";
}

/**
 * Identify a hunk by its changed lines: the +/- payload lines with the
 * leading sigil stripped, joined — a stable identity for echo text and for
 * staged-vs-selected verification (survives line-number drift, which the
 * spike proved apply silently tolerates).
 */
export function hunkPayload(h: DiffHunk): string {
  return h.lines
    .filter((l) => l.startsWith("+") || l.startsWith("-"))
    .map((l) => l.slice(1))
    .join("\n");
}

