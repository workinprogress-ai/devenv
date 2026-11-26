// attribution-check: rejects AI attribution in commit messages. Message-file
// mode serves the local commit-msg hook; commit-range mode serves CI, so a clone
// without hooks cannot land attributed commits. Both use the shared matcher in
// tools/lib/core/attribution-patterns.ts.
// Fixture hygiene per tools/tests/README.md: all scratch paths live under
// os.tmpdir().
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const AC = join(ROOT, "tools", "internal", "attribution-check");

const TRAILER = "Co-Authored-By: Claude <noreply@anthropic.com>";
const FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";

let TMP = "";
let REPO = "";
let BASE = "";

const GIT_ENV = (): Record<string, string> => ({
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
});

function git(args: string[], cwd = REPO): { status: number; stdout: string; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function run(args: string[], opts: { cwd?: string } = {}): { status: number; out: string } {
  const r = spawnSync(AC, args, { cwd: opts.cwd, encoding: "utf8", env: GIT_ENV() });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function messageFile(text: string, name = "msg"): string {
  const p = join(TMP, name);
  writeFileSync(p, text);
  return p;
}

function commit(message: string): void {
  writeFileSync(join(REPO, "f.txt"), `${message}\n${Math.random()}`);
  git(["add", "-A"]);
  const r = git(["commit", "-q", "--no-verify", "-m", message]);
  if (r.status !== 0) throw new Error(r.out);
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), "attribution-check-"));
  REPO = join(TMP, "repo");
  git(["init", "-q", REPO], TMP);
  writeFileSync(join(REPO, "seed.txt"), "seed\n");
  git(["add", "-A"]);
  git(["commit", "-q", "--no-verify", "-m", "seed"]);
  BASE = git(["rev-parse", "HEAD"]).stdout.trim();
});

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("attribution-check", () => {
  it("shim is executable, shows usage and a version, and needs arguments", () => {
    expect(spawnSync("bash", ["-c", `test -x '${AC}'`]).status).toBe(0);
    const h = run(["--help"]);
    expect(h.status).toBe(0);
    expect(h.out).toContain("Usage:");
    const v = run(["--version"]);
    expect(v.status).toBe(0);
    expect(v.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(run([]).status).toBe(2);
  });

  describe("--message-file (the commit-msg hook)", () => {
    it("passes a clean message", () => {
      expect(run(["--message-file", messageFile("patch: a change\n\nBody.\n\nDevenv-Action: nothing\n")]).status).toBe(0);
    });

    it("rejects a trailer, naming the line and telling the author what to do", () => {
      const r = run(["--message-file", messageFile(`patch: a change\n\nBody.\n\n${TRAILER}\n`)]);
      expect(r.status).toBe(1);
      expect(r.out).toContain("AI attribution is not allowed in a commit message");
      expect(r.out).toContain(`line 5: ${TRAILER}`);
      expect(r.out).toMatch(/Remove these lines/);
    });

    it("rejects a footer", () => {
      const r = run(["--message-file", messageFile(`patch: a change\n\n${FOOTER}\n`)]);
      expect(r.status).toBe(1);
      expect(r.out).toContain("line 3:");
    });

    it("has no WIP exemption: attribution is rejected in every commit", () => {
      expect(run(["--message-file", messageFile(`WIP: scratch\n\n${TRAILER}\n`)]).status).toBe(1);
    });

    it("passes a message that discusses attribution, including a quoted example", () => {
      const text = ["patch: discuss", "", "Rejects Co-Authored-By trailers naming an AI identity:", "", "```text", TRAILER, "```", ""].join("\n");
      expect(run(["--message-file", messageFile(text)]).status).toBe(0);
    });

    it("ignores comment lines and everything after a scissors line, as git does", () => {
      const text = [
        "patch: a change",
        "",
        `# ${FOOTER}`,
        "# Please enter the commit message.",
        "# ------------------------ >8 ------------------------",
        TRAILER,
        "diff --git a/x b/x",
        "",
      ].join("\n");
      expect(run(["--message-file", messageFile(text)], { cwd: REPO }).status).toBe(0);
    });

    it("honors a custom core.commentChar", () => {
      git(["config", "core.commentChar", ";"]);
      expect(run(["--message-file", messageFile(`patch: a change\n\n; ${FOOTER}\n`)], { cwd: REPO }).status).toBe(0);
      expect(run(["--message-file", messageFile(`patch: a change\n\n${FOOTER}\n`)], { cwd: REPO }).status).toBe(1);
    });

    it("treats a missing file as a usage error", () => {
      expect(run(["--message-file", join(TMP, "absent")]).status).toBe(2);
    });
  });

  describe("BASE HEAD (CI)", () => {
    it("passes when no commit in the range carries attribution", () => {
      commit("feat: one");
      commit("fix: two\n\nCo-authored-by: Claudia Smith <claudia@example.com>");
      expect(run([BASE, "HEAD"], { cwd: REPO }).status).toBe(0);
    });

    it("fails on an attributed commit, naming it and the offending line, and checks every commit", () => {
      commit("feat: ok");
      commit(`fix: attributed\n\n${TRAILER}`);
      commit(`chore: also attributed\n\n${FOOTER}`);
      const r = run([BASE, "HEAD"], { cwd: REPO });
      expect(r.status).toBe(1);
      expect(r.out).toContain("fix: attributed");
      expect(r.out).toContain("chore: also attributed");
      expect(r.out).not.toContain("feat: ok");
      expect(r.out).toContain(TRAILER);
      expect(r.out).toMatch(/2 commit\(s\) carry AI attribution/);
    });

    it("rejects an unknown revision as a usage error", () => {
      expect(run([BASE, "no-such-rev"], { cwd: REPO }).status).toBe(2);
    });

    it("rejects the wrong number of positionals", () => {
      expect(run([BASE], { cwd: REPO }).status).toBe(2);
    });
  });

  describe("wired into git and CI", () => {
    it("a commit-msg hook that calls it refuses an attributed commit and creates no commit", () => {
      const hook = join(REPO, ".git", "hooks", "commit-msg");
      writeFileSync(hook, `#!/bin/sh\nexec '${AC}' --message-file "$1"\n`);
      chmodSync(hook, 0o755);
      writeFileSync(join(REPO, "g.txt"), "g\n");
      git(["add", "-A"]);
      const before = git(["rev-parse", "HEAD"]).stdout;
      const bad = git(["commit", "-q", "-m", `feat: x\n\n${TRAILER}`]);
      expect(bad.status).not.toBe(0);
      expect(bad.out).toContain("AI attribution is not allowed");
      expect(git(["rev-parse", "HEAD"]).stdout).toBe(before);
      const good = git(["commit", "-q", "-m", "feat: x"]);
      expect(good.status).toBe(0);
    });

    it("the husky commit-msg hook calls it, and keeps the identity list out of the hook", () => {
      const hook = readFileSync(join(ROOT, ".husky", "commit-msg"), "utf8");
      expect(hook).toContain("attribution-check");
      expect(hook).not.toMatch(/anthropic|copilot|claude/i);
    });
  });
});
