// One plan/checkbox grammar shared by parsePlan and the markdown helpers.
// The condensed fixture mirrors plans published in the field (artifact header,
// anchored bold ACs, TOC links, bold sized tasks, unbolded tasks, sub-bullets).
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlan, planAnchors, planCensus } from "../../lib/domain/plan.ts";
import {
  countAcs, countTasks, findAcLine, findTaskLine, setItemCompleteAtLine,
} from "../../lib/domain/markdown.ts";
import { readFileSync } from "node:fs";

const FIELD_PLAN = `<!-- DEVENV_ARTIFACT_V1
doc_id: dv1:org/repo:local:plan:plan-issue-1-001
artifact_type: plan
-->

# Show status

## Goals and Acceptance Criteria

- [x] <a id="ac-1"></a>**AC-1** The grid shows a column. *(explicit)*
- [ ] <a id="ac-2"></a>**AC-2** The grid filters. *(inferred)*

## Phase TOC

- [Phase 1 - Discovery](#phase-1--discovery)
- [Phase 2 - Build](#phase-2--build)

## Phases

### Phase 1 — Discovery

- [x] **1.1 [S] Read the code**
  - detail line
  - [QUESTION] is it async?
- [ ] 1.2 unbolded task

### Phase 2 — Build

- [ ] **2.1 [M] Build the column (satisfies AC-1)**
- [x] **2.2 [L] Add the filter** — see AC-2.
`;

describe("shared plan grammar", () => {
  it("counts a field-shaped plan: tasks, ACs, completion", () => {
    const p = parsePlan(FIELD_PLAN);
    expect(p.tasks.map((t) => `${t.id}:${t.done}`)).toEqual(["1.1:true", "1.2:false", "2.1:false", "2.2:true"]);
    expect(p.acs.map((a) => `${a.id}:${a.done}`)).toEqual(["AC-1:true", "AC-2:false"]);
    expect(planCensus(p)).toEqual({
      census: [
        { phase: "1", total: 2, done: 1, open: 1 },
        { phase: "2", total: 2, done: 1, open: 1 },
      ],
      totals: { tasks: 4, done: 2, open: 2 },
    });
  });

  it("a task line that mentions an AC stays a task", () => {
    const p = parsePlan(FIELD_PLAN);
    expect(p.tasks.find((t) => t.id === "2.1")?.text).toContain("AC-1");
    expect(p.acs).toHaveLength(2);
  });

  it("reads AC-1.2 as AC-1.2, never AC-1", () => {
    const p = parsePlan("- [ ] **AC-1.2** sub criterion\n- [ ] **AC-1** parent\n");
    expect(p.acs.map((a) => a.id)).toEqual(["AC-1.2", "AC-1"]);
  });

  it("an AC mentioned mid-line on a non-task checkbox is not an AC", () => {
    const p = parsePlan("### Phase 1 — A\n\n- [ ] review notes referencing AC-4 somewhere\n");
    expect(p.acs).toEqual([]);
    expect(p.tasks).toEqual([]);
  });

  it("accepts an uppercase [X] as done", () => {
    const p = parsePlan("### Phase 1 — A\n\n- [X] **1.1 [S] t**\n");
    expect(p.tasks[0]?.done).toBe(true);
  });

  it("tolerates CRLF line endings", () => {
    const p = parsePlan("### Phase 1 — A\r\n\r\n- [x] **1.1 [S] t**\r\n- [ ] <a id=\"ac-1\"></a>**AC-1** c\r\n");
    expect(p.tasks).toHaveLength(1);
    expect(p.acs).toHaveLength(1);
  });
});

describe("markdown helpers use the same grammar", () => {
  it("findTaskLine matches bold, unbolded and [X] tasks, and exact ids only", () => {
    const c = "### Phase 1 — A\n\n- [ ] **1.1 [S] a**\n- [X] 1.10 ten\n- [ ] 1.2 plain\n- [ ] **1.3** tight\n";
    expect(findTaskLine(c, "1.1")).toBe(3);
    expect(findTaskLine(c, "1.10")).toBe(4);
    expect(findTaskLine(c, "1.2")).toBe(5);
    expect(findTaskLine(c, "1.3")).toBe(6);
    expect(findTaskLine(c, "1.4")).toBeNull();
  });

  it("findAcLine does not match AC-1 on an AC-1.2 line or on a task that mentions it", () => {
    const c = "- [ ] **AC-1.2** sub\n- [ ] **2.1 [M] impl (see **AC-1**)**\n- [ ] <a id=\"ac-1\"></a>**AC-1** parent\n";
    expect(findAcLine(c, "AC-1")).toBe(3);
    expect(findAcLine(c, "AC-1.2")).toBe(1);
  });

  it("countTasks excludes ACs and countAcs excludes tasks", () => {
    expect(countTasks(FIELD_PLAN)).toEqual({ completed: 2, total: 4 });
    expect(countAcs(FIELD_PLAN)).toEqual({ completed: 1, total: 2 });
  });

  it("setItemCompleteAtLine tests the checkbox position only", () => {
    const dir = mkdtempSync(join(tmpdir(), "grammar-"));
    try {
      const f = join(dir, "p.md");
      writeFileSync(f, "- [ ] **1.1 [S] fix [x] handling**\n- [x] **1.2 [S] reopen [ ] case**\n");
      setItemCompleteAtLine(f, 1, "complete");
      setItemCompleteAtLine(f, 2, "incomplete");
      expect(readFileSync(f, "utf8")).toBe("- [x] **1.1 [S] fix [x] handling**\n- [ ] **1.2 [S] reopen [ ] case**\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("plan anchors", () => {
  it("keeps .json, .csproj and .yaml whole instead of truncating the extension", () => {
    const dir = mkdtempSync(join(tmpdir(), "anchors-"));
    try {
      mkdirSync(join(dir, "cfg"));
      writeFileSync(join(dir, "cfg", "a.json"), "{}");
      const plan = join(dir, "Plan-1.md");
      writeFileSync(plan, "Edit cfg/a.json, App.csproj and ci.yaml and src/x.tsx then y.js.\n");
      const out = planAnchors(plan, readFileSync(plan, "utf8")) as { anchors: { path: string; exists: boolean }[] };
      expect(out.anchors.map((a) => a.path).sort()).toEqual(["App.csproj", "cfg/a.json", "ci.yaml", "src/x.tsx", "y.js"]);
      expect(out.anchors.find((a) => a.path === "cfg/a.json")?.exists).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
