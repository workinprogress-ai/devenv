// Port of tools/tests/scripts/test_plan_parse.bats (47 tests).
// plan-parse: summary mode (counts, weights, phases, header routing),
// census/structure/anchors, lint (+ --require-header), multi-mode rejection,
// characterization pins. The tool spawns per test against fixture plan files.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const TOOL = join(ROOT, "tools", "ts", "plan-parse.ts");

let TMP = "";
let PLAN_DIR = "";
let PLAN_FILE = "";
let STEM_FILE = "";

const PLAN_BODY = `# Test plan

## Goals and Acceptance Criteria

- [x] <a id="ac-1"></a>**AC-1** first criterion
- [ ] **AC-2** second criterion

## Phases

### Phase 1 — First phase

- [x] **1.1 [S] sized done task**
- [x] **1.2 [L] sized done task two**
- [ ] 1.3 unsized open task
  - detail line
  - [QUESTION] should this be async?

### Phase 2 — Second phase

- [ ] **2.1 [M] medium open task**
- [x] **2.2 [S] small done task**

### Phase 3 — Third phase (no tasks yet)

### Phase 4 — Fourth phase

- [ ] **4.1 [L] large open task**
`;

function sedInPlace(file: string, from: string, to: string): void {
  const content = read(file);
  write(file, content.split(from).join(to));
}

function read(file: string): string {
  return (spawnSync("cat", [file], { encoding: "utf8" }).stdout ?? "");
}

function write(file: string, content: string): void {
  writeFileSync(file, content);
}

// jq helper mirroring the bats echo|jq pattern (numbers via -r print bare).
function jq(json: string, expr: string): string {
  const r = spawnSync("jq", ["-r", expr], { input: json, encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

function jqOk(json: string, expr: string): boolean {
  return spawnSync("jq", ["-e", expr], { input: json, stdio: ["pipe", "ignore", "ignore"] }).status === 0;
}

let LAST = { status: 0, out: "" };

function parse(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [TOOL, ...args], { encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  LAST = { status: r.status ?? 1, out };
  return LAST;
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), `planparse-${Date.now()}-${Math.random().toString(36).slice(2)}`));
  PLAN_DIR = TMP;
  PLAN_FILE = join(PLAN_DIR, "Plan-issue-42-001.md");
  write(PLAN_FILE, PLAN_BODY);
  STEM_FILE = join(PLAN_DIR, "Implementation_plan-issue-7-001.md");
  write(STEM_FILE, PLAN_BODY);
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("plan-parse", () => {
  // ── Summary mode (--summary) ────────────────────────────────────────────

  it("plan-parse --summary emits valid JSON", () => {
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ".")).toBe(true);
  });

  it("plan-parse --summary counts tasks (done/open/total)", () => {
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".tasks_done")).toBe("3");
    expect(jq(r.out, ".tasks_open")).toBe("3");
    expect(jq(r.out, ".tasks_total")).toBe("6");
  });

  it("plan-parse --summary computes raw percentage", () => {
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    // numeric equality: jq <=1.6 prints 50.0 as "50", jq 1.7+ preserves "50.0"
    expect(jq(r.out, ".pct_tasks == 50")).toBe("true");
  });

  it("plan-parse --summary applies size weights S=1 M=2 L=4", () => {
    // done: 1.1[S]=1 + 1.2[L]=4 + 2.2[S]=1 = 6
    // total: 1[S] + 4[L] + 2[unsized->M] + 2[M] + 1[S] + 4[L] = 14
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".weighted.done")).toBe("6");
    expect(jq(r.out, ".weighted.total")).toBe("14");
    expect(jq(r.out, ".weighted.pct")).toBe("42.9");
  });

  it("plan-parse --summary defaults missing size to M", () => {
    // 1.3 carries no [S|M|L] token and must count with weight 2 (included in
    // the weighted.total check above: 1+4+2+2+1+4 = 14)
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".weighted.total")).toBe("14");
  });

  it("plan-parse --summary reports sized_tasks ratio", () => {
    // 5 of 6 tasks carry a size token
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".sized_tasks")).toBe("0.83");
  });

  it("plan-parse --summary counts phases with tasks only", () => {
    // Phase 3 has no tasks and must not count toward phases_total
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".phases_total")).toBe("3");
  });

  it("plan-parse --summary computes phases_complete", () => {
    // No phase is fully done (phase 1 has an open task)
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".phases_complete")).toBe("0");
  });

  it("plan-parse --summary marks first phase with open tasks as current", () => {
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".current_phase")).toBe("1");
  });

  it("plan-parse --summary counts open questions", () => {
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".open_questions")).toBe("1");
  });

  it("plan-parse --summary counts unchecked ACs", () => {
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".unchecked_acs")).toBe("1");
  });

  it("plan-parse --summary reports plan_file basename", () => {
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".plan_file")).toBe("Plan-issue-42-001.md");
  });

  it("plan-parse --summary accepts the Implementation_plan stem", () => {
    const r = parse([STEM_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".plan_file")).toBe("Implementation_plan-issue-7-001.md");
    expect(jq(r.out, ".tasks_total")).toBe("6");
  });

  it("plan-parse --summary detects fully-complete phases", () => {
    sedInPlace(PLAN_FILE, "- [ ] 1.3 unsized open task", "- [x] 1.3 unsized open task");
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".phases_complete")).toBe("1");
    expect(jq(r.out, ".current_phase")).toBe("2");
  });

  it("plan-parse --summary all-done plan reports last phase as current", () => {
    sedInPlace(PLAN_FILE, "- [ ]", "- [x]");
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".current_phase")).toBe("4");
    expect(jq(r.out, ".tasks_open")).toBe("0");
  });

  it("plan-parse --summary on empty plan yields zeros", () => {
    const empty = join(PLAN_DIR, "Plan-empty.md");
    write(empty, "# Empty plan\n");
    const r = parse([empty, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".tasks_total")).toBe("0");
    expect(jq(r.out, ".pct_tasks == 0")).toBe("true");
  });

  // ── Regression: existing modes still work after the summary extension ──

  it("plan-parse --census still reports per-phase counts", () => {
    const r = parse([PLAN_FILE, "--census"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".totals.tasks")).toBe("6");
    expect(jq(r.out, "[.census[].done] | add")).toBe("3");
  });

  it("plan-parse --structure still reports phases and tasks", () => {
    const r = parse([PLAN_FILE, "--structure"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".phases | length")).toBe("4");
    expect(jq(r.out, "[.phases[].tasks | length] | add")).toBe("6");
  });

  it("plan-parse --structure task text preserved", () => {
    const r = parse([PLAN_FILE, "--structure"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".phases[0].tasks[0].text")).toBe("sized done task");
  });

  it("plan-parse --anchors still lists file paths", () => {
    appendFileSync(PLAN_FILE, "- Files: `src/Worker.cs`\n");
    mkdirSync(join(PLAN_DIR, "src"), { recursive: true });
    write(join(PLAN_DIR, "src", "Worker.cs"), "");
    expect(existsSync(join(PLAN_DIR, "src", "Worker.cs"))).toBe(true);
    const r = parse([PLAN_FILE, "--anchors"]);
    expect(r.status).toBe(0);
    expect(jqOk(r.out, '.anchors[] | select(.path == "src/Worker.cs" and .exists == true)')).toBe(true);
  });

  // ── Error paths ─────────────────────────────────────────────────────────

  it("plan-parse --summary fails on missing file", () => {
    const r = parse([join(PLAN_DIR, "nope.md"), "--summary"]);
    expect(r.status).toBe(2);
  });

  it("plan-parse requires a file argument", () => {
    const r = parse(["--summary"]);
    expect(r.status).toBe(2);
  });

  it("plan-parse rejects multiple mode flags (exit 2, no silent last-wins)", () => {
    const r = parse([PLAN_FILE, "--summary", "--census"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("only one mode flag");
  });

  // ── Header routing fields in --summary ──────────────────────────────────

  it("plan-parse --summary emits null header fields when header absent", () => {
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".doc_id")).toBe("null");
    expect(jq(r.out, ".issue_number")).toBe("null");
    expect(jq(r.out, ".planning_repo")).toBe("null");
  });

  it("plan-parse --summary emits header routing fields when present", () => {
    const content = read(PLAN_FILE);
    write(
      PLAN_FILE,
      [
        "<!-- DEVENV_ARTIFACT_V1",
        "doc_id: dv1:test-org/test-repo:issue-42:plan:test-slug",
        "artifact_type: plan",
        "issue_number: 42",
        "planning_repo: test-org/planning.main",
        "-->",
        "",
        content,
      ].join("\n"),
    );
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".doc_id")).toBe("dv1:test-org/test-repo:issue-42:plan:test-slug");
    expect(jq(r.out, ".issue_number")).toBe("42");
    expect(jq(r.out, ".planning_repo")).toBe("test-org/planning.main");
    // metrics unaffected by header presence
    expect(jq(r.out, ".tasks_total")).toBe("6");
  });

  // ── Lint mode (--lint) ──────────────────────────────────────────────────

  it("plan-parse --lint passes a structurally valid plan", () => {
    const r = parse([PLAN_FILE, "--lint"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".ok")).toBe("true");
    expect(jq(r.out, ".errors | length")).toBe("0");
  });

  it("plan-parse --lint emits valid JSON", () => {
    const r = parse([PLAN_FILE, "--lint"]);
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ".")).toBe(true);
  });

  it("plan-parse --lint flags missing phases", () => {
    const f = join(PLAN_DIR, "Plan-nophase.md");
    write(f, "# No phases here\n- [ ] **1.1 [S] orphan task**\n");
    const r = parse([f, "--lint"]);
    expect(r.status).toBe(1);
    expect(jqOk(r.out, '.errors[] | select(test("no Phase headings"))')).toBe(true);
  });

  it("plan-parse --lint flags alphabetic task suffix", () => {
    sedInPlace(PLAN_FILE, "- [ ] 1.3 unsized open task", "- [ ] 1.3a unsized open task");
    const r = parse([PLAN_FILE, "--lint"]);
    expect(r.status).toBe(1);
    expect(jqOk(r.out, '.errors[] | select(test("alphabetic suffix"))')).toBe(true);
  });

  it("plan-parse --lint flags duplicate task ids", () => {
    sedInPlace(PLAN_FILE, "- [x] **2.2 [S] small done task**", "- [x] **1.1 [S] dup of earlier task**");
    const r = parse([PLAN_FILE, "--lint"]);
    expect(r.status).toBe(1);
    expect(jqOk(r.out, '.errors[] | select(test("duplicate task id"))')).toBe(true);
  });

  it("plan-parse --lint flags Revision History section", () => {
    appendFileSync(
      PLAN_FILE,
      "\n## Revision History\n\n| Date | Change |\n|---|---|\n| 2026-01-01 | created |\n",
    );
    const r = parse([PLAN_FILE, "--lint"]);
    expect(r.status).toBe(1);
    expect(jqOk(r.out, '.errors[] | select(test("Revision History"))')).toBe(true);
  });

  it("plan-parse --lint warns on phase with no tasks", () => {
    const r = parse([PLAN_FILE, "--lint"]);
    expect(r.status).toBe(0);
    expect(jqOk(r.out, '.warnings[] | select(test("phase 3 has no tasks"))')).toBe(true);
  });

  it("plan-parse --lint warns on missing size tokens (mixed sizing only)", () => {
    const r = parse([PLAN_FILE, "--lint"]);
    expect(r.status).toBe(0);
    expect(jqOk(r.out, '.warnings[] | select(test("size token"))')).toBe(true);
  });

  it("plan-parse --lint does not warn on size tokens when all sized", () => {
    sedInPlace(PLAN_FILE, "- [ ] 1.3 unsized open task", "- [ ] **1.3 [M] sized now**");
    const r = parse([PLAN_FILE, "--lint"]);
    expect(r.status).toBe(0);
    expect(jqOk(r.out, '.warnings[] | select(test("size token"))')).toBe(false);
  });

  // ── --require-header (upsert gate) ──────────────────────────────────────

  it("plan-parse --lint --require-header flags missing header", () => {
    const r = parse([PLAN_FILE, "--lint", "--require-header"]);
    expect(r.status).toBe(1);
    expect(jqOk(r.out, '.errors[] | select(test("header missing"))')).toBe(true);
  });

  it("plan-parse --lint --require-header passes valid header", () => {
    const content = read(PLAN_FILE);
    write(
      PLAN_FILE,
      [
        "<!-- DEVENV_ARTIFACT_V1",
        "doc_id: dv1:test-org/test-repo:issue-42:plan:test-slug",
        "artifact_type: plan",
        "issue_number: 42",
        "planning_repo: test-org/planning.main",
        "updated_at_utc: 2026-09-10T00:00:00Z",
        "-->",
        "",
        content,
      ].join("\n"),
    );
    const r = parse([PLAN_FILE, "--lint", "--require-header"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".ok")).toBe("true");
  });

  it("plan-parse --lint --require-header flags malformed doc_id", () => {
    const content = read(PLAN_FILE);
    write(
      PLAN_FILE,
      [
        "<!-- DEVENV_ARTIFACT_V1",
        "doc_id: not-a-doc-id",
        "artifact_type: plan",
        "-->",
        "",
        content,
      ].join("\n"),
    );
    const r = parse([PLAN_FILE, "--lint", "--require-header"]);
    expect(r.status).toBe(1);
    expect(jqOk(r.out, '.errors[] | select(test("deterministic format"))')).toBe(true);
  });

  it("plan-parse --lint --require-header flags wrong artifact_type", () => {
    const content = read(PLAN_FILE);
    write(
      PLAN_FILE,
      [
        "<!-- DEVENV_ARTIFACT_V1",
        "doc_id: dv1:test-org/test-repo:issue-42:plan:test-slug",
        "artifact_type: roadmap",
        "-->",
        "",
        content,
      ].join("\n"),
    );
    const r = parse([PLAN_FILE, "--lint", "--require-header"]);
    expect(r.status).toBe(1);
    expect(jqOk(r.out, '.errors[] | select(test("expected .plan."))')).toBe(true);
  });

  it("plan-parse --lint --require-header flags malformed planning_repo", () => {
    const content = read(PLAN_FILE);
    write(
      PLAN_FILE,
      [
        "<!-- DEVENV_ARTIFACT_V1",
        "doc_id: dv1:test-org/test-repo:issue-42:plan:test-slug",
        "artifact_type: plan",
        "planning_repo: not-a-repo-form",
        "-->",
        "",
        content,
      ].join("\n"),
    );
    const r = parse([PLAN_FILE, "--lint", "--require-header"]);
    expect(r.status).toBe(1);
    expect(jqOk(r.out, '.errors[] | select(test("owner/repo form"))')).toBe(true);
  });

  it("plan-parse --require-header rejected without --lint", () => {
    const r = parse([PLAN_FILE, "--require-header"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("only valid together with --lint");
  });

  // ── Characterization tests — pin current behavior so parser changes
  // are provable deltas. Flipped, not deleted. ────────────────────────────

  it("characterization flipped: --lint --require-header accepts planning_repo 'none'", () => {
    // fixture body already provides phases/tasks; only the header is inserted
    const content = read(PLAN_FILE);
    write(
      PLAN_FILE,
      [
        "<!-- DEVENV_ARTIFACT_V1",
        "doc_id: dv1:test-org/test-repo:issue-42:plan:test-slug",
        "artifact_type: plan",
        "planning_repo: none",
        "-->",
        "",
        content,
      ].join("\n"),
    );
    const r = parse([PLAN_FILE, "--lint", "--require-header"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".ok")).toBe("true");
  });

  it("plan-parse --summary normalizes planning_repo 'none' to null", () => {
    write(
      PLAN_FILE,
      [
        "<!-- DEVENV_ARTIFACT_V1",
        "doc_id: dv1:test-org/test-repo:issue-42:plan:test-slug",
        "artifact_type: plan",
        "issue_number: 42",
        "planning_repo: none",
        "-->",
        "",
        "# P",
        "",
        "## Phase 1 — A",
        "",
        "- [ ] **1.1 [S] t**",
        "",
      ].join("\n"),
    );
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".planning_repo")).toBe("null");
  });

  it("plan-parse --lint --require-header still rejects malformed planning_repo", () => {
    write(
      PLAN_FILE,
      [
        "<!-- DEVENV_ARTIFACT_V1",
        "doc_id: dv1:test-org/test-repo:issue-42:plan:test-slug",
        "artifact_type: plan",
        "planning_repo: not-a-repo",
        "-->",
        "",
        "# P",
        "",
        "## Phase 1 — A",
        "",
        "- [ ] **1.1 [S] t**",
        "",
      ].join("\n"),
    );
    const r = parse([PLAN_FILE, "--lint", "--require-header"]);
    expect(r.status).toBe(1);
    expect(jqOk(r.out, '.errors[] | select(test("owner/repo form"))')).toBe(true);
  });

  it("characterization: --summary emits planning_repo as JSON string when present", () => {
    write(
      PLAN_FILE,
      [
        "<!-- DEVENV_ARTIFACT_V1",
        "doc_id: dv1:test-org/test-repo:issue-42:plan:test-slug",
        "artifact_type: plan",
        "issue_number: 42",
        "planning_repo: test-org/planning.main",
        "-->",
        "",
        "# P",
        "",
        "## Phase 1 — A",
        "",
        "- [ ] **1.1 [S] t**",
        "",
      ].join("\n"),
    );
    const r = parse([PLAN_FILE, "--summary"]);
    expect(r.status).toBe(0);
    expect(jq(r.out, ".planning_repo")).toBe("test-org/planning.main");
  });

  // ── Multi-mode flag rejection ───────────────────────────────────────────

  it("plan-parse rejects multiple mode flags (no silent last-wins)", () => {
    const r = parse([PLAN_FILE, "--summary", "--census"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("only one mode flag allowed");
  });

  it("plan-parse rejects multiple mode flags in either order", () => {
    const r = parse([PLAN_FILE, "--census", "--structure"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("already set: --census");
  });

  it("plan-parse still accepts a single mode flag", () => {
    const r = parse([PLAN_FILE, "--census"]);
    expect(r.status).toBe(0);
    expect(jqOk(r.out, ".census")).toBe(true);
  });
});
