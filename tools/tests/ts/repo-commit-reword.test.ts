// Tests for repo-commit --reword: change an earlier commit's message only
// (editor gate on the new message), with --fix's safety spine (preflight ->
// backup -> reword -> verify -> report). Fixture shape mirrors the amend/fix
// suites: copied tool fixture in a real temp git repo with a local bare
// remote, scripted GIT_EDITOR, real rebase mechanics.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { chmodSync, writeFileSync } from "node:fs";
import {
  createRepoCommitHarness,
  harnessGit,
  harnessRunTool,
  harnessSeedCommit,
  harnessSetEditorMode,
  harnessStageFile,
  type Harness,
} from "./harness/repo-commit.ts";




let h: Harness;


// Local aliases over the shared harness: the test bodies read against the
// historical helper names.
const git = (...args: string[]) => harnessGit(h, ...args);
const stageFile = (name: string, content: string) => harnessStageFile(h, name, content);
const seedCommit = (msg: string, file: string) => harnessSeedCommit(h, msg, file);
/** Scripted message editor for reword: save a new subject, save the SAME
 * subject (no-op reword), or empty (cancel). */
const setMessageEditorMode = (mode: "save" | "same" | "empty", newSubject = "feat: first work REWORDED"): void => {
  const script =
    mode === "same"
      ? "#!/bin/sh\n" // "same": leave the file untouched (no-op reword)
      : `#!/bin/sh\n${mode === "empty" ? ': > "$1"' : `printf '${newSubject}\n' > "$1"`}\n`;
  writeFileSync(h.editorScript, script);
  chmodSync(h.editorScript, 0o755);
};
const runTool = (
  args: string[],
  opts: { envEditor?: string; barePath?: boolean; env?: Record<string, string> } = {},
) => harnessRunTool(h, args, opts);
beforeEach(() => {
  h = createRepoCommitHarness({ bareRemote: true, seed: { subject: "chore: base", file: "base.txt" } });
  harnessGit(h, "push", "-q", "origin", "master");
  harnessSetEditorMode(h, "save");
});

afterEach(() => h.dispose());

describe("repo-commit --reword", () => {
  it("rewords an earlier commit's message and leaves the tree untouched", () => {
    seedCommit("feat: first work", "a.txt");
    seedCommit("feat: second work", "b.txt");
    setMessageEditorMode("save");
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
    expect(r.out).toContain(`git reset --keep ${backup}`);
    expect(r.out).not.toContain("reset --hard");
  });

  it("a cancelled reword prints --keep recovery advice, never --hard", () => {
    seedCommit("feat: first work", "a.txt");
    seedCommit("feat: second work", "b.txt");
    setMessageEditorMode("empty");
    const r = runTool(["--reword", "HEAD~1"]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("git reset --keep backup/pre-reword-");
    expect(r.out).not.toContain("reset --hard");
  });

  it("does not require staged content (a reword changes messages only)", () => {
    seedCommit("feat: first work", "a.txt");
    seedCommit("feat: second work", "b.txt");
    setMessageEditorMode("save");
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
    // HEAD on a CLEAN index is a valid reword target (message-only); HEAD
    // with STAGED content refuses — folding it needs --amend.
    setMessageEditorMode("save", "feat: first work HEAD-REWORDED");
    const rHead = runTool(["--reword", "HEAD"]);
    expect(rHead.status).toBe(0);
    expect(rHead.out).toContain("feat: first work HEAD-REWORDED");
    // HEAD with staged content
    stageFile("staged.txt", "s\n");
    const rHeadStaged = runTool(["--reword", "HEAD"]);
    expect(rHeadStaged.status).not.toBe(0);
    expect(rHeadStaged.out).toContain("folding staged content needs --amend");
    git("restore", "--staged", "staged.txt");
    // Root commit (the fixture's very first commit)
    const rootSha = git("rev-list", "--max-parents=0", "HEAD").trim();
    const rRoot = runTool(["--reword", rootSha]);
    expect(rRoot.status).not.toBe(0);
    expect(rRoot.out).toContain("root commit");
    // Landed: push a mid-stack commit to master, then try to reword it.
    const mid = seedCommit("feat: pushed work", "p.txt");
    git("push", "-q", "origin", "master");
    seedCommit("feat: tip work", "t.txt");
    const backupsBefore = git("branch", "--format=%(refname:short)", "--list", "backup/*");
    const rLanded = runTool(["--reword", mid]);
    expect(rLanded.status).not.toBe(0);
    expect(rLanded.out).toContain("fold window is closed");
    // No NEW backup: the refusals above must not mutate anything.
    expect(git("branch", "--format=%(refname:short)", "--list", "backup/*")).toBe(backupsBefore);
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
