// Port of tools/tests/scripts/test_markdown_plan_complete.bats (4 tests).
// markdown-plan-complete-task / markdown-plan-complete-ac auto-detect order
// (shared: .local-artifacts/ first, then cwd).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolScript } from "./harness/index.ts";
import { EXIT_MISUSE } from "../../lib/core/exit-codes.ts";

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

  it("task tool refuses to guess when several plans match", () => {
    const second = join(ART_DIR, "Plan-issue-9-002.md");
    writeFileSync(second, "## Phase 1 — A\n\n- [ ] **1.1 [S] second plan task**\n");
    const r = runTask(["1.1"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(r.out).toContain("Plan-issue-9-001.md");
    expect(r.out).toContain("Plan-issue-9-002.md");
    expect(readFileSync(join(ART_DIR, "Plan-issue-9-001.md"), "utf8")).toContain("[ ] **1.1");
    expect(readFileSync(second, "utf8")).toContain("[ ] **1.1");
  });

  it("ac tool refuses to guess when several plans match", () => {
    writeFileSync(join(ART_DIR, "Plan-issue-9-002.md"), "- [ ] **AC-1** other\n");
    const r = runAc(["AC-1"]);
    expect(r.status).toBe(EXIT_MISUSE);
    expect(readFileSync(join(ART_DIR, "Plan-issue-9-002.md"), "utf8")).toContain("[ ] **AC-1**");
  });

  it("an explicit file still works when several plans exist", () => {
    writeFileSync(join(ART_DIR, "Plan-issue-9-002.md"), "## Phase 1 — A\n\n- [ ] **1.1 [S] second**\n");
    const r = runTask(["1.1", join(ART_DIR, "Plan-issue-9-002.md")]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(ART_DIR, "Plan-issue-9-002.md"), "utf8")).toContain("[x] **1.1");
  });

  it("ticks by the checkbox position, not a [x] or [ ] inside the task text", () => {
    const f = join(WORK_DIR, "text.md");
    writeFileSync(f, "## Phase 1 — A\n\n- [ ] **1.1 [S] fix [x] handling**\n- [x] **1.2 [S] reopen [ ] case**\n");
    expect(runTask(["1.1", f]).status).toBe(0);
    expect(runTask(["--uncomplete", "1.2", f]).status).toBe(0);
    expect(readFileSync(f, "utf8")).toBe("## Phase 1 — A\n\n- [x] **1.1 [S] fix [x] handling**\n- [ ] **1.2 [S] reopen [ ] case**\n");
  });

  it("ticks an unbolded task that plan-parse counts", () => {
    const f = join(WORK_DIR, "plain.md");
    writeFileSync(f, "## Phase 1 — A\n\n- [ ] 1.3 unsized open task\n");
    expect(runTask(["1.3", f]).status).toBe(0);
    expect(readFileSync(f, "utf8")).toContain("- [x] 1.3 unsized open task");
  });

  it("ac tool does not tick AC-1 on an AC-1.2 line", () => {
    const f = join(WORK_DIR, "ac.md");
    writeFileSync(f, "- [ ] **AC-1.2** sub\n- [ ] **AC-1** parent\n");
    expect(runAc(["AC-1", f]).status).toBe(0);
    expect(readFileSync(f, "utf8")).toBe("- [ ] **AC-1.2** sub\n- [x] **AC-1** parent\n");
  });

  it("task --help carries no DEVENV marker", () => {
    const r = runTask(["--help"]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("DEVENV");
  });
});
