// Port of tools/tests/scripts/test_markdown_plan_complete.bats (4 tests).
// markdown-plan-complete-task / markdown-plan-complete-ac auto-detect order
// (shared: .local-artifacts/ first, then cwd).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolScript } from "./harness/index.ts";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });


let TMP = "";
let WORK_DIR = "";
let ART_DIR = "";

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `mdplan-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  // A plan in the cwd and a DIFFERENT stale plan in .local-artifacts/ —
  // auto-detect must resolve the .local-artifacts/ copy first in both tools.
  WORK_DIR = join(TMP, "work");
  ART_DIR = join(WORK_DIR, ".local-artifacts");
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(ART_DIR, { recursive: true });
  writeFileSync(
    join(ART_DIR, "Plan-issue-9-001.md"),
    "# Artifact plan\n\n## Phase 1 — A\n\n- [ ] **1.1 [S] artifact copy task**\n",
  );
  writeFileSync(
    join(WORK_DIR, "Plan-issue-9-001.md"),
    "# Cwd plan\n\n## Phase 1 — A\n\n- [ ] **1.1 [S] cwd copy task**\n",
  );
});

function runTask(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [toolScript("markdown-plan-complete-task"), ...args], { cwd: WORK_DIR, encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function runAc(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [toolScript("markdown-plan-complete-ac"), ...args], { cwd: WORK_DIR, encoding: "utf8" });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

describe("scripts/markdown-plan-complete", () => {
  it("task tool auto-detect prefers .local-artifacts/ over cwd", () => {
    const r = runTask(["1.1"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain(".local-artifacts/Plan-issue-9-001.md");
    // cwd copy untouched
    expect(readFileSync(join(WORK_DIR, "Plan-issue-9-001.md"), "utf8")).toContain("[ ] **1.1");
    // artifact copy ticked
    expect(readFileSync(join(ART_DIR, "Plan-issue-9-001.md"), "utf8")).toContain("[x] **1.1");
  });

  it("ac tool auto-detect prefers .local-artifacts/ over cwd", () => {
    writeFileSync(join(ART_DIR, "Plan-issue-9-001.md"), readFileSync(join(ART_DIR, "Plan-issue-9-001.md"), "utf8") + "\n- [ ] **AC-1** artifact copy criterion\n");
    writeFileSync(join(WORK_DIR, "Plan-issue-9-001.md"), readFileSync(join(WORK_DIR, "Plan-issue-9-001.md"), "utf8") + "\n- [ ] **AC-1** cwd copy criterion\n");
    const r = runAc(["AC-1"]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(ART_DIR, "Plan-issue-9-001.md"), "utf8")).toContain("[x] **AC-1** artifact copy criterion");
    expect(readFileSync(join(WORK_DIR, "Plan-issue-9-001.md"), "utf8")).toContain("[ ] **AC-1** cwd copy criterion");
  });

  it("task tool falls back to cwd when .local-artifacts/ has no plan", () => {
    spawnSync("rm", [join(ART_DIR, "Plan-issue-9-001.md")]);
    const r = runTask(["1.1"]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(WORK_DIR, "Plan-issue-9-001.md"), "utf8")).toContain("[x] **1.1");
  });

  it("explicit file argument beats auto-detect in task tool", () => {
    const r = runTask(["1.1", join(WORK_DIR, "Plan-issue-9-001.md")]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(WORK_DIR, "Plan-issue-9-001.md"), "utf8")).toContain("[x] **1.1");
    expect(readFileSync(join(ART_DIR, "Plan-issue-9-001.md"), "utf8")).toContain("[ ] **1.1");
  });
});
