// Black-box tests for repo-commit --amend: folds staged content into HEAD
// whose fold window is still open (not landed in master) under the editor
// gate (HEAD's message preloaded), refuses a master-landed HEAD fail-closed,
// refuses an empty index, and an aborted editor leaves HEAD and the index
// untouched. Same harness shape as the baseline suite: copied tool fixture,
// real temp git repo, scripted GIT_EDITOR, and a local bare remote for
// pushed/unlanded vs landed scenarios.
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

  it("folds staged content into a pushed-but-unlanded HEAD (remote-only membership does not close the window)", () => {
    seedCommit("feat: pushed pr work", "pushed.txt");
    git("push", "-q", "origin", "HEAD:refs/heads/pr-branch"); // on a remote branch, NOT master
    stageFile("extra.txt", "e\n");
    const before = git("rev-parse", "HEAD").trim();
    const r = runTool(["--amend"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("amended.");
    expect(git("rev-parse", "HEAD").trim()).not.toBe(before); // rewritten
  });

  it("refuses a master-landed HEAD fail-closed with remediation", () => {
    // HEAD (chore: base) is on master and pushed: the remote-tracking ref
    // (origin/master) reaches it — the fold window is closed.
    stageFile("late.txt", "l\n");
    const before = git("rev-parse", "HEAD").trim();
    const r = runTool(["--amend"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("fold window is closed");
    expect(r.out).toContain("--fix");
    expect(git("rev-parse", "HEAD").trim()).toBe(before); // untouched
  });

  it("refuses a HEAD named by a tag even though master has not reached it", () => {
    seedCommit("feat: tagged side work", "tagged.txt");
    git("tag", "v9-fold-closed");
    stageFile("extra2.txt", "e\n");
    const r = runTool(["--amend"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("fold window is closed");
  });

  it("amends with a CLEAN index as a message-only rewrite (no content fold)", () => {
    seedCommit("feat: unpushed work", "work2.txt");
    const before = git("rev-parse", "HEAD").trim();
    const r = runTool(["--amend"]); // nothing staged: message-only; save-mode editor keeps the preload
    expect(r.status).toBe(0);
    expect(r.out).toContain("amended.");
    expect(r.out).toContain("rewrites HEAD's message only"); // the clean-index notice
    // Tree untouched: the amended commit has the same tree as before.
    expect(git("rev-parse", "HEAD^{tree}")).toBe(git("rev-parse", `${before}^{tree}`));
    // The preload survived (save-mode editor kept HEAD's message).
    expect(git("log", "-1", "--format=%s")).toContain("feat: unpushed work");
    // A changed message produces a new commit (message-only amend rewrites):
    writeFileSync(join(repo, "ed2.sh"), "#!/bin/sh\nprintf 'feat: unpushed work (reworded via clean amend)\\n' > \"$1\"\n");
    chmodSync(join(repo, "ed2.sh"), 0o755);
    const r2 = spawnSync("node", [tool, "--amend"], {
      encoding: "utf8",
      cwd: repo,
      env: { ...process.env, GIT_EDITOR: join(repo, "ed2.sh") },
    });
    expect(r2.status).toBe(0);
    expect(git("rev-parse", "HEAD").trim()).not.toBe(before); // rewritten
    expect(git("log", "-1", "--format=%s")).toContain("(reworded via clean amend)");
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
