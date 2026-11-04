// Port of tools/tests/devenv/test_negation_assertions.bats (3 tests) — one vitest `it` per source `@test`.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))); // file → ts → tests → tools → devenv root

// Port of tools/tests/devenv/test_negation_assertions.bats — one vitest `it` per source `@test`.

// ── negation-assertions (port of test_negation_assertions.bats, 3 tests) ─

// negationOffenders: "file:line: text" for each statement-start `! cmd`
// whose next significant line is neither the closing brace of the test nor
// the closing quote of an enclosing multi-line string (a negated command
// that is not the last statement of a bats test asserts nothing).
function negationOffenders(files: string[]): string {
  const significant = (s: string): boolean => !/^[ \t]*(#.*)?$/.test(s);
  let out = "";
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/^[ \t]*![ \t]+[^ \t]/.test(lines[i]!)) {
        let j = i + 1;
        while (j < lines.length && !significant(lines[j]!)) j++;
        const next = lines[j] ?? "";
        if (!/^\}[ \t]*$/.test(next) && !/^[ \t]*"[ \t]*$/.test(next)) {
          out += `${f}:${i + 1}: ${lines[i]}\n`;
        }
      }
    }
  }
  return out;
}

describe("negation-assertions", () => {
  it("no test suite has a non-final negated command statement", () => {
    const glob = execFileSync(
      "bash",
      ["-c", 'ls "$1"/tools/tests/*/*.bats', "sh", ROOT],
      { encoding: "utf8" },
    ).trim();
    const files = glob.split("\n").filter((l) => l !== "");
    expect(negationOffenders(files)).toBe("");
  });

  it("the guard flags a non-final negation (it is not vacuous)", () => {
    const dir = mkdirSync(join(tmpdir(), `negation-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true })!;
    const bad = join(dir, "bad.bats");
    writeFileSync(bad, '@test "x" {\n    ! grep -q foo file\n    true\n}\n');
    expect(negationOffenders([bad])).toContain("bad.bats:2:");
  });

  it("the guard accepts a final negation and the enforcing forms", () => {
    const dir = mkdirSync(join(tmpdir(), `negation-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true })!;
    const good = join(dir, "good.bats");
    writeFileSync(
      good,
      '@test "x" {\n    run ! grep -q foo file\n    [[ ! "$output" =~ x ]]\n    ! grep -q foo file\n}\n',
    );
    expect(negationOffenders([good])).toBe("");
  });
});
