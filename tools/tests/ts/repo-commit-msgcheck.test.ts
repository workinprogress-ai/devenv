// Tests for repo-commit's commit-message enforcement (pre-git validation and
// 72-column body wrapping), driven through the same fixture shape as
// repo-commit-baseline.test.ts: a private copy of the tool in a real temp git
// repo with a scripted GIT_EDITOR. The commitlint gate is exercised through a
// scripted fake `.bin/commitlint` whose mode each test sets (pass / reject /
// absent), so no real commitlint or network is involved.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  createRepoCommitHarness,
  harnessSetEditorMode,
  type Harness,
} from "./harness/repo-commit.ts";
import { readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";


function git(...args: string[]): string {
  const r = spawnSync("git", ["-C", h.repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function stageFile(name: string, content: string): void {
  writeFileSync(join(h.repo, name), content);
  git("add", "--", name);
}

function setEditorMode(mode: "save" | "capture" | "empty" | "abort"): void {
  if (mode === "capture") {
    // Capture the message file the editor session receives — the wrap must be
    // observed there (that is exactly what the user sees in their editor).
    writeFileSync(h.editorScript, `#!/bin/sh\ncp "$1" "${join(h.root, "captured-message")}"\nexit 0\n`);
  } else {
    writeFileSync(h.editorScript, `#!/bin/sh\ncase "${mode}" in\n  save) exit 0 ;;\n  empty) : > "$1" ; exit 0 ;;\n  abort) exit 1 ;;\nesac\n`);
  }
  chmodSync(h.editorScript, 0o755);
}

/** Scriptable fake commitlint: `reject` mode exits 1 with a rule report, all
 * other modes exit 0. `absent` removes the fake entirely (the no-setup case). */
function setCommitlintMode(mode: "pass" | "reject" | "absent"): void {
  if (mode === "absent") {
    rmSync(h.commitlintBin!, { force: true });
    return;
  }
  const body = mode === "reject"
    ? `#!/bin/sh\necho "⧗   input\necho marker" >&2\necho "✖   header must not be longer than 100 characters, current length is 145 [header-max-length]"\nexit 1\n`
    : `#!/bin/sh\nexit 0\n`;
  writeFileSync(h.commitlintBin!, body);
  chmodSync(h.commitlintBin!, 0o755);
}

function runTool(args: string[]): { status: number; out: string } {
  const r = spawnSync("node", [h.tool, ...args], {
    encoding: "utf8",
    cwd: h.repo,
    env: { ...process.env, GIT_EDITOR: h.editorScript },
  });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

const LONG_HEADER = "patch: this subject line is deliberately made far too long so it exceeds the one hundred character ceiling and must be rejected by commitlint";

let h: Harness;


beforeAll(() => {
  h = createRepoCommitHarness({
    commitlint: true,
    seed: { subject: "seed: initial", file: "seed.txt" },
    extraToolStubs: [{ name: "git-wip", body: "#!/bin/sh\nexit 42\n" }],
  });
  harnessSetEditorMode(h, "save");
});

afterAll(() => h.dispose());

describe("repo-commit pre-git commitlint gate", () => {
  it("rejects an over-long header BEFORE any git/editor runs, naming the rule", () => {
    stageFile("a.txt", "one\n");
    setCommitlintMode("reject");
    const r = runTool([LONG_HEADER]);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("header-max-length");
    expect(r.out).toContain("pre-git validation");
    // The rejection must be the last word: no editor-open notice follows it.
    expect(r.out).not.toContain("opening editor");
  });

  it("leaves a valid message untouched on the pass path (full commit flow works)", () => {
    stageFile("b.txt", "two\n");
    setCommitlintMode("pass");
    setEditorMode("save");
    const r = runTool(["patch: valid short subject"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("commit created");
    expect(git("log", "-1", "--format=%s").trim()).toBe("patch: valid short subject");
  });

  it("skips validation entirely when the target repo has no commitlint setup", () => {
    stageFile("c.txt", "three\n");
    setCommitlintMode("absent");
    setEditorMode("save");
    const r = runTool([LONG_HEADER]);
    // 145-char header would fail config-conventional — but there is no
    // commitlint setup here, so the gate is a no-op and the commit proceeds.
    expect(r.status).toBe(0);
    expect(git("log", "-1", "--format=%s").trim()).toBe(LONG_HEADER);
  });
});

describe("repo-commit 72-column body wrap", () => {
  it("wraps the over-long suggested body at 72 with a hanging indent (argv message)", () => {
    stageFile("d.txt", "four\n");
    setEditorMode("capture");
    const longBullet = "- " + "word ".repeat(24);
    runTool([`patch: short subject\n\n${longBullet}`]);
    const captured = readFileSync(join(h.root, "captured-message"), "utf8");
    const wrapped = captured.split("\n").filter((l) => l !== "" && !l.startsWith("#"));
    // First physical line of every logical line ≤ 72; continuation lines indented.
    for (const line of wrapped) {
      if (line.startsWith("  ")) continue;
      expect(line.length).toBeLessThanOrEqual(72);
    }
    expect(wrapped.some((l) => l.startsWith("  "))).toBe(true);
  });

  it("never wraps the header even when it is long — it dies at commitlint instead", () => {
    stageFile("e.txt", "five\n");
    setCommitlintMode("pass"); // fake says fine — watch the wrap behave
    setEditorMode("capture");
    runTool([LONG_HEADER]);
    const captured = readFileSync(join(h.root, "captured-message"), "utf8");
    const bodyStart = captured.indexOf(LONG_HEADER);
    expect(bodyStart).toBeGreaterThanOrEqual(0); // message present, banner precedes it
    expect(captured.slice(bodyStart).split("\n")[0]).toBe(LONG_HEADER); // verbatim, unfolded
  });

  it("does NOT rewrite --file content (validated only), still commits it", () => {
    stageFile("f.txt", "six\n");
    const fileMsg = join(h.root, "user-message.txt");
    const longBullet = "- " + "word ".repeat(24);
    writeFileSync(fileMsg, `patch: user authored\n\n${longBullet}\n`);
    setEditorMode("capture");
    const r = runTool(["--file", fileMsg]);
    expect(r.status).toBe(0);
    const captured = readFileSync(join(h.root, "captured-message"), "utf8");
    expect(captured).toContain(longBullet.trim()); // the long line survived intact
  });
});

describe("repo-commit WIP and fix lanes stay out of the gate", () => {
  it("--fix on a non-TTY refuses (picker requires TTY); the gate never engages", () => {
    stageFile("g.txt", "seven\n");
    setCommitlintMode("reject"); // would reject anything — proves the lane is untouched
    const r = runTool(["--fix"]);
    // Non-interactive context: the eligible-target picker cannot open, so the
    // lane refuses BEFORE any message handling — gate involvement impossible.
    expect(r.status).not.toBe(0);
    expect(r.out).not.toContain("pre-git validation");
  });
});
