// editor: the EDITOR/VISUAL hatch follows the suite CLI contract — help is a
// success on stdout, misuse (no file, unknown flag) exits 2 on stderr, and
// nothing is opened in either case.
import { describe, expect, it } from "vitest";
import { runTool } from "./harness/index.ts";
import { EXIT_MISUSE, EXIT_SUCCESS } from "../../lib/core/exit-codes.ts";

describe("editor CLI contract", () => {
  it("--help exits 0 with usage on stdout", () => {
    const r = runTool("editor", ["--help"]);
    expect(r.status).toBe(EXIT_SUCCESS);
    expect(r.stdout).toContain("Usage: editor");
  });

  it("no file is misuse: exit 2 with usage on stderr", () => {
    const r = runTool("editor", []);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.stderr).toContain("Usage: editor");
  });

  it("an unknown flag is misuse: exit 2", () => {
    const r = runTool("editor", ["--no-such-flag"]);
    expect(r.status).toBe(EXIT_MISUSE);
  });
});
