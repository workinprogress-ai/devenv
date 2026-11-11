// roadmap-parse computes per-step progress from the matched plan file
// in-process: no generated plan-parse stub is involved, so a clean checkout
// (no depth-1 stubs) reports real progress instead of null.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool } from "./harness/index.ts";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "rmprog-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("roadmap-parse plan progress", () => {
  it("reports done/total/pct for a step whose plan file backlinks it, with no stub present", () => {
    const roadmap = join(tmp, "roadmap.md");
    writeFileSync(
      roadmap,
      ["# Roadmap: T", "", "## Steps", "", "### STEP-01: Build", "", "**Status**: In progress", "**Issues**: org/repo#1", ""].join("\n"),
    );
    const planDir = join(tmp, "plans");
    const planPath = join(planDir, "Plan-issue-1-001.md");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      planPath,
      ["# Plan", "Implements STEP-01 of the roadmap.", "", "### Phase 1 — Do", "", "- [x] **1.1 [S] one**", "- [ ] **1.2 [S] two**", "- [ ] **1.3 [S] three**", "- [x] **1.4 [S] four**", ""].join("\n"),
    );
    const r = runTool("roadmap-parse", [roadmap, "--plan-dir", planDir], {
      env: { DEVENV_TOOLS: join(tmp, "no-such-tools-dir") },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { steps: Array<{ step: string; progress: { done: number; total: number; pct: string } | null; plan_file: string | null }> };
    expect(out.steps[0]?.plan_file).toBe(planPath);
    expect(out.steps[0]?.progress).toEqual({ done: 2, total: 4, pct: "50" });
  });
});
