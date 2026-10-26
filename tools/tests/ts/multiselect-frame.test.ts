// The multiselect focus-visibility contract (13.7): the focused row is marked
// with a cursor column (`❯`) that does NOT depend on color support — clack's
// own frame marks focus only with a checkbox color, which vanishes in
// color-less profiles and left multi-select unusable without counting rows.
import { describe, expect, it } from "vitest";
import { multiselectFrame } from "../../lib/ui/prompts.ts";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

const opts = (labels: string[]) =>
  labels.map((l) => ({ value: [l, l] as [string, string] }));

describe("multiselectFrame focus visibility", () => {
  it("marks exactly the focused row with a cursor column (color stripped)", () => {
    const frame = stripAnsi(
      multiselectFrame("pick", opts(["alpha", "beta", "gamma"]), [], 1, "idle"),
    );
    const lines = frame.split("\n").filter((l) => l.includes("│"));
    const marked = lines.filter((l) => l.includes("❯"));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain("beta");
    expect(lines[1]).toContain("❯");
  });

  it("every row differs by glyph: cursor column for focus, box for selection", () => {
    const frame = stripAnsi(
      multiselectFrame(
        "pick",
        opts(["alpha", "beta", "gamma"]),
        [["alpha", "alpha"]],
        2,
        "idle",
      ),
    );
    const lines = frame.split("\n").filter((l) => l.includes("│  "));
    expect(lines).toHaveLength(3);
    // checked row: filled box; unchecked: empty box; focused row: cursor glyph
    expect(lines[0]).toContain("◼ alpha");
    expect(lines[1]).toContain("◻ beta");
    expect(lines[2]).toContain("❯ ◻ gamma");
  });

  it("moving focus moves the cursor column (down-arrow simulation)", () => {
    const before = stripAnsi(
      multiselectFrame("pick", opts(["a", "b"]), [], 0, "idle"),
    );
    const after = stripAnsi(
      multiselectFrame("pick", opts(["a", "b"]), [], 1, "idle"),
    );
    expect(before.split("\n").filter((l) => l.includes("❯"))[0]).toContain("a");
    expect(after.split("\n").filter((l) => l.includes("❯"))[0]).toContain("b");
  });

  it("submit renders the chosen labels without the option list", () => {
    const frame = stripAnsi(
      multiselectFrame(
        "pick",
        opts(["a", "b"]),
        [["a", "a"]],
        0,
        "submit",
      ),
    );
    expect(frame).toContain("a");
    expect(frame).not.toContain("◻");
    expect(frame).not.toContain("❯");
  });
});
