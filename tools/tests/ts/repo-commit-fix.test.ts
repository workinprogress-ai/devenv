// Black-box tests for repo-commit --fix: the one-operation fold (backup
// branch, fixup commit, autosquash rebase, verify, report), every preflight
// refusal, conflict auto-abort with the fixup preserved at HEAD, dry-run,
// autostash round-trip, and the non-TTY bare --fix refusal. Real temp git
// repos with a local bare remote; hooks run (the fixup! subject relies on
// the commitlint ignores entry in the real repo's config — here --no-verify
// seeding keeps fixtures independent of that config).
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

function seedCommit(msg: string, file: string, content = "x\n"): string {
  writeFileSync(join(repo, file), content);
  git("add", "--", file);
  git("commit", "-q", "--no-verify", "-m", msg);
  return git("rev-parse", "HEAD").trim();
}

function stageFile(name: string, content: string): void {
  writeFileSync(join(repo, name), content);
  git("add", "--", name);
}

function runTool(args: string[], env: Record<string, string | undefined> = {}): { status: number; out: string } {
  const r = spawnSync("node", [tool, ...args], {
    encoding: "utf8",
    cwd: repo,
    env: { ...process.env, GIT_SEQUENCE_EDITOR: ":", ...env },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "repo-commit-fix-"));
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

describe("repo-commit --fix", () => {
  it("folds staged content into an earlier commit as one operation", () => {
    const second = seedCommit("feat: second", "b.txt", "2\n");
    seedCommit("feat: third", "c.txt", "3\n");
    stageFile("b.txt", "2\nlate addition\n");
    const r = runTool(["--fix", second]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("folded staged content into");
    expect(r.out).toContain("feat: second");
    // stack order preserved, no fixup! commit remains
    const log = git("log", "--format=%s", "-3");
    expect(log).toContain("feat: third");
    expect(log).toContain("feat: second");
    expect(log).not.toContain("fixup!");
    // late content landed in the right commit: find the rewritten 'feat: second'
    const secondSha = git("log", "--format=%H", "--grep=^feat: second$").trim().split("\n")[0] ?? "";
    expect(git("show", `${secondSha}:b.txt`)).toContain("late addition");
  });

  it("creates a backup branch and reports the recovery recipe", () => {
    const second = seedCommit("feat: second", "b2.txt");
    seedCommit("feat: third", "c2.txt");
    stageFile("b2.txt", "changed\n");
    const r = runTool(["--fix", second]);
    expect(r.status).toBe(0);
    const backup = git("branch", "--list", "backup/pre-fixup-*").trim();
    expect(backup).not.toBe("");
    expect(r.out).toContain(backup);
    expect(r.out).toContain("git reset --hard");
  });

  it("refuses nothing-staged before any mutation", () => {
    const second = seedCommit("feat: second", "b3.txt");
    const r = runTool(["--fix", second]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("nothing is staged");
    expect(git("branch", "--list", "backup/*").trim()).toBe(""); // no backup made
  });

  it("refuses a target that is not an ancestor of HEAD", () => {
    seedCommit("feat: second", "b4.txt");
    stageFile("x.txt", "x\n"); // stage first: nothing-staged preflight precedes ancestry
    // create an unrelated commit on a side branch
    git("stash", "-q"); // keep the staged x.txt out of the side branch
    git("switch", "-c", "side");
    const side = seedCommit("feat: side", "s.txt");
    git("switch", "master");
    git("stash", "pop", "-q");
    const r = runTool(["--fix", side]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("not an ancestor of HEAD");
  });

  it("refuses a pushed target fail-closed", () => {
    seedCommit("feat: second", "b5.txt");
    git("push", "-q", "origin", "master");
    seedCommit("feat: third", "c5.txt");
    stageFile("b5.txt", "changed\n");
    const r = runTool(["--fix", "HEAD~1"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("folding shared history is refused");
    expect(r.out).toContain("plain fix");
  });

  it("redirects to --amend when the target is HEAD", () => {
    seedCommit("feat: second", "b6.txt");
    stageFile("b6.txt", "changed\n");
    const r = runTool(["--fix", "HEAD"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("use --amend instead");
  });

  it("refuses an unresolvable ref", () => {
    stageFile("x2.txt", "x\n");
    const r = runTool(["--fix", "does-not-exist"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("cannot resolve");
  });

  it("conflict auto-aborts: fixup preserved at HEAD, stack intact", () => {
    const second = seedCommit("feat: second", "conflict.txt", "original\n");
    seedCommit("feat: third", "c7.txt");
    // staged change conflicting with the fold: rewrite the same line the
    // later commit also touches
    writeFileSync(join(repo, "conflict.txt"), "rewritten\n");
    git("add", "--", "conflict.txt");
    writeFileSync(join(repo, "conflict.txt"), "competing\n");
    git("add", "--", "conflict.txt");
    git("commit", "-q", "--no-verify", "-m", "feat: competing edit");
    writeFileSync(join(repo, "conflict.txt"), "later\n");
    git("add", "--", "conflict.txt");
    const r = runTool(["--fix", second]);
    // either the fold succeeds trivially (no textual conflict) or it
    // auto-aborts with the fixup preserved — never a stuck rebase
    if (r.status !== 0) {
      expect(r.out).toContain("rebase aborted");
      expect(git("log", "-1", "--format=%s")).toContain("fixup!");
      expect(git("status", "--porcelain")).not.toContain("rebase-i");
    } else {
      expect(git("log", "--format=%s", "-5")).not.toContain("fixup!");
    }
  });

  it("dry-run: resolves and prints, touches nothing", () => {
    const second = seedCommit("feat: second", "b8.txt");
    seedCommit("feat: third", "c8.txt");
    stageFile("b8.txt", "changed\n");
    const before = git("rev-parse", "HEAD").trim();
    const r = runTool(["--fix", second, "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("dry-run");
    expect(r.out).toContain("feat: second");
    expect(r.out).toContain("rehash:");
    expect(git("rev-parse", "HEAD").trim()).toBe(before);
    expect(git("branch", "--list", "backup/*").trim()).toBe("");
  });

  it("autostash: unstaged work survives the fold", () => {
    const second = seedCommit("feat: second", "b9.txt");
    seedCommit("feat: third", "c9.txt");
    stageFile("b9.txt", "staged-change\n");
    // unstaged work in an untouched file — autostash must round-trip it
    writeFileSync(join(repo, "unrelated-wip.txt"), "wip\n");
    const r = runTool(["--fix", second]);
    expect(r.status).toBe(0);
    expect(git("status", "--porcelain")).toContain("?? unrelated-wip.txt");
  });

  it("refuses the root commit as target (no mislabeled conflict)", () => {
    // fresh unpushed repo: the cloned fixture's root is the pushed base,
    // so pushed-preflight would fire first there
    const fixtureRoot = root; // the suite's root var stays untouched
    const fresh = join(fixtureRoot, "fresh");
    spawnSync("git", ["init", "-q", "-b", "master", fresh], { encoding: "utf8" });
    spawnSync("git", ["-C", fresh, "config", "user.email", "t@example.com"], { encoding: "utf8" });
    spawnSync("git", ["-C", fresh, "config", "user.name", "T"], { encoding: "utf8" });
    spawnSync("git", ["-C", fresh, "commit", "-q", "--allow-empty", "--no-verify", "-m", "chore: root"], { encoding: "utf8" });
    spawnSync("git", ["-C", fresh, "commit", "-q", "--allow-empty", "--no-verify", "-m", "chore: second"], { encoding: "utf8" });
    writeFileSync(join(fresh, "s.txt"), "s\n");
    spawnSync("git", ["-C", fresh, "add", "--", "s.txt"], { encoding: "utf8" });
    const rootSha = spawnSync("git", ["-C", fresh, "rev-list", "--max-parents=0", "HEAD"], { encoding: "utf8" }).stdout.trim();
    const r = spawnSync("node", [tool, "--fix", rootSha], {
      encoding: "utf8",
      cwd: fresh,
      env: { ...process.env, GIT_SEQUENCE_EDITOR: ":" },
    });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    expect(r.status).not.toBe(0);
    expect(out).toContain("root commit");
    expect(out).not.toContain("conflict");
  });

  it("lane flags are mutually exclusive: --amend --fix refuses, --wip --fix refuses", () => {
    stageFile("x3.txt", "x\n");
    const r1 = runTool(["--amend", "--fix", "HEAD~1"]);
    expect(r1.status).not.toBe(0);
    expect(r1.out).toContain("mutually exclusive");
    const r2 = runTool(["--wip", "--fix", "HEAD"]);
    expect(r2.status).not.toBe(0);
    expect(r2.out).toContain("mutually exclusive");
  });

  it("--fix takes no message: --file and positionals refuse early", () => {
    stageFile("x4.txt", "x\n");
    const r = runTool(["--fix", "HEAD~1", "--file", "/tmp/whatever.txt"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("--fix takes no message");
  });

  it("bare --fix without a TTY refuses with remediation", () => {
    seedCommit("feat: second", "b10.txt");
    stageFile("b10.txt", "changed\n");
    const r = runTool(["--fix"], { GIT_EDITOR: undefined }); // stdin is not a TTY under vitest
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("needs a TTY");
    expect(r.out).toContain("--fix <commit-ish>");
  });
});
