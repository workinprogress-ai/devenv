// commit-format: the conventional-commit title check shared by pr-create and
// pr-merge. The type list must equal commitlint.config.js's type-enum.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMIT_TYPES, conventionalCommitsOk } from "../../lib/core/commit-format.ts";

function commitlintTypeEnum(): string[] {
  const text = readFileSync(join(import.meta.dirname, "..", "..", "..", "commitlint.config.js"), "utf8");
  const block = /'type-enum':\s*\[\s*\d+,\s*'always',\s*\[([\s\S]*?)\]\s*\]/.exec(text);
  if (block === null || block[1] === undefined) throw new Error("type-enum not found in commitlint.config.js");
  return [...block[1].replace(/\/\/.*$/gm, "").matchAll(/'([a-z]+)'/g)].map((m) => m[1] as string);
}

describe("core/commit-format", () => {
  it("COMMIT_TYPES equals the commitlint type-enum", () => {
    expect([...COMMIT_TYPES].sort()).toEqual(commitlintTypeEnum().sort());
  });

  it("accepts type, optional scope, optional bang, and a subject", () => {
    for (const t of ["feat: add x", "fix(core): y", "feat!: break", "refactor(a-b)!: z", "patch: bump", "major: m"]) {
      expect(conventionalCommitsOk(t), t).toBe(true);
    }
  });

  it("rejects unknown types, missing subject or space, and empty titles", () => {
    for (const t of ["", "wip: x", "feat:x", "feat: ", "feat", "Feat: x", "feat(): x", " feat: x"]) {
      expect(conventionalCommitsOk(t), t).toBe(false);
    }
  });
});
