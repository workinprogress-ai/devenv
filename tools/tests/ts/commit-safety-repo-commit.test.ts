// Safety regressions for repo-commit: the editor gate needs a terminal (an
// env-supplied no-op editor is no proof of a human), the reword lane uses the
// validated editor and survives longer todo abbreviations, the fix lane
// refuses merge ranges and surfaces rebase diagnostics, the fold window
// follows the repository's default branch, and `#`-leading body lines survive
// comment stripping. Real git in throwaway fixture repos; the pty comes from
// util-linux `script` via the shared harness.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRepoCommitHarness,
  harnessGit,
  harnessHeadCount,
  harnessHeadSubject,
  harnessRunTool,
  harnessSeedCommit,
  harnessStageFile,
  type Harness,
} from "./harness/repo-commit.ts";

let h: Harness;

beforeEach(() => {
  h = createRepoCommitHarness({ bareRemote: true, seed: { subject: "chore: base", file: "base.txt" } });
  harnessGit(h, "push", "-q", "origin", "master");
});
afterEach(() => h.dispose());

function script(name: string, body: string): string {
  const p = join(h.root, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}

describe("editor gate: a terminal on stdin and stdout is required", () => {
  const noopEditors = (): Record<string, string> => ({
    "python3 -c pass": "python3 -c pass",
    ls: "ls",
    "exit-0 script": script("exit0.sh", "#!/bin/sh\nexit 0\n"),
  });

  for (const label of ["python3 -c pass", "ls", "exit-0 script"]) {
    it(`normal lane refuses without a TTY even with GIT_EDITOR=${label}`, () => {
      harnessStageFile(h, "a.txt", "a\n");
      const before = harnessHeadCount(h);
      const r = harnessRunTool(h, ["feat: no human"], { envEditor: noopEditors()[label] ?? "", noTty: true });
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("without a terminal");
      expect(harnessHeadCount(h)).toBe(before);
      expect(harnessHeadSubject(h)).toBe("chore: base");
    });
  }

  it("amend lane refuses without a TTY and leaves HEAD alone", () => {
    harnessSeedCommit(h, "feat: unpushed", "u.txt");
    const head = harnessGit(h, "rev-parse", "HEAD").trim();
    const r = harnessRunTool(h, ["--amend"], { envEditor: "ls", noTty: true });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("without a terminal");
    expect(harnessGit(h, "rev-parse", "HEAD").trim()).toBe(head);
  });

  it("reword lane refuses without a TTY before creating a backup branch", () => {
    harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    const head = harnessGit(h, "rev-parse", "HEAD").trim();
    const r = harnessRunTool(h, ["--reword", "HEAD~1"], { envEditor: "ls", noTty: true });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("without a terminal");
    expect(harnessGit(h, "rev-parse", "HEAD").trim()).toBe(head);
    expect(harnessGit(h, "branch", "--list", "backup/*").trim()).toBe("");
  });

  it("amend --dry-run needs no terminal", () => {
    harnessSeedCommit(h, "feat: unpushed", "u.txt");
    const r = harnessRunTool(h, ["--amend", "--dry-run"], { noTty: true });
    expect(r.status).toBe(0);
  });
});

describe("reword lane", () => {
  function setSubjectEditor(subject: string): string {
    return script("subject-editor.sh", `#!/bin/sh\nprintf '${subject}\\n' > "$1"\n`);
  }

  it("passes the validated editor: an inherited no-op GIT_EDITOR cannot rewrite history without a save", () => {
    harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    harnessGit(h, "config", "core.editor", setSubjectEditor("feat: one REWORDED"));
    const r = harnessRunTool(h, ["--reword", "HEAD~1"], { envEditor: ":" });
    expect(r.status).toBe(0);
    expect(harnessGit(h, "log", "--format=%s", "-2")).toContain("feat: one REWORDED");
  });

  it("matches the todo entry when git abbreviates the sha longer than 7", () => {
    harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    harnessGit(h, "config", "core.abbrev", "12");
    const r = harnessRunTool(h, ["--reword", "HEAD~1"], { envEditor: setSubjectEditor("feat: one LONGSHA") });
    expect(r.status).toBe(0);
    expect(harnessGit(h, "log", "--format=%s", "-2")).toContain("feat: one LONGSHA");
  });

  it("matches the todo entry under rebase.abbreviateCommands (single-letter pick)", () => {
    harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    harnessGit(h, "config", "rebase.abbreviateCommands", "true");
    const r = harnessRunTool(h, ["--reword", "HEAD~1"], { envEditor: setSubjectEditor("feat: one ABBREV") });
    expect(r.status).toBe(0);
    expect(harnessGit(h, "log", "--format=%s", "-2")).toContain("feat: one ABBREV");
  });
});

describe("fix lane", () => {
  it("refuses a range that contains a merge commit, before any mutation", () => {
    const c1 = harnessSeedCommit(h, "feat: c1", "c1.txt");
    harnessGit(h, "checkout", "-q", "-b", "side");
    harnessSeedCommit(h, "feat: side", "side.txt");
    harnessGit(h, "checkout", "-q", "master");
    harnessSeedCommit(h, "feat: c2", "c2.txt");
    harnessGit(h, "merge", "-q", "--no-ff", "-m", "merge side", "side");
    harnessStageFile(h, "c1.txt", "c1\nlate\n");
    const head = harnessGit(h, "rev-parse", "HEAD").trim();
    const r = harnessRunTool(h, ["--fix", c1], { noTty: true });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("merge commit");
    expect(harnessGit(h, "rev-parse", "HEAD").trim()).toBe(head);
    expect(harnessGit(h, "branch", "--list", "backup/*").trim()).toBe("");
  });

  it("prints the rebase diagnostics when the fold conflicts", () => {
    harnessSeedCommit(h, "feat: base", "conflict.txt");
    writeFileSync(join(h.repo, "conflict.txt"), "from-second\n");
    harnessGit(h, "commit", "-aq", "--no-verify", "-m", "feat: second");
    const second = harnessGit(h, "rev-parse", "HEAD").trim();
    writeFileSync(join(h.repo, "conflict.txt"), "from-third\n");
    harnessGit(h, "commit", "-aq", "--no-verify", "-m", "feat: third");
    harnessStageFile(h, "conflict.txt", "staged-for-fixup\n");
    const r = harnessRunTool(h, ["--fix", second], { noTty: true });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("CONFLICT (content)");
    expect(r.out).toContain("rebase aborted");
  });
});

describe("rebase.updateRefs=true must not move the backup branch", () => {
  it("fix lane: the backup branch still names the pre-fold HEAD", () => {
    harnessGit(h, "config", "rebase.updateRefs", "true");
    const c1 = harnessSeedCommit(h, "feat: c1", "c1.txt");
    harnessSeedCommit(h, "feat: c2", "c2.txt");
    const oldHead = harnessGit(h, "rev-parse", "HEAD").trim();
    harnessStageFile(h, "c1.txt", "c1\nlate\n");
    const r = harnessRunTool(h, ["--fix", c1], { noTty: true });
    expect(r.status).toBe(0);
    const backup = harnessGit(h, "branch", "--list", "backup/pre-fixup-*", "--format=%(refname:short)").trim();
    expect(harnessGit(h, "rev-parse", backup).trim()).toBe(oldHead);
    expect(harnessGit(h, "rev-parse", "HEAD").trim()).not.toBe(oldHead);
  });

  it("reword lane: the backup branch still names the pre-reword HEAD and the verification can fail", () => {
    harnessGit(h, "config", "rebase.updateRefs", "true");
    harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    const oldHead = harnessGit(h, "rev-parse", "HEAD").trim();
    const editor = script("subject-editor.sh", "#!/bin/sh\nprintf 'feat: one UPDATEREFS\\n' > \"$1\"\n");
    const r = harnessRunTool(h, ["--reword", "HEAD~1"], { envEditor: editor });
    expect(r.status).toBe(0);
    const backup = harnessGit(h, "branch", "--list", "backup/pre-reword-*", "--format=%(refname:short)").trim();
    expect(harnessGit(h, "rev-parse", backup).trim()).toBe(oldHead);
  });

  it("reword lane: an unchanged message is a clean no-op under updateRefs=true", () => {
    harnessGit(h, "config", "rebase.updateRefs", "true");
    harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    const oldHead = harnessGit(h, "rev-parse", "HEAD").trim();
    const r = harnessRunTool(h, ["--reword", "HEAD~1"], { envEditor: script("keep.sh", "#!/bin/sh\nexit 0\n") });
    expect(r.status).toBe(0);
    expect(r.out).toContain("message was left unchanged");
    expect(harnessGit(h, "rev-parse", "HEAD").trim()).toBe(oldHead);
    expect(harnessGit(h, "branch", "--list", "backup/*").trim()).toBe("");
  });
});

describe("reword lane: merges and bodies", () => {
  it("refuses a range that contains a merge commit, before any mutation", () => {
    const c1 = harnessSeedCommit(h, "feat: c1", "c1.txt");
    harnessGit(h, "checkout", "-q", "-b", "side");
    harnessSeedCommit(h, "feat: side", "side.txt");
    harnessGit(h, "checkout", "-q", "master");
    harnessSeedCommit(h, "feat: c2", "c2.txt");
    harnessGit(h, "merge", "-q", "--no-ff", "-m", "merge side", "side");
    const head = harnessGit(h, "rev-parse", "HEAD").trim();
    const r = harnessRunTool(h, ["--reword", c1], { envEditor: script("keep2.sh", "#!/bin/sh\nexit 0\n") });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("merge commit");
    expect(harnessGit(h, "rev-parse", "HEAD").trim()).toBe(head);
    expect(harnessGit(h, "branch", "--list", "backup/*").trim()).toBe("");
  });

  it("a body-only reword passes verification", () => {
    harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    const editor = script("body-editor.sh", "#!/bin/sh\nprintf 'feat: one\\n\\nnew body line\\n' > \"$1\"\n");
    const r = harnessRunTool(h, ["--reword", "HEAD~1"], { envEditor: editor });
    expect(r.status).toBe(0);
    expect(harnessGit(h, "log", "--format=%B", "-2")).toContain("new body line");
  });
});

describe("fold window follows the default branch", () => {
  it("refuses to amend a HEAD already on origin/main in a main-branch repo", () => {
    h.dispose();
    h = createRepoCommitHarness({ bareRemote: true, branch: "main", seed: { subject: "chore: base", file: "base.txt" } });
    harnessGit(h, "push", "-q", "origin", "main");
    const r = harnessRunTool(h, ["--amend", "--dry-run"], { noTty: true });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("fold window is closed");
  });

  it("honours origin/HEAD when it names a non-conventional default branch", () => {
    h.dispose();
    h = createRepoCommitHarness({ bareRemote: true, branch: "trunk", seed: { subject: "chore: base", file: "base.txt" } });
    harnessGit(h, "push", "-q", "origin", "trunk");
    harnessGit(h, "remote", "set-head", "origin", "trunk");
    const r = harnessRunTool(h, ["--amend", "--dry-run"], { noTty: true });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("fold window is closed");
  });
});

describe("comment stripping keeps #-leading body lines", () => {
  it("commits a body line that starts with #", () => {
    harnessStageFile(h, "a.txt", "a\n");
    const r = harnessRunTool(h, ["feat: refs an issue\n\n#42 fixes the thing\n\nbody text"]);
    expect(r.status).toBe(0);
    const body = harnessGit(h, "log", "-1", "--format=%B");
    expect(body).toContain("#42 fixes the thing");
    expect(body).not.toContain("NEW commit on top of");
  });

  it("keeps the same line in an amend", () => {
    harnessSeedCommit(h, "feat: unpushed", "u.txt");
    harnessGit(h, "commit", "-q", "--amend", "--no-verify", "-m", "feat: unpushed\n\n#7 stays");
    const r = harnessRunTool(h, ["--amend"]);
    expect(r.status).toBe(0);
    expect(harnessGit(h, "log", "-1", "--format=%B")).toContain("#7 stays");
  });
});
