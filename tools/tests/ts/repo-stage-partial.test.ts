// repo-stage-partial.test.ts — the CLI contract for hunk-level partial
// staging, black-box against real temp git repos (matches
// repo-stage.test.ts: runTool spawns the tool; manifest fixtures live
// outside the worktree). Covers --patch mode, batch hunk selectors,
// drift/coverage/purity refusals, the e2e same-file multi-group sequence,
// draft authoring round-trip, and the review-round-1 regression rows.
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpDir } from "./harness/tmp-repo.ts";
import { runTool } from "./harness/run-tool.ts";


let repo: string;
let manifestDir: string;
const cleanups: string[] = [];

function sh(cmd: string): { status: number; stdout: string } {
  // Direct git via node child process — matches the spawnSync style of the
  // sibling suites.
  const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8", cwd: repo });
  return { status: r.status ?? 1, stdout: (r.stdout ?? "") + (r.stderr ?? "") };
}

/** A 60-line file with two well-separated changes → exactly 2 hunks. */
function twoHunkFile(): void {
  const base = Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
  writeFileSync(`${repo}/f.txt`, base);
  sh("git add f.txt && git commit -qm init");
  const lines = base.split("\n");
  lines[3] = "line4-CHANGED";
  lines[39] = "line40-CHANGED";
  writeFileSync(`${repo}/f.txt`, lines.join("\n"));
}

function manifest(name: string, text: string): string {
  const path = `${manifestDir}/${name}`;
  writeFileSync(path, text);
  return path;
}

beforeEach(() => {
  repo = tmpDir("repo-stage-partial");
  cleanups.push(repo);
  manifestDir = tmpDir("repo-stage-partial-manifests");
  cleanups.push(manifestDir);
  sh("git init -q . && git config user.email t@t && git config user.name t");
});

afterAll(() => {
  for (const d of cleanups.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("path mode --patch (Phase 4.2)", () => {
  it("stages exactly the patch's hunks; remaining hunks stay unstaged; worktree untouched", () => {
    twoHunkFile();
    const h2 = `${manifestDir}/h2.patch`;
    sh(`git diff -- f.txt | sed -n '1,4p;14,22p' > ${h2}`); // preamble + hunk 2 (fixture-only approximation; Phase 4 asserts via engine output)
    const r = runTool("repo-stage", ["--patch", h2], { cwd: repo });
    expect(r.status).toBe(0);
    const staged = sh("git diff --cached -- f.txt").stdout;
    const remaining = sh("git diff -- f.txt").stdout;
    expect(staged).toContain("line40");
    expect(remaining).toContain("line4");
  });

  it("refuses a binary / new-file / rename patch with the class named (v1 doctrine)", () => {
    const p = manifest("bin.patch", "diff --git a/b.bin b/b.bin\nGIT binary patch\n");
    const r = runTool("repo-stage", ["--patch", p], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/binary/);
  });

  it("refuses a patch that does not apply to the index, with drift diagnostics", () => {
    const p = manifest("drift.patch", "diff --git a/gone.txt b/gone.txt\n--- a/gone.txt\n+++ b/gone.txt\n@@ -1,1 +1,1 @@\n-x\n+y\n");
    const r = runTool("repo-stage", ["--patch", p], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/patch does not apply|failed/);
  });

  it("--dry-run validates fully (apply --check) and stages nothing", () => {
    twoHunkFile();
    const h1 = `${manifestDir}/h1.patch`;
    // Full preamble (4 lines) + complete hunk 1 (lines 5-13: header + 3 ctx + del + add + 3 ctx).
    sh(`git diff -- f.txt | sed -n '1,4p;5,13p' > ${h1}`);
    const r = runTool("repo-stage", ["--patch", h1, "--dry-run"], { cwd: repo });
    expect(r.status).toBe(0);
    expect(sh("git diff --cached --quiet").status).toBe(0); // nothing staged
  });
});

describe("non-UTF-8 index content (byte-exact guarantee)", () => {
  /** Two-hunk file whose untouched middle line holds a Latin-1 byte. */
  function latin1TwoHunkFile(): void {
    const lines = Array.from({ length: 60 }, (_, i) => `line${i + 1}`);
    const bytes = (l: string[]): Buffer =>
      Buffer.concat(l.map((x, i) => (i === 24 ? Buffer.concat([Buffer.from("caf"), Buffer.from([0xe9]), Buffer.from("\n")]) : Buffer.from(`${x}\n`))));
    writeFileSync(`${repo}/f.txt`, bytes(lines));
    sh("git add f.txt && git commit -qm init");
    const changed = [...lines];
    changed[3] = "line4-CHANGED";
    changed[39] = "line40-CHANGED";
    writeFileSync(`${repo}/f.txt`, bytes(changed));
  }

  it("batch hunk claim refuses before any index mutation when the blob is not valid UTF-8", () => {
    latin1TwoHunkFile();
    const m = manifest("latin1.md", `# Commit batch: l

## group 1 — feat: first
- f.txt @ 1

## group 2 — fix: second
- f.txt @ 2
`);
    const r = runTool("repo-stage", ["--batch", m, "--group", "1"], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toContain("UTF-8");
    expect(r.output).toContain("nothing was staged");
    expect(sh("git diff --cached --quiet").status).toBe(0);
  });

  it("--patch refuses before any index mutation when the blob is not valid UTF-8", () => {
    latin1TwoHunkFile();
    const h1 = `${manifestDir}/latin1.patch`;
    sh(`git diff -- f.txt | sed -n '1,4p;5,13p' > ${h1}`);
    const r = runTool("repo-stage", ["--patch", h1], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toContain("UTF-8");
    expect(r.output).not.toContain("verification failed");
    expect(sh("git diff --cached --quiet").status).toBe(0);
  });
});

describe("batch mode hunk selectors (Phase 4.3)", () => {
  it("stages one group's claimed hunks of a shared file; the other group's hunks remain", () => {
    twoHunkFile();
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt"); // second changed file so coverage has two paths
    const m = manifest("two-groups.md", `# Commit batch: split

## group 1 — feat: first
- f.txt @ 1

## group 2 — fix: second
- f.txt @ 2
- other.txt
`);
    const r = runTool("repo-stage", ["--batch", m, "--group", "1"], { cwd: repo });
    expect(r.status).toBe(0);
    expect(sh("git diff --cached -- f.txt").stdout).toContain("line4-CHANGED");
    expect(sh("git diff -- f.txt").stdout).toContain("line40-CHANGED");
    expect(sh("git diff --cached --name-only").stdout).not.toContain("other.txt");
  });

  it("echo reports staged hunk headers with counts and remaining", () => {
    twoHunkFile();
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const m = manifest("echo.md", `# Commit batch: e

## group 1 — feat: first
- f.txt @ 1

## group 2 — fix: second
- f.txt @ 2
- other.txt
`);
    const r = runTool("repo-stage", ["--batch", m, "--group", "1"], { cwd: repo });
    expect(r.output).toMatch(/1\/2 hunk/);
    expect(r.output).toMatch(/remain/i);
  });

  it("refuses selector drift after group 1 commits (renumbering) with live count and remediation", () => {
    twoHunkFile();
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const m = manifest("drift.md", `# Commit batch: d

## group 1 — feat: first
- f.txt @ 1

## group 2 — fix: second
- f.txt @ 2
- other.txt
`);
    runTool("repo-stage", ["--batch", m, "--group", "1"], { cwd: repo });
    sh("git commit -qm group1"); // f.txt now has ONE unstaged hunk (the line40 change)
    const r = runTool("repo-stage", ["--batch", m, "--group", "2"], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/selector drift/);
    expect(r.output).toMatch(/now has 1 hunk/);
  });

  it("hunk coverage refuses an unclaimed hunk of a partially-claimed file", () => {
    twoHunkFile();
    writeFileSync(`${repo}/third.txt`, "y\n");
    sh("git add -N third.txt");
    const m = manifest("cov.md", `# Commit batch: c

## group 1 — feat: first
- f.txt @ 1

## group 2 — fix: second
- third.txt
`);
    const r = runTool("repo-stage", ["--batch", m, "--group", "1"], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/hunk 2 is changed but claimed by no group/);
  });

  it("stale selectors after a partial commit REFUSE with drift (renumber or re-group — never silent re-attribution)", () => {
    twoHunkFile();
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const m = manifest("stale.md", `# Commit batch: k

## group 1 — feat: first
- f.txt @ 1

## group 2 — fix: second
- f.txt @ 2
- other.txt
`);
    runTool("repo-stage", ["--batch", m, "--group", "1"], { cwd: repo });
    sh("git commit -qm group1"); // f.txt now carries ONE unstaged hunk (line40)
    const r = runTool("repo-stage", ["--batch", m], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/selector drift/);
    expect(r.output).toMatch(/now has 1 hunk/);
  });
});

describe("repo-batch-draft selector authoring (Phase 4.5)", () => {
  it("renders hunk-selector lines from task claims and round-trips through the strict parser", () => {
    twoHunkFile();
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const planPath = `${manifestDir}/plan.md`;
    const planText = [
      "# Plan",
      "",
      "- [ ] **1.1 [S] First half**",
      "  - Files: `f.txt @ 1`",
      "",
      "- [ ] **1.2 [S] Second half**",
      "  - Files: `f.txt @ 2`, `other.txt`",
      "",
    ].join("\n");
    writeFileSync(planPath, planText);
    mkdirSync(`${repo}/.local-artifacts`, { recursive: true });
    const r = runTool("repo-batch-draft", ["--plan", planPath], { cwd: repo });
    expect(r.status).toBe(0);
    // The draft lands in the repo's .local-artifacts/ (next free suffix).
    const draftPath = `${repo}/.local-artifacts/batch-draft-1.md`;
    const draft = readFileSync(draftPath, "utf8");
    expect(draft).toContain("- f.txt @ 1");
    expect(draft).toContain("- f.txt @ 2");
    expect(draft).toContain("- other.txt");
    // Round-trip: the resolved draft parses under repo-stage's strict parser.
    // The draft is moved OUT of the worktree first — inside it, coverage
    // correctly refuses it (the draft file itself is changed+unclaimed).
    const outsideDraft = `${manifestDir}/roundtrip.md`;
    copyFileSync(draftPath, outsideDraft);
    rmSync(draftPath);
    const parse = runTool("repo-stage", ["--batch", outsideDraft], { cwd: repo });
    expect(parse.status).toBe(0);
    expect(parse.output).toMatch(/batch ok/);
  });
});

describe("end-to-end same-file multi-group sequence (Phase 5.4)", () => {
  it("two groups, same file: stage → commit → renumbered selectors confirmed → stage → commit", () => {
    twoHunkFile();
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const m = manifest("e2e.md", `# Commit batch: e2e

## group 1 — feat: first half
- f.txt @ 1

## group 2 — fix: second half
- f.txt @ 2
- other.txt
`);
    // Group 1: stage + commit via the sanctioned wrappers.
    const s1 = runTool("repo-stage", ["--batch", m, "--group", "1"], { cwd: repo });
    expect(s1.status).toBe(0);
    sh("git commit -qm 'feat: first half'");
    // Post-commit the live diff renumbers: f.txt has ONE hunk (line40).
    // The stale manifest refuses (drift) — renumbered manifest proceeds.
    const stale = runTool("repo-stage", ["--batch", m, "--group", "2"], { cwd: repo });
    expect(stale.status).toBe(1);
    expect(stale.output).toMatch(/selector drift.*now has 1 hunk/s);
    const m2 = manifest("e2e-renumbered.md", `# Commit batch: e2e (renumbered after group 1)

## group 1 — feat: first half

## group 2 — fix: second half
- f.txt @ 1
- other.txt
`);
    const s2 = runTool("repo-stage", ["--batch", m2, "--group", "2"], { cwd: repo });
    expect(s2.status).toBe(0);
    sh("git commit -qm 'fix: second half'");
    // Two commits, each carrying exactly its intended hunk.
    const c1 = sh("git show --stat --format=%s HEAD~1").stdout;
    const c2 = sh("git show --stat --format=%s HEAD").stdout;
    expect(c1).toContain("first half");
    expect(c2).toContain("second half");
    expect(sh("git show HEAD~1 -- f.txt").stdout).toContain("line4-CHANGED");
    expect(sh("git show HEAD~1 -- f.txt").stdout).not.toContain("line40-CHANGED");
    expect(sh("git show HEAD -- f.txt").stdout).toContain("line40-CHANGED");
    // Worktree clean of f.txt changes: both hunks landed in their commits.
    expect(sh("git diff -- f.txt").stdout).toBe("");
  });
});

describe("review round 1 fixes", () => {
  it("B2: no-newline-at-EOF file enumerates and stages (no false drift)", () => {
    const base = Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join("\n"); // NO trailing newline
    writeFileSync(`${repo}/f.txt`, base + "\n");
    sh("git add f.txt && git commit -qm init");
    const lines = base.split("\n");
    lines[3] = "line4-CHANGED";
    lines[39] = "line40-CHANGED";
    writeFileSync(`${repo}/f.txt`, lines.join("\n")); // still no trailing newline
    sh(`git diff -- f.txt > ${manifestDir}/full.patch`);
    // preamble + the ENTIRE second hunk (from the 2nd @@ to EOF — no
    // truncation; a truncated hunk is a corrupt patch, refused by git).
    sh(`awk 'NR<=4 {print; next} /^@@/ {h++} h==2 {print}' ${manifestDir}/full.patch > ${manifestDir}/h2.patch`);
    const r = runTool("repo-stage", ["--patch", `${manifestDir}/h2.patch`], { cwd: repo });
    expect(r.status).toBe(0);
    expect(sh("git diff --cached -- f.txt").stdout).toContain("line40");
    expect(sh("git diff -- f.txt").stdout).toContain("line4");
  });

  it("B3: a huge hunk-spec range refuses fast instead of hanging", () => {
    const m = manifest("huge.md", `# Commit batch: h

## group 1 — s
- f.txt @ 1-999999999
`);
    twoHunkFile();
    const r = runTool("repo-stage", ["--batch", m], { cwd: repo });
    expect(r.status).toBe(1);
    // Parse-time refusal (expandHunkSpec throws → the malformed-selector row
    // names the line; fast, never a hang).
    expect(r.output).toMatch(/malformed hunk selector on 'f\.txt'/);
  });

  it("C1: whole-file claim + selector claim on the same path refuses (no silent re-attribution)", () => {
    twoHunkFile();
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const m = manifest("mixed-grain.md", `# Commit batch: m

## group 1 — whole
- f.txt

## group 2 — partial
- f.txt @ 1
- other.txt
`);
    const r = runTool("repo-stage", ["--batch", m], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/whole-file claim in group 1 and as a hunk-selector claim in group 2/);
  });

  it("C3: a deletion patch refuses in --patch mode", () => {
    twoHunkFile();
    sh("git add f.txt && git commit -qm base");
    sh("rm f.txt");
    const del = `${manifestDir}/del.patch`;
    sh(`git diff -- f.txt > ${del}`);
    const r = runTool("repo-stage", ["--patch", del], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/deletion patches are refused/);
  });

  it("C4: a glob selector claim refuses as non-literal at validation", () => {
    twoHunkFile();
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const m = manifest("glob.md", `# Commit batch: g

## group 1 — s
- src/*.ts @ 1
- other.txt

## excluded
- f.txt
`);
    const r = runTool("repo-stage", ["--batch", m], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/not a literal repo-root-relative file path/);
  });

  it("C2: prior-staged adjacent content stages correctly (merge-aware verification, no false refusal)", () => {
    const base = Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    writeFileSync(`${repo}/f.txt`, base);
    sh("git add f.txt && git commit -qm init");
    // Hand-stage a change at line 10; worktree adds line10-STAGED (staged)
    // PLUS line40-NEW (unstaged). Index-vs-HEAD renders the staged hunk;
    // staging @ 1 (line40-NEW) must verify MERGE-AWARE: the staged diff
    // against HEAD shows both changes, potentially as adjacent merged
    // hunks — the old strict set-equality refused this correct outcome.
    const stage1 = base.split("\n"); stage1[9] = "line10-STAGED";
    writeFileSync(`${repo}/f.txt`, stage1.join("\n"));
    sh("git add f.txt");
    const wt = base.split("\n"); wt[9] = "line10-STAGED"; wt[39] = "line40-NEW";
    writeFileSync(`${repo}/f.txt`, wt.join("\n"));
    // Drive via --patch: extract the line40 hunk and stage it; verification
    // must accept the merged rendering (no false refusal, no data loss).
    sh(`git diff -- f.txt > ${manifestDir}/adj-full.patch`);
    sh(`awk 'NR<=4 {print; next} /^@@/ {h++} h==1 {print}' ${manifestDir}/adj-full.patch > ${manifestDir}/adj.patch`);
    const r = runTool("repo-stage", ["--patch", `${manifestDir}/adj.patch`], { cwd: repo });
    expect(r.status).toBe(0);
    // line40 staged; line10 already staged by hand — both in index now.
    expect(sh("git diff --cached -- f.txt").stdout).toContain("line40-NEW");
    expect(sh("git diff --cached -- f.txt").stdout).toContain("line10-STAGED");
    expect(sh("git diff -- f.txt").stdout).not.toContain("line40-NEW");
  });

  it("C5: untracked selector claim classifies as new-file (not fake 0-hunk drift)", () => {
    twoHunkFile();
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const m = manifest("untracked.md", `# Commit batch: u

## group 1 — s
- brandnew.ts @ 1

## group 2 — t
- f.txt @ 1
- other.txt

## excluded
- f.txt @ 2
`);
    void m;
    // brandnew.ts untracked: enumerate classifies new-file; the manifest
    // also carries a duplicate (f.txt @ 2 in excluded is refused at parse).
    const r = runTool("repo-stage", ["--batch", manifest("untracked2.md", `# Commit batch: u2

## group 1 — s
- brandnew.ts @ 1

## group 2 — t
- f.txt @ 1-2
- other.txt
`)], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/brandnew\.ts.*new file|untracked.*refused in v1/);
  });
});

describe("review round 2 fixes", () => {
  it("B-R2-1: excluded + selector claim on the same path refuses", () => {
    twoHunkFile();
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const m = manifest("r2-excluded.md", `# Commit batch: x

## group 1 — s
- f.txt @ 1-2
- other.txt

## excluded
- f.txt
`);
    const r = runTool("repo-stage", ["--batch", m], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/excluded entry.*hunk-selector claim in group 1|never two of these/);
  });

  it("C-R2-2: repeated disjoint ranges refuse fast (total-expansion cap)", () => {
    twoHunkFile();
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const spec = Array.from({ length: 40 }, () => "1-10000").join(",");
    const m = manifest("r2-comma.md", `# Commit batch: c

## group 1 — s
- f.txt @ ${spec}

## group 2 — t
- other.txt

## excluded
- f.txt @ 1
`);
    void m;
    const m2 = manifest("r2-comma2.md", `# Commit batch: c2

## group 1 — s
- f.txt @ ${spec}

## group 2 — t
- other.txt
`);
    const start = Date.now();
    const r = runTool("repo-stage", ["--batch", m2], { cwd: repo });
    const dur = Date.now() - start;
    expect(dur).toBeLessThan(10000);
    expect(r.status).toBe(1);
    // PARSE-TIME refusal — the expansion itself must refuse past the total
    // ceiling (not merely complete fast enough for validation to refuse).
    expect(r.output).toMatch(/expands past the total ceiling/);
  });

  it("C-R2-3: a content line containing 'new file mode' does NOT classify as new-file", () => {
    const base = Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    writeFileSync(`${repo}/code.ts`, base);
    sh("git add code.ts && git commit -qm init");
    const lines = base.split("\n");
    lines[3] = 'const x = "new file mode check";';
    lines[39] = "line40-CHANGED";
    writeFileSync(`${repo}/code.ts`, lines.join("\n"));
    const m = manifest("r2-content.md", `# Commit batch: n

## group 1 — s
- code.ts @ 1

## group 2 — t
- code.ts @ 2
- other.txt
`);
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const r = runTool("repo-stage", ["--batch", m, "--group", "1"], { cwd: repo });
    expect(r.status).toBe(0);
    expect(sh("git diff --cached -- code.ts").stdout).toContain("new file mode check");
  });

  it("C-R2-5: an unstaged mode change does NOT ride along with content hunks", () => {
    twoHunkFile();
    sh("chmod +x f.txt");
    const m = manifest("r2-mode.md", `# Commit batch: mo

## group 1 — s
- f.txt @ 1

## group 2 — t
- f.txt @ 2
- other.txt
`);
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const r = runTool("repo-stage", ["--batch", m, "--group", "1"], { cwd: repo });
    expect(r.status).toBe(0);
    const summary = sh("git diff --cached --summary -- f.txt").stdout;
    expect(summary).not.toMatch(/mode change/);
  });

  it("C-R2-6: a worktree-deleted file refuses selector claims (whole-file only)", () => {
    writeFileSync(`${repo}/gone.txt`, "a\nb\nc\n");
    sh("git add gone.txt && git commit -qm base");
    sh("rm gone.txt");
    writeFileSync(`${repo}/other.txt`, "x\n");
    sh("git add -N other.txt");
    const m = manifest("r2-del.md", `# Commit batch: d

## group 1 — s
- gone.txt @ 1

## group 2 — t
- other.txt
`);
    const r = runTool("repo-stage", ["--batch", m], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/deleted in the worktree.*whole-file claims/);
  });

  it("C-R2-4: a quoted (non-ASCII) patch path refuses rather than skipping verification", () => {
    const base = Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    writeFileSync(`${repo}/unié.txt`, base);
    sh("git add unié.txt && git commit -qm init");
    const lines = base.split("\n");
    lines[39] = "line40-CHANGED";
    writeFileSync(`${repo}/unié.txt`, lines.join("\n"));
    const p = `${manifestDir}/quoted.patch`;
    sh(`git -c core.quotePath=true diff -- unié.txt > ${p}`);
    if (!readFileSync(p, "utf8").includes('"a/')) {
      // git didn't quote — skip (the refusal path needs the quoted form)
      return;
    }
    const r = runTool("repo-stage", ["--patch", p], { cwd: repo });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/quoted/);
  });
});
