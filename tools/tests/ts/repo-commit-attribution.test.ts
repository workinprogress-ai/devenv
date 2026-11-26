// repo-commit rejects AI attribution in the suggested message before git or the
// editor runs, without touching the caller's message file, and keeps a message
// the human typed when a commit-msg hook rejects it after the editor closes.
// Driven through the shared fixture harness: a private copy of the tool in a
// real temp git repo with a scripted GIT_EDITOR.
import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { createRepoCommitHarness, harnessSetEditorMode, runRepoCommitTty, type Harness } from "./harness/repo-commit.ts";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let h: Harness;

function git(...args: string[]): string {
  const r = spawnSync("git", ["-C", h.repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function stageFile(name: string, content: string): void {
  writeFileSync(join(h.repo, name), content);
  git("add", "--", name);
}

function runTool(args: string[]): { status: number; out: string } {
  return runRepoCommitTty(args, { cwd: h.repo, env: { GIT_EDITOR: h.editorScript } });
}

const head = (): string => git("rev-parse", "HEAD").trim();
const staged = (): string => git("diff", "--cached", "--name-only").trim();

const CLAUDE_TRAILER = "Co-Authored-By: Claude <noreply@anthropic.com>";
const CLAUDE_FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
const message = (...lines: string[]): string => ["patch: a change", "", "Explains the change.", "", ...lines].join("\n");

beforeAll(() => {
  h = createRepoCommitHarness({ seed: { subject: "seed: initial", file: "seed.txt" } });
  harnessSetEditorMode(h, "save");
});

afterAll(() => h.dispose());

afterEach(() => {
  rmSync(join(h.repo, ".git", "hooks", "commit-msg"), { force: true });
  // Leave the index empty for the next test.
  spawnSync("git", ["-C", h.repo, "reset", "-q"], { encoding: "utf8" });
  harnessSetEditorMode(h, "save");
});

describe("repo-commit attribution gate (suggested message)", () => {
  it("rejects a Co-Authored-By trailer before git or the editor runs, leaving the index and HEAD alone", () => {
    stageFile("a.txt", "one\n");
    const before = head();
    const r = runTool([message(CLAUDE_TRAILER)]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("AI attribution is not allowed in a commit message");
    expect(r.out).toContain(`line 5: ${CLAUDE_TRAILER}`);
    expect(r.out).toMatch(/Remove these lines/);
    expect(r.out).not.toContain("opening editor");
    expect(head()).toBe(before);
    expect(staged()).toBe("a.txt");
  });

  it("rejects a generated-with footer and reports every offending line", () => {
    stageFile("b.txt", "two\n");
    const r = runTool([message(CLAUDE_FOOTER, "", CLAUDE_TRAILER)]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`line 5: ${CLAUDE_FOOTER}`);
    expect(r.out).toContain(`line 7: ${CLAUDE_TRAILER}`);
    expect(r.out).not.toContain("opening editor");
  });

  it("rejects through --file and leaves the caller's message file byte-for-byte untouched", () => {
    stageFile("c.txt", "three\n");
    const file = join(h.root, "suggested-message.txt");
    const body = `${message(CLAUDE_TRAILER)}\n`;
    writeFileSync(file, body);
    const r = runTool(["--file", file]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("AI attribution is not allowed");
    expect(readFileSync(file, "utf8")).toBe(body);
    expect(staged()).toBe("c.txt");
  });

  it("applies with no commitlint setup in the repository", () => {
    stageFile("d.txt", "four\n");
    const r = runTool([message(CLAUDE_TRAILER)]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("AI attribution is not allowed");
  });

  it("passes a message that discusses attribution, including a quoted example, and commits it", () => {
    stageFile("e.txt", "five\n");
    const text = [
      "patch: discuss attribution",
      "",
      "Rejects Co-Authored-By trailers that name an AI identity. Example of a rejected line:",
      "",
      "```text",
      CLAUDE_TRAILER,
      "```",
    ].join("\n");
    const r = runTool([text]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("commit created");
    expect(git("log", "-1", "--format=%B")).toContain(CLAUDE_TRAILER);
  });

  it("passes a human co-author", () => {
    stageFile("f.txt", "six\n");
    const r = runTool([message("Co-authored-by: Claudia Smith <claudia@example.com>")]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("commit created");
  });
});

describe("repo-commit keeps a typed message when a commit-msg hook rejects it", () => {
  function installRejectingHook(): void {
    mkdirSync(join(h.repo, ".git", "hooks"), { recursive: true });
    const hook = join(h.repo, ".git", "hooks", "commit-msg");
    writeFileSync(hook, '#!/bin/sh\necho "hook: rejected for the test" >&2\nexit 1\n');
    chmodSync(hook, 0o755);
  }

  it("names the file that still holds the edited message, and that file contains the typed text", () => {
    installRejectingHook();
    writeFileSync(h.editorScript, `#!/bin/sh\nprintf '\\nTYPED-BY-THE-USER line\\n' >> "$1"\nexit 0\n`);
    chmodSync(h.editorScript, 0o755);
    stageFile("g.txt", "seven\n");
    const before = head();

    const r = runTool(["patch: ordinary message"]);

    expect(r.status).not.toBe(0);
    expect(r.out).toContain("after the editor closed");
    const kept = /git kept the text you saved at (\S+)/.exec(r.out)?.[1];
    expect(r.out).toContain("if a commit-msg hook rejected it");
    expect(kept, r.out).toBeDefined();
    expect(existsSync(kept as string)).toBe(true);
    expect(readFileSync(kept as string, "utf8")).toContain("TYPED-BY-THE-USER line");
    expect(head()).toBe(before);
    expect(staged()).toBe("g.txt");
  });

  it("does not claim a kept message when the failure came before the editor opened", () => {
    stageFile("h.txt", "eight\n");
    mkdirSync(join(h.repo, ".git", "hooks"), { recursive: true });
    const hook = join(h.repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    try {
      const r = runTool(["patch: ordinary message"]);
      expect(r.status).not.toBe(0);
      expect(r.out).not.toContain("git kept the text you saved");
    } finally {
      rmSync(hook, { force: true });
    }
  });
});
