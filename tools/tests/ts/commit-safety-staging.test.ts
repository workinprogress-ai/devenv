// Safety regressions for repo-stage and the hunk engine: user diff
// configuration must not change what the engine parses or applies, the staged
// result is verified by content hash, path mode judges success on the index
// entry (not the staged diff), and group staging validates before it mutates
// and reports precisely what it staged when a late failure still happens.
// Real git in throwaway fixture repos; failures are injected with a PATH shim.
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rmrf, runTool, tmpDir } from "./harness/index.ts";
import {
  applyHunks,
  enumerateFile,
  stageSelection,
  type ExecResult,
  type GitExec,
} from "../../lib/domain/hunk-stage.ts";

let root = "";
let repo = "";

function sh(cmd: string): { status: number; out: string } {
  const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8", cwd: repo });
  return { status: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

const realExec: GitExec = (args, input) => {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", input });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

function manifest(text: string): string {
  const p = join(root, "manifest.md");
  writeFileSync(p, text);
  return p;
}

/** Shim `git` that fails invocations ending with / containing the fragment. */
function failingGit(pattern: string): string {
  const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const bin = join(root, "shim-bin");
  mkdirSync(bin, { recursive: true });
  const p = join(bin, "git");
  writeFileSync(p, `#!/bin/sh\ncase "$*" in\n  ${pattern}) exit 1 ;;\nesac\nexec ${real} "$@"\n`);
  chmodSync(p, 0o755);
  return `${bin}:${process.env["PATH"] ?? ""}`;
}

const base60 = (): string => `${Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join("\n")}\n`;

/** f.txt with two well-separated changes (two hunks). */
function twoHunkFile(): void {
  writeFileSync(join(repo, "f.txt"), base60());
  sh("git add f.txt && git commit -qm init");
  const lines = base60().split("\n");
  lines[3] = "line4-CHANGED";
  lines[39] = "line40-CHANGED";
  writeFileSync(join(repo, "f.txt"), lines.join("\n"));
}

const TWO_GROUPS = `# Commit batch: split

## group 1 — feat: first
- f.txt @ 1

## group 2 — fix: second
- f.txt @ 2
`;

beforeEach(() => {
  root = tmpDir("commit-safety-staging");
  repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  sh("git init -q -b main . && git config user.email t@t && git config user.name t");
});
afterEach(() => rmrf(root));

describe("user diff configuration does not reach the engine", () => {
  const configs: Array<[string, string]> = [
    ["diff.noprefix", "git config diff.noprefix true"],
    ["diff.mnemonicPrefix", "git config diff.mnemonicPrefix true"],
    ["diff.external", `printf '#!/bin/sh\\necho EXTERNAL-DIFF-OUTPUT\\n' > ${"$PWD/../ext.sh"} && chmod +x ../ext.sh && git config diff.external $PWD/../ext.sh`],
    ["diff.context=0", "git config diff.context 0"],
    ["diff.interHunkContext", "git config diff.interHunkContext 50"],
  ];
  for (const [label, setup] of configs) {
    it(`stages group 1 correctly with ${label} set`, () => {
      twoHunkFile();
      expect(sh(setup).status).toBe(0);
      const r = runTool("repo-stage", ["--batch", manifest(TWO_GROUPS), "--group", "1"], { cwd: repo });
      expect(r.status, r.output).toBe(0);
      const staged = sh("git -c diff.external= diff --no-ext-diff --cached -- f.txt").out;
      expect(staged).toContain("line4-CHANGED");
      expect(staged).not.toContain("line40-CHANGED");
    });
  }

  it("numbers hunks as -U3 does even when diff.context would split them", () => {
    writeFileSync(join(repo, "f.txt"), base60());
    sh("git add f.txt && git commit -qm init");
    const lines = base60().split("\n");
    lines[3] = "line4-CHANGED";
    lines[7] = "line8-CHANGED"; // 3 unchanged lines apart: one hunk under -U3, two under -U1
    writeFileSync(join(repo, "f.txt"), lines.join("\n"));
    sh("git config diff.context 1");
    const one = `# Commit batch: all\n\n## group 1 — feat: all\n- f.txt @ 1\n`;
    const r = runTool("repo-stage", ["--batch", manifest(one), "--group", "1"], { cwd: repo });
    expect(r.status, r.output).toBe(0);
    expect(sh("git diff --quiet").status).toBe(0); // everything staged
  });
});

describe("hash verification", () => {
  it("applyHunks reproduces what git apply stages, including no-newline-at-EOF", () => {
    writeFileSync(join(repo, "e.txt"), "a\nb\nc");
    sh("git add e.txt && git commit -qm init");
    writeFileSync(join(repo, "e.txt"), "a\nB\nc\nd");
    const before = sh("git show :e.txt").out;
    const e = enumerateFile(realExec, "e.txt");
    if ("message" in e) throw new Error(e.message);
    const expected = applyHunks(before, e.hunks);
    expect(expected).toBe("a\nB\nc\nd");
    const r = stageSelection(realExec, "e.txt", [1]);
    expect("message" in r).toBe(false);
    expect(sh("git show :e.txt").out).toBe(expected);
  });

  it("refuses when git apply stages something other than the selected hunks", () => {
    twoHunkFile();
    const tamper: GitExec = (args, input): ExecResult => {
      const mutating = args[0] === "apply" && !args.includes("--check");
      return realExec(args, mutating && input !== undefined ? input.replace("+line4-CHANGED", "+line4-TAMPERED") : input);
    };
    const r = stageSelection(tamper, "f.txt", [1]);
    expect("message" in r && r.kind).toBe("verify");
  });
});

describe("path mode judges success on the index entry", () => {
  it("accepts a tracked file identical to HEAD (no false 'DIFFERENT repository' refusal)", () => {
    writeFileSync(join(repo, "same.txt"), "same\n");
    sh("git add same.txt && git commit -qm init");
    const r = runTool("repo-stage", ["same.txt"], { cwd: repo });
    expect(r.status, r.output).toBe(0);
    expect(r.output).not.toContain("DIFFERENT repository");
  });

  it("accepts the old path of a staged rename", () => {
    writeFileSync(join(repo, "old.txt"), "content that is long enough to be detected as a rename\n");
    sh("git add old.txt && git commit -qm init && git mv old.txt new.txt");
    const r = runTool("repo-stage", ["old.txt"], { cwd: repo });
    expect(r.status, r.output).toBe(0);
    expect(r.output).not.toContain("DIFFERENT repository");
  });

  it("still refuses a path inside an embedded git repository", () => {
    writeFileSync(join(repo, "seed.txt"), "s\n");
    sh("git add seed.txt && git commit -qm init");
    mkdirSync(join(repo, "nested"), { recursive: true });
    sh("cd nested && git init -q . && git config user.email t@t && git config user.name t && echo n > inner.txt");
    const r = runTool("repo-stage", ["nested/inner.txt"], { cwd: repo });
    expect(r.status).not.toBe(0);
  });
});

describe("group staging is validate-then-mutate", () => {
  const GROUPS_WITH_WHOLE_FILE = `# Commit batch: mixed

## group 1 — feat: mixed
- w.txt
- f.txt @ 1

## group 2 — fix: rest
- f.txt @ 2
`;

  function setup(): void {
    twoHunkFile();
    writeFileSync(join(repo, "w.txt"), "w\n");
    sh("git add w.txt && git commit -qm w");
    writeFileSync(join(repo, "w.txt"), "w changed\n");
  }

  it("a hunk-claim preflight failure leaves the whole-file entries unstaged", () => {
    setup();
    const r = runTool("repo-stage", ["--batch", manifest(GROUPS_WITH_WHOLE_FILE), "--group", "1"], {
      cwd: repo,
      env: { PATH: failingGit('*"apply --cached --check -"') },
    });
    expect(r.status).not.toBe(0);
    expect(sh("git diff --cached --name-only").out.trim()).toBe("");
  });

  it("a late failure names exactly what was staged and the undo recipe", () => {
    setup();
    const r = runTool("repo-stage", ["--batch", manifest(GROUPS_WITH_WHOLE_FILE), "--group", "1"], {
      cwd: repo,
      env: { PATH: failingGit('*"apply --cached -"') },
    });
    expect(r.status).not.toBe(0);
    expect(r.output).toContain("already staged: w.txt");
    expect(r.output).toContain("git restore --staged -- 'w.txt'");
    expect(sh("git diff --cached --name-only").out.trim()).toBe("w.txt");
  });
});
