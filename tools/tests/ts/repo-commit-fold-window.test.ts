// Tests for repo-commit --fold-window: the read-only foldable-commit report
// (15.45). Fixture: the shared repo-commit harness with a local bare remote,
// so pushed-but-unlanded vs landed states are both constructible. Boundary
// agreement (a listed commit is one --fix accepts) is exercised against the
// same helper via the fix lane.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRepoCommitHarness,
  harnessGit,
  harnessRunTool,
  harnessSeedCommit,
  type Harness,
} from "./harness/repo-commit.ts";

let h: Harness;

beforeEach(() => {
  h = createRepoCommitHarness({ bareRemote: true });
  harnessSeedCommit(h, "chore: base", "base.txt");
  harnessGit(h, "push", "-q", "origin", "master");
});

afterEach(() => h.dispose());

describe("repo-commit --fold-window", () => {
  it("empty window: every commit landed — one line, exit 0", () => {
    const r = harnessRunTool(h, ["--fold-window"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("fold window is empty");
  });

  it("lists unlanded commits newest-first with the files each touched", () => {
    harnessSeedCommit(h, "feat: first work", "a.txt");
    const second = harnessSeedCommit(h, "feat: second work", "b.txt");
    const r = harnessRunTool(h, ["--fold-window"]);
    expect(r.status).toBe(0);
    const firstIdx = r.out.indexOf("feat: first work");
    const secondIdx = r.out.indexOf("feat: second work");
    expect(firstIdx).toBeGreaterThan(0);
    expect(secondIdx).toBeLessThan(firstIdx); // newest first
    expect(r.out).toContain("b.txt"); // file map present
    expect(r.out).toContain(second.slice(0, 7));
  });

  it("excludes landed commits from the listing", () => {
    harnessSeedCommit(h, "feat: landed work", "l.txt");
    harnessGit(h, "push", "-q", "origin", "master");
    harnessSeedCommit(h, "feat: unlanded work", "u.txt");
    const r = harnessRunTool(h, ["--fold-window"]);
    expect(r.out).toContain("feat: unlanded work");
    expect(r.out).not.toContain("feat: landed work");
  });

  it("fails closed when no default branch resolves (default branch is neither main nor master)", () => {
    harnessGit(h, "branch", "-m", "master", "develop");
    harnessGit(h, "update-ref", "-d", "refs/remotes/origin/master");
    const target = harnessSeedCommit(h, "feat: unknown-default work", "u1.txt");
    harnessSeedCommit(h, "feat: tip work", "u2.txt");
    writeFileSync(join(h.repo, "u1.txt"), "changed\n");
    harnessGit(h, "add", "u1.txt");
    const r = harnessRunTool(h, ["--fix", target]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("fold window is closed");
  });

  it("overlap section appears when working changes touch a foldable commit's files", () => {
    harnessSeedCommit(h, "feat: touches alpha", "alpha.txt");
    writeFileSync(join(h.repo, "alpha.txt"), "changed\n"); // working-tree change
    const r = harnessRunTool(h, ["--fold-window"]);
    expect(r.out).toContain("fold candidate:");
    expect(r.out).toContain("alpha.txt");
  });

  it("no overlap line when the working set is clean of foldable files", () => {
    harnessSeedCommit(h, "feat: touches alpha", "alpha.txt");
    const r = harnessRunTool(h, ["--fold-window"]);
    expect(r.out).toContain("no staged/working overlap");
  });

  it("refuses to combine with --amend, --fix, --wip, --file, and --dry-run", () => {
    for (const args of [["--fold-window", "--amend"], ["--fold-window", "--fix"], ["--fold-window", "--wip"]]) {
      const r = harnessRunTool(h, args);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("mutually exclusive");
    }
    // --dry-run hits the earlier dry-run-context guard (it applies to
    // --amend/--fix only); --file hits the fold-window-specific refusal.
    const dryRunR = harnessRunTool(h, ["--fold-window", "--dry-run"]);
    expect(dryRunR.status).not.toBe(0);
    expect(dryRunR.out).toContain("--dry-run applies to");
    const fileR = harnessRunTool(h, ["--fold-window", "--file", "x.txt"]);
    expect(fileR.status).not.toBe(0);
    expect(fileR.out).toContain("takes no message");
  });

  it("boundary agreement: a commit the report lists is one --fix accepts (dry-run resolves it)", () => {
    harnessSeedCommit(h, "feat: first work", "a.txt");
    harnessSeedCommit(h, "feat: second work", "b.txt");
    const report = harnessRunTool(h, ["--fold-window"]);
    expect(report.status).toBe(0);
    const shaMatch = report.out.match(/^  ([0-9a-f]{7,}) feat: first work/m);
    const sha = shaMatch?.[1];
    expect(sha).toBeTruthy();
    writeFileSync(join(h.repo, "a.txt"), "changed\n");
    harnessGit(h, "add", "--", "a.txt");
    // Ref-first form: --dry-run before the positional ref keeps the sha out of
    // the message position (the argv loop treats a bare sha as a message).
    const fix = harnessRunTool(h, ["--fix", sha as string, "--dry-run"]);
    expect(fix.status).toBe(0); // the guard accepts what the report lists
    expect(fix.out).toContain("feat: first work");
  });
});
