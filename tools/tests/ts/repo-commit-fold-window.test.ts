// Tests for repo-commit --fold-window: the read-only foldable-commit report
// (15.45). Fixture shape mirrors the amend/fix suites: copied tool fixture in
// a real temp git repo with a local bare remote, so pushed-but-unlanded vs
// landed states are both constructible. Boundary agreement (a listed commit is
// one --fix accepts) is exercised against the same helper via the fix lane.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_TOOLS = fileURLToPath(new URL(".", import.meta.url)).replace("tests/ts/", "");

let root: string;
let repo: string;
let tool: string;

function git(...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function seedCommit(msg: string, file: string): string {
  writeFileSync(join(repo, file), `${msg}\n`);
  git("add", "--", file);
  git("commit", "-q", "--no-verify", "-m", msg);
  return git("rev-parse", "HEAD").trim();
}

function runTool(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [tool, ...args], { encoding: "utf8", cwd: repo });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "repo-commit-fold-window-"));
  cpSync(join(REPO_TOOLS, "lib"), join(root, "tools", "lib"), { recursive: true });
  cpSync(join(REPO_TOOLS, "ts", "repo-commit.ts"), join(root, "tools", "ts", "repo-commit.ts"));
  tool = join(root, "tools", "ts", "repo-commit.ts");
  const remote = join(root, "remote.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "master", remote], { encoding: "utf8" });
  repo = join(root, "work");
  spawnSync("git", ["clone", "-q", remote, repo], { encoding: "utf8" });
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  seedCommit("chore: base", "base.txt");
  git("push", "-q", "origin", "master");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("repo-commit --fold-window", () => {
  it("empty window: every commit landed — one line, exit 0", () => {
    const r = runTool(["--fold-window"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("fold window is empty");
  });

  it("lists unlanded commits newest-first with the files each touched", () => {
    seedCommit("feat: first work", "a.txt");
    const second = seedCommit("feat: second work", "b.txt");
    const r = runTool(["--fold-window"]);
    expect(r.status).toBe(0);
    const firstIdx = r.out.indexOf("feat: first work");
    const secondIdx = r.out.indexOf("feat: second work");
    expect(firstIdx).toBeGreaterThan(0);
    expect(secondIdx).toBeLessThan(firstIdx); // newest first
    expect(r.out).toContain("b.txt"); // file map present
    expect(r.out).toContain(second.slice(0, 7));
  });

  it("excludes landed commits from the listing", () => {
    seedCommit("feat: landed work", "l.txt");
    git("push", "-q", "origin", "master");
    seedCommit("feat: unlanded work", "u.txt");
    const r = runTool(["--fold-window"]);
    expect(r.out).toContain("feat: unlanded work");
    expect(r.out).not.toContain("feat: landed work");
  });

  it("overlap section appears when working changes touch a foldable commit's files", () => {
    seedCommit("feat: touches alpha", "alpha.txt");
    writeFileSync(join(repo, "alpha.txt"), "changed\n"); // working-tree change
    const r = runTool(["--fold-window"]);
    expect(r.out).toContain("fold candidate:");
    expect(r.out).toContain("alpha.txt");
  });

  it("no overlap line when the working set is clean of foldable files", () => {
    seedCommit("feat: touches alpha", "alpha.txt");
    const r = runTool(["--fold-window"]);
    expect(r.out).toContain("no staged/working overlap");
  });

  it("refuses to combine with --amend, --fix, --wip, --file, and --dry-run", () => {
    for (const args of [["--fold-window", "--amend"], ["--fold-window", "--fix"], ["--fold-window", "--wip"]]) {
      const r = runTool(args);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("mutually exclusive");
    }
    // --dry-run hits the earlier dry-run-context guard (it applies to
    // --amend/--fix only); --file hits the fold-window-specific refusal.
    const dryRunR = runTool(["--fold-window", "--dry-run"]);
    expect(dryRunR.status).not.toBe(0);
    expect(dryRunR.out).toContain("--dry-run applies to");
    const fileR = runTool(["--fold-window", "--file", "x.txt"]);
    expect(fileR.status).not.toBe(0);
    expect(fileR.out).toContain("takes no message");
  });

  it("boundary agreement: a commit the report lists is one --fix accepts (dry-run resolves it)", () => {
    seedCommit("feat: first work", "a.txt");
    seedCommit("feat: second work", "b.txt");
    const report = runTool(["--fold-window"]);
    expect(report.status).toBe(0);
    const shaMatch = report.out.match(/^  ([0-9a-f]{7,}) feat: first work/m);
    const sha = shaMatch?.[1];
    expect(sha).toBeTruthy();
    stageForFix("a.txt");
    // Ref-first form: --dry-run before the positional ref keeps the sha out of
    // the message position (the argv loop treats a bare sha as a message).
    const fix = runTool(["--fix", sha as string, "--dry-run"]);
    expect(fix.status).toBe(0); // the guard accepts what the report lists
    expect(fix.out).toContain("feat: first work");
  });

  function stageForFix(file: string): void {
    writeFileSync(join(repo, file), "changed\n");
    git("add", "--", file);
  }
});
