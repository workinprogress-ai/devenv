// Black-box tests for repo-commit --amend: folds staged content into unpushed
// HEAD under the editor gate (HEAD's message preloaded), refuses a pushed
// HEAD fail-closed, refuses an empty index, and an aborted editor leaves
// HEAD and the index untouched. Same harness shape as the baseline suite:
// copied tool fixture, real temp git repo, scripted GIT_EDITOR, and a local
// bare remote for pushed/unpushed scenarios.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_TOOLS = fileURLToPath(new URL(".", import.meta.url)).replace("tests/ts/", "");

let root: string;
let repo: string;
let tool: string;
let editorScript: string;

function git(...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function stageFile(name: string, content: string): void {
  writeFileSync(join(repo, name), content);
  git("add", "--", name);
}

function seedCommit(msg: string, file: string): void {
  writeFileSync(join(repo, file), `${msg}\n`);
  git("add", "--", file);
  git("commit", "-q", "--no-verify", "-m", msg);
}

function setEditorMode(mode: "save" | "empty" | "abort"): void {
  writeFileSync(editorScript, `#!/bin/sh\ncase "${mode}" in\n  save) exit 0 ;;\n  empty) : > "$1" ; exit 0 ;;\n  abort) exit 1 ;;\nesac\n`);
  chmodSync(editorScript, 0o755);
}

function runTool(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [tool, ...args], {
    encoding: "utf8",
    cwd: repo,
    env: { ...process.env, GIT_EDITOR: editorScript },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "repo-commit-amend-"));
  cpSync(join(REPO_TOOLS, "lib"), join(root, "tools", "lib"), { recursive: true });
  cpSync(join(REPO_TOOLS, "ts", "repo-commit.ts"), join(root, "tools", "ts", "repo-commit.ts"));
  tool = join(root, "tools", "ts", "repo-commit.ts");
  editorScript = join(root, "editor.sh");
  setEditorMode("save");

  // repo with a local bare remote: pushed/unpushed HEAD both constructible
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

describe("repo-commit --amend", () => {
  it("folds staged content into unpushed HEAD, message preserved via preload", () => {
    seedCommit("feat: unpushed work", "work.txt"); // HEAD now unpushed
    stageFile("extra.txt", "e\n");
    const before = git("rev-parse", "HEAD").trim();
    const r = runTool(["--amend"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("amended.");
    expect(r.out).toContain("feat: unpushed work"); // message survived
    const after = git("rev-parse", "HEAD").trim();
    expect(after).not.toBe(before); // HEAD rewritten
    expect(git("status", "--porcelain")).toBe(""); // staged content consumed
    expect(git("show", "--stat", "--format=", "HEAD")).toContain("extra.txt");
  });

  it("refuses a pushed HEAD fail-closed with remediation", () => {
    // HEAD (chore: base) is pushed by the fixture
    stageFile("late.txt", "l\n");
    const before = git("rev-parse", "HEAD").trim();
    const r = runTool(["--amend"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("amending pushed history is refused");
    expect(r.out).toContain("--fix");
    expect(git("rev-parse", "HEAD").trim()).toBe(before); // untouched
  });

  it("refuses an empty index before any editor opens", () => {
    seedCommit("feat: unpushed work", "work2.txt");
    const r = runTool(["--amend"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("nothing is staged");
    expect(r.out).not.toContain("opening editor");
  });

  it("an aborted editor session leaves HEAD and index untouched", () => {
    seedCommit("feat: unpushed work", "work3.txt");
    stageFile("nope.txt", "n\n");
    const before = git("rev-parse", "HEAD").trim();
    setEditorMode("abort");
    const r = runTool(["--amend"]);
    expect(r.status).not.toBe(0);
    expect(git("rev-parse", "HEAD").trim()).toBe(before);
    expect(git("status", "--porcelain")).toContain("A  nope.txt");
  });

  it("--dry-run does not mutate: prints the plan, leaves HEAD alone", () => {
    seedCommit("feat: unpushed work", "work5.txt");
    stageFile("dry.txt", "d\n");
    const before = git("rev-parse", "HEAD").trim();
    const r = runTool(["--amend", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("--amend dry-run");
    expect(r.out).toContain("would fold staged content into HEAD");
    expect(git("rev-parse", "HEAD").trim()).toBe(before);
    expect(git("status", "--porcelain")).toContain("A  dry.txt"); // index untouched
  });

  it("an emptied message cancels the amend", () => {
    seedCommit("feat: unpushed work", "work4.txt");
    stageFile("nope2.txt", "n\n");
    const before = git("rev-parse", "HEAD").trim();
    setEditorMode("empty");
    const r = runTool(["--amend"]);
    expect(r.status).not.toBe(0);
    expect(git("rev-parse", "HEAD").trim()).toBe(before);
  });
});
