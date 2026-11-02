// Tests for repo-commit --reword: change an earlier commit's message only
// (editor gate on the new message), with --fix's safety spine (preflight ->
// backup -> reword -> verify -> report). Fixture shape mirrors the amend/fix
// suites: copied tool fixture in a real temp git repo with a local bare
// remote, scripted GIT_EDITOR, real rebase mechanics.
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

function seedCommit(msg: string, file: string): string {
  writeFileSync(join(repo, file), `${msg}\n`);
  git("add", "--", file);
  git("commit", "-q", "--no-verify", "-m", msg);
  return git("rev-parse", "HEAD").trim();
}

/** Scripted message editor: the rebase hands it the message file ($1). Modes:
 * save a new subject, save the SAME subject (no-op reword), empty (cancel). */
function setMessageEditorMode(mode: "save" | "same" | "empty", newSubject = "feat: first work REWORDED"): void {
  const body = mode === "empty"
    ? ': > "$1"'
    : mode === "same"
      ? 'git log --format=%B -1 HEAD~1 > /dev/null; cp "$1" /dev/null; true' // keep as-is
      : `printf '${newSubject}\\n' > "$1"`;
  // "same" mode simply leaves the file untouched (editor that saves no change).
  const script = mode === "same" ? "#!/bin/sh\n" : `#!/bin/sh\n${body}\n`;
  writeFileSync(editorScript, script);
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
  root = mkdtempSync(join(tmpdir(), "repo-commit-reword-"));
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
  editorScript = join(root, "editor.sh");
  setMessageEditorMode("save");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("repo-commit --reword", () => {
  it("rewords an earlier commit's message and leaves the tree untouched", () => {
    seedCommit("feat: first work", "a.txt");
    seedCommit("feat: second work", "b.txt");
    const treeBefore = git("rev-parse", "HEAD^{tree}");
    const r = runTool(["--reword", "HEAD~1"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("reworded.");
    expect(r.out).toContain("feat: first work REWORDED");
    expect(r.out).toContain("backup/pre-reword-");
    // Descendant rehashed (new sha), subject preserved.
    expect(git("log", "--format=%s", "-2")).toContain("feat: second work");
    expect(git("log", "--format=%s", "-2")).toContain("feat: first work REWORDED");
    // The tree is byte-identical to the backup (a reword rewrites messages only).
    expect(git("rev-parse", `HEAD^{tree}`)).toBe(treeBefore);
    const backup = git("branch", "--format=%(refname:short)", "--list", "backup/pre-reword-*").trim();
    expect(backup).toContain("backup/pre-reword-");
    expect(git("diff", "--stat", backup, "HEAD").trim()).toBe("");
  });

  it("does not require staged content (a reword changes messages only)", () => {
    seedCommit("feat: first work", "a.txt");
    seedCommit("feat: second work", "b.txt");
    const r = runTool(["--reword", "HEAD~1"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("reworded.");
  });

  it("dry-run mutates nothing and prints the plan", () => {
    const target = seedCommit("feat: first work", "a.txt");
    seedCommit("feat: second work", "b.txt");
    const headBefore = git("rev-parse", "HEAD");
    // Ref-first contract (same as --fix): the ref must immediately follow
    // --reword; --dry-run trails it (order-free context flag).
    const r = runTool(["--reword", target, "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("--reword dry-run");
    expect(r.out).toContain("feat: first work");
    expect(git("rev-parse", "HEAD")).toBe(headBefore);
    expect(git("branch", "--list", "backup/*").trim()).toBe("");
  });

  it("refuses HEAD (redirect to --amend), the root commit, and a landed target", () => {
    seedCommit("chore: base2", "base2.txt");
    seedCommit("feat: first work", "a.txt");
    // HEAD redirect
    const rHead = runTool(["--reword", "HEAD"]);
    expect(rHead.status).not.toBe(0);
    expect(rHead.out).toContain("use --amend instead");
    // Root commit (the fixture's very first commit)
    const rootSha = git("rev-list", "--max-parents=0", "HEAD").trim();
    const rRoot = runTool(["--reword", rootSha]);
    expect(rRoot.status).not.toBe(0);
    expect(rRoot.out).toContain("root commit");
    // Landed: push a mid-stack commit to master, then try to reword it.
    const mid = seedCommit("feat: pushed work", "p.txt");
    git("push", "-q", "origin", "master");
    seedCommit("feat: tip work", "t.txt");
    const rLanded = runTool(["--reword", mid]);
    expect(rLanded.status).not.toBe(0);
    expect(rLanded.out).toContain("fold window is closed");
    expect(git("branch", "--list", "backup/*").trim()).toBe(""); // no mutation on refusals
  });

  it("refuses to combine with other lanes", () => {
    seedCommit("feat: first work", "a.txt");
    const r = runTool(["--reword", "HEAD~1", "--amend"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("mutually exclusive");
    const rNoRef = runTool(["--reword"]);
    expect(rNoRef.status).not.toBe(0);
    expect(rNoRef.out).toContain("requires a target ref");
  });
});
