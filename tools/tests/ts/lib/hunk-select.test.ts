// hunk-select.test.ts — unit tests for the pure hunk-selection primitives.
// The diff fixtures are real `git diff` output shapes (captured from the
// Phase 1 spike), not hand-composed.
import { describe, expect, it } from "vitest";
import {
  buildSelectionPatch,
  hunkPayload,
  parseHunkSpec,
  splitDiff,
  HunkParseError,
} from "../../../lib/domain/hunk-select.ts";

// Real git diff shape: two separated hunks in one file (60-line base,
// line 4 and line 40 changed). Preamble carries the standard headers.
const TWO_HUNK_DIFF = [
  "diff --git a/f.txt b/f.txt",
  "index 1234567..89abcde 100644",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,7 +1,7 @@",
  " line1",
  " line2",
  " line3",
  "-line4",
  "+line4-CHANGED",
  " line5",
  " line6",
  " line7",
  "@@ -37,7 +37,7 @@ line36",
  " line37",
  " line38",
  " line39",
  "-line40",
  "+line40-CHANGED",
  " line41",
  " line42",
  " line43",
  "",
].join("\n");

describe("splitDiff", () => {
  it("enumerates hunks 1-based and separates the preamble", () => {
    const { preamble, hunks } = splitDiff(TWO_HUNK_DIFF);
    expect(preamble).toEqual([
      "diff --git a/f.txt b/f.txt",
      "index 1234567..89abcde 100644",
      "--- a/f.txt",
      "+++ b/f.txt",
    ]);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.index).toBe(1);
    expect(hunks[0]!.header).toBe("@@ -1,7 +1,7 @@");
    expect(hunks[1]!.index).toBe(2);
    expect(hunks[1]!.header).toBe("@@ -37,7 +37,7 @@ line36");
    expect(hunks[1]!.lines).toHaveLength(8); // 3 ctx + 1 del + 1 add + 3 ctx
  });

  it("refuses a multi-file diff, naming the count", () => {
    const twoFiles = TWO_HUNK_DIFF + "diff --git a/g.txt b/g.txt\n@@ -1,1 +1,1 @@\n-x\n+y\n";
    expect(() => splitDiff(twoFiles)).toThrow(/found 2/);
  });

  it("refuses input with no hunks (nothing unstaged)", () => {
    const empty = "diff --git a/f.txt b/f.txt\nindex a..b 100644\n";
    expect(() => splitDiff(empty)).toThrow(/no hunks found/);
  });

  it("refuses garbage lines inside a hunk with the line number", () => {
    const bad = TWO_HUNK_DIFF.replace(" line2\n", "garbage line\n");
    expect(() => splitDiff(bad)).toThrow(HunkParseError);
    try {
      splitDiff(bad);
    } catch (e) {
      expect((e as HunkParseError).lineNumber).toBe(7); // preamble 4 + @@ = line 5; line1=6, line2=7
    }
  });
});

describe("parseHunkSpec", () => {
  it("parses singles and ranges with dedupe and sorted output", () => {
    expect(parseHunkSpec("3")).toEqual([3]);
    expect(parseHunkSpec("1-2,4")).toEqual([1, 2, 4]);
    expect(parseHunkSpec("4,2,2-3")).toEqual([2, 3, 4]);
  });

  it("refuses non-numeric, reversed, and empty specs", () => {
    expect(() => parseHunkSpec("a")).toThrow(/not a hunk number/);
    expect(() => parseHunkSpec("5-2")).toThrow(/range end before start/);
    expect(() => parseHunkSpec("1,,2")).toThrow(/empty range element/);
    expect(() => parseHunkSpec("0")).toThrow(/1-based/); // 0 is not a hunk
  });
});

describe("buildSelectionPatch", () => {
  it("builds a standalone patch from the preamble plus chosen hunks", () => {
    const { preamble, hunks } = splitDiff(TWO_HUNK_DIFF);
    const patch = buildSelectionPatch(preamble, hunks, [2]);
    expect(patch).toBe(
      [preamble.join("\n"), hunks[1]!.header, ...hunks[1]!.lines].join("\n") + "\n",
    );
  });

  it("orders chosen hunks by diff position, not spec order", () => {
    const { preamble, hunks } = splitDiff(TWO_HUNK_DIFF);
    const patch = buildSelectionPatch(preamble, hunks, [2, 1]);
    expect(patch.indexOf("@@ -1,7")).toBeLessThan(patch.indexOf("@@ -37,7"));
  });

  it("refuses out-of-range selections naming the live hunk count", () => {
    const { preamble, hunks } = splitDiff(TWO_HUNK_DIFF);
    expect(() => buildSelectionPatch(preamble, hunks, [3])).toThrow(/out of range.*2 hunks/s);
  });
});

describe("hunkPayload", () => {
  it("identifies a hunk by its changed lines, sigils stripped", () => {
    const { hunks } = splitDiff(TWO_HUNK_DIFF);
    expect(hunkPayload(hunks[0]!)).toBe("line4\nline4-CHANGED");
  });
});
