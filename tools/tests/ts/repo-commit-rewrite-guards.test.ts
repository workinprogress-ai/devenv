// repo-commit --fix / --reword guards: pending autosquash subjects in the
// rewritten range, the remote-tracking status line, and an unchanged-message
// reword being a clean no-op. Real git in throwaway fixture repos (local bare
// remote), scripted editors through the shared harness.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRepoCommitHarness,
  harnessGit,
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

const subjectEditor = (): string => script("subject.sh", "#!/bin/sh\nprintf 'feat: one REWORDED\\n' > \"$1\"\n");
const keepEditor = (): string => script("keep.sh", "#!/bin/sh\nexit 0\n");
const backups = (): string => harnessGit(h, "branch", "--list", "backup/*", "--format=%(refname:short)").trim();

describe("reword lane with pending autosquash subjects", () => {
  for (const prefix of ["fixup!", "squash!", "amend!"]) {
    it(`refuses a range holding a '${prefix}' commit even when rebase.autoSquash=true, mutating nothing`, () => {
      harnessGit(h, "config", "rebase.autoSquash", "true");
      const one = harnessSeedCommit(h, "feat: one", "one.txt");
      harnessSeedCommit(h, "feat: two", "two.txt");
      harnessSeedCommit(h, `${prefix} feat: one`, "three.txt");
      const head = harnessGit(h, "rev-parse", "HEAD").trim();
      const r = harnessRunTool(h, ["--reword", one], { envEditor: subjectEditor() });
      expect(r.status).not.toBe(0);
      expect(r.out).toContain(prefix);
      expect(harnessGit(h, "rev-parse", "HEAD").trim()).toBe(head);
      expect(backups()).toBe("");
    });
  }
});

describe("fix lane with other pending autosquash commits", () => {
  it("refuses when the range already holds another fixup! commit, mutating nothing", () => {
    harnessGit(h, "config", "rebase.autoSquash", "true");
    const one = harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    harnessSeedCommit(h, "fixup! feat: two", "two-fix.txt");
    harnessStageFile(h, "one.txt", "changed\n");
    const head = harnessGit(h, "rev-parse", "HEAD").trim();
    const r = harnessRunTool(h, ["--fix", one], { noTty: true });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("fixup!");
    expect(harnessGit(h, "rev-parse", "HEAD").trim()).toBe(head);
    expect(backups()).toBe("");
  });

  it("still folds when the range holds no pending autosquash commits, under rebase.autoSquash=true", () => {
    harnessGit(h, "config", "rebase.autoSquash", "true");
    const one = harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    harnessStageFile(h, "one.txt", "changed\n");
    const r = harnessRunTool(h, ["--fix", one], { noTty: true });
    expect(r.status).toBe(0);
    expect(harnessGit(h, "log", "--format=%s", "-3")).not.toContain("fixup!");
  });
});

describe("post-rewrite remote status line", () => {
  it("unpushed commits on a tracking branch are ahead, not diverged", () => {
    const one = harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    const r = harnessRunTool(h, ["--reword", one], { envEditor: subjectEditor() });
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("diverged");
    expect(r.out).toMatch(/ahead of its remote/);
  });

  it("a rewritten pushed branch is diverged and says to force-with-lease", () => {
    harnessGit(h, "checkout", "-q", "-b", "feat");
    const one = harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    harnessGit(h, "push", "-q", "-u", "origin", "feat");
    const r = harnessRunTool(h, ["--reword", one], { envEditor: subjectEditor() });
    expect(r.status).toBe(0);
    expect(r.out).toContain("diverged");
    expect(r.out).toContain("--force-with-lease");
  });

  it("a branch with no upstream reports no remote tracking", () => {
    harnessGit(h, "checkout", "-q", "-b", "local-only");
    const one = harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    const r = harnessRunTool(h, ["--reword", one], { envEditor: subjectEditor() });
    expect(r.status).toBe(0);
    expect(r.out).toContain("no remote tracking");
    expect(r.out).not.toContain("diverged");
  });
});

describe("reword with an unchanged message", () => {
  it("is a clean no-op: exit 0, plain message, HEAD and branches untouched", () => {
    const one = harnessSeedCommit(h, "feat: one", "one.txt");
    harnessSeedCommit(h, "feat: two", "two.txt");
    const head = harnessGit(h, "rev-parse", "HEAD").trim();
    const r = harnessRunTool(h, ["--reword", one], { envEditor: keepEditor() });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/unchanged/i);
    expect(r.out).not.toMatch(/recovery|verification failed|reset --hard/);
    expect(harnessGit(h, "rev-parse", "HEAD").trim()).toBe(head);
    expect(backups()).toBe("");
    expect(harnessGit(h, "status", "--porcelain").trim()).toBe("");
  });
});
