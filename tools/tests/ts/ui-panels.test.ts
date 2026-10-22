// Tests for ui/panels formatTable: column alignment independent of content
// width, empty-cell handling, and the empty-table contract.
import { describe, it, expect } from "vitest";
import { formatTable } from "../../lib/ui/panels.ts";

// Color Toggles with the environment (picocolors): strip ANSI so the
// assertions test geometry, not styling.
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("ui/panels formatTable", () => {
  it("aligns every column to its widest cell (header included)", () => {
    const out = formatTable(
      ["ID", "TITLE", "UPDATED"],
      [
        { cells: ["#7", "Small title", "today"] },
        { cells: ["#123", "A much longer title than the rest", "about 9 days ago"] },
      ],
    );
    const lines = out.split("\n").map(plain);
    expect(lines).toHaveLength(3);
    const [header, row1, row2] = lines as [string, string, string];
    expect(lines).toHaveLength(3);
    // ID column is 4 wide (#123), so every row's ID cell is padded to 4
    // plus the two-space gutter: column 2 starts at index 6 everywhere.
    expect(header.startsWith("ID    TITLE")).toBe(true);
    expect(row1.startsWith("#7    Small title")).toBe(true);
    expect(row2.startsWith("#123  A much longer")).toBe(true);
    // The last column lines up across rows (same start offset).
    expect(row1.indexOf("today")).toBe(row2.indexOf("about 9 days ago"));
  });

  it("renders missing cells as empty padding, not the string undefined", () => {
    const out = formatTable(["A", "B"], [{ cells: ["x"] }]);
    expect(out).not.toContain("undefined");
    expect(plain(out.split("\n")[1] ?? "")).toMatch(/^x/);
  });

  it("returns an empty string for an empty header list", () => {
    expect(formatTable([], [])).toBe("");
  });
});
