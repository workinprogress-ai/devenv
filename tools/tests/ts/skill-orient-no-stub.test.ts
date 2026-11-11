// skill-orient in a clean checkout (no generated depth-1 stubs): the plan
// census and the TODO-marker report come from the real sibling tools run from
// this checkout, so the orientation blob is complete.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runTool, tmpDir } from "./harness/index.ts";

let dir = "";

beforeEach(() => {
  dir = tmpDir("orientnostub");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("skill-orient without generated stubs", () => {
  it("reports plan census totals and scoped TODO markers", () => {
    const plan = join(dir, "Plan-fixture-001.md");
    writeFileSync(plan, ["# Plan", "", "### Phase 1 — Do", "", "- [x] **1.1 [S] one**", "- [ ] **1.2 [S] two**", ""].join("\n"));
    const scope = join(dir, "src");
    mkdirSync(scope);
    writeFileSync(join(scope, "a.ts"), "// TODO:DEVENV[Fixture-001]: keep me — remove when the fixture ends\n");
    const r = runTool("skill-orient", ["--plan", plan, "--scope", scope], { cwd: dir });
    expect(r.status, r.output).toBe(0);
    const blob = JSON.parse(r.stdout) as { plan: { done: number; total: number; open: number } | null; todos: unknown[] };
    expect(blob.plan).toMatchObject({ done: 1, total: 2, open: 1 });
    expect(blob.todos.length).toBe(1);
  });
});
