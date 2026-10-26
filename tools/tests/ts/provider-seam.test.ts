// Provider-seam gate: no direct provider-CLI invocations outside the provider
// layer. The provider layer (tools/lib/providers/, plus the test stubs) owns
// its CLI; everything else goes through the facade verbs. Mirrors the
// strip-only lint ban: a violation fails CI rather than relying on convention.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "../../..");
const SRC_DIRS = ["tools/ts", "tools/scripts", "tools/lib", "tools/internal"] as const;

// gh/az invocation shapes: a spawn/exec family call whose first argument is
// the CLI name. String-template and variable first args are not matched (they
// cannot be statically judged); the audit that landed this gate swept those
// manually and the facade verbs are the reviewed path for new code.
const CLI_SHAPE =
  /(execFileSync|execFile|spawnSync|spawn)\(\s*["'](gh|az)["']/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts")) yield p;
  }
}

describe("provider seam gate", () => {
  it("spawns no gh/az CLI outside tools/lib/providers/", () => {
    const violations: string[] = [];
    for (const dir of SRC_DIRS) {
      for (const file of walk(join(REPO, dir))) {
        // The provider layer IS the sanctioned transport owner.
        if (file.includes(`${join("tools", "lib", "providers")}`)) continue;
        // Test stubs mock the CLI on purpose.
        if (file.includes(`${join("tools", "tests")}`)) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          // Self-referential docstrings/tests of this gate name the pattern
          // without spawning anything.
          if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
          if (CLI_SHAPE.test(line)) {
            violations.push(`${file.replace(`${REPO}/`, "")}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(
      violations,
      `direct provider-CLI calls outside tools/lib/providers/ (move behind a facade verb):\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
