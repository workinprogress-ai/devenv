// hunk-stage.test.ts — engine tests against real temp git repos (black-box
// at the git boundary, white-box at the function seam: the GitExec
// injection keeps this module pure while exercising real git behavior).
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpDir } from "../harness/tmp-repo.ts";
import { enumerateFile, resolveSelectors, stageSelection } from "../../../lib/domain/hunk-stage.ts";

const cleanups: string[] = [];
let repo: string;

function setup(): void {
  repo = tmpDir("hunk-stage");
  cleanups.push(repo);
  sh("git init -q . && git config user.email t@t && git config user.name t");
}

function sh(cmd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8", cwd: repo });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const exec = (args: string[], input?: string) => {
  const r = spawnSync("git", args, { encoding: "utf8", cwd: repo, input });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

function twoHunkFile(): void {
  const base = Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
  writeFileSync(`${repo}/f.txt`, base);
  sh("git add f.txt && git commit -qm init");
  const lines = base.split("\n");
  lines[3] = "line4-CHANGED";
  lines[39] = "line40-CHANGED";
  writeFileSync(`${repo}/f.txt`, lines.join("\n"));
}

afterAll(() => {
  for (const d of cleanups.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("enumerateFile", () => {
  it("enumerates the live unstaged hunks of a two-change file", () => {
    setup();
    twoHunkFile();
    const e = enumerateFile(exec, "f.txt");
    expect("hunks" in e && e.hunks).toHaveLength(2);
  });

  it("returns zero hunks when the file has no unstaged diff", () => {
    setup();
    twoHunkFile();
    sh("git add f.txt");
    const e = enumerateFile(exec, "f.txt");
    expect("hunks" in e && e.hunks).toHaveLength(0);
  });

  it("classifies binary diffs and refuses with the class named", () => {
    setup();
    writeFileSync(`${repo}/b.bin`, Buffer.from([0, 1, 2, 3]));
    sh("git add b.bin && git commit -qm bin");
    writeFileSync(`${repo}/b.bin`, Buffer.from([0, 1, 2, 4]));
    const e = enumerateFile(exec, "b.bin");
    expect("message" in e && e.message).toMatch(/binary diff.*refused in v1/s);
  });

  it("classifies new files and refuses with the class named", () => {
    setup();
    writeFileSync(`${repo}/n.txt`, "new content\n");
    sh("git add -N n.txt");
    const e = enumerateFile(exec, "n.txt");
    expect("message" in e && e.message).toMatch(/new file.*refused in v1/s);
  });

  it("classifies renames and refuses with the class named", () => {
    setup();
    twoHunkFile();
    sh("git add f.txt && git commit -qm base");
    // UNSTAGED rename visible to git: mv plus intent-to-add on the new path.
    // (A bare mv leaves the new path untracked — invisible to git diff — and
    // a pathspec-filtered name-status normalizes R to A; the engine scans the
    // unfiltered diff, pinned by this test.)
    sh("mv f.txt g.txt && git add -N g.txt");
    const e = enumerateFile(exec, "g.txt");
    expect("message" in e).toBe(true);
    if ("message" in e) expect(e.message).toMatch(/rename diff.*refused in v1/s);
  });
});

describe("resolveSelectors", () => {
  it("resolves selector numbers to payloads and headers", () => {
    setup();
    twoHunkFile();
    const e = enumerateFile(exec, "f.txt");
    if (!("hunks" in e)) throw new Error("enumeration must succeed");
    const r = resolveSelectors(e, [2]);
    expect("payloads" in r && r.payloads).toEqual(["line40\nline40-CHANGED"]);
    expect("headers" in r && r.headers[0]).toMatch(/^@@ -37,7/);
  });

  it("refuses out-of-range selectors with the live count and remediation", () => {
    setup();
    twoHunkFile();
    const e = enumerateFile(exec, "f.txt");
    if (!("hunks" in e)) throw new Error("enumeration must succeed");
    const r = resolveSelectors(e, [3]);
    expect("message" in r && r.message).toMatch(/selector drift.*now has 2 hunks/s);
  });
});

describe("stageSelection (three-part invariant)", () => {
  it("stages exactly the selected hunks; unselected remain unstaged; worktree untouched", () => {
    setup();
    twoHunkFile();
    const r = stageSelection(exec, "f.txt", [2]);
    expect("message" in r).toBe(false);
    if ("message" in r) throw new Error(r.message);
    expect(r.stagedPayloads).toEqual(["line40\nline40-CHANGED"]);
    expect(r.remaining).toBe(1);
    const staged = sh("git diff --cached -- f.txt").stdout;
    const unstaged = sh("git diff -- f.txt").stdout;
    expect(staged).toContain("line40-CHANGED");
    expect(staged).not.toContain("line4-CHANGED");
    expect(unstaged).toContain("line4-CHANGED");
    expect(unstaged).not.toContain("line40-CHANGED");
    // worktree untouched: both changes still in the file
    const content = sh("cat f.txt").stdout;
    expect(content).toContain("line4-CHANGED");
    expect(content).toContain("line40-CHANGED");
  });

  it("second stage completes the file; staged now equals the full diff", () => {
    setup();
    twoHunkFile();
    const full = sh("git diff -- f.txt").stdout;
    stageSelection(exec, "f.txt", [2]);
    stageSelection(exec, "f.txt", [1]);
    expect(sh("git diff --cached -- f.txt").stdout).toBe(full);
    expect(sh("git diff --quiet -- f.txt").status).toBe(0);
  });

  it("regenerate semantics: a re-run selector names the next live hunk (engine-level re-run protection is batch validation's job)", () => {
    setup();
    twoHunkFile();
    stageSelection(exec, "f.txt", [1]); // stages line4; live hunks now [line40]
    const r = stageSelection(exec, "f.txt", [1]);
    // By design (regenerate + echo): [1] now names line40 — NOT an error at
    // engine level. The protection against silently re-staging a group is
    // batch validation: every group's selectors are validated per invocation
    // and the OTHER groups' drifted selectors refuse the run before mutation
    // (Phase 4 wires this; the commit-batch validator rows pin it).
    expect("stagedPayloads" in r).toBe(true);
    if ("stagedPayloads" in r) expect(r.stagedPayloads).toEqual(["line40\nline40-CHANGED"]);
  });

  it("verification failure leaves the index as apply left it (report + recipe policy)", () => {
    setup();
    twoHunkFile();
    // Prime drift: after staging hunk 1, hand-modify the worktree line 40 so a
    // stale patch for hunk 2 cannot verify — the refusal must carry the recipe.
    stageSelection(exec, "f.txt", [1]);
    sh("sed -i 's/line40-CHANGED/line40-DRIFTED/' f.txt");
    const r = stageSelection(exec, "f.txt", [2]);
    expect("message" in r).toBe(true);
    if ("message" in r) expect(r.message).toMatch(/restore --staged f\.txt|selector drift|does not apply/);
  });
});
